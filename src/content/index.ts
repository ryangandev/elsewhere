// Content loaders for the English edition, for server components at build time.
// Server-only: importing this from a client component fails the build, because content, the
// gazetteer and zod must never enter the browser bundle. The browser reads view models and the
// generated indexes instead (docs/architecture.md#server-and-client-boundary).
// Content files are discovered in content/en at load time (src/content/files.ts).
// Production builds return reviewed content only; development also shows drafts, and reloads
// content when a file is added or edited.
import 'server-only';
import { contentTreeRevision, localeContentDir, readContentTree } from './files';
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
export type { ContentFile, ContentTree } from './files';

const contentDir = localeContentDir('en');

/** In development, the content tree's fingerprint, checked at most twice a second. */
function developmentRevision(): () => string {
  let checkedAt = 0;
  let revision = '';
  return () => {
    const now = Date.now();
    if (now - checkedAt > 500) {
      revision = contentTreeRevision(contentDir);
      checkedAt = now;
    }
    return revision;
  };
}

const store = createContentStore(() => readContentTree(contentDir), {
  includeDrafts: process.env.NODE_ENV !== 'production',
  ...(process.env.NODE_ENV === 'development' ? { revision: developmentRevision() } : {}),
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
