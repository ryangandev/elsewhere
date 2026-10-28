import { describe, expect, it } from 'vitest';
import { geoContains } from 'd3-geo';
import type { MultiPolygon, Polygon } from 'geojson';
import { readFileSync } from 'node:fs';
import {
  countryLabelPoints,
  countryPlacePoint,
  distanceKm,
  findRouteLandCrossings,
  findSeaRouteLandCrossings,
  getMapCountry,
  getPlace,
  listMapCountries,
  listPlaces,
  placeCoordinates,
  routePoints,
} from '../../src/content/geo';
import { findPlaces } from '../../pipeline/generate/gazetteer-context';
import { CountryFile, type SceneRouteSpec } from '../../src/content/schema';
import { contentInput, landIndex } from './load';

function allRoutes(): { where: string; route: SceneRouteSpec }[] {
  return contentInput().countryFiles.flatMap(({ file, data }) => {
    const { country, stories } = CountryFile.parse(data);
    return [
      ...country.scene.routes.map((route) => ({ where: `${file} country`, route })),
      ...stories.flatMap((story) =>
        story.scene.routes.map((route) => ({ where: `${file} ${story.id}`, route })),
      ),
    ];
  });
}

describe('country places', () => {
  const shapes = JSON.parse(readFileSync('public/maps/countries.geojson', 'utf8')).features as {
    properties: { ADM0_A3: string };
    geometry: Polygon | MultiPolygon;
  }[];
  const shape = (id: string) => shapes.find((feature) => feature.properties.ADM0_A3 === id)!;
  const malaysia = getPlace('malaysia')!;

  it('offers the label point first, then interior points of the country', () => {
    const [anchor, ...others] = countryLabelPoints(malaysia);
    expect(anchor).toEqual([malaysia.lat, malaysia.lng]);
    expect(others.length).toBeGreaterThan(0);
    for (const [lat, lng] of others) expect(geoContains(shape('MYS').geometry, [lng, lat])).toBe(true);
  });

  it('moves to the part of the country nearest the scene', () => {
    // Malaysia's label point is on Borneo; a scene on the Strait of Malacca marks the peninsula.
    const [lat, lng] = countryPlacePoint(malaysia, [1.35, 103.82]);
    expect(lng).toBeLessThan(105);
    expect(distanceKm([lat, lng], [1.35, 103.82])).toBeLessThan(400);
    // Seen from Borneo, the label point is already the nearest.
    expect(countryPlacePoint(malaysia, [4, 114])).toEqual([malaysia.lat, malaysia.lng]);
  });

  it('keeps the label point unless another part is much closer', () => {
    // Bavaria is a little closer to France than central Germany, which is not enough to move.
    const germany = getPlace('germany')!;
    expect(countryPlacePoint(germany, [46.6, 2.5])).toEqual([germany.lat, germany.lng]);
  });
});

describe('gazetteer', () => {
  it('resolves places by ID', () => {
    expect(getPlace('strait-of-malacca')).toMatchObject({ kind: 'water', surface: 'sea' });
    expect(getPlace('singapore')).toMatchObject({ kind: 'country', countryId: 'SGP' });
    expect(getPlace('singapore-city')).toMatchObject({ kind: 'place' });
    const kualaLumpur = getPlace('kuala-lumpur')!;
    expect(placeCoordinates('kuala-lumpur')).toEqual([kualaLumpur.lat, kualaLumpur.lng]);
    expect(() => placeCoordinates('atlantis')).toThrow('atlantis');
  });

  it('knows every map identity by ID or slug', () => {
    expect(listMapCountries()).toHaveLength(258);
    expect(getMapCountry('SGP')).toMatchObject({ slug: 'singapore', name: 'Singapore' });
    expect(getMapCountry('united-states')).toMatchObject({ id: 'USA' });
    expect(getMapCountry('XXX')).toBeUndefined();
  });

  it('gives straits a passage path through the water', () => {
    const path = getPlace('bosporus')!.path!;
    expect(path.length).toBeGreaterThanOrEqual(3);
    for (const point of path) expect(landIndex().isLand(point)).toBe(false);
  });

  it('keeps strait and channel passages at sea, so the route check can trust them', () => {
    // Only canals cross the land they cut through; marine passages stay off the globe's land
    // apart from crossings shorter than the route check's tolerance.
    const passages = listPlaces().filter((place) => place.path && place.source !== 'rivers');
    expect(passages.length).toBeGreaterThan(40);
    for (const place of passages) {
      const waypoints = place.path!.map((point) => ({
        id: place.id,
        point,
        surface: 'sea' as const,
      }));
      expect(findSeaRouteLandCrossings(waypoints, landIndex()), place.id).toEqual([]);
    }
  });
});

