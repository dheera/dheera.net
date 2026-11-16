import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { publishLibrary } from '../lib/publisher.mjs';
import { translateLibrary } from '../lib/local-translations.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-publish-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'library');
  const outputDir = path.join(root, 'published');
  await mkdir(sourceDir);
  await writeFile(path.join(sourceDir, '.gallery-library'), JSON.stringify({ version: 1, id: 'test-library' }));
  return {
    sourceDir,
    outputDir,
    publish: (options = {}) => publishLibrary({ sourceDir, outputDir, ...options }),
    pointer: () => readFile(path.join(outputDir, 'current.json'), 'utf8'),
    async gallery(name, metadata) {
      const directory = path.join(sourceDir, name);
      await mkdir(directory, { recursive: true });
      if (metadata !== undefined) await writeFile(path.join(directory, 'gallery.md'), metadata);
      return directory;
    },
  };
}

async function photo(directory, filename, color = '#39746c') {
  const buffer = await sharp({ create: { width: 80, height: 60, channels: 3, background: color } }).jpeg().toBuffer();
  await writeFile(path.join(directory, filename), buffer);
}

async function sidecar(directory, filename, contents) {
  await writeFile(path.join(directory, filename.replace(/\.[^.]+$/, '.md')), contents);
}

test('a folder of photos publishes with no gallery or photo sidecars and natural filename order', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('plain-gallery');
  for (const name of ['10.jpg', '2.jpg', '1.jpg']) await photo(gallery, name);
  const manifest = await f.publish();
  assert.equal(manifest.galleries.length, 1);
  const published = manifest.galleries[0];
  assert.equal(published.slug, 'plain-gallery');
  assert.ok(published.title);
  assert.equal(published.layout, 'grid');
  assert.equal(published.imageCount, 3);
  assert.deepEqual(published.photos.map(image => image.file), ['1.jpg', '2.jpg', '10.jpg']);
  for (const image of published.photos) {
    assert.equal(image.width, 80);
    assert.equal(image.height, 60);
    assert.equal(image.captionHtml, '');
    assert.match(image.src, /^\/media\//);
    await readFile(path.join(f.outputDir, image.src));
  }
  const pointer = JSON.parse(await f.pointer());
  assert.ok(pointer.release);
  const saved = JSON.parse(await readFile(path.join(f.outputDir, 'releases', pointer.release, 'manifest.json'), 'utf8'));
  assert.deepEqual(saved.galleries, manifest.galleries);
});

test('explicit numeric orders precede unordered photos, ties and defaults use natural filename order', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('ordered', '---\ntitle: Selected photographs\nlayout: exhibition\n---\nAn opening paragraph.\n');
  for (const name of ['1.jpg', '2.jpg', '10.jpg', '20.jpg', '30.jpg', '100.jpg']) await photo(gallery, name);
  await sidecar(gallery, '2.jpg', '---\norder: 20\n---\n');
  await sidecar(gallery, '10.jpg', '---\norder: 20\n---\n');
  await sidecar(gallery, '30.jpg', '---\norder: 0\n---\n');
  await sidecar(gallery, '20.jpg', '---\ntitle: A title without an order\n---\n');
  const { galleries: [published] } = await f.publish();
  assert.equal(published.layout, 'exhibition');
  assert.match(published.descriptionHtml, /An opening paragraph/);
  assert.deepEqual(published.photos.map(image => image.file), ['30.jpg', '2.jpg', '10.jpg', '1.jpg', '20.jpg', '100.jpg']);
});

test('Markdown-only and empty sidecars work; structured fields and story text remain separate', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('stories');
  for (const name of ['1.jpg', '2.jpg', '3.jpg', '4.jpg']) await photo(gallery, name);
  await sidecar(gallery, '1.jpg', 'A **short caption** with a [link](https://dheera.net/).\n');
  await sidecar(gallery, '2.jpg', '');
  await sidecar(gallery, '4.jpg', '---\n---\n');
  await sidecar(gallery, '3.jpg', '---\ntitle: Harbor\nalt: Boats on still water.\n---\nThe first paragraph.\n\nThe second paragraph.\n');
  const { galleries: [published] } = await f.publish();
  assert.match(published.photos[0].captionHtml, /<strong>short caption<\/strong>/);
  assert.equal(published.photos[1].captionHtml, '');
  assert.equal(published.photos[3].captionHtml, '');
  assert.equal(published.photos[2].title, 'Harbor');
  assert.equal(published.photos[2].alt, 'Boats on still water.');
  assert.match(published.photos[2].captionHtml, /<p>The first paragraph\.<\/p>/);
  assert.match(published.photos[2].captionHtml, /<p>The second paragraph\.<\/p>/);
});

