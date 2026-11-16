import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { publishLibrary } from '../lib/publisher.mjs';
import { rebuildSite } from '../lib/releases.mjs';

const header = (fields, body = '') => `---\n${fields}\n---\n${body}\n`;

async function image(filename, color, width = 90, height = 60) {
  await mkdir(path.dirname(filename), { recursive: true });
  const source = sharp({ create: { width, height, channels: 3, background: color } });
  await (path.extname(filename).toLowerCase() === '.png' ? source.png() : source.jpeg()).toFile(filename);
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-pairs-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'library');
  const outputDir = path.join(root, 'published');
  const gallery = path.join(sourceDir, 'photos', 'contrasts');
  await mkdir(gallery, { recursive: true });
  await mkdir(path.join(sourceDir, 'projects'));
  await writeFile(path.join(sourceDir, '.publish-library'), JSON.stringify({ version: 1, id: 'pairs-test' }));
  await writeFile(path.join(gallery, 'gallery.md'), header('title: Contrasts\nlayout: pairs', 'A collection of paired photographs.'));
  return {
    root, sourceDir, outputDir, gallery,
    async pair(name, fields, body = '', names = ['a.jpg', 'b.jpg']) {
      const dir = path.join(gallery, name);
      await image(path.join(dir, names[0]), '#354f28');
      await image(path.join(dir, names[1]), '#815733', 60, 90);
      if (fields !== undefined) await writeFile(path.join(dir, 'pair.md'), header(fields, body));
      return dir;
    },
    publish: () => publishLibrary({ sourceDir, outputDir, siteURL: 'https://portfolio.example' }),
    async release() {
      const pointer = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'));
      return path.join(outputDir, 'releases', pointer.release);
    },
  };
}

function mediaNames(photos) {
  return [...new Set(photos.flatMap(photo => photo.srcset.split(', ').map(item => path.basename(item.split(' ')[0]))))].sort();
}

test('a pair needs only A and B images; originals and unrelated files never enter the public release', async t => {
  const f = await fixture(t);
  const dir = await f.pair('01-landscape', undefined, '', ['A.JPG', 'b.png']);
  await image(path.join(dir, 'original.jpg'), '#d5b932', 160, 250);
  await writeFile(path.join(dir, 'original.md'), header('title: PRIVATE ORIGINAL CAPTION', 'Never publish this.'));
  await writeFile(path.join(dir, 'notes.txt'), 'Private working notes.');
  const manifest = await f.publish();
  const gallery = manifest.galleries[0];
  assert.equal(gallery.layout, 'pairs');
  assert.equal(gallery.pairCount, 1);
  assert.equal(gallery.imageCount, 2);
  assert.equal(gallery.pairs.length, 1);
  assert.equal(gallery.pairs[0].title, '');
  assert.equal(gallery.pairs[0].captionHtml, '');
  assert.equal(gallery.pairs[0].a.label, 'A');
  assert.equal(gallery.pairs[0].b.label, 'B');
  assert.deepEqual(gallery.photos.map(photo => photo.file), ['01-landscape/A.JPG', '01-landscape/b.png']);
  assert.equal(gallery.cover.src, gallery.pairs[0].a.src);
  const release = await f.release();
  assert.deepEqual((await readdir(path.join(release, 'media'))).sort(), mediaNames(gallery.photos));
  assert.doesNotMatch(JSON.stringify(manifest), /original\.jpg|PRIVATE ORIGINAL CAPTION|Never publish this|notes\.txt/);
  await assert.rejects(stat(path.join(release, 'photos/contrasts/01-landscape/original.jpg')), { code: 'ENOENT' });
});

test('pair order uses explicit numbers then natural folder names, and a cover may select either image', async t => {
  const f = await fixture(t);
  await f.pair('10-river');
  await f.pair('2-river');
  await f.pair('20-first', 'order: 1');
  await f.pair('3-first', 'order: 1');
  await writeFile(path.join(f.gallery, 'gallery.md'), header('title: Contrasts\nlayout: pairs\ncover: 2-river/b.jpg'));
  const gallery = (await f.publish()).galleries[0];
  assert.deepEqual(gallery.pairs.map(pair => pair.id), ['3-first', '20-first', '2-river', '10-river']);
  assert.equal(gallery.cover.file, '2-river/b.jpg');
  assert.equal(gallery.photos.length, 8);
});

