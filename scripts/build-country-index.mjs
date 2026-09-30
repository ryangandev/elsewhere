// Regenerate names and label anchors from the bundled detailed Natural Earth data.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
const source = JSON.parse(readFileSync(new URL('../public/maps/countries-detail.geojson', import.meta.url), 'utf8'));
const index = source.features.map(feature => {
  const properties = feature.properties;
  const polygons = feature.geometry.type === 'MultiPolygon'
    ? feature.geometry.coordinates.map(coordinates => ({ type: 'Polygon', coordinates }))
    : [feature.geometry];
  const mainland = polygons.sort((a, b) => geoArea(b) - geoArea(a))[0];
  const anchor = [properties.LABEL_X, properties.LABEL_Y];
  let point = anchor.every(Number.isFinite) && geoContains(feature, anchor) ? anchor : geoCentroid(mainland);
  // An atoll's centroid can fall inside its lagoon. Keep its anchor on land.
  if (!geoContains(feature, point)) point = mainland.coordinates[0].find(coordinate => geoContains(feature, coordinate)) ?? point;
  const [lng, lat] = point;
  return { id: properties.ADM0_A3, name: properties.NAME_LONG || properties.ADMIN,
    region: properties.SUBREGION, lat: +lat.toFixed(6), lng: +lng.toFixed(6),
    area: +geoArea(mainland).toFixed(8), rank: properties.LABELRANK ?? 6 };
}).sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(new URL('../app/country-index.json', import.meta.url), JSON.stringify(index, null, 2) + '\n');
console.log(`Indexed ${index.length} Natural Earth countries and territories.`);
