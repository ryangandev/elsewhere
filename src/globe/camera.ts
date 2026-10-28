import type { CameraView, MapScene } from './scene';

// Pure camera framing. Altitude is in globe radii above the surface, as in globe.gl.

export const HOME_VIEW: CameraView = { lat: 23, lng: 83, altitude: 1.95 };

export const ZOOM_LIMITS = { min: 0.06, max: 4.5 } as const;

type CountryAnchor = { lat: number; lng: number; area: number };

// Area is in steradians, as produced by d3-geo's geoArea for the country index.
// Unknown area frames as a large country rather than diving into the surface.
export function countryAltitude(area: number | undefined) {
  return Math.max(0.16, Math.min(1.3, Math.sqrt(area ?? 0.1) * 5));
}

export function countryView(country: CountryAnchor): CameraView {
  return { lat: country.lat, lng: country.lng, altitude: countryAltitude(country.area) };
}

// Scene framing works on unit vectors, so it needs no special case at the antimeridian.
type Vector = [number, number, number];

const RADIANS = Math.PI / 180;

function toVector({ lat, lng }: { lat: number; lng: number }): Vector {
  const phi = lat * RADIANS;
  const lambda = lng * RADIANS;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

function toLatLng([x, y, z]: Vector) {
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RADIANS, lng: Math.atan2(y, x) / RADIANS };
}

const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: Vector, b: Vector) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

// globe.gl's camera has a 50 degree vertical field of view; its horizontal one follows the globe
// area's aspect ratio (width over height). The globe area already sits beside the reading panel,
// so framing only has to keep the scene clear of the view's edges and the map note at the bottom.
// A country's own view is kept while every point lies within COUNTRY_FILL of the view's
// half-extent, as today's country overviews do; a scene that reaches farther is framed to
// SCENE_FILL, which leaves its outermost places room for their labels.
const HALF_FOV = 25 * RADIANS;
export const COUNTRY_FILL = 0.6;
export const SCENE_FILL = 0.5;

// The tangent of the view's half-extent on its narrower side: its half-height in a landscape
// globe area, its half-width in a portrait one, as on a phone.
const halfExtent = (aspect: number) => Math.tan(HALF_FOV) * Math.min(1, aspect);

// How far from the middle of a view a point appears, as a share of the view's half-height or
// half-width, whichever is smaller. A point beyond the horizon never fits.
export function viewOffset(view: CameraView, point: { lat: number; lng: number }, aspect = 1) {
  const radians = angle(toVector(view), toVector(point));
  const distance = 1 + view.altitude;
  if (Math.cos(radians) <= 1 / distance) return Infinity;
  return Math.sin(radians) / (distance - Math.cos(radians)) / halfExtent(aspect);
}

// The altitude at which a cap of this radius fills SCENE_FILL of the view.
function capAltitude(radius: number, aspect: number) {
  return Math.cos(radius) + Math.sin(radius) / (SCENE_FILL * halfExtent(aspect)) - 1;
}

// The scene's places and route waypoints, split into the points framed in full and the points
// a scene names only as a direction. Waypoints are enough: a great-circle step between two points
// of a cap smaller than a hemisphere stays inside it.
function scenePoints(scene: MapScene) {
  const points = [...scene.places, ...scene.routes.flatMap((route) => route.waypoints)];
  return {
    full: points.filter((point) => !point.direction).map(toVector),
    directions: points.filter((point) => point.direction).map(toVector),
  };
}

// The camera reaches at most this far past the rest of the scene toward a direction point:
// 500 km, in radians of the globe. That shows the near coast of a sea or a neighbour's border
// region beside the scene without turning the view toward the far-off label point.
export const DIRECTION_REACH = 500 / 6371;

// The point at most `limit` radians from `center`, on the great circle toward `point`.
function pullToward(center: Vector, point: Vector, limit: number): Vector {
  if (angle(center, point) <= limit) return point;
  const along = point.map((value, axis) => value - center[axis] * dot(center, point));
  const length = Math.hypot(...along);
  // A point opposite the center gives no direction to pull along.
  if (length < 1e-9) return center;
  return center.map(
    (value, axis) => value * Math.cos(limit) + (along[axis] / length) * Math.sin(limit),
  ) as Vector;
}

