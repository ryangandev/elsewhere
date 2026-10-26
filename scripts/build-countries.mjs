// Build data/geo/countries.json: one entry for each of the 258 Natural Earth map identities.
// Attributes come from the Natural Earth 10m countries dataset; label anchors come from the
// bundled detailed geometry so labels sit on the shapes the globe actually draws.
// English only: names are Natural Earth's English long names, and shortName is Natural Earth's
// short map name (NAME, "Russia" for "Russian Federation") when it is shorter.
import { readFileSync } from 'node:fs';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import {
  readDataset,
  round,
  slugify,
  sourceRecord,
  updateSourcesManifest,
  writeJson,
} from './natural-earth.mjs';

const OUTPUT = 'data/geo/countries.json';

const source = await readDataset('countries');
const attributes = new Map(
  source.features.map(({ properties }) => [properties.ADM0_A3, properties]),
);
const geometry = JSON.parse(readFileSync('public/maps/countries-detail.geojson', 'utf8'));

function labelAnchor(feature) {
  const { properties } = feature;
  const polygons =
    feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }))
      : [feature.geometry];
  const mainland = polygons.sort((a, b) => geoArea(b) - geoArea(a))[0];
  const anchor = [properties.LABEL_X, properties.LABEL_Y];
  let point =
    anchor.every(Number.isFinite) && geoContains(feature, anchor) ? anchor : geoCentroid(mainland);
  // An atoll's centroid can fall inside its lagoon. Keep its anchor on land.
  if (!geoContains(feature, point)) {
    point = mainland.coordinates[0].find((coordinate) => geoContains(feature, coordinate)) ?? point;
  }
  return { point, area: geoArea(mainland) };
}

function isoA2(properties) {
  const code = [properties.ISO_A2_EH, properties.ISO_A2].find((value) => /^[A-Z]{2}$/.test(value));
  return code ?? null;
}

const countries = geometry.features
  .map((feature) => {
    const id = feature.properties.ADM0_A3;
    const properties = attributes.get(id);
    if (!properties) throw new Error(`No Natural Earth attributes for ${id}`);
    const name = properties.NAME_LONG || properties.ADMIN;
    const { point, area } = labelAnchor(feature);
    return {
      id,
      slug: slugify(name),
      name,
      ...(properties.NAME && properties.NAME.length < name.length
        ? { shortName: properties.NAME }
        : {}),
      isoA2: isoA2(properties),
      region: properties.SUBREGION,
      continent: properties.CONTINENT,
      type: properties.TYPE,
      // Natural Earth estimates a few populations with a fraction (Somalia).
      population: properties.POP_EST >= 0 ? Math.round(properties.POP_EST) : null,
      populationYear: properties.POP_YEAR > 0 ? properties.POP_YEAR : null,
      lat: round(point[1], 6),
      lng: round(point[0], 6),
      area: round(area, 8),
      labelRank: properties.LABELRANK ?? 6,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const slugs = new Set();
for (const country of countries) {
  if (slugs.has(country.slug)) throw new Error(`Duplicate country slug ${country.slug}`);
  slugs.add(country.slug);
}

writeJson(OUTPUT, countries);
updateSourcesManifest('countries', {
  source: 'Natural Earth, public domain',
  ...sourceRecord('countries'),
  labelGeometry: 'public/maps/countries-detail.geojson',
  features: countries.length,
});
console.log(`${OUTPUT}: ${countries.length} map identities.`);
