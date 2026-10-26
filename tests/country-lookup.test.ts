import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createCountryLookup } from '../app/globe/country-lookup';
import type { CountryFeature } from '../app/globe/cartography';
import index from '../src/content/legacy/country-index.json';

const features = JSON.parse(readFileSync(new URL('../public/maps/countries-detail.geojson', import.meta.url), 'utf8')).features as CountryFeature[];
const lookup = createCountryLookup(features);

test('surface picking resolves country anchors, including islands, enclaves and dateline countries', () => {
  for (const country of index) assert.equal(lookup(country)?.properties.ADM0_A3, country.id, country.name);
});
test('surface picking does not select a country in open water or outside the globe', () => {
  assert.equal(lookup(null), undefined);
  assert.equal(lookup({ lat: 0, lng: -140 }), undefined);
  assert.equal(lookup({ lat: 0, lng: -30 }), undefined);
});
