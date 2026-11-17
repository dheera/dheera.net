import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm, cp, realpath, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { publishLibrary } from '../lib/publisher.mjs';
import { rebuildSite } from '../lib/releases.mjs';

const header = (fields, body = '') => `---\n${fields}\n---\n${body}`;

async function image(filename, color = '#39746c') {
  await mkdir(path.dirname(filename), { recursive: true });
  await sharp({ create: { width: 80, height: 60, channels: 3, background: color } }).jpeg().toFile(filename);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-static-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'library');
  const outputDir = path.join(root, 'published');
  const gallery = path.join(sourceDir, 'photos', 'harbor');
  const project = path.join(sourceDir, 'projects', 'build-notes');
  await mkdir(gallery, { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(path.join(sourceDir, 'projects', 'github-tool'));
  await writeFile(path.join(sourceDir, '.publish-library'), JSON.stringify({ version: 1, id: 'static-test' }));
  await writeFile(path.join(sourceDir, 'site.md'), header('name: Fixture Artist\nheadline: Look closely\ndefaultStyle: museum', 'An authored introduction.'));
  await writeFile(path.join(sourceDir, 'site.zh-Hant.md'), header('headline: 仔細觀察', '作者的介紹。'));
  await writeFile(path.join(sourceDir, 'about.md'), header('title: About the artist', 'I make things and photographs.'));
  await writeFile(path.join(sourceDir, 'about.zh-Hant.md'), header('title: 關於作者', '我喜歡創作與攝影。'));
  await image(path.join(gallery, '1.jpg'));
  await image(path.join(gallery, '2.jpg'), '#c45236');
  await writeFile(path.join(gallery, 'gallery.md'), header('title: Harbor collection\nlayout: exhibition', 'Stories beside the water.'));
  await writeFile(path.join(gallery, 'gallery.zh-Hant.md'), header('title: 港灣影像', '水邊的故事。'));
  await writeFile(path.join(gallery, '1.md'), header('title: First light\nalt: Boats on water.', 'Morning at the harbor.'));
  await writeFile(path.join(gallery, '1.zh-Hant.md'), header('title: 晨光\nalt: 水面上的船隻。', '港灣的清晨。'));
  await writeFile(path.join(gallery, '2.md'), 'An English-only caption.');
  await writeFile(path.join(project, 'project.md'), header('title: Build notes\ncover: assets/front.jpg', 'An article about the build.\n\n![The assembly](assets/front.jpg)'));
  await writeFile(path.join(project, 'project.zh-Hant.md'), header('title: 製作筆記', '關於製作的文章。\n\n![組裝](assets/front.jpg)'));
  await image(path.join(project, 'assets', 'front.jpg'), '#556677');
  await writeFile(path.join(sourceDir, 'projects', 'github-tool', 'project.md'), header('title: Useful tool\ngithub: https://github.com/example/tool'));
  return {
    root, sourceDir, outputDir, gallery, project,
    publish: (options = {}) => publishLibrary({ sourceDir, outputDir, siteURL: 'https://portfolio.example', ...options }),
    async release() {
      const pointer = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'));
      return path.join(outputDir, 'releases', pointer.release);
    },
  };
}

async function filesUnder(directory, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(directory, name));
    else if (entry.isFile()) result.push(name);
  }
  return result.sort();
}

async function snapshot(directory) {
  return Object.fromEntries(await Promise.all((await filesUnder(directory)).map(async name => [
    name, createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex'),
  ])));
}

const visibleHtml = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

function tags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map(([tag]) => Object.fromEntries(
    [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key.toLowerCase(), value.replaceAll('&amp;', '&')]),
  ));
}

async function assertLocalTargetExists(directory, reference, basePath = '/') {
  if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return;
  const url = new URL(reference, `https://static.example${basePath}`);
  const local = path.join(directory, decodeURIComponent(url.pathname));
  const info = await stat(local);
  if (info.isDirectory()) assert.ok((await stat(path.join(local, 'index.html'))).isFile(), `Missing index for ${reference}`);
  else assert.ok(info.isFile(), `Missing local asset ${reference}`);
}

