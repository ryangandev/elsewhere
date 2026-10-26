import { readFileSync } from 'node:fs';
import { geoContains } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import {
  fitFailures,
  labelOrder,
  labelScale,
  nudgeDirection,
  positionOrder,
  stackedName,
  type CountryFeature,
} from '../../src/globe/cartography';
import { labelCandidates } from '../../src/globe/label-candidates';
import index from '../../data/geo/countries.json';

const base = JSON.parse(
  readFileSync(new URL('../../public/maps/countries.geojson', import.meta.url), 'utf8'),
).features as CountryFeature[];
const feature = (id: string) => base.find((item) => item.properties.ADM0_A3 === id)!;
const anchor = (id: string) => index.find((country) => country.id === id)!;
const candidates = (id: string) => labelCandidates(feature(id).geometry, anchor(id));

describe('label candidates', () => {
  it('starts with the cartographic anchor and keeps every candidate on the country', () => {
    for (const country of index) {
      const points = labelCandidates(feature(country.id).geometry, country);
      expect(points[0]).toMatchObject({ lat: country.lat, lng: country.lng });
      expect(points.length).toBeLessThanOrEqual(6);
      for (const point of points.slice(1)) {
        expect(geoContains(feature(country.id), [point.lng, point.lat]), country.name).toBe(true);
        expect(point.room).toBeGreaterThan(0);
        expect(point.area).toBeGreaterThan(0);
      }
    }
  });

  it('offers a large country a second position across its interior', () => {
    // Russia's label point is west of the Urals; Siberia must offer its own.
    expect(candidates('RUS').some((point) => point.lng > 80)).toBe(true);
    expect(candidates('CAN').some((point) => point.lng < -115)).toBe(true);
  });

  it('skips thin tails', () => {
    // The Tenasserim strip south of about 16 degrees north is too narrow for a name.
    for (const point of candidates('MMR')) expect(point.lat).toBeGreaterThan(16);
  });

  it('spreads candidates across the largest islands', () => {
    const points = candidates('IDN').slice(1);
    expect(points.length).toBeGreaterThan(2);
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++)
        expect(
          Math.hypot(points[i].lat - points[j].lat, points[i].lng - points[j].lng),
        ).toBeGreaterThan(1);
  });

  it('ranks open interiors above narrow ones', () => {
    const [, ...russia] = candidates('RUS');
    const [, ...chile] = candidates('CHL');
    const widest = (points: { room: number }[]) => Math.max(...points.map((point) => point.room));
    expect(widest(russia)).toBeGreaterThan(widest(chile));
  });
});

describe('label order', () => {
  it('puts the selected country first, then places, then other countries', () => {
    const selected = labelOrder({ kind: 'selected' });
    const quietPlace = labelOrder({ kind: 'place', active: false, water: false });
    const country = labelOrder({
      kind: 'country',
      emphasized: true,
      rank: 0,
      space: 1000,
      visible: true,
    });
    expect(selected).toBeGreaterThan(labelOrder({ kind: 'place', active: true, water: true }));
    expect(quietPlace).toBeGreaterThan(country);
    expect(labelOrder({ kind: 'place', active: true, water: false })).toBeGreaterThan(
      labelOrder({ kind: 'place', active: false, water: true }),
    );
  });

  it('orders countries by emphasis, then rank, then on-screen size', () => {
    const country = (overrides: Partial<{ emphasized: boolean; rank: number; space: number }>) =>
      labelOrder({
        kind: 'country',
        emphasized: false,
        rank: 3,
        space: 40,
        visible: false,
        ...overrides,
      });
    expect(country({ emphasized: true, rank: 4 })).toBeGreaterThan(
      country({ rank: 1, space: 100 }),
    );
    expect(country({ rank: 2 })).toBeGreaterThan(country({ rank: 3 }));
    expect(country({ space: 80 })).toBeGreaterThan(country({ space: 40 }));
    // A visible name only wins ties, so it cannot hold off a clearly better newcomer.
    expect(
      labelOrder({ kind: 'country', emphasized: false, rank: 3, space: 40, visible: true }),
    ).toBeLessThan(country({ space: 50 }));
  });
});

