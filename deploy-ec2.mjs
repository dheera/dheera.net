import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, link, cp, open, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inventoryRelease } from './lib/deploy.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));

export function validateEC2Target(target) {
  if (!target || !/^[a-z_][a-z0-9_-]*@[a-z0-9][a-z0-9.-]*$/i.test(target.host || '')) throw new Error('EC2 host must be user@hostname.');
  if (!/^\/[a-zA-Z0-9/_.-]+$/.test(target.directory || '') || target.directory === '/' || path.posix.normalize(target.directory) !== target.directory || target.directory.split('/').some(part => part === '..' || part === '.')) throw new Error('EC2 directory must be a normalized absolute path.');
  const url = new URL(target.siteURL);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('EC2 siteURL must be an HTTPS origin.');
  return target;
}

export function sshArguments(identity) {
  return ['-F', '/dev/null', '-i', identity, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
}

function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }

async function run(command, args, { input, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'] });
    let output = '';
    if (capture) child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited with status ${code}.`)));
    if (input !== undefined) { child.stdin.on('error', reject); child.stdin.end(input); }
  });
}

// The existing inventory validator is shared with S3: these inert labels satisfy
// its metadata contract. This path never invokes the AWS CLI or uploads its manifest.
export async function inventoryEC2Release(releaseDir, target) {
  validateEC2Target(target);
  return inventoryRelease(releaseDir, {
    bucket: 'ec2-static', region: 'not-used', profile: 'not-used', siteURL: target.siteURL,
    cacheControl: 'public, max-age=60, s-maxage=60, must-revalidate, stale-if-error=0', invalidateCloudFront: false,
  });
}

export function remoteScript(action, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  const prelude = `import base64, hashlib, json, os, pathlib, stat\np = json.loads(base64.b64decode('${encoded}'))\nbase = pathlib.Path(p['directory'])\nrelease = base / 'releases' / p['release']\nlock = base / '.deploy-lock'\n`;
  const actions = {
    prepare: `if not (base / 'releases').is_dir():\n    raise RuntimeError('Create the deployment releases directory before publishing.')\nlock.mkdir(mode=0o700)\ntry:\n    (lock / 'owner').write_text(p['release'])\n    release.mkdir(mode=0o755)\nexcept BaseException:\n    (lock / 'owner').unlink(missing_ok=True)\n    lock.rmdir()\n    raise\nprint('Remote release prepared.')\n`,
    activate: `if (lock / 'owner').read_text() != p['release']:\n    raise RuntimeError('Deployment lock ownership changed.')\nexpected = {item['key']: item['sha256'] for item in p['objects']}\nactual = set()\nfor parent, dirs, files in os.walk(release):\n    for name in dirs + files:\n        item = pathlib.Path(parent) / name\n        if item.is_symlink():\n            raise RuntimeError('Symlink in uploaded release.')\n    for name in files:\n        item = pathlib.Path(parent) / name\n        key = item.relative_to(release).as_posix()\n        if not stat.S_ISREG(item.stat().st_mode) or key not in expected:\n            raise RuntimeError('Unexpected file in uploaded release.')\n        digest = hashlib.sha256()\n        with item.open('rb') as stream:\n            for block in iter(lambda: stream.read(1048576), b''):\n                digest.update(block)\n        if digest.hexdigest() != expected[key]:\n            raise RuntimeError('Uploaded file checksum mismatch: ' + key)\n        actual.add(key)\nif actual != set(expected):\n    raise RuntimeError('Uploaded release is incomplete.')\ncurrent = base / 'current'\nif current.exists() and not current.is_symlink():\n    raise RuntimeError('Current deployment is not a symlink; refusing to replace it.')\nprevious = os.readlink(current) if current.is_symlink() else None\nnext_link = base / ('.current-' + p['release'])\nos.symlink('releases/' + p['release'], next_link)\nos.replace(next_link, current)\nprint(json.dumps({'release': p['release'], 'previous': previous, 'verifiedFiles': len(actual)}))\n`,
    unlock: `if lock.is_dir() and (lock / 'owner').read_text() == p['release']:\n    (lock / 'owner').unlink()\n    lock.rmdir()\n`,
  };
  if (!Object.hasOwn(actions, action)) throw new Error('Unknown remote deployment action.');
  return prelude + actions[action];
}

export async function deployEC2({ target, identity, releaseDir, dryRun = false, log = console.log }) {
  const { directory, manifest } = await inventoryEC2Release(releaseDir, target);
  const objects = manifest.objects.map(({ key, sha256 }) => ({ key, sha256 }));
  const digest = createHash('sha256').update(JSON.stringify(objects)).digest('hex').slice(0, 12);
  const release = `${new Date().toISOString().replace(/[-:.]/g, '')}-${digest}`;
  log(`${dryRun ? 'Plan' : 'Deploy'}: ${objects.length} public files → ${target.host}:${target.directory}/releases/${release}`);
  if (dryRun) return { dryRun: true, release, objects };
  const args = sshArguments(identity);
  const payload = { directory: target.directory, release, objects };
  const remote = (action, capture = false) => run('ssh', [...args, target.host, 'python3 -'], { input: remoteScript(action, payload), capture });
  const staging = await mkdtemp(path.join(tmpdir(), 'dheera-ec2-'));
  let prepared = false;
  try {
    for (const file of objects) {
      const destination = path.join(staging, file.key);
      await mkdir(path.dirname(destination), { recursive: true });
      try { await link(path.join(directory, file.key), destination); }
      catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
        await cp(path.join(directory, file.key), destination);
      }
    }
    await remote('prepare');
    prepared = true;
    await run('rsync', ['--recursive', '--times', '--chmod=D755,F644', '--protect-args', '--stats', '-e', ['ssh', ...args].map(shellQuote).join(' '), '--', `${staging}/`, `${target.host}:${target.directory}/releases/${release}/`]);
    const result = JSON.parse((await remote('activate', true)).trim());
    log(`Verified ${result.verifiedFiles} files; activated ${release}.`);
    return { ...result, siteURL: target.siteURL, host: target.host, directory: target.directory, dryRun: false };
  } finally {
    if (prepared) {
      try { await remote('unlock'); }
      catch { console.error('Could not clear the remote deployment lock. Check server connectivity before the next deployment.'); }
    }
    await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    identity: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: npm run deploy:production -- [--dry-run] [--identity /path/to/ssh-key]\nBuilds saved NAS content, verifies a complete remote release, and atomically activates it. Dry run builds and inventories locally without contacting the server.');
    return;
  }
  const lockPath = path.join(root, '.ec2-deploy-lock');
  let lock;
  try {
    const target = validateEC2Target(JSON.parse(await readFile(path.join(root, 'deployment', 'ec2.json'), 'utf8')));
    const key = values.identity || process.env.DHEERA_SSH_KEY || path.join(homedir(), 'private', 'aws', 'aws-us-west.pem');
    const identity = path.resolve(key.startsWith('~/') ? path.join(homedir(), key.slice(2)) : key);
    lock = await open(lockPath, 'wx');
    await run(process.execPath, [path.join(root, 'publish.mjs'), '--site-url', target.siteURL]);
    const result = await deployEC2({ target, identity, releaseDir: path.join(root, 'dist'), dryRun: values['dry-run'] });
    if (!result.dryRun) {
      const receipts = path.join(root, '.published', 'deployments', 'production');
      await mkdir(receipts, { recursive: true });
      await writeFile(path.join(receipts, 'current.json'), JSON.stringify(result, null, 2) + '\n');
      console.log(`Published: ${target.siteURL}`);
    }
  } catch (error) {
    console.error(`Production deploy failed: ${error.code === 'EEXIST' ? 'A deployment lock already exists.' : error.message}`);
    process.exitCode = 1;
  } finally {
    if (lock) { await lock.close(); await rm(lockPath, { force: true }); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