test('paired pages publish both images and authored labels, captions, and Chinese without needing JavaScript', async t => {
  const f = await fixture(t);
  const dir = await f.pair('01-city', 'title: City lights\na:\n  label: Day\n  alt: A street in daylight.\nb:\n  label: Night\n  alt: The same street at night.', 'Photos: Alice · Bob.\n\nA longer **story** about this pair.');
  await writeFile(path.join(dir, 'pair.zh-Hant.md'), header('title: 城市光影\na:\n  label: 白晝\n  alt: 日光下的街道。\nb:\n  label: 夜晚\n  alt: 夜色中的同一條街道。', '攝影：Alice · Bob。\n\n關於這組照片的**故事**。'));
  await writeFile(path.join(f.gallery, 'gallery.zh-Hant.md'), header('title: 對照', '成對呈現的攝影系列。'));
  const manifest = await f.publish();
  const release = await f.release();
  for (const [route, expected] of [
    ['photos/contrasts/index.html', ['City lights', 'Day', 'Night', 'A street in daylight.', 'The same street at night.', 'Photos: Alice · Bob.', '<strong>story</strong>']],
    ['zh-hant/photos/contrasts/index.html', ['城市光影', '白晝', '夜晚', '日光下的街道。', '夜色中的同一條街道。', '攝影：Alice · Bob。', '<strong>故事</strong>']],
  ]) {
    const rawHtml = await readFile(path.join(release, route), 'utf8');
    const html = rawHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    for (const text of expected) assert.ok(html.includes(text), `${route} should contain ${text}`);
    assert.doesNotMatch(html, /type="range"|data-pair-mode|follow-mouse/, 'paired pages show both images without comparison controls');
    assert.doesNotMatch(rawHtml, /class="[^"]*\bphoto-link\b|data-pswp-|\/vendor\/photoswipe\/|\/assets\/gallery\.js/, 'paired pages do not load a lightbox or make images into zoom links');
    for (const photo of manifest.galleries[0].photos) {
      assert.ok(html.includes(photo.src), 'each photograph should be present in static image markup');
      assert.ok(!html.includes(`href="${photo.src}"`), 'photographs are not links');
      assert.ok((await stat(path.join(release, photo.src))).isFile());
    }
    assert.ok(html.includes('/assets/pairs.css'));
  }
  const home = await readFile(path.join(release, 'index.html'), 'utf8');
  assert.match(home, /1 (?:image )?pair\b/);
  await stat(path.join(release, 'assets/pairs.css'));
});

test('missing or ambiguous pair images and invalid metadata leave the previous release active', async t => {
  const f = await fixture(t);
  const dir = await f.pair('01-city');
  await f.publish();
  const pointer = await readFile(path.join(f.outputDir, 'current.json'), 'utf8');
  const target = await readlink(path.join(f.outputDir, 'dist'));
  const assertUnchanged = async () => {
    await assert.rejects(f.publish());
    assert.equal(await readFile(path.join(f.outputDir, 'current.json'), 'utf8'), pointer);
    assert.equal(await readlink(path.join(f.outputDir, 'dist')), target);
  };
  await rm(path.join(dir, 'b.jpg'));
  await assertUnchanged();
  await image(path.join(dir, 'b.jpg'), '#815733');
  await image(path.join(dir, 'a.png'), '#436190');
  await assertUnchanged();
  await rm(path.join(dir, 'a.png'));
  await writeFile(path.join(dir, 'pair.md'), header('a:\n  label: 42'));
  await assertUnchanged();
});

test('replacing and removing pairs changes the next release while keeping ordinary galleries and old releases', async t => {
  const f = await fixture(t);
  const dir = await f.pair('01-city', 'title: City');
  const plainDir = path.join(f.sourceDir, 'photos', 'ordinary');
  await image(path.join(plainDir, '1.jpg'), '#225980');
  const first = await f.publish();
  const oldRelease = await f.release();
  const oldImage = first.galleries.find(g => g.layout === 'pairs').pairs[0].a.src;
  await image(path.join(dir, 'a.jpg'), '#942352');
  const second = await f.publish();
  const replacement = second.galleries.find(g => g.layout === 'pairs').pairs[0].a.src;
  assert.notEqual(replacement, oldImage);
  const nextRelease = await f.release();
  await assert.rejects(stat(path.join(nextRelease, oldImage)), { code: 'ENOENT' });
  await stat(path.join(oldRelease, oldImage));
  await rm(dir, { recursive: true });
  const third = await f.publish();
  assert.equal(third.galleries.find(g => g.slug === 'ordinary')?.imageCount, 1);
  assert.ok(!third.galleries.some(g => g.slug === 'contrasts'));
  await assert.rejects(stat(path.join(await f.release(), 'photos/contrasts/index.html')), { code: 'ENOENT' });
  await stat(path.join(oldRelease, 'photos/contrasts/index.html'));
});

test('a theme rebuild preserves paired content after the source library is unavailable', async t => {
  const f = await fixture(t);
  await f.pair('01-city', 'title: City\na:\n  label: Day\nb:\n  label: Night', 'An authored caption.');
  const original = await f.publish();
  await rm(f.sourceDir, { recursive: true });
  const rebuilt = await rebuildSite({ outputDir: f.outputDir, siteURL: 'https://preview.example' });
  assert.deepEqual(rebuilt.galleries[0].pairs, original.galleries[0].pairs);
  const release = await f.release();
  const html = await readFile(path.join(release, 'photos/contrasts/index.html'), 'utf8');
  assert.ok(html.includes('An authored caption.'));
  for (const photo of original.galleries[0].photos) await stat(path.join(release, photo.src));
});

test('removing optional source text ignores old translated labels and alt text without changing the sidecar', async t => {
  const f = await fixture(t);
  const dir = await f.pair('01-city');
  const chinese = header('title: 舊標題\na:\n  label: 舊標籤\n  alt: 舊說明', '舊說明文字。');
  await writeFile(path.join(dir, 'pair.zh-Hant.md'), chinese);
  const pair = (await f.publish()).galleries[0].pairs[0];
  assert.equal(pair.a.translations['zh-Hant'].label, 'A');
  assert.equal(pair.a.translations['zh-Hant'].alt, 'A');
  assert.deepEqual(pair.translations['zh-Hant'], {});
  assert.equal(await readFile(path.join(dir, 'pair.zh-Hant.md'), 'utf8'), chinese);
});
