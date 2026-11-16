import { readdir } from 'node:fs/promises';
import path from 'node:path';

const imageFile = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const compareNames = (a, b) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

function validateMetadata(sidecar, file) {
  for (const key of ['a', 'b']) {
    const value = sidecar.data[key];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}: ${key} must be a mapping.`);
    for (const field of ['label', 'alt']) {
      if (value[field] !== undefined && typeof value[field] !== 'string') throw new Error(`${file}: ${key}.${field} must be text.`);
    }
  }
}

/** Pair folders publish only a.* and b.*. original.jpg is an optional local archive. */
export async function scanPairs(directory, { readSidecar }) {
  const folders = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'));
  const pairs = [];
  for (const folder of folders) {
    const dir = path.join(directory, folder.name);
    const files = (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isFile() && imageFile.test(entry.name));
    const sides = {};
    for (const side of ['a', 'b']) {
      const matches = files.filter(entry => path.parse(entry.name).name.toLowerCase() === side);
      if (matches.length !== 1) throw new Error(`${dir}: each pair needs exactly one ${side} image (for example ${side}.jpg); found ${matches.length}.`);
      sides[side] = { file: `${folder.name}/${matches[0].name}`, source: path.join(dir, matches[0].name) };
    }
    const sidecar = await readSidecar(path.join(dir, 'pair.md'));
    const override = await readSidecar(path.join(dir, 'pair.zh-Hant.md'));
    validateMetadata(sidecar, path.join(dir, 'pair.md'));
    validateMetadata(override, path.join(dir, 'pair.zh-Hant.md'));
    pairs.push({ id: folder.name, title: sidecar.data.title ?? '', body: sidecar.body,
      order: sidecar.data.order ?? null, data: sidecar.data, override, ...sides });
  }
  return pairs.sort((a, b) => {
    if (a.order !== null && b.order === null) return -1;
    if (a.order === null && b.order !== null) return 1;
    return (a.order !== null ? a.order - b.order : 0) || compareNames(a.id, b.id);
  });
}

export function pairTexts(pairs) {
  return pairs.flatMap(pair => [
    ...(pair.override.data.title === undefined ? [pair.title] : []),
    ...(pair.override.body ? [] : [pair.body]),
    ...['a', 'b'].flatMap(side => ['label', 'alt'].flatMap(field =>
      pair.override.data[side]?.[field] === undefined ? [pair.data[side]?.[field]] : [])),
  ]).filter(Boolean);
}

export async function renderPairs(pairs, { renderPhoto, markdown }) {
  const result = [];
  for (const pair of pairs) {
    const local = {};
    if (pair.title && pair.override.data.title !== undefined) local.title = pair.override.data.title;
    if (pair.body && pair.override.body) local.captionHtml = markdown.render(pair.override.body);
    const rendered = { id: pair.id, title: pair.title, captionHtml: markdown.render(pair.body), order: pair.order,
      translations: { 'zh-Hant': local } };
    for (const side of ['a', 'b']) {
      const metadata = pair.data[side] ?? {}, override = pair.override.data[side] ?? {};
      const label = metadata.label || side.toUpperCase();
      const title = [pair.title, label].filter(Boolean).join(' — ');
      const localLabel = metadata.label ? override.label ?? label : label;
      const localTitle = [local.title ?? pair.title, localLabel].filter(Boolean).join(' — ');
      rendered[side] = { ...await renderPhoto({ ...pair[side], title, alt: metadata.alt || title, body: '', order: pair.order }), label,
        translations: { 'zh-Hant': { label: localLabel, title: localTitle, alt: metadata.alt ? override.alt ?? metadata.alt : localTitle } } };
    }
    result.push(rendered);
  }
  return result;
}
