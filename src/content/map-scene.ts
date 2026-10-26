// Globe-level scene types: what the globe controller renders.
// These are owned by the globe workstream at src/globe/scene.ts and duplicated here verbatim
// until integration, when this file is replaced by a re-export from src/globe/scene.ts.

export type CameraView = { lat: number; lng: number; altitude: number };

export type ScenePlace = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'water' | 'region' | 'place' | 'country';
  note?: string;
};

export type SceneRoute = {
  id: string;
  kind: 'sea' | 'land' | 'river' | 'flow';
  points: [number, number][]; // [lat, lng]
};

export type MapScene = {
  camera?: CameraView;
  focusCountryId?: string;
  highlights: { countryId: string; role: 'related' | 'contrast' }[];
  places: ScenePlace[];
  routes: SceneRoute[];
  focusPlaceId?: string;
};
