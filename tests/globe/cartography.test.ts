import { readFileSync } from 'node:fs';
import { geoArea, geoContains } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import {
  fitsCountry,
  overlaps,
  placeContextLabel,
  type CountryFeature,
} from '../../src/globe/cartography';
import index from '../../app/country-index.json';

const geometry = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../public/maps/${name}.geojson`, import.meta.url), 'utf8'))
    .features as CountryFeature[];
const base = geometry('countries');
const detail = geometry('countries-detail');

describe('cartography', () => {
  it('covers every searchable country at both geometry levels, including small islands', () => {
    const ids = index.map((country) => country.id).sort();
    expect(new Set(ids).size).toBe(ids.length);
    for (const collection of [base, detail]) {
      expect(collection.map((feature) => feature.properties.ADM0_A3).sort()).toEqual(ids);
      for (const feature of collection) {
        expect(geoArea(feature), feature.properties.ADMIN).toBeGreaterThan(0);
        expect(geoArea(feature), feature.properties.ADMIN).toBeLessThan(2 * Math.PI);
      }
    }
    for (const id of ['SGP', 'VAT', 'MCO', 'TLS']) expect(ids).toContain(id);
  });

  it('keeps country anchors on their own geography, including archipelagos and atolls', () => {
    for (const place of index) {
      const feature = detail.find((item) => item.properties.ADM0_A3 === place.id)!;
      expect(geoContains(feature, [place.lng, place.lat]), place.name).toBe(true);
      expect(Number.isFinite(place.rank)).toBe(true);
    }
  });

  it('fits a name to the country, not only its bounding box or center', () => {
    const france = detail.find((feature) => feature.properties.ADM0_A3 === 'FRA')!;
    const unproject = (x: number, y: number) => ({ lng: x, lat: y });
    expect(fitsCountry(france, { left: 2, right: 3, top: 46, bottom: 47 }, unproject)).toBe(true);
    expect(fitsCountry(france, { left: -8, right: 3, top: 46, bottom: 47 }, unproject)).toBe(false);
    expect(fitsCountry(france, { left: 2, right: 3, top: 46, bottom: 47 }, () => null)).toBe(false);
    const box = { left: 0, right: 80, top: 0, bottom: 20 };
    expect(overlaps(box, { left: 75, right: 120, top: 5, bottom: 25 })).toBe(true);
    expect(overlaps(box, { left: 81, right: 120, top: 5, bottom: 25 })).toBe(false);
  });

  it('moves crowded place labels clear of the current country and keeps them inside the map', () => {
    const selected = { left: 150, right: 240, top: 205, bottom: 233 };
    const label = { left: 80, right: 207, top: 181, bottom: 219 };
    const frame = { left: 0, right: 390, top: 100, bottom: 330 };
    const placement = placeContextLabel(label, [selected], frame);
    expect(placement).not.toBeNull();
    expect(overlaps(placement!.box, selected)).toBe(false);
    expect(placeContextLabel(label, [frame], frame)).toBeNull();
  });
});
