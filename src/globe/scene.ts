// The declarative contract between content and the globe.
// Content describes what to show; the controller decides how to animate and render it.

export type CameraView = { lat: number; lng: number; altitude: number };

// A direction point is a label point the scene names as a direction rather than a place to show:
// an ocean, sea or gulf ("ships arrive from the Atlantic") or a country other than the focus
// country ("trade with China"). Its label point is an arbitrary spot in a large area, so the
// camera reaches only a bounded way toward it rather than framing it in full.
export type ScenePlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'water' | 'region' | 'place' | 'country';
  direction?: true;
  note?: string;
};

// Route points are [lat, lng], as drawn. `stops` are indices into `points` of the points the route
// is drawn through before the great-circle steps between them: its stops, and the path points of
// the passages and rivers it follows. The camera frames these. `directions` are the stops among
// them that are only a direction, as for a place.
export type SceneRoute = {
  id: string;
  kind: 'sea' | 'land' | 'river' | 'flow';
  points: [number, number][];
  stops: number[];
  directions?: number[];
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
