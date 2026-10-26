import { describe, expect, it } from 'vitest';
import {
  distanceKm,
  findRouteLandCrossings,
  getMapCountry,
  getPlace,
  listMapCountries,
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

  it('only check sea routes', () => {
    const via = ['andaman-sea', 'singapore-strait'];
    expect(findRouteLandCrossings({ kind: 'flow', via }, landIndex())).toEqual([]);
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