test('replacing a photo changes its media URL and editing its sidecar updates the caption', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('edits');
  await photo(gallery, '1.jpg');
  await sidecar(gallery, '1.jpg', 'Original caption.');
  const first = await f.publish();
  const firstSrc = first.galleries[0].photos[0].src;
  await photo(gallery, '1.jpg', '#c45236');
  await sidecar(gallery, '1.jpg', 'Revised caption.');
  const second = await f.publish();
  assert.notEqual(second.galleries[0].photos[0].src, firstSrc);
  assert.match(second.galleries[0].photos[0].captionHtml, /Revised caption/);
  // Old releases remain valid while a new release is activated.
  await readFile(path.join(f.outputDir, firstSrc));
});

test('photo and gallery deletion are reflected on publish, including an orphan sidecar and removed cover', async t => {
  const f = await fixture(t);
  const forest = await f.gallery('forest', '---\ncover: 1.jpg\n---\n');
  const ocean = await f.gallery('ocean');
  await photo(forest, '1.jpg');
  await photo(forest, '2.jpg');
  await sidecar(forest, '1.jpg', 'This sidecar remains after its photo is removed.');
  await photo(ocean, '1.jpg');
  await f.publish();
  await rm(path.join(forest, '1.jpg'));
  await rm(ocean, { recursive: true });
  const { galleries } = await f.publish();
  assert.deepEqual(galleries.map(gallery => gallery.slug), ['forest']);
  assert.deepEqual(galleries[0].photos.map(image => image.file), ['2.jpg']);
  assert.equal(galleries[0].cover.file, '2.jpg');
});

test('invalid metadata leaves the current successful release active', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('validation');
  await photo(gallery, '1.jpg');
  await f.publish();
  const current = await f.pointer();
  for (const invalid of ['---\norder: first\n---\n', '---\norder: [1, 2]\n---\n', '---\norder: .inf\n---\n', '---\norder: .nan\n---\n', '---\norder: true\n---\n', '---\ntitle: [broken\n---\n']) {
    await sidecar(gallery, '1.jpg', invalid);
    await assert.rejects(f.publish());
    assert.equal(await f.pointer(), current);
  }
});

test('a missing source or library marker cannot erase an existing release', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('safe');
  await photo(gallery, '1.jpg');
  await f.publish();
  const current = await f.pointer();
  await assert.rejects(f.publish({ sourceDir: path.join(f.sourceDir, 'not-mounted') }));
  assert.equal(await f.pointer(), current);
  await rm(path.join(f.sourceDir, '.gallery-library'));
  await assert.rejects(f.publish());
  assert.equal(await f.pointer(), current);
});

test('publishing an empty library initially works, but clearing a populated library requires allowEmpty', async t => {
  const f = await fixture(t);
  const empty = await f.publish();
  assert.deepEqual(empty.galleries, []);
  const gallery = await f.gallery('temporary');
  await photo(gallery, '1.jpg');
  await f.publish();
  const current = await f.pointer();
  await rm(gallery, { recursive: true });
  await assert.rejects(f.publish());
  assert.equal(await f.pointer(), current);
  const cleared = await f.publish({ allowEmpty: true });
  assert.deepEqual(cleared.galleries, []);
});

test('unsafe and duplicate gallery slugs fail before changing the current release', async t => {
  const f = await fixture(t);
  const first = await f.gallery('one');
  const second = await f.gallery('two');
  await photo(first, '1.jpg');
  await photo(second, '1.jpg');
  await f.publish();
  const current = await f.pointer();
  await writeFile(path.join(first, 'gallery.md'), '---\nslug: ../outside\n---\n');
  await assert.rejects(f.publish());
  assert.equal(await f.pointer(), current);
  await writeFile(path.join(first, 'gallery.md'), '---\nslug: same\n---\n');
  await writeFile(path.join(second, 'gallery.md'), '---\nslug: same\n---\n');
  await assert.rejects(f.publish());
  assert.equal(await f.pointer(), current);
});

