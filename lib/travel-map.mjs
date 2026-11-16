import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
import { feature as topologyFeature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json' with { type: 'json' };

const width = 1000;
const height = 520;
const projection = geoNaturalEarth1().fitExtent([[14, 14], [width - 14, height - 14]], { type: 'Sphere' });
const projectPath = geoPath(projection).digits(2);
const landPath = projectPath(topologyFeature(landTopology, landTopology.objects.land));
const outlinePath = projectPath({ type: 'Sphere' });
const graticulePath = projectPath(geoGraticule10());
const round = value => Math.round(value * 100) / 100;

function position(value, label) {
  if (!Array.isArray(value) || value.length < 2 || !value.every(Number.isFinite)) throw new TypeError(`${label}: expected finite longitude/latitude coordinates.`);
  const [longitude, latitude] = value;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new RangeError(`${label}: coordinates are outside longitude/latitude bounds.`);
  return [longitude, latitude];
}

/** Project a travel FeatureCollection once during publishing; no map service is needed in the browser. */
export function buildTravelMap(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) throw new TypeError('Travel map must be a GeoJSON FeatureCollection.');
  const places = [], routes = [], identifiers = new Set();
  for (const [index, item] of geojson.features.entries()) {
    if (!item || item.type !== 'Feature' || !item.geometry) throw new TypeError(`Travel map feature ${index + 1}: geometry is required.`);
    const id = String(item.properties?.id ?? `feature-${index + 1}`);
    if (!id || identifiers.has(id)) throw new TypeError(`Travel map feature ${index + 1}: id must be unique and nonempty.`);
    identifiers.add(id);
    const name = item.properties?.name ?? '';
    const kind = item.properties?.kind ?? '';
    if (typeof name !== 'string' || typeof kind !== 'string') throw new TypeError(`Travel map feature ${index + 1}: name and kind must be text.`);
    if (item.geometry.type === 'Point') {
      const coordinates = position(item.geometry.coordinates, `Travel map point ${id}`);
      const [x, y] = projection(coordinates);
      places.push({ id, name, kind, x: round(x), y: round(y) });
    } else if (item.geometry.type === 'LineString') {
      if (!Array.isArray(item.geometry.coordinates) || item.geometry.coordinates.length < 2) throw new TypeError(`Travel map route ${id}: at least two positions are required.`);
      const coordinates = item.geometry.coordinates.map((point, pointIndex) => position(point, `Travel map route ${id}, position ${pointIndex + 1}`));
      routes.push({ id, name, kind, path: projectPath({ type: 'LineString', coordinates }) || '' });
    } else {
      throw new TypeError(`Travel map feature ${id}: only Point and LineString geometries are supported.`);
    }
  }
  const sortedPlaces = [...places].sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || a.id.localeCompare(b.id));
  let source = null;
  if (geojson.source?.url) {
    const url = new URL(geojson.source.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Travel map source must use HTTP(S).');
    source = { url: url.href, title: String(geojson.source.title || ''), importedAt: String(geojson.source.importedAt || '') };
  }
  return { width, height, landPath, outlinePath, graticulePath, places, sortedPlaces, routes, placeCount: places.length, routeCount: routes.length, source };
}
