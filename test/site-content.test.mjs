import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishLibrary } from '../lib/publisher.mjs';

const mapData = name => ({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { id: 'visited-place', name }, geometry: { type: 'Point', coordinates: [121.56, 25.03] } },
] });

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dheera-site-content-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = path.join(root, 'library');
  const outputDir = path.join(root, 'published');
  for (const directory of ['photos', 'projects', 'assets']) await mkdir(path.join(sourceDir, directory), { recursive: true });
  await writeFile(path.join(sourceDir, '.publish-library'), JSON.stringify({ version: 1, id: 'site-content-test' }));
  return {
    root, sourceDir, outputDir,
    publish: () => publishLibrary({ sourceDir, outputDir }),
    setMap: value => writeFile(path.join(sourceDir, 'about.md'), `---\ntitle: About\ntravelMap: ${value}\n---\nPlaces I have visited.\n`),
    pointer: () => readFile(path.join(outputDir, 'current.json'), 'utf8'),
    async page(language = 'en') {
      const { release } = JSON.parse(await readFile(path.join(outputDir, 'current.json'), 'utf8'));
      return readFile(path.join(outputDir, 'releases', release, language === 'en' ? 'about/index.html' : 'zh-hant/about/index.html'), 'utf8');
    },
  };
}

test('about.travelMap publishes a contained NAS file into both languages and reflects edits or removal', async t => {
  const f = await fixture(t);
  const filename = path.join(f.sourceDir, 'assets', 'travel.geojson');
  const source = JSON.stringify(mapData('臺北'));
  await writeFile(filename, source);
  await f.setMap('assets/travel.geojson');
  await writeFile(path.join(f.sourceDir, 'about.zh-Hant.md'), '---\ntitle: 關於我\n---\n我去過的地方。\n');
  const first = await f.publish();
  assert.equal(first.about.travelMap.placeCount, 1);
  assert.equal(first.about.travelMap.places[0].name, '臺北');
  assert.equal(await readFile(filename, 'utf8'), source);
  for (const language of ['en', 'zh-Hant']) {
    const html = await f.page(language);
    assert.match(html, /data-map-place="visited-place"/);
    assert.match(html, /臺北/);
    assert.match(html, /src="\/assets\/travel-map\.js"/);
    assert.doesNotMatch(html, /assets\/travel\.geojson/);
  }
  await writeFile(filename, JSON.stringify(mapData('Taipei — revised label')));
  const second = await f.publish();
  assert.equal(second.about.travelMap.places[0].name, 'Taipei — revised label');
  assert.match(await f.page(), /Taipei — revised label/);
  await writeFile(path.join(f.sourceDir, 'about.md'), '---\ntitle: About\n---\nA biography without a map.\n');
  const removed = await f.publish();
  assert.equal(removed.about.travelMap, undefined);
  for (const language of ['en', 'zh-Hant']) assert.doesNotMatch(await f.page(language), /id="travel-map"|src="\/assets\/travel-map\.js"/);
});

test('travelMap rejects traversal, escaping symlinks, and missing files without replacing the published site', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.sourceDir, 'assets', 'valid.geojson'), JSON.stringify(mapData('A valid place')));
  await f.setMap('assets/valid.geojson');
  await f.publish();
  const current = await f.pointer();
  const exportTarget = await readlink(path.join(f.outputDir, 'dist'));
  const outside = path.join(f.root, 'outside.geojson');
  await writeFile(outside, JSON.stringify(mapData('Must not be imported')));
  await symlink(outside, path.join(f.sourceDir, 'assets', 'escape.geojson'));
  for (const reference of ['../outside.geojson', outside, 'assets/escape.geojson', 'assets/missing.geojson']) {
    await f.setMap(reference);
    await assert.rejects(f.publish());
    assert.equal(await f.pointer(), current);
    assert.equal(await readlink(path.join(f.outputDir, 'dist')), exportTarget);
    assert.match(await f.page(), /A valid place/);
    assert.doesNotMatch(await f.page(), /Must not be imported/);
  }
});