test('publishing reads editable NAS Chinese sidecars created by an explicit translation step', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('translated', '---\ntitle: Harbor gallery\n---\nA collection beside the sea.');
  await photo(gallery, '1.jpg');
  await sidecar(gallery, '1.jpg', '---\ntitle: Harbor\nalt: Boats on still water.\n---\nA quiet harbor.');
  const seedPath = path.join(f.sourceDir, '..', 'translation-seed.json');
  await writeFile(seedPath, JSON.stringify({
    'Harbor gallery': '港口相簿',
    'A collection beside the sea.': '海邊的影像集。',
    'Harbor': '港口',
    'Boats on still water.': '平靜水面上的船隻。',
    'A quiet harbor.': '寧靜的港口。',
  }));
  await translateLibrary({ sourceDir: f.sourceDir, seedPath });
  const seeded = await f.publish();
  assert.equal(seeded.galleries[0].translations['zh-Hant'].title, '港口相簿');
  assert.match(seeded.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /寧靜的港口/);

  await writeFile(path.join(gallery, 'gallery.zh-Hant.md'), '---\ntitle: 海港記事\n---\n沿岸的光影。');
  await writeFile(path.join(gallery, '1.zh-Hant.md'), '---\ntitle: 港灣\nalt: 靜水與漁船。\n---\n暮色中的**港灣**。');
  const revised = await f.publish();
  const translatedGallery = revised.galleries[0].translations['zh-Hant'];
  const translatedPhoto = revised.galleries[0].photos[0].translations['zh-Hant'];
  assert.equal(translatedGallery.title, '海港記事');
  assert.match(translatedGallery.descriptionHtml, /沿岸的光影/);
  assert.equal(translatedPhoto.title, '港灣');
  assert.equal(translatedPhoto.alt, '靜水與漁船。');
  assert.match(translatedPhoto.captionHtml, /暮色中的<strong>港灣<\/strong>/);
  assert.equal(revised.galleries[0].photos[0].title, 'Harbor');
});

test('existing Chinese survives English edits until its sidecar is explicitly removed', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('caption-change', '---\ntitle: Caption change\n---\n');
  await photo(gallery, '1.jpg');
  await sidecar(gallery, '1.jpg', 'A quiet harbor.');
  const seedPath = path.join(f.sourceDir, '..', 'translation-seed.json');
  await writeFile(seedPath, JSON.stringify({ 'Caption change': '圖說更新', 'A quiet harbor.': '寧靜的港口。' }));
  await translateLibrary({ sourceDir: f.sourceDir, seedPath });
  const first = await f.publish();
  assert.match(first.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /寧靜的港口/);
  const localChinese = await readFile(path.join(gallery, '1.zh-Hant.md'), 'utf8');

  await sidecar(gallery, '1.jpg', 'Fishing boats leave at dawn.');
  await translateLibrary({ sourceDir: f.sourceDir, seedPath });
  assert.equal(await readFile(path.join(gallery, '1.zh-Hant.md'), 'utf8'), localChinese);
  const unchanged = await f.publish();
  assert.match(unchanged.galleries[0].photos[0].captionHtml, /Fishing boats leave at dawn/);
  assert.match(unchanged.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /寧靜的港口/);
  await rm(path.join(gallery, '1.zh-Hant.md'));

  await writeFile(seedPath, JSON.stringify({ 'Caption change': '圖說更新', 'Fishing boats leave at dawn.': '漁船在黎明時分出港。' }));
  await translateLibrary({ sourceDir: f.sourceDir, seedPath });
  const updated = await f.publish();
  assert.match(updated.galleries[0].photos[0].captionHtml, /Fishing boats leave at dawn/);
  assert.match(updated.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /漁船在黎明時分出港/);
  assert.doesNotMatch(updated.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /寧靜的港口/);
  await sidecar(gallery, '1.jpg', '');
  const removed = await f.publish();
  assert.equal(removed.galleries[0].photos[0].captionHtml, '');
  assert.ok(!removed.galleries[0].photos[0].translations['zh-Hant'].captionHtml);
});

