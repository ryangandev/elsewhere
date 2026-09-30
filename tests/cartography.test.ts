import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { geoArea, geoContains } from 'd3-geo';
import { fitsCountry, overlaps, type CountryFeature } from '../app/globe/cartography';
import index from '../app/country-index.json';
const geometry = (name: string) => JSON.parse(readFileSync(new URL(`../public/maps/${name}.geojson`, import.meta.url), 'utf8')).features as CountryFeature[];
const base = geometry('countries');
const detail = geometry('countries-detail');

test('both geometry levels cover every searchable country including small islands', () => {
  const ids = index.map(country => country.id).sort();
  assert.equal(new Set(ids).size, ids.length);
  for (const collection of [base, detail]) {
    assert.deepEqual(collection.map(feature => feature.properties.ADM0_A3).sort(), ids);
    for (const feature of collection) assert.ok(geoArea(feature) > 0 && geoArea(feature) < 2 * Math.PI, feature.properties.ADMIN);
  }
  for (const id of ['SGP', 'VAT', 'MCO', 'TLS']) assert.ok(ids.includes(id), id);
});

test('country anchors stay on their own geography, including archipelagos and atolls', () => {
  for (const place of index) {
    const feature = detail.find(feature => feature.properties.ADM0_A3 === place.id)!;
    assert.ok(geoContains(feature, [place.lng, place.lat]), place.name);
    assert.ok(Number.isFinite(place.rank));
  }
});

test('a name must fit the country, not only its bounding box or center', () => {
  const france = detail.find(feature => feature.properties.ADM0_A3 === 'FRA')!;
  const unproject = (x: number, y: number) => ({ lng: x, lat: y });
  assert.ok(fitsCountry(france, { left: 2, right: 3, top: 46, bottom: 47 }, unproject));
  assert.equal(fitsCountry(france, { left: -8, right: 3, top: 46, bottom: 47 }, unproject), false);
  assert.equal(fitsCountry(france, { left: 2, right: 3, top: 46, bottom: 47 }, () => null), false);
  assert.equal(overlaps({ left: 0, right: 80, top: 0, bottom: 20 }, { left: 75, right: 120, top: 5, bottom: 25 }), true);
  assert.equal(overlaps({ left: 0, right: 80, top: 0, bottom: 20 }, { left: 81, right: 120, top: 5, bottom: 25 }), false);
});

test('crowded story labels move clear of the current country and stay inside the map', async () => {
  const { placeContextLabel } = await import('../app/globe/cartography');
  const selected = { left: 150, right: 240, top: 205, bottom: 233 };
  const label = { left: 80, right: 207, top: 181, bottom: 219 };
  const frame = { left: 0, right: 390, top: 100, bottom: 330 };
  const placement = placeContextLabel(label, [selected], frame);
  assert.ok(placement);
  assert.equal(overlaps(placement.box, selected), false);
  assert.equal(placeContextLabel(label, [frame], frame), null);
});
