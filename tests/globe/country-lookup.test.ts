import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countryContains, createCountryLookup, ringContains } from '../../src/globe/country-lookup';
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

  it('keeps a hole out of the country drawn around it', () => {
    const southAfrica = features.find((feature) => feature.properties.ADM0_A3 === 'ZAF')!;
    expect(countryContains(southAfrica, 28.25, -29.48)).toBe(false);
    expect(countryContains(southAfrica, 25, -30)).toBe(true);
  });
});

describe('ring test', () => {
  const square = [
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
    [0, 0],
  ];

  it('tells inside from outside and counts the ring vertices as inside', () => {
    expect(ringContains(square, 5, 5)).toBe(true);
    expect(ringContains(square, 15, 5)).toBe(false);
    expect(ringContains(square, -1, 5)).toBe(false);
    // An atoll's label point can be one of its vertices.
    expect(ringContains(square, 10, 10)).toBe(true);
  });
});
