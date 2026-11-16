import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { publishLibrary } from '../lib/publisher.mjs';
import { translateLibrary } from '../lib/local-translations.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-projects-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'library');
  const outputDir = path.join(root, 'published');
  await mkdir(path.join(sourceDir, 'photos'), { recursive: true });
  await mkdir(path.join(sourceDir, 'projects'));
  await writeFile(path.join(sourceDir, '.publish-library'), JSON.stringify({ version: 1, id: 'test' }));
  return {
    root, sourceDir, outputDir,
    publish: (options = {}) => publishLibrary({ sourceDir, outputDir, ...options }),
    pointer: () => readFile(path.join(outputDir, 'current.json'), 'utf8'),
    async project(name, contents) {
      const directory = path.join(sourceDir, 'projects', name);
      await mkdir(directory, { recursive: true });
      if (contents !== undefined) await writeFile(path.join(directory, 'project.md'), contents);
      return directory;
    },
  };
}

async function image(filename, color = '#39746c') {
  await mkdir(path.dirname(filename), { recursive: true });
  await sharp({ create: { width: 80, height: 60, channels: 3, background: color } }).jpeg().toFile(filename);
}

function header(fields, body = '') {
  return `---\n${fields}\n---\n${body}`;
}

test('unified library keeps GitHub and demo cards direct while publishing photography separately', async t => {
  const f = await fixture(t);
  await f.project('github-tool', header('title: Useful tool\ngithub: https://github.com/example/tool\ntags: [Software, Open source]'));
  await f.project('interactive-demo', header('title: Interactive demo\ndemo: https://example.com/demo/'));
  const ignored = await f.project('unfinished');
  await writeFile(path.join(ignored, 'notes.md'), 'A folder without project.md is not published.');
  await image(path.join(f.sourceDir, 'photos', 'quiet-water', '1.jpg'));
  const manifest = await f.publish();
  assert.equal(manifest.sourceId, 'test');
  assert.deepEqual(manifest.galleries.map(gallery => gallery.slug), ['quiet-water']);
  assert.equal(manifest.projects.length, 2);
  const github = manifest.projects.find(project => project.slug === 'github-tool');
  assert.equal(github.href, 'https://github.com/example/tool');
  assert.equal(github.hasPage, false);
  assert.deepEqual(github.tags, ['Software', 'Open source']);
  const demo = manifest.projects.find(project => project.slug === 'interactive-demo');
  assert.equal(demo.href, 'https://example.com/demo/');
  assert.equal(demo.hasPage, false);
  assert.equal(manifest.about, null);
  assert.equal(manifest.site.defaultStyle, 'midnight');
});

test('Markdown project pages publish nested images and covers with generated media URLs', async t => {
  const f = await fixture(t);
  const project = await f.project('build-notes', header(
    'title: Build notes\nsummary: A small hardware build.\ncover: assets/front.jpg\ngithub: https://github.com/example/build',
    '## Assembly\n\n![Front view](assets/front.jpg)\n\n![Detail](assets/detail.jpg)\n\n[Instructions](https://example.com/instructions)\n',
  ));
  await image(path.join(project, 'assets', 'front.jpg'));
  await image(path.join(project, 'assets', 'detail.jpg'), '#c45236');
  const { projects: [published] } = await f.publish();
  assert.equal(published.hasPage, true);
  assert.equal(published.href, '/projects/build-notes/');
  assert.equal(published.summary, 'A small hardware build.');
  assert.equal(published.github, 'https://github.com/example/build');
  assert.match(published.cover.src, /^\/media\/[a-f0-9]+-\d+\.webp$/);
  assert.match(published.bodyHtml, /<h2>Assembly<\/h2>/);
  assert.ok(published.bodyHtml.includes(`src="${published.cover.src}"`));
  assert.match(published.bodyHtml, /srcset=/);
  assert.match(published.bodyHtml, /width="80" height="60"/);
  assert.doesNotMatch(published.bodyHtml, /src="assets\//);
  assert.match(published.bodyHtml, /href="https:\/\/example.com\/instructions"/);
  await readFile(path.join(f.outputDir, published.cover.src));
});

test('local project video is copied by content hash with the correct media type and updates on replacement', async t => {
  const f = await fixture(t);
  const project = await f.project('moving-sculpture', header('title: Moving sculpture\nvideo: clips/motion.webm'));
  await mkdir(path.join(project, 'clips'));
  // The publisher copies videos without decoding; these fixture bytes test that contract.
  const initialBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
  await writeFile(path.join(project, 'clips', 'motion.webm'), initialBytes);
  const first = (await f.publish()).projects[0];
  assert.equal(first.hasPage, true);
  assert.equal(first.video.type, 'video/webm');
  assert.match(first.video.src, /^\/media\/[a-f0-9]+\.webm$/);
  assert.deepEqual(await readFile(path.join(f.outputDir, first.video.src)), initialBytes);
  const unchanged = (await f.publish()).projects[0];
  assert.equal(unchanged.video.src, first.video.src);
  await writeFile(path.join(project, 'clips', 'motion.webm'), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x02]));
  const changed = (await f.publish()).projects[0];
  assert.notEqual(changed.video.src, first.video.src);
  assert.deepEqual(await readFile(path.join(f.outputDir, first.video.src)), initialBytes);
});