// A small cap holding every point and the focus country, taken as a disc of its area.
// Badoiu and Clarkson's method, on the sphere: step toward whatever lies farthest, by a shrinking
// share. It starts at the country, so a densely sampled route does not pull the start its way.
function enclosingCap(points: readonly Vector[], country: CountryAnchor) {
  const anchor = toVector(country);
  const countryRadius = Math.sqrt(country.area / Math.PI);
  const reach = (center: Vector) => {
    let farthest = anchor;
    let radius = angle(center, anchor) + countryRadius;
    for (const point of points) {
      const distance = angle(center, point);
      if (distance > radius) [farthest, radius] = [point, distance];
    }
    return { farthest, radius };
  };
  let center = anchor;
  for (let step = 1; step <= 400; step++) {
    const { farthest } = reach(center);
    const t = 1 / (step + 1);
    const next: Vector = [
      center[0] + (farthest[0] - center[0]) * t,
      center[1] + (farthest[1] - center[1]) * t,
      center[2] + (farthest[2] - center[2]) * t,
    ];
    // Only a point exactly opposite the center lands on the globe's middle; skip that step.
    const length = Math.hypot(...next);
    if (length > 1e-9) center = [next[0] / length, next[1] / length, next[2] / length];
  }
  return { center, radius: reach(center).radius };
}

// The overview a scene returns to on reset: explicit camera, then a view framed from the focus
// country and everything the scene shows, then home. `aspect` is the globe area's width over its
// height.
export function sceneView(
  scene: MapScene,
  countries: ReadonlyMap<string, CountryAnchor>,
  home: CameraView = HOME_VIEW,
  aspect = 1,
): CameraView {
  if (scene.camera) return scene.camera;
  const country = scene.focusCountryId ? countries.get(scene.focusCountryId) : undefined;
  if (!country) return home;
  const view = countryView(country);
  const { full, directions } = scenePoints(scene);
  // Direction points are pulled toward the cap of everything else, to reach at most a fixed
  // distance past it.
  const core = enclosingCap(full, country);
  const points = [
    ...full,
    ...directions.map((point) => pullToward(core.center, point, core.radius + DIRECTION_REACH)),
  ];
  // A scene inside or near its country keeps the country's view, so overviews hold still.
  if (points.every((point) => viewOffset(view, toLatLng(point), aspect) <= COUNTRY_FILL)) {
    return view;
  }
  // Otherwise the view frames the whole scene, never closer than the country's view and never
  // farther out than home. No view shows a scene wider than a hemisphere, so that is home.
  const cap = enclosingCap(points, country);
  if (cap.radius >= Math.PI / 2) return home;
  const altitude = Math.max(view.altitude, capAltitude(cap.radius, aspect));
  return { ...toLatLng(cap.center), altitude: Math.min(home.altitude, altitude) };
}

// A focused place moves closer than its story view, including already-close island views.
export function placeView(overview: CameraView, place: { lat: number; lng: number }): CameraView {
  return {
    lat: place.lat,
    lng: place.lng,
    altitude: Math.max(0.12, Math.min(overview.altitude * 0.75, 0.7)),
  };
}

// Where the camera should be for a scene: the focused place when present, else the overview.
export function sceneTarget(
  scene: MapScene,
  countries: ReadonlyMap<string, CountryAnchor>,
  home: CameraView = HOME_VIEW,
  aspect = 1,
): CameraView {
  const overview = sceneView(scene, countries, home, aspect);
  const place = scene.focusPlaceId
    ? scene.places.find((item) => item.id === scene.focusPlaceId)
    : undefined;
  return place ? placeView(overview, place) : overview;
}

export function zoomView(view: CameraView, direction: 'in' | 'out'): CameraView {
  const altitude =
    direction === 'in'
      ? Math.max(ZOOM_LIMITS.min, view.altitude * 0.76)
      : Math.min(ZOOM_LIMITS.max, view.altitude * 1.26);
  return { ...view, altitude };
}

export const sameView = (a: CameraView, b: CameraView) =>
  a.lat === b.lat && a.lng === b.lng && a.altitude === b.altitude;
