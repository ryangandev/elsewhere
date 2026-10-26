// The compact indexes the browser loads instead of content. They are generated at build time
// (src/domain/client-indexes.ts) and served as static JSON:
//   /atlas/labels.json  country labels for the globe, loaded when the globe mounts
//   /atlas/index.json   countries, questions and trails for search, the library, recent
//                       history and trails, loaded on demand
// This module only describes and reads them, so it is safe in the browser.
import type { CountryLabelData } from '@/globe/controller';
import { destinationKey, type Destination } from './destination';
import type { StoryLinkView, TrailView } from './view-models';

export const LABELS_INDEX_URL = '/atlas/labels.json';
export const ATLAS_INDEX_URL = '/atlas/index.json';

/** A globe label plus the page it opens. */
export type CountryLabel = CountryLabelData & { path: string };

export type IndexCountry = {
  id: string;
  name: string;
  path: string;
  region: string;
  flag: string;
  /** True when the country has editorial content, not only map basics. */
  edited: boolean;
  nativeName?: string;
  kicker?: string;
};

export type IndexStory = {
  id: string;
  countryId: string;
  path: string;
  question: string;
  category: string;
  summary: string;
  /** Distinctive words from the answer, space-separated, for search. */
  keywords: string;
};

export type AtlasIndex = {
  countries: IndexCountry[];
  stories: IndexStory[];
  trails: TrailView[];
  /** The home screen's starting questions, offered when search has nothing better. */
  suggestions: { countryId: string; storyId: string }[];
};

/** Fast lookups over an index, built once per loaded index. */
export type AtlasLookup = {
  index: AtlasIndex;
  country(countryId: string): IndexCountry | undefined;
  story(countryId: string, storyId: string): IndexStory | undefined;
  stories(countryId: string): IndexStory[];
  trail(trailId: string): TrailView | undefined;
};

export function createAtlasLookup(index: AtlasIndex): AtlasLookup {
  const countries = new Map(index.countries.map((country) => [country.id, country]));
  const stories = new Map(
    index.stories.map((story) => [
      destinationKey({ countryId: story.countryId, storyId: story.id }),
      story,
    ]),
  );
  const trails = new Map(index.trails.map((trail) => [trail.id, trail]));
  return {
    index,
    country: (countryId) => countries.get(countryId),
    story: (countryId, storyId) => stories.get(destinationKey({ countryId, storyId })),
    stories: (countryId) => index.stories.filter((story) => story.countryId === countryId),
    trail: (trailId) => trails.get(trailId),
  };
}

/** A stop of a trail, when the destination is one. */
function trailStop(lookup: AtlasLookup, destination: Destination): StoryLinkView | undefined {
  if (!destination.trailId) return undefined;
  const key = destinationKey(destination);
  return lookup.trail(destination.trailId)?.stops.find((stop) => stop.key === key);
}

/**
 * A ready-to-render link for a stored destination, or undefined when it no longer exists
 * (a removed question, or a country that left the map). A trail the question is no longer
 * on is dropped from the link.
 */
export function linkFor(lookup: AtlasLookup, destination: Destination): StoryLinkView | undefined {
  const country = lookup.country(destination.countryId);
  if (!country) return undefined;
  if (!destination.storyId) {
    return {
      key: destinationKey(destination),
      href: country.path,
      flag: country.flag,
      countryName: country.name,
      title: country.kicker ?? country.name,
    };
  }
  const story = lookup.story(destination.countryId, destination.storyId);
  if (!story) return undefined;
  return {
    key: destinationKey(destination),
    href: trailStop(lookup, destination)?.href ?? story.path,
    flag: country.flag,
    countryName: country.name,
    category: story.category,
    title: story.question,
  };
}