test('YouTube project videos normalize supported URLs and share the embed across languages', async t => {
  const f = await fixture(t);
  const urls = [
    ['short', 'https://www.youtube.com/shorts/GcAxKKQDbNw', true],
    ['watch', 'https://www.youtube.com/watch?v=GcAxKKQDbNw&feature=shared', false],
    ['share', 'https://youtu.be/GcAxKKQDbNw?si=share-token', false],
    ['embed', 'https://www.youtube.com/embed/GcAxKKQDbNw', false],
    ['private-embed', 'https://www.youtube-nocookie.com/embed/GcAxKKQDbNw', false],
  ];
  for (const [slug, url] of urls) {
    const directory = await f.project(slug, header(`title: Moving lamp\nvideo: ${url}`));
    await writeFile(path.join(directory, 'project.zh-Hant.md'), header('title: 會動的檯燈'));
  }
  const { projects } = await f.publish();
  const pointer = JSON.parse(await f.pointer());
  for (const [slug, , portrait] of urls) {
    const project = projects.find(item => item.slug === slug);
    assert.equal(project.hasPage, true);
    assert.equal(project.href, `/projects/${slug}/`);
    assert.deepEqual(project.video, {
      provider: 'youtube',
      id: 'GcAxKKQDbNw',
      src: 'https://www.youtube-nocookie.com/embed/GcAxKKQDbNw?playsinline=1&rel=0',
      href: 'https://www.youtube.com/watch?v=GcAxKKQDbNw',
      portrait,
    });
    for (const [prefix, title] of [['', 'Moving lamp'], ['zh-hant/', '會動的檯燈']]) {
      const html = await readFile(path.join(f.outputDir, 'releases', pointer.release, prefix, 'projects', slug, 'index.html'), 'utf8');
      assert.ok(html.includes(`<h1>${title}</h1>`));
      assert.match(html, /<iframe\b[^>]*src="https:\/\/www\.youtube-nocookie\.com\/embed\/GcAxKKQDbNw\?playsinline=1&amp;rel=0"/);
      assert.doesNotMatch(html, /<video\b/);
    }
  }
});

test('invalid remote video URLs preserve the active project release', async t => {
  const f = await fixture(t);
  const project = await f.project('validated-video', header('title: Existing project', 'An existing article.'));
  await f.publish();
  const current = await f.pointer();
  for (const url of [
    'https://example.com/clip.mp4',
    'https://youtube.com.example.com/shorts/GcAxKKQDbNw',
    'http://www.youtube.com/shorts/GcAxKKQDbNw',
    'javascript:alert(1)',
    'https://www.youtube.com/watch?v=too-short',
    'https://www.youtube.com/shorts/GcAxKKQDbNwX',
    'https://www.youtube.com/watch?v=GcAxKKQDbN%22',
  ]) {
    await writeFile(path.join(project, 'project.md'), header(`title: Invalid video\nvideo: ${url}`));
    await assert.rejects(f.publish(), undefined, `Should reject ${url}`);
    assert.equal(await f.pointer(), current);
  }
});

test('project order, draft exclusion, and directory deletion update the published selection', async t => {
  const f = await fixture(t);
  const direct = 'href: https://example.com/';
  await f.project('project-10', header(`${direct}\norder: 20`));
  const second = await f.project('project-2', header(`${direct}\norder: 20`));
  await f.project('first', header(`${direct}\norder: 0`));
  await f.project('project-1', header(direct));
  await f.project('draft', header('draft: true\norder: -1'));
  const first = await f.publish();
  assert.deepEqual(first.projects.map(project => project.slug), ['first', 'project-2', 'project-10', 'project-1']);
  await rm(second, { recursive: true });
  const changed = await f.publish();
  assert.deepEqual(changed.projects.map(project => project.slug), ['first', 'project-10', 'project-1']);
});

