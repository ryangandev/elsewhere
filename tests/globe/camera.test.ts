import { describe, expect, it } from 'vitest';
import { getMapCountry } from '../../src/content/geo';
import { resolveScene } from '../../src/content/store';
import {
  COUNTRY_FILL,
  DIRECTION_REACH,
  HOME_VIEW,
  SCENE_FILL,
  ZOOM_LIMITS,
  countryAltitude,
  countryView,
  placeView,
  sameView,
  sceneTarget,
  sceneView,
  viewOffset,
  zoomView,
} from '../../src/globe/camera';
import { EMPTY_SCENE, type MapScene, type ScenePlace } from '../../src/globe/scene';

const countries = new Map([
  ['RUS', { lat: 61.98, lng: 96.69, area: 0.4 }],
  ['FRA', { lat: 46.6, lng: 2.5, area: 0.0137 }],
  ['SGP', { lat: 1.35, lng: 103.82, area: 0.0000172 }],
]);

const scene = (overrides: Partial<MapScene>): MapScene => ({ ...EMPTY_SCENE, ...overrides });

describe('camera framing', () => {
  it('frames countries by area within readable bounds', () => {
    expect(countryAltitude(0.4)).toBe(1.3);
    expect(countryAltitude(0.0000172)).toBe(0.16);
    expect(countryAltitude(0.0137)).toBeCloseTo(Math.sqrt(0.0137) * 5);
    expect(countryAltitude(undefined)).toBe(1.3);
  });

  it('uses the explicit camera, then the focus country, then home', () => {
    const camera = { lat: 10, lng: 20, altitude: 0.5 };
    expect(sceneView(scene({ camera, focusCountryId: 'FRA' }), countries)).toEqual(camera);
    expect(sceneView(scene({ focusCountryId: 'FRA' }), countries)).toEqual({
      lat: 46.6,
      lng: 2.5,
      altitude: countryAltitude(0.0137),
    });
    expect(sceneView(EMPTY_SCENE, countries)).toEqual(HOME_VIEW);
    expect(sceneView(scene({ focusCountryId: 'XXX' }), countries)).toEqual(HOME_VIEW);
    const home = { lat: 0, lng: 0, altitude: 2 };
    expect(sceneView(EMPTY_SCENE, countries, home)).toBe(home);
  });

  it('moves closer than the story view to a focused place, with limits', () => {
    expect(placeView({ lat: 0, lng: 0, altitude: 1.95 }, { lat: 3, lng: 99 })).toEqual({
      lat: 3,
      lng: 99,
      altitude: 0.7,
    });
    expect(placeView({ lat: 0, lng: 0, altitude: 0.4 }, { lat: 3, lng: 99 }).altitude).toBeCloseTo(
      0.3,
    );
    expect(placeView({ lat: 0, lng: 0, altitude: 0.1 }, { lat: 3, lng: 99 }).altitude).toBe(0.12);
  });

  it('targets the focused place when it is one of the scene places', () => {
    const strait = {
      id: 'malacca',
      name: 'Malacca Strait',
      lat: 3,
      lng: 99,
      kind: 'water' as const,
    };
    const focused = scene({ focusCountryId: 'SGP', places: [strait], focusPlaceId: 'malacca' });
    expect(sceneTarget(focused, countries)).toEqual(
      placeView(sceneView(focused, countries), strait),
    );
    const missing = scene({ focusCountryId: 'SGP', places: [], focusPlaceId: 'malacca' });
    expect(sceneTarget(missing, countries)).toEqual(sceneView(missing, countries));
  });

  it('zooms by steps and clamps at the limits', () => {
    const view = { lat: 1, lng: 2, altitude: 1 };
    expect(zoomView(view, 'in')).toEqual({ lat: 1, lng: 2, altitude: 0.76 });
    expect(zoomView(view, 'out').altitude).toBeCloseTo(1.26);
    expect(zoomView({ ...view, altitude: 0.07 }, 'in').altitude).toBe(ZOOM_LIMITS.min);
    expect(zoomView({ ...view, altitude: 4 }, 'out').altitude).toBe(ZOOM_LIMITS.max);
  });
});

