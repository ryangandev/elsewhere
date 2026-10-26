// The declarative contract between content and the globe.
// Content describes what to show; the controller decides how to animate and render it.

export type CameraView = { lat: number; lng: number; altitude: number };

export type ScenePlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'water' | 'region' | 'place' | 'country';
  note?: string;
};

// Route points are [lat, lng].
export type SceneRoute = {
  id: string;
  kind: 'sea' | 'land' | 'river' | 'flow';
  points: [number, number][];
};

export type MapScene = {
  camera?: CameraView;
  focusCountryId?: string;
  highlights: { countryId: string; role: 'related' | 'contrast' }[];
  places: ScenePlace[];
  routes: SceneRoute[];
  focusPlaceId?: string;
};

// No focus, highlights, places, or routes: the world view.
export const EMPTY_SCENE: MapScene = { highlights: [], places: [], routes: [] };