test('project translations use generated seeds and manual Traditional Chinese overrides', async t => {
  const f = await fixture(t);
  const project = await f.project('translated', header('title: Harbor robot\nsummary: A small robot.', 'The build process.'));
  const seedPath = path.join(f.root, 'translations.json');
  await writeFile(seedPath, JSON.stringify({
    'Harbor robot': '港口機器人', 'A small robot.': '一個小型機器人。', 'The build process.': '製作過程。',
  }));
  await translateLibrary({ sourceDir: f.sourceDir, seedPath });
  const seeded = (await f.publish()).projects[0].translations['zh-Hant'];
  assert.equal(seeded.title, '港口機器人');
  assert.equal(seeded.summary, '一個小型機器人。');
  assert.match(seeded.bodyHtml, /製作過程/);
  await writeFile(path.join(project, 'project.zh-Hant.md'), header('title: 海港機器人\nsummary: 手作機器人。', '**組裝紀錄**。'));
  const manual = (await f.publish()).projects[0].translations['zh-Hant'];
  assert.equal(manual.title, '海港機器人');
  assert.equal(manual.summary, '手作機器人。');
  assert.match(manual.bodyHtml, /<strong>組裝紀錄<\/strong>/);
});

test('site and about content publish configuration, portrait, Markdown, and translated metadata', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.sourceDir, 'site.md'), header(
    'name: Example Author\nemail: author@example.com\nheadline: Looking **closer**\ndefaultStyle: museum\ngithub: https://github.com/example\nlinkedin: https://www.linkedin.com/in/example\nresume: https://example.com/resume.pdf',
    'Engineering and photography.',
  ));
  await writeFile(path.join(f.sourceDir, 'about.md'), header('title: About the maker\nportrait: assets/portrait.jpg', 'I make things.'));
  await image(path.join(f.sourceDir, 'assets', 'portrait.jpg'));
  const seedPath = path.join(f.root, 'translations.json');
  await writeFile(seedPath, JSON.stringify({
    'Looking **closer**': '仔細**觀察**', 'Engineering and photography.': '工程與攝影。',
    'About the maker': '關於創作者', 'I make things.': '我喜歡動手創作。',
  }));
  await translateLibrary({ sourceDir: f.sourceDir, seedPath });
  const seeded = await f.publish();
  assert.equal(seeded.site.name, 'Example Author');
  assert.equal(seeded.site.email, 'author@example.com');
  assert.equal(seeded.site.defaultStyle, 'museum');
  assert.equal(seeded.site.resume, 'https://example.com/resume.pdf');
  assert.match(seeded.site.headlineHtml, /<strong>closer<\/strong>/);
  assert.match(seeded.site.translations['zh-Hant'].headlineHtml, /<strong>觀察<\/strong>/);
  assert.equal(seeded.about.title, 'About the maker');
  assert.match(seeded.about.bodyHtml, /I make things/);
  assert.equal(seeded.about.portrait.alt, 'Example Author');
  assert.match(seeded.about.portrait.src, /^\/media\//);
  assert.equal(seeded.about.translations['zh-Hant'].title, '關於創作者');
  assert.match(seeded.about.translations['zh-Hant'].bodyHtml, /我喜歡動手創作/);
  await writeFile(path.join(f.sourceDir, 'site.zh-Hant.md'), header('headline: 用心觀察', '軟體與影像。'));
  await writeFile(path.join(f.sourceDir, 'about.zh-Hant.md'), header('title: 關於我', '手作的樂趣。'));
  const manual = await f.publish();
  assert.equal(manual.site.translations['zh-Hant'].headline, '用心觀察');
  assert.match(manual.site.translations['zh-Hant'].introHtml, /軟體與影像/);
  assert.equal(manual.about.translations['zh-Hant'].title, '關於我');
  assert.match(manual.about.translations['zh-Hant'].bodyHtml, /手作的樂趣/);
});

test('unsafe project destinations, escaping assets, missing assets, and invalid tags preserve the active release', async t => {
  const f = await fixture(t);
  const project = await f.project('validated', header('title: Valid project', 'An existing article.'));
  await f.publish();
  const current = await f.pointer();
  await image(path.join(f.sourceDir, 'projects', 'outside.jpg'));
  const invalid = [
    header('href: javascript:alert(1)'),
    header('href: //example.com/'),
    header('title: Escape', '![Outside](../outside.jpg)'),
    header('title: Missing', '![Missing](assets/missing.jpg)'),
    header('title: Bad tags\ntags: [1, valid]', 'Body.'),
  ];
  for (const contents of invalid) {
    await writeFile(path.join(project, 'project.md'), contents);
    await assert.rejects(f.publish());
    assert.equal(await f.pointer(), current);
  }
});

test('missing photos or projects directories fail safely instead of publishing disappearance', async t => {
  const f = await fixture(t);
  await f.project('still-live', header('github: https://github.com/example/tool'));
  await f.publish();
  const current = await f.pointer();
  await rm(path.join(f.sourceDir, 'photos'), { recursive: true });
  await assert.rejects(f.publish());
  assert.equal(await f.pointer(), current);
  await mkdir(path.join(f.sourceDir, 'photos'));
  await rm(path.join(f.sourceDir, 'projects'), { recursive: true });
  await assert.rejects(f.publish());
  assert.equal(await f.pointer(), current);
});
