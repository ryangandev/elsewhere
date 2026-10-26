// Typed, synchronous access to one locale's content.
// Draft content is visible only when includeDrafts is set; references to hidden content
// (starter questions, next questions, trail stops) are removed so nothing links to a draft.
import type { z } from 'zod';
import type { ContentFile, ContentTree } from './files';
import { getPlace, routePoints } from './geo';
import type { MapScene } from './map-scene';
import {
  CountryFile,
  HomeFile,
  PlaceNotesFile,
  TrailsFile,
  type Country,
  type Home,
  type PlaceNotes,
  type SceneSpec,
  type Story,
  type StoryRef,
  type Trail,
} from './schema';

/** Raw (unparsed) content files of one locale, as read by readContentTree. */
export type ContentSources = ContentTree;

export type ContentStore = {
  /** An edited country by ID ("SGP", any case) or slug ("singapore"). */
  getCountry(idOrSlug: string): Country | undefined;
  /** Edited countries, by name. */
  listCountries(): Country[];
  getStory(countryId: string, storyId: string): Story | undefined;
  getStoryBySlug(countrySlug: string, storySlug: string): Story | undefined;
  /** Stories of one country in editorial order, or of all countries by country name. */
  listStories(countryId?: string): Story[];
  listTrails(): Trail[];
  /** The home screen's suggested questions, without any that are hidden. */
  getHome(): Home;
  getPlaceNote(placeId: string): string | undefined;
  /** The globe-level scene for a content scene: coordinates from the gazetteer, notes from content. */
  resolveScene(spec: SceneSpec): MapScene;
};

export type ContentStoreOptions = {
  includeDrafts: boolean;
  /**
   * A fingerprint of the sources. When given, it is checked on every read and the content is
   * loaded again when it changes; the development server uses this to pick up edited files.
   */
  revision?: () => string;
};

type Indexed = {
  countries: Country[];
  countriesById: Map<string, Country>;
  countriesBySlug: Map<string, Country>;
  stories: Map<string, Story[]>;
  trails: Trail[];
  home: Home;
  placeNotes: PlaceNotes;
};

const storyKey = (countryId: string, storyId: string) => `${countryId}/${storyId}`;

/** Parse one content file, naming the file when it does not match the schema. */
function parseFile<T>(schema: z.ZodType<T>, { file, data }: ContentFile): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Content file ${file} does not match the schema:\n${problems}`);
}

function buildIndex(sources: ContentSources, { includeDrafts }: ContentStoreOptions): Indexed {
  const files = sources.countryFiles.map((file) => parseFile(CountryFile, file));
  const visible = (status: 'draft' | 'reviewed') => includeDrafts || status === 'reviewed';

  const visibleFiles = files
    .filter((file) => visible(file.country.provenance.status))
    .map((file) => ({
      country: file.country,
      stories: file.stories.filter((story) => visible(story.provenance.status)),
    }));
  const visibleStories = new Set(
    visibleFiles.flatMap((file) =>
      file.stories.map((story) => storyKey(story.countryId, story.id)),
    ),
  );
  const isVisible = (ref: Pick<StoryRef, 'countryId' | 'storyId'>) =>
    visibleStories.has(storyKey(ref.countryId, ref.storyId));

  const countries: Country[] = [];
  const stories = new Map<string, Story[]>();
  for (const file of visibleFiles) {
    countries.push({
      ...file.country,
      starterStoryIds: file.country.starterStoryIds.filter((storyId) =>
        isVisible({ countryId: file.country.id, storyId }),
      ),
    });
    stories.set(
      file.country.id,
      file.stories.map((story) => ({ ...story, next: story.next.filter(isVisible) })),
    );
  }
  countries.sort((a, b) => a.name.localeCompare(b.name));

  const trails = parseFile(TrailsFile, sources.trails)
    .map((trail) => ({ ...trail, stops: trail.stops.filter(isVisible) }))
    .filter((trail) => trail.stops.length >= 2);

  const home = parseFile(HomeFile, sources.home);

  return {
    countries,
    countriesById: new Map(countries.map((country) => [country.id, country])),
    countriesBySlug: new Map(countries.map((country) => [country.slug, country])),
    stories,
    trails,
    home: { ...home, suggestedQuestions: home.suggestedQuestions.filter(isVisible) },
    placeNotes: parseFile(PlaceNotesFile, sources.placeNotes),
  };
}

/**
 * Typed access to one locale's content. `sources` is the content itself or a function that reads
 * it; either way it is parsed on first use, so importing the loaders costs nothing until content
 * is read.
 */
export function createContentStore(
  sources: ContentSources | (() => ContentSources),
  options: ContentStoreOptions,
): ContentStore {
  const load = typeof sources === 'function' ? sources : () => sources;
  let cached: { index: Indexed; revision: string | undefined } | undefined;
  const index = () => {
    const revision = options.revision?.();
    if (!cached || cached.revision !== revision) {
      cached = { index: buildIndex(load(), options), revision };
    }
    return cached.index;
  };

  const getCountry = (idOrSlug: string) =>
    index().countriesById.get(idOrSlug.toUpperCase()) ??
    index().countriesBySlug.get(idOrSlug.toLowerCase());

  const listStories = (countryId?: string) => {
    if (countryId) return [...(index().stories.get(countryId.toUpperCase()) ?? [])];
    return index().countries.flatMap((country) => index().stories.get(country.id) ?? []);
  };

  const getPlaceNote = (placeId: string) => index().placeNotes[placeId];

  return {
    getCountry,
    listCountries: () => [...index().countries],
    getStory: (countryId, storyId) => listStories(countryId).find((story) => story.id === storyId),
    getStoryBySlug: (countrySlug, storySlug) => {
      const country = getCountry(countrySlug);
      return country && listStories(country.id).find((story) => story.slug === storySlug);
    },
    listStories,
    listTrails: () => [...index().trails],
    getHome: () => ({ suggestedQuestions: [...index().home.suggestedQuestions] }),
    getPlaceNote,
    resolveScene: (spec) => resolveScene(spec, getPlaceNote),
  };
}

export function resolveScene(
  spec: SceneSpec,
  noteFor: (placeId: string) => string | undefined = () => undefined,
): MapScene {
  return {
    ...(spec.camera ? { camera: { ...spec.camera } } : {}),
    focusCountryId: spec.focusCountryId,
    highlights: spec.highlights.map((highlight) => ({ ...highlight })),
    places: spec.placeIds.map((id) => {
      const place = getPlace(id);
      if (!place) throw new Error(`Unknown gazetteer place "${id}"`);
      const note = noteFor(id);
      return {
        id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        kind: place.kind,
        ...(note ? { note } : {}),
      };
    }),
    routes: spec.routes.map((route) => ({
      id: route.id,
      kind: route.kind,
      points: routePoints(route),
    })),
  };
}
