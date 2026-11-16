import { readdir, readFile, mkdir, stat, realpath, rename, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import MarkdownIt from 'markdown-it';
import sharp from 'sharp';
import { createStaticRelease } from './releases.mjs';
import { createImageRenderer } from './image-cache.mjs';
import { scanProjects, projectTexts, renderProjects } from './projects.mjs';
import { readSiteContent, siteTexts, renderSiteContent } from './site-content.mjs';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const images = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const compareNames = (a, b) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const humanize = value => value.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());
const validSlug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

async function exists(file) {
  try { await stat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function readSidecar(file) {
  let content;
  try { content = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'); }
  catch (error) { if (error.code === 'ENOENT') return { data: {}, body: '', exists: false }; throw error; }
  let data = {}, body = content;
  if (/^---\s*\n/.test(content)) {
    const match = content.match(/^---[ \t]*\n([\s\S]*?)^---[ \t]*(?:\n|$)/m);
    if (!match) throw new Error(`${file}: YAML header needs a closing --- line.`);
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) throw new Error(`${file}: ${document.errors[0].message}`);
    data = document.toJS({ maxAliasCount: 50 }) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${file}: YAML must be a mapping.`);
    body = content.slice(match[0].length);
  }
  for (const field of ['title', 'alt', 'slug', 'cover', 'layout']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`${file}: ${field} must be text.`);
  }
  if (data.order !== undefined && (typeof data.order !== 'number' || !Number.isFinite(data.order))) {
    throw new Error(`${file}: order must be a finite number.`);
  }
  return { data, body: body.trim(), exists: true };
}

async function scanLibrary(sourceDir) {
  const unified = await exists(path.join(sourceDir, '.publish-library'));
  const markerPath = path.join(sourceDir, unified ? '.publish-library' : '.gallery-library');
  let marker;
  try { marker = JSON.parse(await readFile(markerPath, 'utf8')); }
  catch { throw new Error(`Source library is unavailable or missing a library marker: ${sourceDir}. Initialize it once with --init.`); }
  if (marker.version !== 1 || typeof marker.id !== 'string' || !marker.id) throw new Error('Invalid library marker.');
  if (unified) {
    for (const name of ['photos', 'projects']) {
      if (!(await stat(path.join(sourceDir, name))).isDirectory()) throw new Error(`Missing ${name} directory in source library.`);
    }
  }
  const photoDir = unified ? path.join(sourceDir, 'photos') : sourceDir;
  const galleries = [], slugs = new Set();
  const folders = (await readdir(photoDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => compareNames(a.name, b.name));
  for (const folder of folders) {
    const dir = path.join(photoDir, folder.name);
    const files = (await readdir(dir, { withFileTypes: true }))
      .filter(entry => entry.isFile() && images.test(entry.name));
    if (!files.length) continue;
    const sidecar = await readSidecar(path.join(dir, 'gallery.md'));
    const override = await readSidecar(path.join(dir, 'gallery.zh-Hant.md'));
    const slug = sidecar.data.slug ?? folder.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!validSlug(slug)) throw new Error(`${dir}: invalid gallery slug.`);
    if (slugs.has(slug)) throw new Error(`Duplicate gallery slug: ${slug}`);
    slugs.add(slug);
    const layout = sidecar.data.layout ?? 'grid';
    if (!['grid', 'exhibition'].includes(layout)) throw new Error(`${dir}: layout must be grid or exhibition.`);
    const stems = new Set(), photos = [];
    for (const file of files) {
      const stem = path.parse(file.name).name;
      if (stem === 'gallery' || stems.has(stem)) throw new Error(`${dir}: photo stems must be unique and cannot be "gallery" (${file.name}).`);
      stems.add(stem);
      const photoSidecar = await readSidecar(path.join(dir, `${stem}.md`));
      const photoOverride = await readSidecar(path.join(dir, `${stem}.zh-Hant.md`));
      photos.push({
        file: file.name, source: path.join(dir, file.name),
        title: photoSidecar.data.title ?? '', alt: photoSidecar.data.alt ?? photoSidecar.data.title ?? '',
        order: photoSidecar.data.order ?? null, body: photoSidecar.body, override: photoOverride,
      });
    }
    photos.sort((a, b) => {
      if (a.order !== null && b.order === null) return -1;
      if (a.order === null && b.order !== null) return 1;
      return (a.order !== null ? a.order - b.order : 0) || compareNames(a.file, b.file);
    });
    galleries.push({ slug, title: sidecar.data.title ?? humanize(folder.name), body: sidecar.body,
      layout, coverFile: sidecar.data.cover, photos, override });
  }
  return { marker, galleries, unified };
}

export async function renderPhoto(photo, outputDir) {
  const source = await readFile(photo.source);
  const hash = createHash('sha256').update('dheera-webp-v1\0').update(source).digest('hex').slice(0, 24);
  const meta = await sharp(source).metadata();
  const rotate = [5, 6, 7, 8].includes(meta.orientation);
  const inputWidth = rotate ? meta.height : meta.width;
  const inputHeight = rotate ? meta.width : meta.height;
  if (!inputWidth || !inputHeight) throw new Error(`Cannot determine dimensions: ${photo.source}`);
  const maxEdge = Math.max(inputWidth, inputHeight);
  const sizes = [...new Set([640, 1280, 2560].map(size => Math.min(size, maxEdge)))].sort((a, b) => a - b);
  const renditions = [];
  for (const size of sizes) {
    const name = `${hash}-${size}.webp`;
    const target = path.join(outputDir, 'media', name);
    let width = Math.max(1, Math.round(inputWidth * size / maxEdge));
    let height = Math.max(1, Math.round(inputHeight * size / maxEdge));
    if (!await exists(target)) {
      const temp = `${target}.${randomUUID()}.tmp`;
      const info = await sharp(source).rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 }).toFile(temp);
      width = info.width; height = info.height;
      await rename(temp, target);
    }
    renditions.push({ src: `/media/${name}`, width, height });
  }
  const largest = renditions.at(-1);
  return { id: hash, file: photo.file, title: photo.title, alt: photo.alt, order: photo.order,
    captionHtml: markdown.render(photo.body ?? ''), src: largest.src, thumb: renditions[0].src,
    width: largest.width, height: largest.height,
    srcset: renditions.map(item => `${item.src} ${item.width}w`).join(', ') };
}

function localize(source, translator, gallery = false) {
  const result = {};
  const title = source.title ? source.override.data.title : undefined;
  if (title !== undefined) result.title = title;
  if (!gallery) {
    const alt = source.alt ? source.override.data.alt ?? (source.alt === source.title ? title : undefined) : undefined;
    if (alt !== undefined) result.alt = alt;
  }
  const body = source.body ? source.override.body || undefined : undefined;
  if (body !== undefined) result[gallery ? 'descriptionHtml' : 'captionHtml'] = markdown.render(body);
  return { 'zh-Hant': result };
}

export async function publishLibrary({ sourceDir, outputDir, allowEmpty = false, siteURL = 'https://dheera.net', designPreview = false } = {}) {
  if (!sourceDir || !outputDir) throw new Error('sourceDir and outputDir are required.');
  sourceDir = path.resolve(sourceDir); outputDir = path.resolve(outputDir);
  const { marker, galleries, unified } = await scanLibrary(sourceDir);
  const projects = unified ? await scanProjects(path.join(sourceDir, 'projects'), { readSidecar }) : [];
  const siteContent = await readSiteContent(sourceDir, { readSidecar });
  // A generated output directory must never be inside the content library.
  const actualSource = await realpath(sourceDir);
  await mkdir(outputDir, { recursive: true });
  const actualOutput = await realpath(outputDir);
  if (actualOutput === actualSource || actualOutput.startsWith(actualSource + path.sep) || actualSource.startsWith(actualOutput + path.sep)) {
    throw new Error('Source and output directories must be separate, non-nested locations.');
  }
  const lockPath = path.join(outputDir, '.publish-lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another publish is running (.publish-lock exists).'); throw error; }
  const release = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const staging = path.join(outputDir, `.staging-${release}`);
  try {
    let previous;
    try {
      const current = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'));
      previous = JSON.parse(await readFile(path.join(outputDir, 'releases', current.release, 'manifest.json'), 'utf8'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!galleries.length && !projects.length && (previous?.galleries?.length || previous?.projects?.length) && !allowEmpty) {
      throw new Error('Source library is empty. Use --allow-empty to intentionally remove all photos and projects.');
    }
    await mkdir(path.join(outputDir, 'media'), { recursive: true });
    await mkdir(path.join(outputDir, 'releases'), { recursive: true });
    const texts = [...galleries.flatMap(g => [
      ...(g.override.data.title === undefined ? [g.title] : []), ...(g.override.body ? [] : [g.body]),
      ...g.photos.flatMap(p => [
        ...(p.override.data.title === undefined ? [p.title] : []),
        ...(p.override.data.alt === undefined && !(p.alt === p.title && p.override.data.title !== undefined) ? [p.alt] : []), ...(p.override.body ? [] : [p.body]),
      ]),
    ]), ...projectTexts(projects), ...siteTexts(siteContent)];
    // Publishing consumes saved translations only. Generation is an explicit command.
    const translator = { get: () => undefined, missingCount: texts.filter(Boolean).length };
    const images = await createImageRenderer(outputDir, renderPhoto, markdown);
    const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceId: marker.id,
      translationMissing: translator.missingCount, galleries: [], projects: [] };
    for (const gallery of galleries) {
      const photos = [];
      for (const photo of gallery.photos) {
        photos.push({ ...await images.render(photo), translations: localize(photo, translator) });
      }
      manifest.galleries.push({ slug: gallery.slug, title: gallery.title, descriptionHtml: markdown.render(gallery.body),
        layout: gallery.layout, cover: photos.find(photo => photo.file === gallery.coverFile) ?? photos[0],
        imageCount: photos.length, photos, translations: localize(gallery, translator, true) });
    }
    manifest.projects = await renderProjects(projects, { outputDir, renderPhoto: photo => images.render(photo), markdown, translator });
    Object.assign(manifest, await renderSiteContent(siteContent, { outputDir, renderPhoto: photo => images.render(photo), markdown, translator }));
    await images.save();
    await createStaticRelease({ manifest, outputDir, release, siteURL, designPreview });
    return manifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
