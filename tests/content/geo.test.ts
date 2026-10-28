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
  interpolateGreatCircle,
  getMapCountry,
  getPlace,
  listMapCountries,
  listPlaces,
  placeCoordinates,
  routePoints,
  routePolyline,
} from '../../src/content/geo';
import { findPlaces, sharedListing } from '../../pipeline/generate/gazetteer-context';
import { mainStem } from '../../scripts/passage-paths.mjs';
import type { SceneRouteSpec } from '../../src/content/schema';
import { landIndex } from './load';

/**
 * Sea routes that content has used, written out here so the check below does not depend on what
 * content/en holds today. Production content is checked as a whole by validate.test.ts.
 */
const seaRoutes: SceneRouteSpec[] = [
  {
    id: 'malacca-passage',
    kind: 'sea',
    via: ['andaman-sea', 'strait-of-malacca', 'singapore-strait', 'south-china-sea'],
  },
  { id: 'peninsula-to-sabah', kind: 'sea', via: ['kuantan', 'kota-kinabalu'] },
  {
    id: 'turkish-straits',
    kind: 'sea',
    via: ['black-sea', 'bosporus', 'sea-of-marmara', 'dardanelles', 'aegean-sea'],
  },
];

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
    for (const [lat, lng] of others)
      expect(geoContains(shape('MYS').geometry, [lng, lat])).toBe(true);
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
    const points = routePoints({ kind: 'sea', via: ['kuantan', 'kota-kinabalu'] });
    expect(points[0]).toEqual(placeCoordinates('kuantan'));
    expect(points.at(-1)).toEqual(placeCoordinates('kota-kinabalu'));
    for (let index = 1; index < points.length; index += 1) {
      expect(distanceKm(points[index - 1], points[index])).toBeLessThanOrEqual(50.1);
    }
  });

  it('pass through every point of a strait passage', () => {
    const points = routePoints({ kind: 'sea', via: ['sea-of-marmara', 'bosporus', 'black-sea'] });
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
      through: [
        'north-atlantic-ocean',
        'gulf-of-saint-lawrence',
        'saint-lawrence-river',
        'montreal',
      ],
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
    {
      // And the English Channel and the North Sea, across the Strait of Dover: a straight line
      // between their label points crosses Kent and East Anglia.
      passage: 'strait-of-dover',
      through: ['english-channel', 'strait-of-dover', 'north-sea'],
      acrossLand: ['english-channel', 'north-sea'],
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

  it('reach Rotterdam from the Atlantic through the Strait of Dover', () => {
    const routes = [
      ['north-atlantic-ocean', 'english-channel', 'strait-of-dover', 'north-sea', 'rotterdam'],
      ['english-channel', 'strait-of-dover', 'rotterdam'],
      ['rotterdam', 'north-sea', 'strait-of-dover', 'english-channel', 'north-atlantic-ocean'],
    ];
    for (const via of routes) {
      expect(findRouteLandCrossings({ kind: 'sea', via }, landIndex()), via.join(' > ')).toEqual(
        [],
      );
    }
    // Without the strait, the line from the Channel cuts across Cap Gris-Nez and Walcheren.
    expect(
      findRouteLandCrossings({ kind: 'sea', via: ['english-channel', 'rotterdam'] }, landIndex()),
    ).not.toEqual([]);
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
    const points = routePoints({ kind: 'sea', via: ['sea-of-marmara', 'bosporus', 'istanbul'] });
    expect(points.at(-1)).toEqual(placeCoordinates('istanbul'));
    expect(points).not.toContainEqual(blackSeaEnd);
    // A route from the port joins the passage at the same point and goes on through it.
    const outbound = routePoints({ kind: 'sea', via: ['istanbul', 'bosporus', 'black-sea'] });
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
      'lake-albert',
      'lake-kyoga',
      'lake-tana',
      'blue-nile-river',
      'meuse-river',
      'scheldt-river',
      'thames-river',
      'strait-of-dover',
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
    for (const lake of ['lake-victoria', 'lake-albert', 'lake-kyoga', 'lake-tana']) {
      expect(getPlace(lake), lake).toMatchObject({
        kind: 'water',
        surface: 'land',
        source: 'lakes',
      });
    }
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
    expect(listPlaces().filter((place) => /^(rhine|rhein) river$/i.test(place.name))).toHaveLength(
      1,
    );
    expect(getPlace('rhein-river')).toBeUndefined();
    expect(getPlace('nyanza')).toBeUndefined();
    for (const id of ['albert', 'kyoga', 'tana', 'maas-river', 'schelde-river']) {
      expect(getPlace(id), id).toBeUndefined();
    }
  });

  /** How close a line through `points` comes to `point`, in km, measured every kilometre. */
  const closestKm = (points: [number, number][], point: [number, number]) =>
    Math.min(
      ...points.flatMap((from, index) =>
        (index ? interpolateGreatCircle(points[index - 1], from, 1) : [from]).map((sample) =>
          distanceKm(sample, point),
        ),
      ),
    );
  const rivers = () =>
    listPlaces().filter((place) => place.source === 'rivers' && !/canal$/i.test(place.name));

  it('give every river its course, through its label point', () => {
    expect(rivers().length).toBeGreaterThanOrEqual(50);
    for (const river of rivers()) {
      expect(river.path?.length, river.id).toBeGreaterThanOrEqual(2);
      // The course is simplified to within 3 km of the centerline the label point is on.
      expect(closestKm(river.path!, [river.lat, river.lng]), river.id).toBeLessThanOrEqual(3.1);
    }
    // The Rhine runs from the Alps through Lake Constance to the delta, about 1,100 km.
    const rhine = getPlace('rhine-river')!.path!;
    const length = rhine
      .slice(1)
      .reduce((sum, point, index) => sum + distanceKm(rhine[index], point), 0);
    expect(length).toBeGreaterThan(1000);
    expect(closestKm(rhine, placeCoordinates('vaduz'))).toBeLessThan(10);
    expect(
      Math.min(
        ...[rhine[0], rhine.at(-1)!].map((end) => distanceKm(end, placeCoordinates('rotterdam'))),
      ),
    ).toBeLessThan(50);
  });

  it('take a river course through the lakes it crosses, but not across the lake it leaves', () => {
    // Pieces as [lng, lat] lines: a centerline across the lake the river leaves, the river, a
    // lake it flows through, and the river again.
    const piece = (lake: boolean, ...line: [number, number][]) => ({ line, lake });
    const { path } = mainStem(
      [
        piece(true, [30, 0], [30.5, 0], [31, 0]),
        piece(false, [31, 0], [31, 0.5], [31, 1]),
        piece(true, [31, 1], [31, 1.5]),
        piece(false, [31, 1.5], [31, 2], [31, 3]),
      ],
      2,
    );
    // Either end may come first.
    expect([path[0], path.at(-1)]).toEqual(
      expect.arrayContaining([
        [0, 31],
        [3, 31],
      ]),
    );
    expect(path).toContainEqual([1.5, 31]);
    expect(path).not.toContainEqual([0, 30.5]);

    // The Victoria Nile leaves Lake Victoria at its outlet, north of the equator, instead of
    // crossing the lake from the Kagera's mouth, south of it.
    const victoriaNile = getPlace('victoria-nile-river')!.path!;
    expect(Math.min(...victoriaNile.map(([lat]) => lat))).toBeGreaterThan(0);
  });

  it('keep separate delta branches apart', () => {
    // Pieces of one river meet within 2 km; branches of a delta are farther apart over land.
    const branches = [
      {
        line: [
          [0, 0],
          [0, 1],
        ] as [number, number][],
        lake: false,
      },
      {
        line: [
          [0.05, 0],
          [0.05, 1.5],
        ] as [number, number][],
        lake: false,
      },
    ];
    const { path, leftOutKm } = mainStem(branches, 2);
    expect(path).toHaveLength(2);
    expect(leftOutKm).toBeGreaterThan(100);
    // The Irrawaddy delta is one branch, from near the delta's head to the sea, not a line
    // stitched from branch to branch with both ends near Yangon.
    const irrawaddy = getPlace('irrawaddy-delta-river')!.path!;
    expect(distanceKm(irrawaddy[0], irrawaddy.at(-1)!)).toBeGreaterThan(150);
  });

  it('follow a river along its course instead of a straight line through its label point', () => {
    // Before, this route was two great circles: Alps to Cologne (the Rhine's label point) to the
    // middle of the North Sea.
    const rhine = getPlace('rhine-river')!.path!;
    const points = routePoints({ kind: 'river', via: ['alps', 'rhine-river', 'north-sea'] });
    expect(points[0]).toEqual(placeCoordinates('alps'));
    expect(points.at(-1)).toEqual(placeCoordinates('north-sea'));
    // The Alps are beside the river, so the route joins it at the nearest point and follows it
    // down to its mouth in the delta.
    const nearestAlps = rhine.reduce((best, point) =>
      distanceKm(point, placeCoordinates('alps')) < distanceKm(best, placeCoordinates('alps'))
        ? point
        : best,
    );
    const from = rhine.indexOf(nearestAlps);
    const mouth =
      distanceKm(rhine[0], placeCoordinates('north-sea')) <
      distanceKm(rhine.at(-1)!, placeCoordinates('north-sea'))
        ? 0
        : rhine.length - 1;
    const course =
      from <= mouth ? rhine.slice(from, mouth + 1) : rhine.slice(mouth, from + 1).reverse();
    const indexes = course.map((point) =>
      points.findIndex(([lat, lng]) => lat === point[0] && lng === point[1]),
    );
    expect(indexes).not.toContain(-1);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(closestKm(points, placeCoordinates('rhine-river'))).toBeLessThan(3.1);
    expect(closestKm(points, placeCoordinates('vaduz'))).toBeLessThan(10);
  });

  it('join and leave a river at the cities beside it', () => {
    // Rotterdam is on the Rhine delta: a route from it joins the river nearby and goes upstream.
    const rhine = getPlace('rhine-river')!.path!;
    const upstream = routePoints({ kind: 'river', via: ['rotterdam', 'rhine-river'] });
    expect(upstream[0]).toEqual(placeCoordinates('rotterdam'));
    expect(distanceKm(upstream[0], upstream[1])).toBeLessThan(50);
    const source = [rhine[0], rhine.at(-1)!].find(
      (end) => distanceKm(end, placeCoordinates('rotterdam')) > 500,
    )!;
    expect(upstream.at(-1)).toEqual(source);

    // The Nile from Lake Victoria to Cairo, through Lake Kyoga, the Sudd and Khartoum.
    const nile = routePoints({
      kind: 'river',
      via: [
        'lake-victoria',
        'victoria-nile-river',
        'albert-nile-river',
        'mountain-nile-river',
        'white-nile-river',
        'khartoum',
        'nile-river',
        'cairo',
      ],
    });
    expect(nile.at(-1)).toEqual(placeCoordinates('cairo'));
    expect(closestKm(nile, placeCoordinates('lake-kyoga'))).toBeLessThan(25);
    expect(closestKm(nile, placeCoordinates('khartoum'))).toBeLessThan(10);

    // The Blue Nile from Lake Tana, where it begins, to Khartoum, where it ends.
    const blueNile = getPlace('blue-nile-river')!.path!;
    const route = routePoints({ kind: 'river', via: ['lake-tana', 'blue-nile-river', 'khartoum'] });
    const tanaEnd = [blueNile[0], blueNile.at(-1)!].find(
      (end) => distanceKm(end, placeCoordinates('lake-tana')) < 50,
    );
    expect(route[1]).toEqual(tanaEnd);
    expect(route.at(-1)).toEqual(placeCoordinates('khartoum'));
  });

  it('draw land routes and flows through label points, not along paths', () => {
    // Land routes and flows are illustrative arcs: a land route that names a river crosses it at
    // its label point instead of following its course, and so does a flow through a strait.
    const pointToPoint = (via: string[]) =>
      routePolyline(via.map(placeCoordinates), 50).map(([lat, lng]) => [
        Math.round(lat * 1e4) / 1e4,
        Math.round(lng * 1e4) / 1e4,
      ]);
    const overland = ['ural-mountains', 'ob-river', 'lena-river', 'sea-of-okhotsk'];
    expect(routePoints({ kind: 'land', via: overland })).toEqual(pointToPoint(overland));
    const gulfStream = ['caribbean-sea', 'florida-strait', 'north-atlantic-ocean'];
    expect(getPlace('florida-strait')!.path!.length).toBeGreaterThanOrEqual(2);
    expect(routePoints({ kind: 'flow', via: gulfStream })).toEqual(pointToPoint(gulfStream));

    // Sea and river routes through the same places keep following the paths.
    const sea = routePoints({ kind: 'sea', via: gulfStream });
    for (const [lat, lng] of getPlace('florida-strait')!.path!)
      expect(sea).toContainEqual([lat, lng]);
    const river = routePoints({ kind: 'river', via: ['lena-river', 'sea-of-okhotsk'] });
    for (const [lat, lng] of getPlace('lena-river')!.path!)
      expect(river).toContainEqual([lat, lng]);
  });

  it('tell drafters which water bodies are rivers, passages and lakes', () => {
    const listing = sharedListing();
    expect(listing).toContain(
      'rhine-river | Rhine River | river (a sea or river route follows its course',
    );
    expect(listing).toContain('blue-nile-river | Blue Nile River | river (');
    expect(listing).toContain('suez-canal | Suez Canal | passage (');
    expect(listing).toContain('strait-of-dover | Strait of Dover | passage (');
    expect(listing).toContain('lake-albert | Lake Albert | lake |');
  });

  it('know the Saint Lawrence River by one ID', () => {
    expect(getPlace('saint-lawrence-river')?.path?.length).toBeGreaterThanOrEqual(2);
    expect(getPlace('st-lawrence-river')).toBeUndefined();
    expect(listPlaces().filter((place) => /lawrence river/i.test(place.name))).toHaveLength(1);
  });

  it('stay at sea along the routes content has used', () => {
    for (const route of seaRoutes) {
      expect(findRouteLandCrossings(route, landIndex()), route.id).toEqual([]);
    }
  });
});
