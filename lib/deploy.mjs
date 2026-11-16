import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile, realpath, mkdtemp, mkdir, link, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const stateKey = '_deploy/current.json';
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

export function validateTarget(target) {
  if (!target || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(target.bucket || '')) throw new Error('Invalid deployment bucket.');
  if (!/^[a-z0-9-]+$/.test(target.region || '') || !/^[\w.-]+$/.test(target.profile || '')) throw new Error('Explicit region and AWS profile are required.');
  const url = new URL(target.siteURL);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Deployment siteURL must be an HTTPS origin.');
  if (target.cacheControl !== 'public, max-age=60, s-maxage=60, must-revalidate, stale-if-error=0') throw new Error('Use the configured 60-second cache policy.');
  if (target.invalidateCloudFront !== false) throw new Error('This uploader uses bucket-only access, without CloudFront invalidations.');
  return target;
}

export function awsCLI(target) {
  validateTarget(target);
  return async args => {
    const { stdout } = await exec('aws', [...args, '--profile', target.profile, '--region', target.region, '--no-cli-pager', '--output', 'json'], {
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' },
    });
    return stdout;
  };
}

function isPage(key) {
  return /^(?:[a-zA-Z0-9_%.-]+\/)*(?:index|404)\.html$/.test(key);
}

function isPublicKey(key) {
  if (typeof key !== 'string' || key.includes('\\') || /[\x00-\x1f]/.test(key) || key.split('/').some(part => !part || part.startsWith('.'))) return false;
  return isPage(key) || ['sitemap.xml', 'robots.txt'].includes(key)
    || /^(assets|media|fonts|vendor)\//.test(key) && Boolean(types[path.extname(key).toLowerCase()]);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function inventoryRelease(releaseDir, target) {
  validateTarget(target);
  const directory = await realpath(releaseDir);
  const objects = [];
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.')) throw new Error(`Hidden file in release: ${key}`);
      if (entry.isSymbolicLink()) throw new Error(`Symlink inside release: ${key}`);
      if (entry.isDirectory()) { await visit(key); continue; }
      if (key === 'manifest.json') continue; // Local build model; never public.
      if (!entry.isFile() || !isPublicKey(key)) throw new Error(`Unexpected public file: ${key}`);
      if (key.endsWith('.html')) {
        const html = await readFile(path.join(directory, key), 'utf8');
        if (html.includes('data-design-preview="true"')) throw new Error('Design-preview controls must not be deployed.');
      }
      objects.push({ key, sha256: await sha256(path.join(directory, key)), contentType: types[path.extname(key).toLowerCase()] });
    }
  }
  await visit();
  for (const required of ['index.html', '404.html', 'zh-hant/index.html', 'sitemap.xml', 'robots.txt']) {
    if (!objects.some(file => file.key === required)) throw new Error(`Incomplete release: ${required} missing.`);
  }
  const homepage = await readFile(path.join(directory, 'index.html'), 'utf8');
  if (!homepage.includes(`rel="canonical" href="${new URL('/', target.siteURL).href}"`)) throw new Error('Build canonical URL does not match deployment target.');
  return { directory, manifest: { version: 1, bucket: target.bucket, siteURL: target.siteURL, release: path.basename(directory), cacheControl: target.cacheControl, objects: objects.sort((a, b) => a.key.localeCompare(b.key)) } };
}

export function createDeployPlan(current, previous, { force = false } = {}) {
  if (previous) {
    if (previous.version !== 1 || previous.bucket !== current.bucket || !Array.isArray(previous.objects)) throw new Error('Invalid previous deployment manifest; no files changed.');
    const seen = new Set();
    for (const file of previous.objects) {
      if (!isPublicKey(file.key) || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || seen.has(file.key)) throw new Error('Invalid object in previous deployment manifest.');
      seen.add(file.key);
    }
  }
  const old = new Map((previous?.objects || []).map(file => [file.key, file]));
  const next = new Set(current.objects.map(file => file.key));
  const uploads = current.objects.filter(file => force || previous?.cacheControl !== current.cacheControl || old.get(file.key)?.sha256 !== file.sha256 || old.get(file.key)?.contentType !== file.contentType);
  const deleted = (previous?.objects || []).filter(file => isPage(file.key) && !next.has(file.key)).map(file => file.key);
  return { uploads, deleted };
}

