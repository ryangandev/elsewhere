// Content loaders for the English edition, for server components at build time.
// Server-only: importing this from a client component fails the build, because content, the
// gazetteer and zod must never enter the browser bundle. The browser reads view models and the
// generated indexes instead (docs/architecture.md#server-and-client-boundary).
// Production builds return reviewed content only; development also shows drafts.
import 'server-only';
import { englishContent } from './registry';
import { createContentStore } from './store';

export type { CameraView, MapScene, ScenePlace, SceneRoute } from './map-scene';
export type {
  Country,
  CountryFile,
  GazetteerPlace,
  Home,
  MapCountry,
  Provenance,
  QuickFact,
  SceneRouteSpec,
  SceneSpec,
  Section,
  Source,
  Story,
  StoryRef,
  SuggestedQuestion,
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
  getHome,
  getPlaceNote,
  resolveScene,
} = store;