describe('scene framing', () => {
  const egypt = new Map([['EGY', getMapCountry('EGY')!]]);
  const place = (id: string, lat: number, lng: number): ScenePlace => ({
    id,
    name: id,
    lat,
    lng,
    kind: 'place',
  });
  const pointsOf = (scene: MapScene) => [
    ...scene.places,
    ...scene.routes.flatMap((route) => route.points.map(([lat, lng]) => ({ lat, lng }))),
  ];

  // Egypt's "Where does the Nile begin?" story, which runs far south of Egypt.
  const nileSource = resolveScene({
    focusCountryId: 'EGY',
    highlights: [],
    placeIds: [
      'lake-victoria',
      'ethiopian-highlands',
      'sudd',
      'khartoum',
      'white-nile-river',
      'nile-river',
    ],
    routes: [
      {
        id: 'white-nile',
        kind: 'river',
        via: [
          'lake-victoria',
          'victoria-nile-river',
          'lake-kyoga',
          'lake-albert',
          'albert-nile-river',
          'mountain-nile-river',
          'sudd',
          'white-nile-river',
          'khartoum',
          'nile-river',
          'cairo',
        ],
      },
      { id: 'blue-nile', kind: 'river', via: ['lake-tana', 'blue-nile-river', 'khartoum'] },
    ],
  });

  it('frames a scene that reaches beyond its country, from Lake Victoria to Cairo', () => {
    const country = countryView(egypt.get('EGY')!);
    const lakeVictoria = nileSource.places.find((item) => item.id === 'lake-victoria')!;
    // Framed from Egypt alone, Lake Victoria is off the bottom of the view.
    expect(viewOffset(country, lakeVictoria)).toBeGreaterThan(1);

    const view = sceneView(nileSource, egypt);
    for (const point of pointsOf(nileSource))
      expect(viewOffset(view, point)).toBeLessThanOrEqual(SCENE_FILL + 1e-6);
    // Centered between the lake and the delta, and only as far out as the route needs.
    expect(view.lat).toBeGreaterThan(10);
    expect(view.lat).toBeLessThan(20);
    expect(view.lng).toBeGreaterThan(29);
    expect(view.lng).toBeLessThan(34);
    expect(view.altitude).toBeGreaterThan(country.altitude);
    expect(view.altitude).toBeLessThan(1.3);
    // The route reaches as far as its frame allows on at least one side.
    const fill = Math.max(...pointsOf(nileSource).map((point) => viewOffset(view, point)));
    expect(fill).toBeGreaterThan(SCENE_FILL * 0.9);
  });

  it('keeps the country view for a scene inside or near its country', () => {
    const overview = resolveScene({
      focusCountryId: 'EGY',
      highlights: [],
      placeIds: ['cairo', 'alexandria', 'nile-river', 'suez-canal', 'mediterranean-sea', 'red-sea'],
      routes: [],
    });
    expect(sceneView(overview, egypt)).toEqual(countryView(egypt.get('EGY')!));
  });

  it('marks open seas and other countries as directions, and nothing else', () => {
    const scene = resolveScene({
      focusCountryId: 'NLD',
      highlights: [],
      placeIds: [
        'north-sea',
        'english-channel',
        'lake-victoria',
        'white-nile-river',
        'rotterdam',
        'belgium',
      ],
      routes: [
        {
          id: 'approach',
          kind: 'sea',
          via: ['north-atlantic-ocean', 'strait-of-dover', 'rotterdam'],
        },
        { id: 'trade', kind: 'flow', via: ['china', 'netherlands'] },
      ],
    });
    expect(scene.places.filter((item) => item.direction).map((item) => item.id)).toEqual([
      'north-sea',
      'belgium',
    ]);
    const [start, ...rest] = scene.routes[0].waypoints;
    expect(start).toMatchObject({ lat: 29.241, lng: -37.31, direction: true });
    expect(rest.length).toBeGreaterThan(2);
    expect(rest.every((point) => !point.direction)).toBe(true);
    // Another country as a route stop is a direction too; the focus country is not.
    expect(scene.routes[1].waypoints.map((point) => point.direction)).toEqual([true, undefined]);
  });

  it('reaches exactly the set distance past the rest of the scene toward a direction', () => {
    // A tiny country on the equator, a place 800 km west and an open sea 2000 km east of the
    // middle of the two: the frame reaches 500 km past the country, as for a place there.
    const tiny = new Map([['XXX', { lat: 0, lng: 0, area: 1e-10 }]]);
    const km = (distance: number) => (distance / 6371) * (180 / Math.PI);
    const west = place('west', 0, -km(800));
    const core = { lng: -km(400), radius: km(400) };
    const sea = { ...place('sea', 0, core.lng + km(2000)), direction: true as const };
    const view = sceneView({ ...EMPTY_SCENE, focusCountryId: 'XXX', places: [west, sea] }, tiny);
    const reached = place('reached', 0, core.lng + core.radius + (DIRECTION_REACH * 180) / Math.PI);
    expect(reached.lng).toBeCloseTo(km(500));
    const same = sceneView(
      { ...EMPTY_SCENE, focusCountryId: 'XXX', places: [west, reached] },
      tiny,
    );
    // Within the enclosing cap's approximation, about a kilometre here.
    expect(view.lat).toBeCloseTo(same.lat, 1);
    expect(view.lng).toBeCloseTo(same.lng, 1);
    expect(view.altitude).toBeCloseTo(same.altitude, 2);
    // Both ends sit on the edge of the frame, so the cap is 650 km across each way.
    expect(view.lng).toBeCloseTo(-km(150), 1);
    expect(viewOffset(view, west)).toBeCloseTo(SCENE_FILL, 2);
    expect(viewOffset(view, reached)).toBeCloseTo(SCENE_FILL, 2);
    expect(viewOffset(view, sea)).toBeGreaterThan(1);
  });

  it('keeps Japan in view when its overview names China', () => {
    const japan = new Map([['JPN', getMapCountry('JPN')!]]);
    const overview = resolveScene({
      focusCountryId: 'JPN',
      highlights: [],
      placeIds: ['republic-of-korea', 'china', 'philippine-sea', 'sea-of-japan'],
      routes: [],
    });
    const country = countryView(japan.get('JPN')!);
    const view = sceneView(overview, japan);
    expect(view.altitude).toBeLessThan(country.altitude * 1.5);
    // Japan stays near the middle; China's far-off label point is not framed.
    expect(viewOffset(view, country)).toBeLessThan(0.3);
    const china = overview.places.find((item) => item.id === 'china')!;
    expect(viewOffset(view, china)).toBeGreaterThan(1);
  });

  it('reaches only a bounded way toward an open sea, as a place or a route stop', () => {
    const countries = new Map([['USA', getMapCountry('USA')!]]);
    const overview = (placeIds: string[]) =>
      sceneView(
        resolveScene({ focusCountryId: 'USA', highlights: [], placeIds, routes: [] }),
        countries,
      );
    const country = countryView(countries.get('USA')!);
    const withOceans = overview([
      'canada',
      'mexico',
      'north-atlantic-ocean',
      'north-pacific-ocean',
    ]);
    // Naming two oceans moves the view out a little, nowhere near the whole globe.
    expect(withOceans.altitude).toBeLessThan(country.altitude * 1.3);
    expect(withOceans.altitude).toBeLessThan(HOME_VIEW.altitude);
    // The same points framed in full would need the whole globe.
    const full = resolveScene({
      focusCountryId: 'USA',
      highlights: [],
      placeIds: ['canada', 'mexico', 'north-atlantic-ocean', 'north-pacific-ocean'],
      routes: [],
    });
    full.places = full.places.map((item) => ({ ...item, direction: undefined }));
    expect(sceneView(full, countries).altitude).toBe(HOME_VIEW.altitude);

    // As a route stop, the open sea is a direction: the route leaves the frame toward it.
    const egyptRoute = resolveScene({
      focusCountryId: 'EGY',
      highlights: [],
      placeIds: [],
      routes: [{ id: 'tea', kind: 'sea', via: ['indian-ocean', 'red-sea', 'suez-canal'] }],
    });
    const view = sceneView(egyptRoute, egypt);
    expect(view.altitude).toBeLessThan(1.3);
    const ocean = egyptRoute.routes[0].waypoints[0];
    expect(viewOffset(view, ocean)).toBeGreaterThan(1);
  });

  it('frames Rotterdam from the Channel to the Rhine, not from the mid-Atlantic', () => {
    const netherlands = new Map([['NLD', getMapCountry('NLD')!]]);
    const rotterdam = resolveScene({
      focusCountryId: 'NLD',
      highlights: [],
      placeIds: ['rotterdam', 'rhine-river', 'north-sea', 'english-channel'],
      routes: [
        {
          id: 'ship-approach',
          kind: 'sea',
          via: ['north-atlantic-ocean', 'english-channel', 'strait-of-dover', 'rotterdam'],
        },
        { id: 'rhine-hinterland', kind: 'river', via: ['rotterdam', 'rhine-river'] },
        { id: 'meuse-hinterland', kind: 'river', via: ['rotterdam', 'meuse-river'] },
      ],
    });
    const view = sceneView(rotterdam, netherlands);
    // The Channel, the Strait of Dover, Rotterdam and the Rhine and Meuse count in full.
    const full = [
      ...rotterdam.places.filter((item) => !item.direction),
      ...rotterdam.routes.flatMap((route) => route.waypoints.filter((point) => !point.direction)),
    ];
    for (const point of full)
      expect(viewOffset(view, point)).toBeLessThanOrEqual(SCENE_FILL + 1e-6);
    // The North Sea stays in view; the mid-Atlantic start of the ship route does not.
    const northSea = rotterdam.places.find((item) => item.id === 'north-sea')!;
    expect(viewOffset(view, northSea)).toBeLessThan(1);
    expect(viewOffset(view, { lat: 29.241, lng: -37.31 })).toBeGreaterThan(1);
    expect(view.lat).toBeGreaterThan(46);
    expect(view.lat).toBeLessThan(55);
    expect(view.lng).toBeGreaterThan(-6);
    expect(view.lng).toBeLessThan(10);
    expect(view.altitude).toBeLessThan(0.8);
  });

  it('still prefers an explicit camera, a focused place and home', () => {
    const camera = { lat: 26, lng: 30, altitude: 0.8 };
    expect(sceneView({ ...nileSource, camera }, egypt)).toEqual(camera);
    const focused = { ...nileSource, focusPlaceId: 'lake-victoria' };
    expect(sceneTarget(focused, egypt)).toEqual(
      placeView(sceneView(nileSource, egypt), nileSource.places[0]),
    );
    expect(sceneView({ ...nileSource, focusCountryId: undefined }, egypt)).toEqual(HOME_VIEW);
  });

  it('frames against the narrower side of a portrait globe area', () => {
    // A phone with the reading panel collapsed: the globe area is about 421 by 700.
    const aspect = 421 / 700;
    const fiji = new Map([['FJI', { lat: -17.8, lng: 178, area: 0.0006 }]]);
    const islands: MapScene = {
      ...EMPTY_SCENE,
      focusCountryId: 'FJI',
      places: [place('samoa', -13.8, -172), place('tonga', -21.2, -175.2)],
    };
    const wide = sceneView(islands, fiji);
    const tall = sceneView(islands, fiji, HOME_VIEW, aspect);
    expect(tall.altitude).toBeGreaterThan(wide.altitude * 1.3);
    expect(Math.max(...islands.places.map((item) => viewOffset(tall, item, aspect)))).toBeCloseTo(
      SCENE_FILL,
      2,
    );
    // The Nile from Lake Victoria to Cairo needs home's altitude on a phone, centered as before.
    const landscape = sceneView(nileSource, egypt);
    const portrait = sceneView(nileSource, egypt, HOME_VIEW, aspect);
    expect(portrait).toEqual({ ...landscape, altitude: HOME_VIEW.altitude });
    // A wide globe area frames as a square one: height is its narrower side.
    expect(sceneView(nileSource, egypt, HOME_VIEW, 1.6)).toEqual(landscape);
    expect(sceneView(islands, fiji, HOME_VIEW, 1.6)).toEqual(wide);
    // The country view is kept only while its places fit the narrower side too.
    const overview = resolveScene({
      focusCountryId: 'EGY',
      highlights: [],
      placeIds: ['cairo', 'alexandria', 'nile-river', 'suez-canal', 'mediterranean-sea', 'red-sea'],
      routes: [],
    });
    const kept = countryView(egypt.get('EGY')!);
    const narrow = sceneView(overview, egypt, HOME_VIEW, aspect);
    for (const item of overview.places)
      expect(viewOffset(narrow, item, aspect)).toBeLessThanOrEqual(
        sameView(narrow, kept) ? COUNTRY_FILL : SCENE_FILL + 1e-6,
      );
  });

  it('frames across the antimeridian', () => {
    const fiji = new Map([['FJI', { lat: -17.8, lng: 178, area: 0.0006 }]]);
    const scene: MapScene = {
      ...EMPTY_SCENE,
      focusCountryId: 'FJI',
      places: [place('samoa', -13.8, -172), place('tonga', -21.2, -175.2)],
    };
    const view = sceneView(scene, fiji);
    expect(Math.abs(view.lng)).toBeGreaterThan(175);
    expect(view.altitude).toBeLessThan(0.6);
    for (const point of scene.places)
      expect(viewOffset(view, point)).toBeLessThanOrEqual(SCENE_FILL + 1e-6);
  });

  it('frames a scene that spans the world no farther out than home', () => {
    const scene: MapScene = {
      ...EMPTY_SCENE,
      focusCountryId: 'EGY',
      places: [place('jakarta', -6.2, 106.8), place('lima', -12, -77)],
    };
    // Short of a hemisphere, a cap that needs more than home is framed at home's altitude.
    const view = sceneView(scene, egypt);
    expect(view.altitude).toBe(HOME_VIEW.altitude);
    expect(view).not.toEqual(HOME_VIEW);
    const home = { lat: 0, lng: 0, altitude: 2.5 };
    expect(sceneView(scene, egypt, home).altitude).toBe(2.5);
    // Points all around the globe need a cap wider than a hemisphere, which no view shows, so
    // the scene uses the home view itself.
    const around: MapScene = {
      ...scene,
      places: [
        place('a', 0, 0),
        place('b', 0, 90),
        place('c', 0, 180),
        place('d', 0, -90),
        place('north', 90, 0),
        place('south', -90, 0),
      ],
    };
    expect(sceneView(around, egypt)).toEqual(HOME_VIEW);
  });
});
