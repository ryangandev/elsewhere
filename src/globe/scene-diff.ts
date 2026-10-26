import type { MapScene, ScenePlace, SceneRoute } from './scene';

// Pure change detection, so equal scenes cost nothing and changed ones touch only their layer.

export type KeyedDiff<T> = {
  added: T[];
  updated: T[];
  unchanged: T[];
  removed: string[];
  // The next keyed state, in input order, with duplicate ids dropped after the first.
  next: Map<string, T>;
};

export function diffKeyed<T extends { id: string }>(
  previous: ReadonlyMap<string, T>,
  items: readonly T[],
  equal: (a: T, b: T) => boolean,
): KeyedDiff<T> {
  const diff: KeyedDiff<T> = {
    added: [],
    updated: [],
    unchanged: [],
    removed: [],
    next: new Map(),
  };
  for (const item of items) {
    if (diff.next.has(item.id)) continue;
    diff.next.set(item.id, item);
    const before = previous.get(item.id);
    if (!before) diff.added.push(item);
    else if (equal(before, item)) diff.unchanged.push(item);
    else diff.updated.push(item);
  }
  for (const id of previous.keys()) if (!diff.next.has(id)) diff.removed.push(id);
  return diff;
}

export const samePlace = (a: ScenePlace, b: ScenePlace) =>
  a.name === b.name && a.lat === b.lat && a.lng === b.lng && a.kind === b.kind && a.note === b.note;

export const sameRoute = (a: SceneRoute, b: SceneRoute) =>
  a.kind === b.kind &&
  a.points.length === b.points.length &&
  a.points.every(([lat, lng], index) => lat === b.points[index][0] && lng === b.points[index][1]);

const sameList = <T extends { id: string }>(
  a: readonly T[],
  b: readonly T[],
  equal: (x: T, y: T) => boolean,
) =>
  a.length === b.length &&
  a.every((item, index) => item.id === b[index].id && equal(item, b[index]));

const sameHighlights = (a: MapScene['highlights'], b: MapScene['highlights']) =>
  a.length === b.length &&
  a.every((item, index) => item.countryId === b[index].countryId && item.role === b[index].role);

export type SceneChanges = {
  camera: boolean;
  focusCountry: boolean;
  focusPlace: boolean;
  highlights: boolean;
  places: boolean;
  routes: boolean;
  any: boolean;
};

export function diffScene(previous: MapScene, next: MapScene): SceneChanges {
  const a = previous.camera;
  const b = next.camera;
  const changes = {
    camera:
      a !== b && (!a || !b || a.lat !== b.lat || a.lng !== b.lng || a.altitude !== b.altitude),
    focusCountry: previous.focusCountryId !== next.focusCountryId,
    focusPlace: previous.focusPlaceId !== next.focusPlaceId,
    highlights: !sameHighlights(previous.highlights, next.highlights),
    places: !sameList(previous.places, next.places, samePlace),
    routes: !sameList(previous.routes, next.routes, sameRoute),
  };
  return { ...changes, any: Object.values(changes).some(Boolean) };
}
