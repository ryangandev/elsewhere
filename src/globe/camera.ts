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

// The overview a scene returns to on reset: explicit camera, then focus country, then home.
export function sceneView(
  scene: MapScene,
  countries: ReadonlyMap<string, CountryAnchor>,
  home: CameraView = HOME_VIEW,
): CameraView {
  if (scene.camera) return scene.camera;
  const country = scene.focusCountryId ? countries.get(scene.focusCountryId) : undefined;
  return country ? countryView(country) : home;
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
): CameraView {
  const overview = sceneView(scene, countries, home);
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
