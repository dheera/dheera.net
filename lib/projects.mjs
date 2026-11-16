import { readdir, realpath, stat, mkdir, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import MarkdownIt from 'markdown-it';

const imageExtension = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const copyExtensions = new Set(['.mp4', '.webm', '.pdf']);
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const compare = (a, b) => natural.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const inside = (root, file) => file.startsWith(root + path.sep);

async function containedFile(directory, filename, optional = false) {
  const candidate = path.resolve(directory, filename);
  if (!inside(directory, candidate)) throw new Error(`${directory}: asset path escapes project: ${filename}`);
  try {
    const actual = await realpath(candidate);
    if (!inside(directory, actual)) throw new Error(`${directory}: asset symlink escapes project: ${filename}`);
    if (!(await stat(actual)).isFile()) throw new Error(`${candidate}: expected a file.`);
    return actual;
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function destination(value, label, allowRoot = false) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\\]/.test(value)) {
    throw new Error(`${label}: expected a URL without spaces or control characters.`);
  }
  if (allowRoot && value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol)) return url.href;
  } catch {}
  throw new Error(`${label}: expected an http(s) URL${allowRoot ? ' or root-relative path' : ''}.`);
}

function validateMetadata(data, file) {
  for (const field of ['title', 'summary', 'slug', 'cover', 'href', 'github', 'demo', 'video']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`${file}: ${field} must be text.`);
  }
  if (data.order !== undefined && (typeof data.order !== 'number' || !Number.isFinite(data.order))) {
    throw new Error(`${file}: order must be a finite number.`);
  }
  if (data.draft !== undefined && typeof data.draft !== 'boolean') throw new Error(`${file}: draft must be true or false.`);
  if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some(tag => typeof tag !== 'string'))) {
    throw new Error(`${file}: tags must be a list of text values.`);
  }
}

function youtubeVideo(value, label) {
  if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return undefined;
  let url;
  try { url = new URL(value); } catch {}
  const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
  if (!url || url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error(`${label}: video must be a local .mp4/.webm file or an HTTPS YouTube video URL.`);
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const shortHost = url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be';
  const portrait = !shortHost && parts[0] === 'shorts';
  const id = shortHost && parts.length === 1 ? parts[0]
    : parts.length === 1 && parts[0] === 'watch' ? url.searchParams.get('v')
    : parts.length === 2 && ['shorts', 'embed'].includes(parts[0]) ? parts[1] : null;
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new Error(`${label}: expected a YouTube watch, Shorts, embed, or youtu.be URL with a valid video ID.`);
  return { provider: 'youtube', id, src: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`,
    href: `https://www.youtube.com/watch?v=${id}`, portrait };
}

/** Only folders containing project.md are published. Drafts are skipped; empty entries fail. */
export async function scanProjects(projectsDir, { readSidecar }) {
  if (!projectsDir) return [];
  let directory;
  try { directory = await realpath(projectsDir); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const folders = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => compare(a.name, b.name));
  const projects = [], slugs = new Set();
  for (const folder of folders) {
    const dir = await realpath(path.join(directory, folder.name));
    if (!inside(directory, dir)) throw new Error(`Project directory escapes source: ${dir}`);
    const file = await containedFile(dir, 'project.md', true);
    if (!file) continue;
    const source = await readSidecar(file);
    const data = source.data;
    validateMetadata(data, file);
    if (data.draft) continue;
    const overrideFile = await containedFile(dir, 'project.zh-Hant.md', true);
    const override = overrideFile ? await readSidecar(overrideFile) : { data: {}, body: '', exists: false };
    validateMetadata(override.data, overrideFile ?? file);
    const slug = data.slug ?? folder.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`${file}: invalid project slug.`);
    if (slugs.has(slug)) throw new Error(`Duplicate project slug: ${slug}`);
    slugs.add(slug);
    const title = data.title ?? folder.name.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase());
    if (!title.trim()) throw new Error(`${file}: project title cannot be empty.`);
    const github = data.github === undefined ? undefined : destination(data.github, `${file}: github`);
    const demo = data.demo === undefined ? undefined : destination(data.demo, `${file}: demo`);
    const direct = data.href === undefined ? undefined : destination(data.href, `${file}: href`, true);
    const hasPage = direct === undefined && Boolean(source.body || data.video || (!demo && !github && data.cover));
    const href = direct ?? (hasPage ? `/projects/${slug}/` : demo ?? github);
    if (!href) throw new Error(`${file}: add a destination (href, demo or github), body, cover, or video; empty project pages are not published.`);
    projects.push({ dir, slug, title, summary: data.summary ?? '', body: source.body, override,
      href, hasPage, github, demo, coverFile: data.cover, videoFile: data.video,
      order: data.order ?? null, tags: data.tags ?? [] });
  }
  return projects.sort((a, b) => {
    if (a.order !== null && b.order === null) return -1;
    if (a.order === null && b.order !== null) return 1;
    return (a.order !== null ? a.order - b.order : 0) || compare(a.slug, b.slug);
  });
}

export function projectTexts(projects) {
  return projects.flatMap(project => [
    ...(project.override.data.title === undefined ? [project.title] : []),
    ...(project.override.data.summary === undefined ? [project.summary] : []),
    ...(project.override.body ? [] : [project.body]),
  ]).filter(Boolean);
}

