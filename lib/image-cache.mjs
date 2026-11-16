import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Cache only image geometry/exports. Captions and all other authored text are read each build.
export async function createImageRenderer(outputDir, renderPhoto, markdown) {
  const filename = path.join(outputDir, '.image-cache.json');
  let previous = {};
  try { previous = JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const next = {};
  return {
    async render(photo) {
      const info = await stat(photo.source, { bigint: true });
      const signature = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':');
      let cached = next[photo.source] ?? previous[photo.source];
      if (cached?.signature === signature) {
        const files = cached.image.srcset.split(', ').map(item => path.join(outputDir, item.split(' ')[0]));
        const available = await Promise.all(files.map(file => stat(file).then(value => value.isFile()).catch(() => false)));
        if (!available.every(Boolean)) cached = undefined;
      }
      if (cached?.signature !== signature) {
        const result = await renderPhoto(photo, outputDir);
        const { id, src, thumb, width, height, srcset } = result;
        cached = { signature, image: { id, src, thumb, width, height, srcset } };
      }
      next[photo.source] = cached;
      return { ...cached.image, file: photo.file, title: photo.title, alt: photo.alt, order: photo.order,
        captionHtml: markdown.render(photo.body ?? '') };
    },
    async save() {
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next) + '\n');
      await rename(temporary, filename);
    },
  };
}