describe('routes', () => {
  it('follow great circles in short steps', () => {
    const points = routePoints({ via: ['kuantan', 'kota-kinabalu'] });
    expect(points[0]).toEqual(placeCoordinates('kuantan'));
    expect(points.at(-1)).toEqual(placeCoordinates('kota-kinabalu'));
    for (let index = 1; index < points.length; index += 1) {
      expect(distanceKm(points[index - 1], points[index])).toBeLessThanOrEqual(50.1);
    }
  });

  it('pass through every point of a strait passage', () => {
    const points = routePoints({ via: ['sea-of-marmara', 'bosporus', 'black-sea'] });
    for (const [lat, lng] of getPlace('bosporus')!.path!) {
      expect(points).toContainEqual([lat, lng]);
    }
  });

  it('flag a sea route that cuts across land', () => {
    // The legacy Singapore route jumped from the Andaman Sea straight to the Singapore Strait,
    // drawing a line across the Malay Peninsula.
    const crossings = findRouteLandCrossings(
      { kind: 'sea', via: ['andaman-sea', 'singapore-strait', 'south-china-sea'] },
      landIndex(),
    );
    expect(crossings.length).toBeGreaterThan(0);
    for (const crossing of crossings) {
      expect(crossing).toMatchObject({ from: 'andaman-sea', to: 'singapore-strait' });
    }
    expect(Math.max(...crossings.map((crossing) => crossing.lengthKm))).toBeGreaterThan(400);
  });

  it('check the way into and out of a passage, but not the path inside it', () => {
    // The Suez Canal crosses land in the globe's geometry by definition; its path is exempt,
    // the legs to and from it are not.
    const canal = getPlace('suez-canal')!;
    expect(canal.path!.length).toBeGreaterThanOrEqual(3);
    expect(canal.path!.some((point) => landIndex().isLand(point))).toBe(true);
    expect(
      findRouteLandCrossings({ kind: 'sea', via: ['suez-canal', 'red-sea'] }, landIndex()),
    ).not.toEqual([]);
  });

  it('only check sea routes', () => {
    const via = ['andaman-sea', 'singapore-strait'];
    expect(findRouteLandCrossings({ kind: 'flow', via }, landIndex())).toEqual([]);
  });

  // A realistic route through each narrow passage stays at sea; the shortcut across the land
  // beside it does not.
  const passages: { passage: string; through: string[]; acrossLand: string[] }[] = [
    {
      passage: 'suez-canal',
      through: ['mediterranean-sea', 'suez-canal', 'gulf-of-suez', 'red-sea'],
      acrossLand: ['mediterranean-sea', 'gulf-of-suez', 'red-sea'],
    },
    {
      passage: 'panama-canal',
      through: ['caribbean-sea', 'panama-canal', 'gulf-of-panama'],
      acrossLand: ['caribbean-sea', 'gulf-of-panama'],
    },
    {
      passage: 'strait-of-hormuz',
      through: ['persian-gulf', 'strait-of-hormuz', 'gulf-of-oman'],
      acrossLand: ['persian-gulf', 'gulf-of-oman'],
    },
    {
      passage: 'bab-el-mandeb',
      through: ['red-sea', 'bab-el-mandeb', 'gulf-of-aden'],
      acrossLand: ['red-sea', 'gulf-of-aden'],
    },
    {
      passage: 'bristol-channel',
      through: ['english-channel', 'bristol-channel'],
      acrossLand: ['irish-sea', 'bristol-channel'],
    },
    {
      passage: 'hudson-strait',
      through: ['labrador-sea', 'hudson-strait', 'hudson-bay'],
      acrossLand: ['labrador-sea', 'hudson-bay'],
    },
    {
      passage: 'northwest-passage',
      through: ['baffin-bay', 'northwest-passage', 'amundsen-gulf', 'beaufort-sea'],
      acrossLand: ['baffin-bay', 'beaufort-sea'],
    },
    {
      passage: 'saint-lawrence-river',
      through: ['north-atlantic-ocean', 'gulf-of-saint-lawrence', 'saint-lawrence-river', 'montreal'],
      acrossLand: ['gulf-of-saint-lawrence', 'montreal'],
    },
    {
      passage: 'strait-of-magellan',
      through: ['falkland-islands', 'strait-of-magellan', 'south-pacific-ocean'],
      acrossLand: ['bahia-grande', 'south-pacific-ocean'],
    },
    {
      // Natural Earth's own polygon is slivers; the passage is where the two oceans meet.
      passage: 'drake-passage',
      through: ['bellingshausen-sea', 'drake-passage', 'scotia-sea'],
      acrossLand: ['bellingshausen-sea', 'scotia-sea'],
    },
    {
      // Natural Earth has only the Bering Sea and Chukchi Sea polygons, which meet across it. The
      // passage starts south of St Lawrence Island, so the Bering Sea's open-water label point
      // reaches it; a straight line to the Chukchi Sea from Norton Sound crosses the Seward Peninsula.
      passage: 'bering-strait',
      through: ['bering-sea', 'bering-strait', 'chukchi-sea'],
      acrossLand: ['norton-sound', 'kotzebue-sound'],
    },
    {
      // Likewise the Black Sea and the Sea of Azov, across the Kerch Strait.
      passage: 'kerch-strait',
      through: ['black-sea', 'kerch-strait', 'sea-of-azov'],
      acrossLand: ['black-sea', 'sea-of-azov'],
    },
  ];

  it.each(passages)('pass through $passage', ({ passage, through, acrossLand }) => {
    expect(getPlace(passage)?.path?.length).toBeGreaterThanOrEqual(2);
    expect(findRouteLandCrossings({ kind: 'sea', via: through }, landIndex())).toEqual([]);
    expect(findRouteLandCrossings({ kind: 'sea', via: acrossLand }, landIndex())).not.toEqual([]);
  });

  it('reach the Bering Strait from the Pacific side in both directions', () => {
    const routes = [
      ['bering-sea', 'bering-strait', 'chukchi-sea'],
      ['chukchi-sea', 'bering-strait', 'bering-sea'],
      ['gulf-of-anadyr', 'bering-strait', 'chukchi-sea'],
      ['chukchi-sea', 'bering-strait', 'gulf-of-anadyr'],
      ['norton-sound', 'bering-strait', 'chukchi-sea'],
      ['chukchi-sea', 'bering-strait', 'norton-sound'],
      // Bristol Bay opens onto the Bering Sea, behind the Alaska Peninsula.
      ['bristol-bay', 'bering-sea', 'bering-strait', 'chukchi-sea'],
      ['chukchi-sea', 'bering-strait', 'bering-sea', 'bristol-bay'],
    ];
    for (const via of routes) {
      expect(findRouteLandCrossings({ kind: 'sea', via }, landIndex()), via.join(' > ')).toEqual(
        [],
      );
    }
  });

  // Waters and ports the pilot countries need that Natural Earth lacks or leaves out by default:
  // a realistic route through each stays at sea, the shortcut across the land beside it does not.
  const places: { place: string; through: string[][]; acrossLand: string[] }[] = [
    {
      place: 'celtic-sea',
      through: [['bay-of-biscay', 'celtic-sea', 'irish-sea']],
      acrossLand: ['bay-of-biscay', 'irish-sea'],
    },
    {
      place: 'cabot-strait',
      through: [
        ['saint-lawrence-river', 'gulf-of-saint-lawrence', 'cabot-strait', 'north-atlantic-ocean'],
      ],
      acrossLand: ['cabot-strait', 'bay-of-fundy'],
    },
    {
      place: 'cardiff',
      through: [['celtic-sea', 'bristol-channel', 'cardiff']],
      acrossLand: ['english-channel', 'cardiff'],
    },
    {
      place: 'punta-arenas',
      through: [
        ['falkland-islands', 'strait-of-magellan', 'punta-arenas'],
        ['punta-arenas', 'strait-of-magellan', 'south-pacific-ocean'],
      ],
      acrossLand: ['bahia-grande', 'punta-arenas'],
    },
  ];

  it.each(places)('reach $place', ({ place, through, acrossLand }) => {
    expect(getPlace(place)).toBeDefined();
    for (const via of through) {
      expect(findRouteLandCrossings({ kind: 'sea', via }, landIndex()), via.join(' > ')).toEqual(
        [],
      );
    }
    expect(findRouteLandCrossings({ kind: 'sea', via: acrossLand }, landIndex())).not.toEqual([]);
  });

  it('leave a passage at the port on it instead of sailing to the far end', () => {
    // Istanbul is on the Bosporus: the route stops there, short of the Black Sea end.
    const path = getPlace('bosporus')!.path!;
    const blackSeaEnd = path.at(-1)!;
    const points = routePoints({ via: ['sea-of-marmara', 'bosporus', 'istanbul'] });
    expect(points.at(-1)).toEqual(placeCoordinates('istanbul'));
    expect(points).not.toContainEqual(blackSeaEnd);
    // A route from the port joins the passage at the same point and goes on through it.
    const outbound = routePoints({ via: ['istanbul', 'bosporus', 'black-sea'] });
    expect(outbound).toContainEqual(blackSeaEnd);
    expect(outbound).not.toContainEqual(path[0]);
  });

  it('know the places drafters asked for', () => {
    // Ports and island towns below the default cutoff, the Rhine and South Africa's rivers, Lake
    // Victoria (Natural Earth's lakes dataset), and the nine provinces for stories by province.
    const ids = [
      'rotterdam',
      'mombasa',
      'zanzibar',
      'zanzibar-island',
      'lamu',
      'rhine-river',
      'vaal-river',
      'orange-river',
      'lake-victoria',
      'durban',
      'cape-town',
      'strait-of-gibraltar',
      'bosporus',
      'dardanelles',
      'suez-canal',
      'panama-canal',
      ...[
        'eastern-cape',
        'free-state',
        'gauteng',
        'kwazulu-natal',
        'limpopo',
        'mpumalanga',
        'north-west-province',
        'northern-cape',
        'western-cape',
      ],
    ];
    for (const id of ids) expect(getPlace(id), id).toBeDefined();
    expect(getPlace('lake-victoria')).toMatchObject({ kind: 'water', surface: 'land' });
    expect(getPlace('gauteng')).toMatchObject({ kind: 'region', source: 'admin1' });
    // Zanzibar the city and Zanzibar the island are different places.
    expect(getPlace('zanzibar')).toMatchObject({ kind: 'place', countryId: 'TZA' });
    expect(getPlace('zanzibar-island')).toMatchObject({ kind: 'region' });
  });

  it('give every admin-1 region the map country Natural Earth files it under', () => {
    const regions = listPlaces().filter((place) => place.source === 'admin1');
    expect(regions.length).toBeGreaterThanOrEqual(12);
    for (const region of regions) {
      expect(getMapCountry(region.countryId ?? ''), region.id).toBeDefined();
    }
    const countryOf = (id: string) => getPlace(id)?.countryId;
    expect(countryOf('gauteng')).toBe('ZAF');
    expect(countryOf('north-west-province')).toBe('ZAF');
    expect(countryOf('sabah')).toBe('MYS');
    expect(countryOf('french-guiana')).toBe('FRA');
    expect(getPlace('north-west')).toBeUndefined();
    // Drafters search by country: the provinces turn up for South Africa.
    expect(findPlaces({ query: 'gauteng', countryId: 'ZAF', near: null })).toContain('gauteng');
    const provinces = findPlaces({ query: null, countryId: 'ZAF', near: null }, 200);
    for (const id of ['eastern-cape', 'free-state', 'kwazulu-natal', 'north-west-province']) {
      expect(provinces, id).toContain(id);
    }
  });

  it('know the Rhine by one ID although Natural Earth names it in several ways', () => {
    expect(listPlaces().filter((place) => /^(rhine|rhein) river$/i.test(place.name))).toHaveLength(1);
    expect(getPlace('rhein-river')).toBeUndefined();
    expect(getPlace('nyanza')).toBeUndefined();
  });

  it('know the Saint Lawrence River by one ID', () => {
    expect(getPlace('saint-lawrence-river')?.path?.length).toBeGreaterThanOrEqual(2);
    expect(getPlace('st-lawrence-river')).toBeUndefined();
    expect(listPlaces().filter((place) => /lawrence river/i.test(place.name))).toHaveLength(1);
  });

  it('stay at sea in all content', () => {
    const sea = allRoutes().filter(({ route }) => route.kind === 'sea');
    expect(sea.map(({ route }) => route.id)).toEqual(
      expect.arrayContaining(['malacca-passage', 'peninsula-to-sabah', 'turkish-straits']),
    );
    for (const { where, route } of sea) {
      expect(findRouteLandCrossings(route, landIndex()), `${where} ${route.id}`).toEqual([]);
    }
  });
});
