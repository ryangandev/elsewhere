// Build local vector geometry at two levels of detail from Natural Earth.
// Raw downloads belong in .map-sources; only compact runtime assets are shipped.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import mapshaper from 'mapshaper';
import { geoArea } from 'd3-geo';
import sharp from 'sharp';

const elevationUrl = 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/topography/gebco_08_rev_elev_21600x10800.jpg';
const countryUrls = [10, 50].map(scale => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_${scale}m_admin_0_countries.geojson`);
mkdirSync('.map-sources', { recursive: true });
mkdirSync('public/maps', { recursive: true });
async function download(url, path) {
  if (existsSync(path)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}
await Promise.all([...countryUrls.map((url, index) => download(url, `.map-sources/countries-${[10, 50][index]}m.geojson`)), download(elevationUrl, '.map-sources/elevation.jpg')]);
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
await import('./build-country-index.mjs');
for (const width of [4096, 8192]) {
  await sharp('.map-sources/elevation.jpg').resize(width, width / 2).jpeg({ quality: 90 }).toFile(`public/maps/relief-${width}.jpg`);
}
const manifest = {
  boundaries: { source: 'Natural Earth, public domain', urls: countryUrls,
    sha256: Object.fromEntries([10, 50].map(scale => [scale, createHash('sha256').update(readFileSync(`.map-sources/countries-${scale}m.geojson`)).digest('hex')])),
    detailPercent: 18, basePercent: 22, precisionDegrees: .001, features: detail.features.length },
  elevation: { source: 'NASA Earth Observatory, Blue Marble Next Generation, GEBCO elevation', url: elevationUrl,
    sha256: createHash('sha256').update(readFileSync('.map-sources/elevation.jpg')).digest('hex'), widths: [4096, 8192], jpegQuality: 90 }
};
writeFileSync('public/maps/sources.json', JSON.stringify(manifest, null, 2) + '\n');
