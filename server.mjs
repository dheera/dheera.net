import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = path.resolve(process.env.GALLERY_OUTPUT ?? path.join(dir, '.published'));
const port = Number(process.env.PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf' };
const server = http.createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); return response.end(); }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const current = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'));
    if (!/^[\d]+-[a-f0-9-]+$/.test(current.release)) throw new Error('Invalid release pointer.');
    const base = path.join(outputDir, 'releases', current.release);
    const relative = pathname.slice(1) || 'index.html';
    let target = path.resolve(base, relative);
    if (!target.startsWith(base + path.sep) || relative.split('/').some(part => part.startsWith('.'))) {
      response.writeHead(403); return response.end('Forbidden');
    }
    let info = await stat(target);
    if (info.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const url = new URL(request.url, 'http://localhost');
        response.writeHead(301, { Location: pathname + '/' + url.search }); return response.end();
      }
      target = path.join(target, 'index.html');
      info = await stat(target);
    }
    if (!info.isFile()) { response.writeHead(404); return response.end('Not found'); }
    const headers = { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
      'Content-Length': info.size, 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes',
      'Cache-Control': pathname.startsWith('/media/') ? 'public, max-age=31536000, immutable' : 'no-store' };
    let range;
    if (request.headers.range) {
      const match = request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
      let start, end;
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return response.end();
      }
      range = { start, end };
      headers['Content-Length'] = end - start + 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') return response.end();
    createReadStream(target, range).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        const current = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'));
        const page = await readFile(path.join(outputDir, 'releases', current.release, '404.html'));
        response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.length, 'Cache-Control': 'no-store' });
        return response.end(request.method === 'HEAD' ? undefined : page);
      } catch (_) {}
    }
    response.writeHead(error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(request.method === 'HEAD' ? undefined : error.code === 'ENOENT' ? 'Not found. Run npm run publish first.' : 'Could not serve this release.');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local: http://localhost:${port}`));
