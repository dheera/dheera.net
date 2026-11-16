import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildTravelMap } from '../lib/travel-map.mjs';
import { buildStaticSite } from '../lib/static-site.mjs';

const fixture = () => ({ type: 'FeatureCollection', source: { url: 'https://example.com/travel', title: 'Travel map' }, features: [
  { type: 'Feature', properties: { id: 'taipei', name: '臺北', kind: 'city' }, geometry: { type: 'Point', coordinates: [121.56, 25.03] } },
  { type: 'Feature', properties: { id: 'sf', name: 'San Francisco', kind: 'city' }, geometry: { type: 'Point', coordinates: [-122.42, 37.77] } },
  { type: 'Feature', properties: { id: 'route', name: 'Across the date line', kind: 'boat' }, geometry: { type: 'LineString', coordinates: [[179, 10], [-179, 12]] } },
] });

test('travel map preserves names and projects valid points and date-line routes without changing source data', () => {
  const source = fixture(), original = JSON.stringify(source);
  const result = buildTravelMap(source);
  assert.equal(result.placeCount, 2);
  assert.equal(result.routeCount, 1);
  assert.equal(result.places[0].name, '臺北');
  assert.ok(result.landPath.length > 1000);
  assert.ok(result.places.every(place => Number.isFinite(place.x) && Number.isFinite(place.y) && place.x >= 0 && place.x <= 1000 && place.y >= 0 && place.y <= 520));
  assert.ok((result.routes[0].path.match(/M/g) || []).length >= 2, 'date-line route should split at the map edge');
  assert.doesNotMatch(result.routes[0].path, /NaN|Infinity/);
  assert.equal(JSON.stringify(source), original);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('travel map rejects malformed geometry, duplicate ids, and unsafe source URLs', () => {
  assert.throws(() => buildTravelMap(null), /FeatureCollection/);
  assert.throws(() => buildTravelMap({ type: 'FeatureCollection', features: {} }), /FeatureCollection/);
  const source = fixture();
  source.features[0].geometry.coordinates = [121, 95];
  assert.throws(() => buildTravelMap(source), /bounds/);
  source.features[0].geometry.coordinates = [NaN, 25];
  assert.throws(() => buildTravelMap(source), /finite/);
  source.features[0].geometry = { type: 'Polygon', coordinates: [] };
  assert.throws(() => buildTravelMap(source), /Point and LineString/);
  const duplicate = fixture();
  duplicate.features[1].properties.id = duplicate.features[0].properties.id;
  assert.throws(() => buildTravelMap(duplicate), /unique/);
  const unsafe = fixture();
  unsafe.source.url = 'javascript:alert(1)';
  assert.throws(() => buildTravelMap(unsafe), /HTTP/);
});

test('About emits complete map geometry and accessible labels in HTML, without a browser data fetch', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dheera-travel-map-test-'));
  try {
    const source = fixture();
    source.features[0].properties.name = '<script>alert("place")</script>';
    await buildStaticSite({ outputDir: directory, manifest: { site: { name: 'Dheera', defaultStyle: 'midnight' }, galleries: [], projects: [], about: { title: 'About', bodyHtml: '<p>A traveller.</p>', travelMap: buildTravelMap(source) } } });
    const html = await readFile(path.join(directory, 'about/index.html'), 'utf8');
    assert.match(html, /class="travel-map-land" d="M/);
    assert.doesNotMatch(html, /id="travel-map-place"/);
    assert.match(html, /data-map-action="reset"/);
    assert.match(html, /data-map-place="sf"/);
    assert.match(html, /San Francisco/);
    assert.match(html, /&lt;script&gt;alert/);
    assert.doesNotMatch(html, /<script>alert\("place"\)/);
    assert.match(html, /\/assets\/travel-map\.js/);
    const home = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.doesNotMatch(home, /\/assets\/travel-map\.js/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
