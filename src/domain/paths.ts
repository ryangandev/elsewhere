import { validDestination, type Destination } from './destination';
import { countryIdFromSlug, countrySlug, storySlug, topicIdFromSlug } from './slugs';

/**
 * Paths are the source of truth for where the reader is:
 *   /                      the world
 *   /<country>             a country overview
 *   /<country>/<story>     one question, optionally `?trail=<trail id>`
 */

export function destinationPath(destination: Destination | null): string {
  if (!destination) return '/';
  let path = `/${countrySlug(destination.countryId)}`;
  if (destination.topicId) path += `/${storySlug(destination.topicId)}`;
  if (destination.trailId) path += `?${new URLSearchParams({ trail: destination.trailId })}`;
  return path;
}

/** Reads a destination from a pathname and optional trail. Returns null for `/` and unknown paths. */
export function destinationFromPath(pathname: string, trailId?: string | null): Destination | null {
  const [countrySegment, storySegment, ...rest] = pathname.split('/').filter(Boolean);
  if (!countrySegment || rest.length > 0) return null;
  const destination = validDestination({
    countryId: countryIdFromSlug(countrySegment),
    topicId: storySegment ? topicIdFromSlug(storySegment) : undefined,
    trailId,
  });
  // A story segment that does not exist is not a valid address, so it must not fall back to the country.
  if (storySegment && !destination?.topicId) return null;
  return destination;
}

/**
 * Translates the prototype's query-string URLs (`/?country=sgp&topic=shipping&trail=...`)
 * to path URLs. Returns null when the query does not describe a destination.
 */
export function legacyQueryToPath(search: string): string | null {
  const params = new URLSearchParams(search);
  const country = params.get('country');
  if (!country) return null;
  const destination = validDestination({
    countryId: countryIdFromSlug(country),
    topicId: params.get('topic') ?? undefined,
    trailId: params.get('trail') ?? undefined,
  });
  return destination ? destinationPath(destination) : null;
}
