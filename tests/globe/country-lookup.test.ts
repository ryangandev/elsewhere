import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCountryLookup } from '../../src/globe/country-lookup';
import type { CountryFeature } from '../../src/globe/cartography';
import index from '../../data/geo/countries.json';

const features = JSON.parse(
  readFileSync(new URL('../../public/maps/countries-detail.geojson', import.meta.url), 'utf8'),
).features as CountryFeature[];
const lookup = createCountryLookup(features);

describe('country lookup', () => {
  it('resolves country anchors, including islands, enclaves and dateline countries', () => {
    for (const country of index) {
      expect(lookup(country)?.properties.ADM0_A3, country.name).toBe(country.id);
    }
  });

  it('does not select a country in open water or outside the globe', () => {
    expect(lookup(null)).toBeUndefined();
    expect(lookup({ lat: 0, lng: -140 })).toBeUndefined();
    expect(lookup({ lat: 0, lng: -30 })).toBeUndefined();
  });
});
