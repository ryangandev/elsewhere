/**
 * The only place that maps between permanent content IDs and URL slugs.
 * Pages, static params, redirects and the generated client indexes all go through these
 * functions, so a slug scheme changes here and nowhere else. The browser never maps slugs
 * itself: it receives finished paths in view models and indexes.
 *
 * Country slugs come from the map identities in data/geo/countries.json (an edited country's
 * content slug must equal its map slug). Story slugs come from content.
 */
import 'server-only';
import { getMapCountry, getStory, getStoryBySlug, listMapCountries } from '@/content';

export function countrySlug(countryId: string): string {
  const country = getMapCountry(countryId);
  if (!country) throw new Error(`Unknown map country "${countryId}"`);
  return country.slug;
}

export function storySlug(countryId: string, storyId: string): string {
  const story = getStory(countryId, storyId);
  if (!story) throw new Error(`Unknown story "${countryId}/${storyId}"`);
  return story.slug;
}

/** The map identity a country path segment names, by its readable slug. */
export function countryFromSegment(segment: string): string | undefined {
  return listMapCountries().find((country) => country.slug === segment)?.id;
}

/** The question a story path segment names within a country, by its readable slug. */
export function storyFromSegment(countryId: string, segment: string): string | undefined {
  return getStoryBySlug(countrySlug(countryId), segment)?.id;
}
