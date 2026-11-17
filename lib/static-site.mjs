import Eleventy from '@11ty/eleventy';
import { readFile, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const themeDirectory = fileURLToPath(new URL('../theme/', import.meta.url));
const styleNames = ['editorial', 'midnight', 'museum'];

function plainText(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name.toLowerCase()] || entity;
  }).replace(/\s+/g, ' ').trim();
}

function translated(value, fields, language) {
  const result = { ...(value || {}) };
  const localized = value?.translations?.[language];
  for (const field of fields) if (localized?.[field] !== undefined && localized[field] !== null) result[field] = localized[field];
  return result;
}

function localizePath(value, language) {
  return language === 'zh-Hant' ? `/zh-hant${value}` : value;
}

function link(value, language, siteURL) {
  if (!value || typeof value !== 'string') return null;
  let url;
  try { url = new URL(value, siteURL); } catch { return null; }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
  const local = value.startsWith('/') && !value.startsWith('//');
  if (local) {
    const localized = /^\/(?:projects|photos|about)(?:\/|$)/.test(url.pathname) || url.pathname === '/';
    return { href: (localized ? localizePath(url.pathname, language) : url.pathname) + url.search + url.hash, local: true };
  }
  return { href: url.href, local: false };
}

function actionsFor(project, language, t, siteURL, includePrimary = false) {
  const actions = [], seen = new Set();
  const add = (value, label) => {
    const destination = link(value, language, siteURL);
    if (destination && !seen.has(destination.href)) {
      actions.push({ ...destination, label });
      seen.add(destination.href);
    }
  };
  add(project.github, t.sourceCode);
  const demo = link(project.demo, language, siteURL);
  const isVideo = demo && /(^|\.)(youtube\.com|youtu\.be|vimeo\.com)$/.test(new URL(demo.href, siteURL).hostname);
  add(project.demo, isVideo ? t.watchVideo : t.liveDemo);
  if (includePrimary && project.href && !project.href.startsWith('/')) add(project.href, t.visitProject);
  return actions;
}

function galleryFor(source, language, t) {
  const gallery = translated(source, ['title', 'descriptionHtml'], language);
  gallery.photos = (source.photos || []).map(photo => {
    const translatedPhoto = translated(photo, ['title', 'captionHtml', 'alt'], language);
    return { ...translatedPhoto, lightboxLabel: plainText(translatedPhoto.title || translatedPhoto.captionHtml).slice(0, 180) };
  });
  gallery.pairs = (source.pairs || []).map(sourcePair => {
    const pair = translated(sourcePair, ['title', 'captionHtml'], language);
    for (const side of ['a', 'b']) {
      pair[side] = translated(sourcePair[side], ['label', 'alt'], language);
      pair[side].label ||= side.toUpperCase();
    }
    pair.portrait = pair.a.width < pair.a.height && pair.b.width < pair.b.height;
    return pair;
  });
  gallery.cover = source.cover ? translated(source.cover, ['title', 'captionHtml', 'alt'], language) : gallery.photos[0];
  gallery.url = localizePath(`/photos/${encodeURIComponent(gallery.slug)}/`, language);
  gallery.layout = ['exhibition', 'pairs'].includes(gallery.layout) ? gallery.layout : 'grid';
  gallery.count = gallery.layout === 'pairs' ? gallery.pairs.length : gallery.photos.length;
  gallery.countLabel = `${gallery.count} ${gallery.layout === 'pairs' ? (gallery.count === 1 ? t.imagePair : t.imagePairs) : (gallery.count === 1 ? t.photograph : t.photographs)}`;
  gallery.excerpt = plainText(gallery.descriptionHtml);
  return gallery;
}

