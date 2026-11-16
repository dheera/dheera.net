import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, open, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deployRelease, validateTarget } from './lib/deploy.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const { values } = parseArgs({ options: {
  target: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
} });

if (values.help) {
  console.log('Usage: npm run deploy -- [--target preview] [--dry-run] [--force]\nBuilds saved NAS content, then uploads changed public files using deploy.config.json. --dry-run builds and reads remote state without uploading. --force reuploads all files. No translations or DNS changes.');
} else {
  const lockPath = path.join(root, '.deploy-lock');
  let lock;
  try {
    const config = JSON.parse(await readFile(path.join(root, 'deploy.config.json'), 'utf8'));
    const name = values.target || config.defaultTarget;
    if (config.version !== 1 || !/^[\w-]+$/.test(name || '') || !Object.hasOwn(config.targets || {}, name)) throw new Error('Unknown deployment target.');
    const target = validateTarget(config.targets[name]);
    lock = await open(lockPath, 'wx');
    console.log(`Building for ${target.siteURL} → s3://${target.bucket}/ (${target.profile}).`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'publish.mjs'), '--site-url', target.siteURL], { cwd: root, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Local build failed (${code}); nothing uploaded.`)));
    });
    const result = await deployRelease({ releaseDir: path.join(root, 'dist'), target, dryRun: values['dry-run'], force: values.force });
    if (!result.dryRun) {
      const receipts = path.join(root, '.published', 'deployments', name);
      await mkdir(receipts, { recursive: true });
      await writeFile(path.join(receipts, 'current.json'), JSON.stringify(result.manifest, null, 2) + '\n');
      console.log(`Uploaded ${result.uploads.length} files. Preview: ${target.siteURL}\nAllow up to two minutes for existing cached responses. DNS and CloudFront settings were not changed.`);
    }
  } catch (error) {
    console.error(`Deploy failed: ${error.code === 'EEXIST' ? 'Another deployment is running (.deploy-lock exists).' : error.message}`);
    process.exitCode = 1;
  } finally {
    if (lock) { await lock.close(); await rm(lockPath, { force: true }); }
  }
}
