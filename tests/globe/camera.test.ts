import { describe, expect, it } from 'vitest';
import {
  HOME_VIEW,
  ZOOM_LIMITS,
  countryAltitude,
  placeView,
  sceneTarget,
  sceneView,
  zoomView,
} from '../../src/globe/camera';
import { EMPTY_SCENE, type MapScene } from '../../src/globe/scene';

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
