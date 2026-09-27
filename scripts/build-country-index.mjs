// Regenerate the compact search directory from the bundled Natural Earth geometry.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoArea, geoCentroid } from 'd3-geo';
const source = JSON.parse(readFileSync(new URL('../public/maps/countries.geojson', import.meta.url), 'utf8'));
const index = source.features.map(feature => {
  const polygons = feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates.map(coordinates => ({ type: 'Polygon', coordinates }))
    : [feature.geometry];
  const mainland = polygons.sort((a, b) => geoArea(b) - geoArea(a))[0];
  const [lng, lat] = geoCentroid(mainland);
  return { id: feature.properties.ADM0_A3, name: feature.properties.ADMIN,
    region: feature.properties.SUBREGION, lat: +lat.toFixed(3), lng: +lng.toFixed(3),
    area: +geoArea(mainland).toFixed(8) };
}).sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(new URL('../app/country-index.json', import.meta.url), JSON.stringify(index, null, 2) + '\n');
console.log(`Indexed ${index.length} Natural Earth countries and territories.`);
