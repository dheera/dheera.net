import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
};

function isPublicFile(key) {
  if (typeof key !== 'string' || key.includes('\\') || /[\x00-\x1f]/.test(key) || key.split('/').some(part => !part || part.startsWith('.'))) return false;
  return /^(?:[a-zA-Z0-9_%.-]+\/)*(?:index|404)\.html$/.test(key)
    || ['sitemap.xml', 'robots.txt'].includes(key)
    || /^files\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(pdf|txt)$/i.test(key)
    || /^(assets|media|fonts|vendor)\//.test(key) && Boolean(types[path.extname(key).toLowerCase()]);
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Validate and hash the complete public release before uploading any files. */
export async function inventoryRelease(releaseDir, { siteURL }) {
  const origin = new URL(siteURL);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) throw new Error('Deployment siteURL must be an HTTPS origin.');
  const directory = await realpath(releaseDir);
  const objects = [];
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.')) throw new Error(`Hidden file in release: ${key}`);
      if (entry.isSymbolicLink()) throw new Error(`Symlink inside release: ${key}`);
      if (entry.isDirectory()) { await visit(key); continue; }
      if (key === 'manifest.json') continue; // Local build model; never public.
      if (!entry.isFile() || !isPublicFile(key)) throw new Error(`Unexpected public file: ${key}`);
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
  if (!homepage.includes(`rel="canonical" href="${new URL('/', origin).href}"`)) throw new Error('Build canonical URL does not match deployment target.');
  return { directory, manifest: { version: 1, siteURL: origin.origin, release: path.basename(directory), objects: objects.sort((a, b) => a.key.localeCompare(b.key)) } };
}
