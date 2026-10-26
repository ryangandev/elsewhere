// Content loaders for the English edition. Synchronous and free of Node APIs, so they work in
// Next.js server components at build time and in the browser bundle.
// Production builds return reviewed content only; development also shows drafts.
import { englishContent } from './registry';
import { createContentStore } from './store';

export type { CameraView, MapScene, ScenePlace, SceneRoute } from './map-scene';
export type {
  Country,
  CountryFile,
  GazetteerPlace,
  MapCountry,
  Provenance,
  QuickFact,
  SceneRouteSpec,
  SceneSpec,
  Section,
  Source,
  Story,
  StoryRef,
  Trail,
} from './schema';
export { getMapCountry, getPlace, listMapCountries, routePoints } from './geo';
export { createContentStore, type ContentSources, type ContentStore } from './store';

const store = createContentStore(englishContent, {
  includeDrafts: process.env.NODE_ENV !== 'production',
});

export const {
  getCountry,
  listCountries,
  getStory,
  getStoryBySlug,
  listStories,
  listTrails,
  getPlaceNote,
  resolveScene,
} = store;