test('explicit local translation fills missing text before publishing without overwriting existing Chinese', async t => {
  const f = await fixture(t);
  const gallery = await f.gallery('translator-command', '---\ntitle: Harbor gallery\n---\nOpening story.');
  await photo(gallery, '1.jpg');
  await photo(gallery, '2.jpg');
  await sidecar(gallery, '1.jpg', '---\ntitle: Harbor\nalt: Boats on still water.\n---\nA quiet harbor.');
  await writeFile(path.join(gallery, '1.zh-Hant.md'), '---\ntitle: 港灣\nalt: 靜水與漁船。\n---\n');
  await sidecar(gallery, '2.jpg', '---\ntitle: Manual title\nalt: Manual description.\n---\nDo not send this caption.');
  await writeFile(path.join(gallery, '2.zh-Hant.md'), '---\ntitle: 手動標題\nalt: 手動描述。\n---\n手動圖說。');
  const translatorCommand = path.join(f.sourceDir, '..', 'translator.mjs');
  const callsPath = path.join(f.sourceDir, '..', 'calls.jsonl');
  const modePath = path.join(f.sourceDir, '..', 'mode.txt');
  await writeFile(modePath, 'valid');
  await writeFile(translatorCommand, `#!${process.execPath}
import { appendFile, readFile } from 'node:fs/promises';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
await appendFile(new URL('./calls.jsonl', import.meta.url), JSON.stringify(request) + '\\n');
const mode = await readFile(new URL('./mode.txt', import.meta.url), 'utf8');
if (mode === 'malformed') process.stdout.write('not JSON');
else process.stdout.write(JSON.stringify({
  translations: Object.fromEntries(request.items.map(item => [item.id, '譯文：' + item.text])),
}));
`, { mode: 0o755 });
  const calls = async () => (await readFile(callsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));

  await translateLibrary({ sourceDir: f.sourceDir, translatorCommand });
  const first = await f.publish();
  const initialCalls = await calls();
  assert.equal(initialCalls.length, 1);
  assert.equal(initialCalls[0].sourceLanguage, 'en');
  assert.equal(initialCalls[0].targetLanguage, 'zh-Hant');
  assert.deepEqual(initialCalls[0].items.map(item => item.text).sort(), ['Harbor gallery', 'Opening story.', 'A quiet harbor.'].sort());
  assert.ok(initialCalls[0].items.every(item => typeof item.id === 'string' && item.id.length > 0));
  assert.equal(first.translationMissing, 0);
  assert.match(first.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /譯文：A quiet harbor/);
  assert.match(first.galleries[0].photos[1].translations['zh-Hant'].captionHtml, /手動圖說/);

  await translateLibrary({ sourceDir: f.sourceDir, translatorCommand });
  await f.publish();
  assert.equal((await calls()).length, 1, 'unchanged content does not invoke the translator again');

  await sidecar(gallery, '1.jpg', '---\ntitle: Harbor\nalt: Boats on still water.\n---\nFishing boats leave at dawn.');
  await translateLibrary({ sourceDir: f.sourceDir, translatorCommand });
  assert.equal((await calls()).length, 1, 'existing Chinese is preserved even after its English source changes');
  await writeFile(path.join(gallery, '1.zh-Hant.md'), '---\ntitle: 港灣\nalt: 靜水與漁船。\n---\n');
  await translateLibrary({ sourceDir: f.sourceDir, translatorCommand });
  const changed = await f.publish();
  const changedCalls = await calls();
  assert.equal(changedCalls.length, 2);
  assert.deepEqual(changedCalls[1].items.map(item => item.text), ['Fishing boats leave at dawn.']);
  assert.match(changed.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /譯文：Fishing boats leave at dawn/);
  assert.doesNotMatch(changed.galleries[0].photos[0].translations['zh-Hant'].captionHtml, /quiet harbor/);

  const current = await f.pointer();
  await writeFile(modePath, 'malformed');
  await sidecar(gallery, '1.jpg', '---\ntitle: Harbor\nalt: Boats on still water.\n---\nNew unpublished caption.');
  await writeFile(path.join(gallery, '1.zh-Hant.md'), '---\ntitle: 港灣\nalt: 靜水與漁船。\n---\n');
  await assert.rejects(translateLibrary({ sourceDir: f.sourceDir, translatorCommand }), /JSON/);
  assert.equal(await f.pointer(), current);
  assert.equal((await calls()).length, 3);
});
