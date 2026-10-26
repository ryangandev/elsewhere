import { describe, expect, it } from 'vitest';
import { planLabels, planPlaceLabels } from '../../src/globe/label-layer';
import type { ScenePlace } from '../../src/globe/scene';

const countries = [
  { id: 'SGP', name: 'Singapore' },
  { id: 'MYS', name: 'Malaysia' },
  { id: 'IDN', name: 'Indonesia' },
];

const place = (id: string, overrides: Partial<ScenePlace> = {}): ScenePlace => ({
  id,
  name: id,
  lat: 1,
  lng: 2,
  kind: 'place',
  ...overrides,
});

describe('label planning', () => {
  it('does not repeat the selected country as a place label', () => {
    const plan = planLabels(countries, {
      selectedId: 'SGP',
      places: [place('singapore', { name: 'Singapore' }), place('SGP'), place('strait')],
    });
    expect(plan.places.map((item) => item.id)).toEqual(['strait']);
  });

  it('lets a place with a country identity replace that country name', () => {
    const plan = planLabels(countries, {
      selectedId: 'SGP',
      places: [place('malaysia', { name: 'malaysia ', kind: 'country' }), place('IDN')],
    });
    expect([...plan.suppressedIds].sort()).toEqual(['IDN', 'MYS']);
    expect(planLabels(countries, { places: [] }).suppressedIds.size).toBe(0);
  });
});

describe('place label diffing', () => {
  const previous = new Map([
    ['strait', place('strait')],
    ['johor', place('johor')],
    ['sea', place('sea')],
  ]);

  it('reuses elements for unchanged and renamed places', () => {
    const plan = planPlaceLabels(previous, [
      place('strait'),
      place('johor', { name: 'Johor', kind: 'region' }),
      place('sea'),
    ]);
    expect(plan.create.size).toBe(0);
    expect(plan.removed).toEqual([]);
    expect(plan.dataChanged).toBe(false);
  });

  it('creates new and moved places and drops removed ones', () => {
    const plan = planPlaceLabels(previous, [
      place('strait', { lat: 4 }),
      place('johor'),
      place('riau'),
    ]);
    expect([...plan.create].sort()).toEqual(['riau', 'strait']);
    expect(plan.removed).toEqual(['sea']);
    expect(plan.dataChanged).toBe(true);
    expect([...plan.places.keys()]).toEqual(['strait', 'johor', 'riau']);
  });
});