export async function deployRelease({ releaseDir, target, aws = awsCLI(target), dryRun = false, force = false, log = console.log }) {
  const { directory, manifest } = await inventoryRelease(releaseDir, target);
  const temp = await mkdtemp(path.join(tmpdir(), 'dheera-deploy-'));
  try {
    let previous;
    const previousFile = path.join(temp, 'previous.json');
    try {
      await aws(['s3api', 'get-object', '--bucket', target.bucket, '--key', stateKey, previousFile]);
      previous = JSON.parse(await readFile(previousFile, 'utf8'));
    } catch (error) {
      if (!/\(NoSuchKey\)/.test(error.stderr || '')) throw error;
    }
    const plan = createDeployPlan(manifest, previous, { force });
    log(`${dryRun ? 'Plan' : 'Deploy'}: ${manifest.objects.length} public files; ${plan.uploads.length} to upload; ${plan.deleted.length} obsolete pages to remove.`);
    if (dryRun) return { manifest, ...plan, dryRun: true };
    // Hard-link a fixed release into MIME/phase batches. The CLI transfers each batch concurrently.
    for (const phase of ['media', 'assets', 'pages']) {
      const phaseOf = key => key.startsWith('media/') ? 'media' : isPage(key) || ['sitemap.xml', 'robots.txt'].includes(key) ? 'pages' : 'assets';
      const files = plan.uploads.filter(file => phaseOf(file.key) === phase);
      const groups = new Map();
      for (const file of files) {
        if (!groups.has(file.contentType)) groups.set(file.contentType, []);
        groups.get(file.contentType).push(file);
      }
      for (const [contentType, batch] of groups) {
        const staging = await mkdtemp(path.join(temp, `${phase}-`));
        for (const file of batch) {
          const dest = path.join(staging, file.key);
          await mkdir(path.dirname(dest), { recursive: true });
          try { await link(path.join(directory, file.key), dest); }
          catch (error) { if (['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) await cp(path.join(directory, file.key), dest); else throw error; }
        }
        log(`Uploading ${batch.length} ${phase} files (${contentType}).`);
        await aws(['s3', 'cp', staging, `s3://${target.bucket}/`, '--recursive', '--no-follow-symlinks', '--only-show-errors', '--cache-control', target.cacheControl, '--content-type', contentType]);
      }
    }
    // No bucket-wide sync/delete: only HTML owned by the previous successful deployment.
    for (let offset = 0; offset < plan.deleted.length; offset += 1000) {
      const requestFile = path.join(temp, 'delete.json');
      await writeFile(requestFile, JSON.stringify({ Objects: plan.deleted.slice(offset, offset + 1000).map(Key => ({ Key })), Quiet: true }));
      const result = JSON.parse(await aws(['s3api', 'delete-objects', '--bucket', target.bucket, '--delete', `file://${requestFile}`]));
      if (result.Errors?.length) throw new Error(`S3 could not remove ${result.Errors.length} obsolete pages; deployment not recorded.`);
    }
    const manifestFile = path.join(temp, 'current.json');
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
    // Records contain public object keys/hashes only, never source paths or the build manifest.
    for (const key of [`_deploy/releases/${manifest.release}.json`, stateKey]) {
      await aws(['s3', 'cp', manifestFile, `s3://${target.bucket}/${key}`, '--only-show-errors', '--cache-control', target.cacheControl, '--content-type', 'application/json']);
    }
    return { manifest, ...plan, dryRun: false };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
