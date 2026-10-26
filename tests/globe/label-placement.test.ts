import { readFileSync } from 'node:fs';
import { geoContains } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import {
  arrangeLabels,
  fitFailures,
  labelOrder,
  landCover,
  labelScale,
  nudgeDirection,
  overflowFailures,
  placeContextLabel,
  positionOrder,
  stackedName,
  surfacePoint,
  type CountryFeature,
  type CountryLabel,
  type LabelView,
  type PlaceLabel,
  type Rect,
} from '../../src/globe/cartography';
import { countryContains } from '../../src/globe/country-lookup';
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

  it('offers a long, thin country a position along each stretch', () => {
    const lats = (id: string) => candidates(id).map((point) => point.lat);
    // Vietnam's Red River delta, its centre and the Mekong delta.
    expect(lats('VNM').some((lat) => lat > 20)).toBe(true);
    expect(lats('VNM').some((lat) => lat > 15 && lat < 20)).toBe(true);
    expect(lats('VNM').some((lat) => lat < 12)).toBe(true);
    expect(lats('CHL').some((lat) => lat > -28)).toBe(true);
    expect(lats('CHL').some((lat) => lat < -44)).toBe(true);
    expect(lats('NOR').some((lat) => lat > 67)).toBe(true);
    expect(lats('ITA').some((lat) => lat < 41.5)).toBe(true);
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

  it('keeps the current position while it faces the camera and is nearly as good', () => {
    expect(positionOrder(2, [0.9, 0.85, 0.8], rooms(5, 5, 5), [])).toEqual([2, 0, 1]);
  });

  it('leaves a current position that shows far less land than the best', () => {
    expect(positionOrder(2, [0.9, 0.5, 0.45], rooms(5, 5, 1), [])).toEqual([0, 1, 2]);
  });

  it('counts a position fading toward the horizon for less', () => {
    // Facing alone ranks the first position ahead (1.75 against 1.35); its fade puts it behind.
    expect(positionOrder(-1, [0.35, 0.9], rooms(5, 1.5), [])).toEqual([1, 0]);
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

// A flat test map: ten pixels per degree, with screen y growing southward from 50 degrees north.
const box = (id: string, west: number, south: number, east: number, north: number) =>
  ({
    type: 'Feature',
    properties: { ADM0_A3: id, ADMIN: id },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      ],
    },
  }) satisfies CountryFeature;
const flatUnproject = (x: number, y: number) => ({ lng: x / 10, lat: 50 - y / 10 });
const flatCountryAt =
  (features: CountryFeature[]) =>
  ({ lat, lng }: { lat: number; lng: number }) =>
    features.find((feature) => countryContains(feature, lng, lat))?.properties.ADM0_A3;

describe('overflowing names', () => {
  // A strip one degree wide, too thin for a name eight degrees long.
  const strip = box('STR', 10, 10, 11, 40);
  const name = { left: 65, right: 145, top: 246, bottom: 254 };

  it('lets a name reach over the sea when its center is on its own land', () => {
    const countryAt = flatCountryAt([strip]);
    expect(fitFailures(strip, name, flatUnproject)).not.toBe(0);
    expect(overflowFailures(strip, name, flatUnproject, countryAt)).toBe(0);
  });

  it('keeps a name off a neighbour and needs its center on its own land', () => {
    const neighbour = box('NBR', 11, 10, 30, 40);
    const countryAt = flatCountryAt([strip, neighbour]);
    const failures = overflowFailures(strip, name, flatUnproject, countryAt);
    expect(nudgeDirection(failures)).toEqual({ x: -1, y: 0 });
    const offshore = { left: 130, right: 210, top: 246, bottom: 254 };
    expect(nudgeDirection(overflowFailures(strip, offshore, flatUnproject, countryAt))).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe('land cover', () => {
  const land = box('LND', 20, 20, 40, 30);
  const countryAt = flatCountryAt([land]);

  it('counts the sample points on land, and rules out a box centered on land', () => {
    const sea = { left: 100, right: 160, top: 240, bottom: 260 };
    expect(landCover(sea, flatUnproject, countryAt)).toBe(0);
    const shore = { left: 160, right: 220, top: 240, bottom: 260 };
    expect(landCover(shore, flatUnproject, countryAt)).toBe(3);
    expect(landCover(shore, flatUnproject, countryAt, 2)).toBe(2);
    const inland = { left: 270, right: 330, top: 240, bottom: 260 };
    expect(landCover(inland, flatUnproject, countryAt)).toBe(Infinity);
  });

  it('counts points off the globe as land', () => {
    const edge = (x: number, y: number) => (x > 150 ? null : flatUnproject(x, y));
    const sea = { left: 100, right: 160, top: 240, bottom: 260 };
    expect(landCover(sea, edge, countryAt)).toBe(3);
  });
});

describe('context label shifts', () => {
  const frame = { left: 0, top: 0, right: 1000, bottom: 1000 };
  const rect = { left: 400, right: 460, top: 400, bottom: 420 };

  it('takes the first clear shift without a cover measure', () => {
    expect(placeContextLabel(rect, [], frame)).toMatchObject({ x: 0, y: 0 });
    expect(placeContextLabel(rect, [rect], frame)).toMatchObject({ x: 0, y: -30 });
  });

  it('takes the clear shift with the least cover, and none above the limit', () => {
    // Land lies to the right: the further left a shift, the less of it covers land.
    const cover = (shifted: Rect) => Math.max(0, Math.round((shifted.left - 360) / 12));
    expect(placeContextLabel(rect, [], frame, cover, 3)).toMatchObject({ x: -36, y: 0 });
    expect(placeContextLabel(rect, [], frame, () => 5, 3)).toBeNull();
  });
});

describe('label arrangement', () => {
  const frame = { left: 0, top: 0, right: 1000, bottom: 1000 };
  const view = (features: CountryFeature[]): LabelView => ({
    facing: () => 1,
    scale: () => 200,
    screen: (point) => ({ x: point.lng * 10, y: (50 - point.lat) * 10 }),
    unproject: flatUnproject,
    countryAt: flatCountryAt(features),
    frame,
  });
  const element = () =>
    ({
      classList: { toggle() {} },
      style: {},
      setAttribute() {},
      tabIndex: 0,
    }) as unknown as HTMLButtonElement;
  const country = (
    id: string,
    lat: number,
    lng: number,
    overrides: Partial<CountryLabel> = {},
  ): CountryLabel => {
    const label = element();
    return {
      id,
      area: 0.1,
      rank: 3,
      anchor: { lat, lng },
      element: label,
      datum: { lat, lng, element: label },
      positions: [surfacePoint(lat, lng, 0.1, 1)],
      position: 0,
      facing: [],
      width: 80,
      height: 16,
      stackedWidth: 0,
      stackedHeight: 0,
      stacked: false,
      nudgeX: 0,
      nudgeY: 0,
      visible: false,
      suppressed: false,
      emphasized: false,
      ...overrides,
    };
  };
  const place = (lat: number, lng: number, overrides: Partial<PlaceLabel> = {}): PlaceLabel => {
    const label = element();
    return {
      element: label,
      datum: { lat, lng, element: label },
      point: surfacePoint(lat, lng, 0),
      active: false,
      water: true,
      width: 60,
      height: 20,
      ...overrides,
    };
  };
  const arrange = (
    features: CountryFeature[],
    countries: CountryLabel[],
    places: PlaceLabel[] = [],
    blocked: Rect[] = [],
  ) =>
    arrangeLabels({
      view: view(features),
      countries,
      places,
      features: new Map(features.map((feature) => [feature.properties.ADM0_A3, feature])),
      blocked,
    });

  it('names a thin country across the sea beside it', () => {
    const strip = country('STR', 25, 11);
    arrange([box('STR', 10, 10, 12, 40)], [strip]);
    expect(strip.visible).toBe(true);
  });

  it('does not write a thin country across its neighbour', () => {
    const strip = country('STR', 25, 11);
    const neighbour = country('NBR', 25, 21);
    arrange([box('STR', 10, 10, 12, 40), box('NBR', 12.2, 10, 30, 40)], [strip, neighbour]);
    expect(strip.visible).toBe(false);
    expect(neighbour.visible).toBe(true);
  });

  it('places names that fit inside before names that overflow', () => {
    // The strip ranks first, but its overflowing name would cover the other name's only spot.
    const strip = country('STR', 25, 11, { emphasized: true });
    const wide = country('WID', 25, 18);
    arrange([box('STR', 10, 10, 12, 40), box('WID', 14, 20, 30, 30)], [strip, wide]);
    expect(wide).toMatchObject({ visible: true, nudgeX: 0, nudgeY: 0 });
    expect(strip.visible).toBe(false);
  });

  it('steps a name aside when its own spot is taken', () => {
    const wide = country('WID', 25, 30);
    arrange(
      [box('WID', 20, 20, 40, 30)],
      [wide],
      [],
      [{ left: 0, top: 0, right: 262, bottom: 1000 }],
    );
    expect(wide.visible).toBe(true);
    expect(wide.nudgeX).toBeGreaterThan(0);
  });

  it('puts a water name on the water beside a coast', () => {
    const bay = place(25, 19);
    arrange([box('LND', 20, 20, 40, 30)], [], [bay]);
    expect(bay.element.style.visibility).toBe('visible');
    expect(bay.element.style.translate).toBe('-36px 0px');
  });

  it('leaves out a water name with no water around it, unless the reader focused it', () => {
    const lake = place(25, 30);
    const focused = place(25, 30, { active: true });
    arrange([box('LND', 20, 20, 40, 30)], [], [lake]);
    arrange([box('LND', 20, 20, 40, 30)], [], [focused]);
    expect(lake.element.style.visibility).toBe('hidden');
    expect(focused.element.style.visibility).toBe('visible');
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