describe('position order', () => {
  const rooms = (...values: number[]) => values.map((room) => ({ room }));

  it('keeps the current position while it faces the camera', () => {
    expect(positionOrder(2, [0.9, 0.5, 0.45], rooms(5, 5, 1), [])).toEqual([2, 0, 1]);
  });

  it('drops a current position near the horizon and ranks the rest by visible room', () => {
    expect(positionOrder(0, [0.3, 0.9, 0.8], rooms(5, 2, 4), [])).toEqual([2, 1, 0]);
    expect(positionOrder(-1, [0.9, 0.9], rooms(1, 3), [])).toEqual([1, 0]);
  });

  it('reuses the output array', () => {
    const order = [7, 7, 7, 7];
    expect(positionOrder(-1, [1], rooms(1), order)).toBe(order);
    expect(order).toEqual([0]);
  });
});

describe('fit and nudge', () => {
  // A 10 by 10 degree square; the test projection maps screen x to longitude and y to latitude.
  const square: CountryFeature = {
    type: 'Feature',
    properties: { ADM0_A3: 'SQR', ADMIN: 'Square' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 10],
          [10, 10],
          [10, 0],
          [0, 0],
        ],
      ],
    },
  };
  const unproject = (x: number, y: number) => ({ lng: x, lat: y });

  it('reports which corners fall off the country', () => {
    expect(fitFailures(square, { left: 2, right: 8, top: 4, bottom: 6 }, unproject)).toBe(0);
    const left = fitFailures(square, { left: -2, right: 4, top: 4, bottom: 6 }, unproject);
    expect(nudgeDirection(left)).toEqual({ x: 1, y: 0 });
    const corner = fitFailures(square, { left: 6, right: 12, top: 6, bottom: 12 }, unproject);
    // Screen y grows downward, so the failing bottom corners push the name up (negative y).
    expect(nudgeDirection(corner)).toEqual({ x: -1, y: -1 });
  });

  it('gives no direction when the center misses or failures cancel out', () => {
    const missed = fitFailures(square, { left: 20, right: 30, top: 4, bottom: 6 }, unproject);
    expect(nudgeDirection(missed)).toEqual({ x: 0, y: 0 });
    const wide = fitFailures(square, { left: -2, right: 12, top: 4, bottom: 6 }, unproject);
    expect(nudgeDirection(wide)).toEqual({ x: 0, y: 0 });
  });
});

describe('map names', () => {
  // Short names are generated from Natural Earth's NAME field by scripts/build-countries.mjs.
  const countries: { id: string; name: string; shortName?: string }[] = index;
  const shortName = (id: string) => countries.find((country) => country.id === id)?.shortName;

  it('uses short atlas forms and keeps other names', () => {
    expect(shortName('RUS')).toBe('Russia');
    expect(shortName('COD')).toBe('Dem. Rep. Congo');
    expect(shortName('FRA')).toBeUndefined();
    // Natural Earth's NAME is longer here ("United States of America"), so there is none.
    expect(shortName('USA')).toBeUndefined();
  });

  it('keeps every short name shorter than the full name', () => {
    for (const country of countries) {
      if (country.shortName)
        expect(country.shortName.length, country.id).toBeLessThan(country.name.length);
    }
  });

  it('breaks a multi-word name where the longer line is shortest', () => {
    expect(stackedName('Saudi Arabia')).toBe('Saudi\nArabia');
    expect(stackedName('Central African Rep.')).toBe('Central\nAfrican Rep.');
    expect(stackedName('Bosnia and Herz.')).toBe('Bosnia\nand Herz.');
    expect(stackedName('Mongolia')).toBeUndefined();
  });
});

describe('label scale', () => {
  it('steps type size with zoom', () => {
    expect(labelScale(1.95)).toBe('world');
    expect(labelScale(1.4)).toBe('world');
    expect(labelScale(0.9)).toBe('region');
    expect(labelScale(0.3)).toBe('local');
  });
});
