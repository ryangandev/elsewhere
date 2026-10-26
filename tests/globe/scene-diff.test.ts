import { describe, expect, it } from 'vitest';
import { EMPTY_SCENE, type MapScene, type ScenePlace } from '../../src/globe/scene';
import { diffKeyed, diffScene, samePlace } from '../../src/globe/scene-diff';

const place = (id: string, overrides: Partial<ScenePlace> = {}): ScenePlace => ({
  id,
  name: id,
  lat: 1,
  lng: 2,
  kind: 'place',
  ...overrides,
});

const shipping: MapScene = {
  camera: { lat: 1.3, lng: 103.8, altitude: 0.4 },
  focusCountryId: 'SGP',
  highlights: [
    { countryId: 'MYS', role: 'related' },
    { countryId: 'IDN', role: 'related' },
  ],
  places: [place('malacca', { kind: 'water' }), place('johor')],
  routes: [
    {
      id: 'strait',
      kind: 'sea',
      points: [
        [8, 89],
        [1.2, 103.5],
      ],
    },
  ],
};

// A structurally equal copy, as React would produce from content on every render.
const copy = (scene: MapScene): MapScene => JSON.parse(JSON.stringify(scene));

describe('keyed diff', () => {
  it('separates added, updated, unchanged, and removed items by id', () => {
    const previous = new Map([
      ['a', place('a')],
      ['b', place('b')],
      ['c', place('c')],
    ]);
    const diff = diffKeyed(
      previous,
      [place('a'), place('b', { name: 'Bee' }), place('d')],
      samePlace,
    );
    expect(diff.unchanged.map((item) => item.id)).toEqual(['a']);
    expect(diff.updated.map((item) => item.id)).toEqual(['b']);
    expect(diff.added.map((item) => item.id)).toEqual(['d']);
    expect(diff.removed).toEqual(['c']);
    expect([...diff.next.keys()]).toEqual(['a', 'b', 'd']);
  });

  it('keeps the first of duplicate ids', () => {
    const diff = diffKeyed(
      new Map(),
      [place('a', { name: 'First' }), place('a', { name: 'Second' })],
      samePlace,
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.next.get('a')?.name).toBe('First');
  });
});

describe('scene diff', () => {
  it('reports no change for a structurally equal scene', () => {
    expect(diffScene(shipping, copy(shipping)).any).toBe(false);
    expect(diffScene(EMPTY_SCENE, { highlights: [], places: [], routes: [] }).any).toBe(false);
  });

  it('isolates each changed layer', () => {
    const highlights = {
      ...copy(shipping),
      highlights: [{ countryId: 'MYS', role: 'contrast' as const }],
    };
    expect(diffScene(shipping, highlights)).toMatchObject({
      any: true,
      highlights: true,
      places: false,
      routes: false,
      camera: false,
    });

    const renamed = copy(shipping);
    renamed.places[1].name = 'Johor Strait';
    expect(diffScene(shipping, renamed)).toMatchObject({
      places: true,
      highlights: false,
      routes: false,
    });

    const rerouted = copy(shipping);
    rerouted.routes[0].points[1] = [1.2, 104];
    expect(diffScene(shipping, rerouted)).toMatchObject({ routes: true, places: false });

    const focused = { ...copy(shipping), focusPlaceId: 'malacca' };
    expect(diffScene(shipping, focused)).toMatchObject({
      focusPlace: true,
      places: false,
      camera: false,
    });

    const moved = { ...copy(shipping), camera: { lat: 1.3, lng: 103.8, altitude: 0.5 } };
    expect(diffScene(shipping, moved)).toMatchObject({ camera: true, focusCountry: false });

    expect(diffScene(shipping, EMPTY_SCENE)).toMatchObject({
      camera: true,
      focusCountry: true,
      highlights: true,
      places: true,
      routes: true,
    });
  });

  it('treats a reordered place list as a change', () => {
    const reordered = { ...copy(shipping), places: [...copy(shipping).places].reverse() };
    expect(diffScene(shipping, reordered).places).toBe(true);
  });
});