async function copyAsset(source, extension, outputDir) {
  const temp = path.join(outputDir, 'media', `.project-${randomUUID()}.tmp`);
  const hash = createHash('sha256').update('dheera-project-asset-v1\0');
  try {
    await pipeline(createReadStream(source), new Transform({
      transform(chunk, encoding, callback) { hash.update(chunk); callback(null, chunk); },
    }), createWriteStream(temp, { flags: 'wx' }));
    const filename = `${hash.digest('hex').slice(0, 24)}${extension}`;
    await rename(temp, path.join(outputDir, 'media', filename));
    return { src: `/media/${filename}` };
  } finally {
    await rm(temp, { force: true });
  }
}

/** Relative Markdown assets are validated and published, never served from the source tree. */
export async function renderProjects(projects, { outputDir, renderPhoto, markdown, translator }) {
  // Keep author HTML inert, including in manually translated Markdown.
  const renderer = markdown?.options?.html === false ? markdown : new MarkdownIt({ html: false, linkify: true, typographer: true });
  await mkdir(path.join(outputDir, 'media'), { recursive: true });
  const manifests = [];
  for (const project of projects) {
    const assets = new Map();
    async function asset(filename, imageOnly = false) {
      const source = await containedFile(project.dir, filename);
      const extension = path.extname(source).toLowerCase();
      const isImage = imageExtension.test(source);
      if ((!isImage && !copyExtensions.has(extension)) || (imageOnly && !isImage)) {
        throw new Error(`${project.dir}: unsupported ${imageOnly ? 'image' : 'asset'}: ${filename}. Publish interactive demos separately and link to their URL.`);
      }
      if (!assets.has(source)) {
        assets.set(source, isImage
          ? renderPhoto({ source, file: filename, title: '', alt: project.title, order: null, body: '' }, outputDir)
          : copyAsset(source, extension, outputDir));
      }
      return assets.get(source);
    }
    async function rewrite(url, imageOnly = false) {
      if (/^[a-z][a-z\d+.-]*:/i.test(url)) {
        const protocol = new URL(url).protocol;
        if (/^https?:$/.test(protocol) || (!imageOnly && protocol === 'mailto:')) return { src: url };
        throw new Error(`${project.dir}: unsupported link protocol: ${url}`);
      }
      if (url.startsWith('/') || url.startsWith('#')) {
        if (url.startsWith('//') || /[\u0000-\u0020\\]/.test(url)) throw new Error(`${project.dir}: unsafe link: ${url}`);
        return { src: url };
      }
      const split = url.search(/[?#]/);
      const pathname = split < 0 ? url : url.slice(0, split);
      const suffix = split < 0 ? '' : url.slice(split);
      let filename;
      try { filename = decodeURIComponent(pathname); }
      catch { throw new Error(`${project.dir}: malformed asset URL: ${url}`); }
      if (!filename || filename.includes('\\') || filename.includes('\0')) throw new Error(`${project.dir}: invalid asset URL: ${url}`);
      const result = await asset(filename, imageOnly);
      return { ...result, src: result.src + suffix };
    }
    async function bodyHtml(body) {
      const env = {}, tokens = renderer.parse(body, env);
      async function visit(items) {
        for (const token of items) {
          if (token.type === 'image' || token.type === 'link_open') {
            const attribute = token.type === 'image' ? 'src' : 'href';
            const media = await rewrite(token.attrGet(attribute), token.type === 'image');
            token.attrSet(attribute, media.src);
            if (token.type === 'image' && media.srcset) {
              token.attrSet('srcset', media.srcset);
              token.attrSet('sizes', '(max-width: 900px) 100vw, 900px');
              token.attrSet('width', String(media.width));
              token.attrSet('height', String(media.height));
              token.attrSet('loading', 'lazy');
            }
          }
          if (token.children) await visit(token.children);
        }
      }
      await visit(tokens);
      return renderer.renderer.render(tokens, renderer.options, env);
    }
    const cover = project.coverFile ? await asset(project.coverFile, true) : undefined;
    let video = project.videoFile ? youtubeVideo(project.videoFile, project.dir) : undefined;
    if (project.videoFile && !video) {
      const source = await containedFile(project.dir, project.videoFile);
      const extension = path.extname(source).toLowerCase();
      if (!['.mp4', '.webm'].includes(extension)) throw new Error(`${project.dir}: video must be a local .mp4 or .webm file.`);
      const published = await asset(project.videoFile);
      video = { src: published.src, type: extension === '.mp4' ? 'video/mp4' : 'video/webm' };
    }
    const translations = {};
    for (const field of ['title', 'summary']) {
      const value = project[field] ? project.override.data[field] ?? translator?.get(project[field]) : undefined;
      if (value !== undefined) translations[field] = value;
    }
    const translatedBody = project.body ? project.override.body || translator?.get(project.body) : undefined;
    if (translatedBody !== undefined) translations.bodyHtml = await bodyHtml(translatedBody);
    manifests.push({ slug: project.slug, title: project.title, summary: project.summary,
      href: project.href, hasPage: project.hasPage, github: project.github, demo: project.demo,
      tags: project.tags, cover, video, bodyHtml: await bodyHtml(project.body), translations: { 'zh-Hant': translations } });
  }
  return manifests;
}