/** Build all public pages from the publish manifest. Browser JavaScript is enhancement only. */
export async function buildStaticSite({ manifest, outputDir, siteURL = 'https://dheera.net', designPreview = false }) {
  if (!manifest || !Array.isArray(manifest.galleries)) throw new Error('Static site requires a gallery manifest.');
  if (!outputDir) throw new Error('Static site requires an output directory.');
  const baseURL = new URL(siteURL);
  if (!['http:', 'https:'].includes(baseURL.protocol)) throw new Error('siteURL must use HTTP(S).');
  const pages = [];
  const dictionaries = Object.fromEntries(await Promise.all(['en', 'zh-Hant'].map(async language => [language, JSON.parse(await readFile(path.join(themeDirectory, 'locales', `${language}.json`), 'utf8'))])));
  const defaultStyle = styleNames.includes(manifest.site?.defaultStyle) ? manifest.site.defaultStyle : 'midnight';

  for (const language of ['en', 'zh-Hant']) {
    const t = { ...dictionaries.en, ...dictionaries[language] };
    const site = translated(manifest.site, ['headline', 'headlineHtml', 'intro', 'introHtml'], language);
    site.name ||= 'Dheera Venkatraman';
    const galleries = manifest.galleries.map(gallery => galleryFor(gallery, language, t));
    const galleryCards = galleries.map(({ photos, pairs, translations, ...gallery }) => gallery);
    const projects = (manifest.projects || []).map(source => {
      const project = translated(source, ['title', 'summary', 'bodyHtml'], language);
      project.cover = source.cover ? translated(source.cover, ['title', 'alt'], language) : null;
      project.url = localizePath(`/projects/${encodeURIComponent(project.slug)}/`, language);
      project.destination = link(project.href || (project.hasPage ? `/projects/${project.slug}/` : project.demo || project.github), language, baseURL);
      project.actions = actionsFor(project, language, t, baseURL);
      project.detailActions = actionsFor(project, language, t, baseURL, true);
      if (project.video?.type && !project.video.type.includes('/')) project.video = { ...project.video, type: `video/${project.video.type}` };
      return project;
    });
    const about = translated(manifest.about, ['title', 'bodyHtml'], language);
    about.title ||= t.aboutHeadline;
    about.bodyHtml ||= site.introHtml || '';
    const links = { home: localizePath('/', language), projects: localizePath('/projects/', language), about: localizePath('/about/', language) };
    const socialLinks = ['instagram', 'rednote'].flatMap(name => {
      const destination = link(site[name], language, baseURL);
      return destination ? [{ ...destination, label: t[name], icon: name }] : [];
    });
    const footerLinks = [{ href: links.about, local: true, label: t.about }];
    const contactLinks = [];
    for (const field of ['github', 'linkedin', 'resume']) {
      const destination = link(site[field], language, baseURL);
      if (destination) contactLinks.push({ ...destination, label: t[field], icon: field });
    }
    if (site.email) contactLinks.push({ href: `mailto:${site.email}`, local: false, label: t.contact, icon: 'mail' });
    footerLinks.push(...socialLinks, ...contactLinks);
    const defaultImage = galleries[0]?.cover || about.portrait;
    const defaultDescription = plainText(site.introHtml || site.intro || t.footerDescription);
    const common = { designPreview, language, t, site, links, footerLinks, contactLinks, socialLinks, defaultStyle, styles: styleNames.map(id => ({ id, label: t[`style${id[0].toUpperCase()}${id.slice(1)}`] })) };
    const addPage = (kind, originalPath, title, data = {}, description = defaultDescription, image = defaultImage) => {
      const url = localizePath(originalPath, language);
      const is404 = kind === 'not-found';
      const canonicalPath = kind === 'redirect' ? '/' : originalPath;
      const alternates = ['en', 'zh-Hant'].map(lang => ({ language: lang, path: localizePath(canonicalPath, lang), href: new URL(localizePath(canonicalPath, lang), baseURL).href, active: lang === language, label: lang === 'en' ? 'EN' : '中', name: lang === 'en' ? t.english : t.traditionalChinese }));
      pages.push({ ...common, ...data, kind, url, originalPath,
        section: ['projects', 'project'].includes(kind) ? 'projects' : kind === 'about' ? 'about' : 'photos',
        bodyClass: kind === 'gallery' ? `gallery-page${data.gallery?.layout === 'pairs' ? ' paired-gallery-page' : ''}` : `${kind}-page`,
        title: `${title} — ${site.name}`, description: plainText(description).slice(0, 180),
        canonical: new URL(localizePath(canonicalPath, language), baseURL).href, alternates, xDefault: new URL(canonicalPath, baseURL).href,
        ogImage: image?.src ? new URL(image.src, baseURL).href : null,
        ogImageAlt: image?.alt || image?.title || title,
        ogLocale: language === 'en' ? 'en_US' : 'zh_TW',
        noindex: is404,
      });
    };

    addPage('home', '/', t.photos, { galleries: galleryCards });
    for (const gallery of galleries) addPage('gallery', `/photos/${encodeURIComponent(gallery.slug)}/`, gallery.title,
      { gallery, otherGalleries: galleryCards.filter(other => other.slug !== gallery.slug).slice(0, 2) },
      gallery.descriptionHtml || `${gallery.title} — ${gallery.countLabel}`, gallery.cover);
    addPage('projects', '/projects/', t.projects, { projects }, t.projectsDescription, projects.find(project => project.cover)?.cover || defaultImage);
    for (const project of projects.filter(project => project.hasPage)) addPage('project', `/projects/${encodeURIComponent(project.slug)}/`, project.title,
      { project }, project.summary || project.bodyHtml || project.title, project.cover || defaultImage);
    addPage('about', '/about/', about.title, { about }, about.bodyHtml || defaultDescription, about.portrait || defaultImage);
    addPage('not-found', '/404.html', t.pageUnavailable);
    addPage('redirect', '/photos/', t.photos, { redirect: links.home });
  }

  await mkdir(outputDir, { recursive: true });
  const inputDirectory = path.join(themeDirectory, 'templates');
  const eleventy = new Eleventy(inputDirectory, path.resolve(outputDir), {
    quietMode: true,
    configPath: false,
    config(config) {
      config.setTemplateFormats(['njk']);
      config.setNunjucksEnvironmentOptions({ autoescape: true });
      config.addGlobalData('sitePages', pages);
      config.addGlobalData('sitemapPages', pages.filter(page => !['not-found', 'redirect'].includes(page.kind)));
      config.addGlobalData('sitemapURL', new URL('/sitemap.xml', baseURL).href);
      config.addFilter('padNumber', value => String(value).padStart(2, '0'));
      return { dir: { includes: '_includes', layouts: '_includes' }, templateFormats: ['njk'], htmlTemplateEngine: 'njk' };
    },
  });
  await eleventy.write();
  await mkdir(path.join(outputDir, 'assets'), { recursive: true });
  await Promise.all(['tokens.css', 'styles.css', 'site.js', 'gallery.js', 'pairs.css', 'travel-map.css', 'travel-map.js', 'visibility-normal.css', 'visibility-limited.css'].map(filename => cp(path.join(themeDirectory, 'assets', filename), path.join(outputDir, 'assets', filename))));
  // Nginx selects a regional variant at this URL; other static hosts use the default.
  await cp(path.join(themeDirectory, 'assets', 'visibility-normal.css'), path.join(outputDir, 'visibility.css'));
  await cp(path.join(themeDirectory, 'assets', 'fonts'), path.join(outputDir, 'fonts'), { recursive: true });
  await cp(fileURLToPath(new URL('../public/files/', import.meta.url)), path.join(outputDir, 'files'), { recursive: true });
  return { pages: pages.length, urls: pages.map(page => page.url) };
}