test('publishing emits complete English and Chinese HTML, reciprocal language links, and direct project cards', async t => {
  const f = await fixture(t);
  await f.publish();
  const release = await f.release();
  for (const [route, language, title, body] of [
    ['photos/harbor/index.html', 'en', 'Harbor collection', 'Morning at the harbor.'],
    ['zh-hant/photos/harbor/index.html', 'zh-Hant', '港灣影像', '港灣的清晨。'],
    ['projects/build-notes/index.html', 'en', 'Build notes', 'An article about the build.'],
    ['zh-hant/projects/build-notes/index.html', 'zh-Hant', '製作筆記', '關於製作的文章。'],
    ['about/index.html', 'en', 'About the artist', 'I make things and photographs.'],
    ['zh-hant/about/index.html', 'zh-Hant', '關於作者', '我喜歡創作與攝影。'],
  ]) {
    const html = await readFile(path.join(release, route), 'utf8');
    assert.equal(tags(html, 'html')[0].lang, language);
    assert.ok(visibleHtml(html).includes(body), `${route} must include its body without running JavaScript`);
    assert.ok(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].includes(title));
    const routePath = '/' + route.replace(/index\.html$/, '');
    const englishPath = routePath.replace(/^\/zh-hant\//, '/');
    const links = tags(html, 'link');
    assert.equal(links.find(link => link.rel === 'canonical')?.href, `https://portfolio.example${routePath}`);
    assert.equal(links.find(link => link.hreflang === 'en')?.href, `https://portfolio.example${englishPath}`);
    assert.equal(links.find(link => link.hreflang === 'zh-Hant')?.href, `https://portfolio.example/zh-hant${englishPath}`);
    assert.equal(links.find(link => link.hreflang === 'x-default')?.href, `https://portfolio.example${englishPath}`);
  }
  const home = visibleHtml(await readFile(path.join(release, 'index.html'), 'utf8'));
  const chineseHome = visibleHtml(await readFile(path.join(release, 'zh-hant/index.html'), 'utf8'));
  assert.ok(home.includes('Harbor collection') && home.includes('An authored introduction.'));
  assert.ok(chineseHome.includes('港灣影像') && chineseHome.includes('作者的介紹。'));
  const projects = await readFile(path.join(release, 'projects/index.html'), 'utf8');
  assert.ok(tags(projects, 'a').some(link => link.href === 'https://github.com/example/tool'));
  await assert.rejects(stat(path.join(release, 'projects/github-tool/index.html')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(release, 'zh-hant/projects/github-tool/index.html')), { code: 'ENOENT' });
  assert.equal(await realpath(path.join(f.outputDir, 'dist')), await realpath(release));
});

test('gallery subtitles are optional localized plain text above the title, with English fallback', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.gallery, 'gallery.md'), header('title: Harbor collection\nsubtitle: Light <em>and</em> water\nlayout: exhibition', 'Stories beside the water.'));
  await writeFile(path.join(f.gallery, 'gallery.zh-Hant.md'), header('title: 港灣影像\nsubtitle: 光 <em>與</em> 水', '水邊的故事。'));
  for (const [slug, fields] of [
    ['fallback', 'subtitle: Across the water'],
    ['no-subtitle', ''],
    ['empty-subtitle', 'subtitle: ""'],
  ]) {
    const dir = path.join(f.sourceDir, 'photos', slug);
    await image(path.join(dir, '1.jpg'));
    await writeFile(path.join(dir, 'gallery.md'), header(`title: ${slug}\n${fields}`));
    // A removed English subtitle must not resurrect an old Chinese one.
    if (slug !== 'fallback') await writeFile(path.join(dir, 'gallery.zh-Hant.md'), header('subtitle: 舊的副標題'));
  }
  await f.publish();
  const release = await f.release();
  for (const [prefix, subtitle] of [['', 'Light &lt;em&gt;and&lt;/em&gt; water'], ['zh-hant/', '光 &lt;em&gt;與&lt;/em&gt; 水']]) {
    const html = await readFile(path.join(release, prefix, 'photos/harbor/index.html'), 'utf8');
    const eyebrow = `<span class="eyebrow">${subtitle}</span>`;
    assert.ok(html.includes(eyebrow), `${prefix || 'English'} subtitle is escaped plain text`);
    assert.ok(html.indexOf(eyebrow) < html.indexOf('<h1 id="gallery-title">'));
    assert.doesNotMatch(html, /A photographic collection|<em>and<\/em>|<em>與<\/em>/);
    const fallback = await readFile(path.join(release, prefix, 'photos/fallback/index.html'), 'utf8');
    assert.match(fallback, /<span class="eyebrow">Across the water<\/span>/);
    for (const slug of ['no-subtitle', 'empty-subtitle']) {
      const optional = await readFile(path.join(release, prefix, 'photos', slug, 'index.html'), 'utf8');
      const titleLine = optional.match(/<div class="gallery-title-line">([\s\S]*?)<\/div>/)?.[1];
      assert.ok(titleLine);
      assert.doesNotMatch(titleLine, /eyebrow|A photographic collection|舊的副標題/);
      assert.match(titleLine, /gallery-total/, 'Photo count remains when the subtitle is omitted');
    }
  }
});

