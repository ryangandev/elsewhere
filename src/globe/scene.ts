// The declarative contract between content and the globe.
// Content describes what to show; the controller decides how to animate and render it.

export type CameraView = { lat: number; lng: number; altitude: number };

// An open-sea point is the label point of an ocean, sea or gulf: an arbitrary spot in a large
// area, which a scene names as a direction ("ships arrive from the Atlantic"). The camera reaches
// only a bounded way toward it rather than framing it in full.
export type ScenePlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'water' | 'region' | 'place' | 'country';
  openSea?: true;
  note?: string;
};

// Route points are [lat, lng], as drawn. Waypoints are the route's stops and the path points of
// the passages and rivers it follows, before the great-circle steps between them; the camera
// frames these.
export type SceneRoute = {
  id: string;
  kind: 'sea' | 'land' | 'river' | 'flow';
  points: [number, number][];
  waypoints: { lat: number; lng: number; openSea?: true }[];
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
