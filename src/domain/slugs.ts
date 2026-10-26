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

/**
 * Reads a country path segment. `canonical` is false for the interim ID paths (`/sgp`)
 * that redirect to the readable slug (`/singapore`).
 */
export function countryFromSegment(
  segment: string,
): { countryId: string; canonical: boolean } | undefined {
  const bySlug = listMapCountries().find((country) => country.slug === segment);
  if (bySlug) return { countryId: bySlug.id, canonical: true };
  if (isInterimCountrySegment(segment))
    return { countryId: segment.toUpperCase(), canonical: false };
  return undefined;
}

/** Reads a story path segment: its readable slug, or its ID on an interim ID path. */
export function storyFromSegment(
  countryId: string,
  segment: string,
  canonical: boolean,
): string | undefined {
  if (canonical) return getStoryBySlug(countrySlug(countryId), segment)?.id;
  return getStory(countryId, segment)?.id;
}

/** The interim path segment for a country, its lowercase ID. Only redirects use it. */
export function interimCountrySegment(countryId: string): string {
  return countryId.toLowerCase();
}

function isInterimCountrySegment(segment: string): boolean {
  const id = segment.toUpperCase();
  return /^[a-z]{3}$/.test(segment) && getMapCountry(id)?.id === id;
}