test('a copied release contains every local HTML and stylesheet asset and needs no runtime manifest', async t => {
  const f = await fixture(t);
  await f.publish();
  const exported = path.join(f.root, 'standalone');
  await cp(await f.release(), exported, { recursive: true, dereference: true });
  await rm(f.sourceDir, { recursive: true });
  await rm(f.outputDir, { recursive: true });
  for (const filename of await filesUnder(exported)) {
    if (filename.endsWith('.html')) {
      const html = await readFile(path.join(exported, filename), 'utf8');
      const basePath = '/' + filename.replace(/index\.html$/, '');
      for (const tagName of ['a', 'link', 'img', 'script', 'source', 'video']) {
        for (const attributes of tags(html, tagName)) {
          for (const key of ['src', 'href', 'poster']) await assertLocalTargetExists(exported, attributes[key], basePath);
          for (const item of (attributes.srcset ?? '').split(',').filter(Boolean)) {
            await assertLocalTargetExists(exported, item.trim().split(/\s+/)[0], basePath);
          }
          if ((tagName === 'img' || tagName === 'source') && attributes.src && !/^[a-z][a-z\d+.-]*:/i.test(attributes.src)) {
            assert.ok(attributes.src.startsWith('/media/'), `${filename} must use shared root-relative media, got ${attributes.src}`);
          }
        }
      }
      assert.doesNotMatch(html, /fetch\s*\(\s*['"]\/?manifest\.json/);
    } else if (filename.endsWith('.css')) {
      const css = await readFile(path.join(exported, filename), 'utf8');
      for (const [, url] of css.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g)) {
        await assertLocalTargetExists(exported, url, '/' + filename);
      }
    }
  }
  for (const filename of ['assets/site.js', 'assets/gallery.js']) {
    const script = await readFile(path.join(exported, filename), 'utf8');
    assert.doesNotMatch(script, /manifest\.json|fetch\s*\(/, `${filename} should only enhance already-rendered HTML`);
  }
  await stat(path.join(exported, 'vendor/photoswipe/photoswipe-lightbox.esm.js'));
  await stat(path.join(exported, 'vendor/photoswipe/photoswipe.esm.js'));
});

test('regional visibility hides only About content and links in both languages, with a normal static fallback', async t => {
  const f = await fixture(t);
  await f.publish();
  const release = await f.release();
  const normal = await readFile(path.join(release, 'assets/visibility-normal.css'), 'utf8');
  const limited = await readFile(path.join(release, 'assets/visibility-limited.css'), 'utf8');
  assert.equal(await readFile(path.join(release, 'visibility.css'), 'utf8'), normal);
  assert.doesNotMatch(normal, /display\s*:\s*none/);
  assert.match(limited, /\[data-visibility="about"\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.equal(limited.replace(/\/\*[\s\S]*?\*\//g, '').match(/\{/g)?.length, 1, 'Only the explicitly marked About content should be hidden');
  for (const prefix of ['', 'zh-hant/']) {
    for (const route of ['index.html', 'about/index.html', 'photos/harbor/index.html', 'projects/index.html']) {
      const html = await readFile(path.join(release, prefix, route), 'utf8');
      const styles = tags(html, 'link').filter(link => link.rel === 'stylesheet');
      assert.equal(styles.at(-1)?.href, '/visibility.css', 'Visibility must be a regular, render-blocking head stylesheet');
      const aboutLinks = tags(html, 'a').filter(link => link.href === `/${prefix}about/` && !link['data-language-choice']);
      assert.equal(aboutLinks.length, 2, 'Header and footer both link to About');
      assert.ok(aboutLinks.every(link => link['data-visibility'] === 'about'));
      assert.equal(tags(html, 'main')[0]['data-visibility'], route === 'about/index.html' ? 'about' : undefined);
      const languageGroup = tags(html, 'div').find(tag => tag.class?.includes('footer-language'));
      assert.equal(languageGroup['data-visibility'], route === 'about/index.html' ? 'about' : undefined);
      if (route !== 'about/index.html') {
        assert.doesNotMatch(html.match(/<main\b[\s\S]*?<\/main>/)?.[0] || '', /data-visibility=/, 'Home, gallery and project content stays visible');
      }
    }
  }
});

test('publish is read-only toward NAS text, ignores translation adapters and legacy cache, and falls back for missing Chinese', async t => {
  const f = await fixture(t);
  const before = await snapshot(f.sourceDir);
  await mkdir(f.outputDir);
  await writeFile(path.join(f.outputDir, '.translation-cache.json'), 'invalid legacy cache; publishing must not read this');
  const invoked = path.join(f.root, 'translator-was-invoked');
  const translatorCommand = path.join(f.root, 'never-run.mjs');
  await writeFile(translatorCommand, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(invoked)}, 'called');\nprocess.exit(1);\n`, { mode: 0o755 });
  const seedPath = path.join(f.root, 'ignored-seed.json');
  await writeFile(seedPath, JSON.stringify({ 'An English-only caption.': '不應出現的種子翻譯。' }));
  const manifest = await f.publish({ translatorCommand, seedPath });
  assert.deepEqual(await snapshot(f.sourceDir), before);
  await assert.rejects(stat(invoked), { code: 'ENOENT' });
  assert.ok(manifest.translationMissing > 0);
  const chinese = visibleHtml(await readFile(path.join(await f.release(), 'zh-hant/photos/harbor/index.html'), 'utf8'));
  assert.ok(chinese.includes('港灣的清晨。'));
  assert.ok(chinese.includes('An English-only caption.'));
  assert.ok(!chinese.includes('不應出現的種子翻譯。'));

  const pointer = await readFile(path.join(f.outputDir, 'current.json'), 'utf8');
  const exportTarget = await readlink(path.join(f.outputDir, 'dist'));
  await writeFile(path.join(f.gallery, '1.md'), '---\norder: invalid\n---\n');
  await assert.rejects(f.publish());
  assert.equal(await readFile(path.join(f.outputDir, 'current.json'), 'utf8'), pointer);
  assert.equal(await readlink(path.join(f.outputDir, 'dist')), exportTarget);
});

test('deleting a gallery or local project removes its static route from the next release', async t => {
  const f = await fixture(t);
  await f.publish();
  const oldRelease = await f.release();
  await rm(f.gallery, { recursive: true });
  await rm(f.project, { recursive: true });
  await f.publish();
  const newRelease = await f.release();
  assert.notEqual(newRelease, oldRelease);
  for (const route of ['photos/harbor/index.html', 'zh-hant/photos/harbor/index.html', 'projects/build-notes/index.html', 'zh-hant/projects/build-notes/index.html']) {
    await stat(path.join(oldRelease, route));
    await assert.rejects(stat(path.join(newRelease, route)), { code: 'ENOENT' });
  }
  const projects = visibleHtml(await readFile(path.join(newRelease, 'projects/index.html'), 'utf8'));
  assert.ok(projects.includes('Useful tool'));
  assert.ok(!projects.includes('Build notes'));
});

test('theme rebuild uses the published snapshot after the NAS is unavailable', async t => {
  const f = await fixture(t);
  const original = await f.publish();
  const oldRelease = await f.release();
  await rm(f.sourceDir, { recursive: true });
  const rebuilt = await rebuildSite({ outputDir: f.outputDir, siteURL: 'https://preview.example' });
  const release = await f.release();
  assert.notEqual(release, oldRelease);
  assert.deepEqual(rebuilt.galleries, original.galleries);
  const html = await readFile(path.join(release, 'photos/harbor/index.html'), 'utf8');
  assert.ok(visibleHtml(html).includes('Morning at the harbor.'));
  assert.equal(tags(html, 'link').find(link => link.rel === 'canonical')?.href, 'https://preview.example/photos/harbor/');
  await stat(path.join(release, original.galleries[0].photos[0].src));
  assert.equal(await realpath(path.join(f.outputDir, 'dist')), await realpath(release));
});
