// Build local vector geometry at two levels of detail from Natural Earth.
// Raw downloads belong in .map-sources; only compact runtime assets are shipped.
// The globe's image basemap, public/maps/earth.jpg, is bundled as-is and only recorded here.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import mapshaper from 'mapshaper';
import { geoArea } from 'd3-geo';

const countryUrls = [10, 50].map(scale => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_${scale}m_admin_0_countries.geojson`);
mkdirSync('.map-sources', { recursive: true });
mkdirSync('public/maps', { recursive: true });
async function download(url, path) {
  if (existsSync(path)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}
await Promise.all(countryUrls.map((url, index) => download(url, `.map-sources/countries-${[10, 50][index]}m.geojson`)));
const fields = 'ADM0_A3,ADMIN,NAME_LONG,SUBREGION,LABEL_X,LABEL_Y,LABELRANK';
async function simplify(file, amount) {
  const result = await mapshaper.applyCommands(`-i source.geojson -simplify ${amount}% weighted keep-shapes -filter-fields ${fields} -o format=geojson precision=0.001`, { 'source.geojson': readFileSync(file) });
  const collection = JSON.parse(Object.values(result)[0].toString());
  for (const feature of collection.features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const coordinates of polygons) {
      if (geoArea({ type: 'Polygon', coordinates }) > 2 * Math.PI) coordinates.forEach(ring => ring.reverse());
    }
  }
  return collection;
}
const detail = await simplify('.map-sources/countries-10m.geojson', 18);
const base = await simplify('.map-sources/countries-50m.geojson', 22);
const existing = new Set(base.features.map(f => f.properties.ADM0_A3));
base.features.push(...detail.features.filter(f => !existing.has(f.properties.ADM0_A3)));
for (const [name, data] of [['countries', base], ['countries-detail', detail]]) {
  writeFileSync(`public/maps/${name}.geojson`, JSON.stringify(data));
  console.log(`${name}: ${data.features.length} features, ${(JSON.stringify(data).length / 1e6).toFixed(2)} MB`);
}
// Label anchors and basics in data/geo/countries.json depend on this geometry.
await import('./build-countries.mjs');
const manifest = {
  boundaries: { source: 'Natural Earth, public domain', urls: countryUrls,
    sha256: Object.fromEntries([10, 50].map(scale => [scale, createHash('sha256').update(readFileSync(`.map-sources/countries-${scale}m.geojson`)).digest('hex')])),
    detailPercent: 18, basePercent: 22, precisionDegrees: .001, features: detail.features.length },
  basemap: { source: 'NASA Blue Marble, via the three-globe example assets', file: 'public/maps/earth.jpg', width: 4096, height: 2048,
    sha256: createHash('sha256').update(readFileSync('public/maps/earth.jpg')).digest('hex') }
};
writeFileSync('public/maps/sources.json', JSON.stringify(manifest, null, 2) + '\n');
