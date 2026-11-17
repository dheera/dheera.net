import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { buildTravelMap } from './travel-map.mjs';

const defaults = {
  name: 'Dheera Venkatraman', email: 'dheera@dheera.net',
  headline: 'A different way of seeing.', intro: 'Software, AI, photography, and other things I make.',
  defaultStyle: 'midnight', github: 'https://github.com/dheera',
  linkedin: 'https://www.linkedin.com/in/vdheera', resume: 'https://dheera.net/resume',
};

export async function readSiteContent(sourceDir, { readSidecar }) {
  const source = await readSidecar(path.join(sourceDir, 'site.md'));
  const override = await readSidecar(path.join(sourceDir, 'site.zh-Hant.md'));
  const about = await readSidecar(path.join(sourceDir, 'about.md'));
  const aboutOverride = await readSidecar(path.join(sourceDir, 'about.zh-Hant.md'));
  const data = { ...defaults, ...source.data, intro: source.body || source.data.intro || defaults.intro };
  for (const name of Object.keys(defaults)) {
    if (typeof data[name] !== 'string') throw new Error(`site.md: ${name} must be text.`);
  }
  if (!['midnight', 'editorial', 'museum'].includes(data.defaultStyle)) throw new Error('site.md: defaultStyle must be midnight, editorial, or museum.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('site.md: email must be an email address.');
  for (const name of ['github', 'linkedin', 'resume']) {
    if (!/^https?:\/\//i.test(data[name])) throw new Error(`site.md: ${name} must be an HTTP(S) URL.`);
  }
  for (const name of ['instagram', 'rednote']) {
    if (data[name] === undefined || data[name] === '') continue;
    let url;
    try { url = typeof data[name] === 'string' ? new URL(data[name]) : null; } catch { /* Invalid optional profile URL. */ }
    if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error(`site.md: ${name} must be an HTTP(S) URL without credentials.`);
    }
  }
  let portrait;
  if (about.data.portrait) {
    if (typeof about.data.portrait !== 'string' || !/\.(jpe?g|png|webp|avif)$/i.test(about.data.portrait)) throw new Error('about.md: portrait must reference an image.');
    const root = await realpath(sourceDir);
    const file = await realpath(path.resolve(sourceDir, about.data.portrait));
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error('about.md: portrait must remain inside the content directory.');
    portrait = file;
  }
  let travelMap;
  if (about.data.travelMap) {
    if (typeof about.data.travelMap !== 'string' || !/\.(geojson|json)$/i.test(about.data.travelMap)) throw new Error('about.md: travelMap must reference a GeoJSON file.');
    const root = await realpath(sourceDir);
    const file = await realpath(path.resolve(sourceDir, about.data.travelMap));
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error('about.md: travelMap must remain inside the content directory.');
    travelMap = buildTravelMap(JSON.parse(await readFile(file, 'utf8')));
  }
  return { data, hasSource: source.exists, override, about, aboutOverride, portrait, travelMap };
}

export function siteTexts({ data, hasSource, override, about, aboutOverride }) {
  return [
    ...(hasSource && override.data.headline === undefined ? [data.headline] : []),
    ...(!hasSource || override.body || override.data.intro ? [] : [data.intro]),
    ...(about.exists && aboutOverride.data.title === undefined ? [about.data.title ?? 'About'] : []),
    ...(about.exists && !aboutOverride.body ? [about.body] : []),
  ];
}

export async function renderSiteContent({ data, override, about, aboutOverride, portrait, travelMap }, { outputDir, renderPhoto, markdown, translator }) {
  const headline = override.data.headline ?? translator.get(data.headline);
  const intro = override.body || override.data.intro || translator.get(data.intro);
  const title = about.data.title ?? 'About';
  const aboutTitle = aboutOverride.data.title ?? translator.get(title);
  const aboutBody = about.body ? aboutOverride.body || translator.get(about.body) : undefined;
  return {
    site: { ...data, headlineHtml: markdown.renderInline(data.headline), introHtml: markdown.render(data.intro),
      translations: { 'zh-Hant': {
        ...(headline !== undefined ? { headline, headlineHtml: markdown.renderInline(headline) } : {}),
        ...(intro !== undefined ? { intro, introHtml: markdown.render(intro) } : {}),
      } } },
    about: about.exists ? { title, bodyHtml: markdown.render(about.body), travelMap,
      portrait: portrait ? await renderPhoto({ source: portrait, file: path.basename(portrait), alt: data.name, body: '' }, outputDir) : null,
      translations: { 'zh-Hant': {
        ...(aboutTitle !== undefined ? { title: aboutTitle } : {}),
        ...(aboutBody !== undefined ? { bodyHtml: markdown.render(aboutBody) } : {}),
      } },
    } : null,
  };
}
