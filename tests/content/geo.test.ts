import { describe, expect, it } from 'vitest';
import {
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
  ];

  it.each(passages)('pass through $passage', ({ passage, through, acrossLand }) => {
    expect(getPlace(passage)?.path?.length).toBeGreaterThanOrEqual(2);
    expect(findRouteLandCrossings({ kind: 'sea', via: through }, landIndex())).toEqual([]);
    expect(findRouteLandCrossings({ kind: 'sea', via: acrossLand }, landIndex())).not.toEqual([]);
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
