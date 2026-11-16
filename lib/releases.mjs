import { readFile, writeFile, mkdir, cp, rename, rm, symlink, link, readlink, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildStaticSite } from './static-site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function readCurrentRelease(outputDir) {
  const current = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'));
  if (!/^[\d]+-[a-f0-9-]+$/.test(current.release)) throw new Error('Invalid release pointer.');
  const directory = path.join(outputDir, 'releases', current.release);
  return { ...current, directory, manifest: JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) };
}

// Each release is complete: any ordinary static host can serve its directory.
export async function createStaticRelease({ manifest, outputDir, release, siteURL, designPreview = false }) {
  const staging = path.join(outputDir, `.staging-${release}`);
  const temporaryLink = path.join(outputDir, `.dist-${release}`);
  const pointer = path.join(outputDir, `current-${release}.tmp`);
  let oldTarget;
  try { oldTarget = await readlink(path.join(outputDir, 'dist')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let linkActivated = false;
  try {
    await mkdir(staging, { recursive: true });
    await buildStaticSite({ manifest, outputDir: staging, siteURL, designPreview });
    const vendor = path.join(staging, 'vendor', 'photoswipe');
    await mkdir(vendor, { recursive: true });
    for (const file of ['photoswipe-lightbox.esm.js', 'photoswipe.esm.js', 'photoswipe.css']) {
      await cp(path.join(root, 'node_modules/photoswipe/dist', file), path.join(vendor, file));
    }
    await mkdir(path.join(staging, 'media'));
    const filenames = new Set([...JSON.stringify(manifest).matchAll(/(?:^|[\s"'(])\/media\/([a-zA-Z0-9][a-zA-Z0-9._-]*)/g)].map(match => match[1]));
    for (const filename of filenames) {
      const source = path.join(outputDir, 'media', filename), target = path.join(staging, 'media', filename);
      // Content-addressed files are immutable; hard links avoid duplicating a large photo library.
      try { await link(source, target); }
      catch (error) { if (['EXDEV', 'EPERM', 'EACCES', 'EMLINK', 'ENOTSUP'].includes(error.code)) await cp(source, target); else throw error; }
    }
    await writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await mkdir(path.join(outputDir, 'releases'), { recursive: true });
    await rename(staging, path.join(outputDir, 'releases', release));
    await writeFile(pointer, JSON.stringify({ release }) + '\n');
    await symlink(path.join('releases', release), temporaryLink);
    await rename(temporaryLink, path.join(outputDir, 'dist'));
    linkActivated = true;
    await rename(pointer, path.join(outputDir, 'current.json'));
  } catch (error) {
    if (linkActivated) {
      if (oldTarget) {
        await symlink(oldTarget, temporaryLink);
        await rename(temporaryLink, path.join(outputDir, 'dist'));
      } else await rm(path.join(outputDir, 'dist'), { force: true });
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(temporaryLink, { force: true });
    await rm(pointer, { force: true });
  }
}

export async function rebuildSite({ outputDir, siteURL = 'https://dheera.net', designPreview = false }) {
  outputDir = path.resolve(outputDir);
  const lockPath = path.join(outputDir, '.publish-lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another publish is running (.publish-lock exists).'); throw error; }
  try {
    const { manifest } = await readCurrentRelease(outputDir);
    const release = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    await createStaticRelease({ manifest, outputDir, release, siteURL, designPreview });
    return manifest;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
