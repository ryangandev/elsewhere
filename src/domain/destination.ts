/**
 * Where the reader is: a country, optionally one of its questions, optionally as a stop on a trail.
 * Country and story IDs are permanent identifiers, never array positions, titles, or slugs.
 *
 * This module is shared by server and browser code, so it knows nothing about content.
 * Whether a destination still exists is decided by whoever resolves it (a page, or the atlas
 * index in the browser).
 */
export type Destination = { countryId: string; storyId?: string; trailId?: string };

const COUNTRY_ID = /^[A-Z]{3}$/;
const SLUG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Identifies the content shown, ignoring which trail it was reached from. */
export function destinationKey(destination: Destination): string {
  return `${destination.countryId}:${destination.storyId ?? ''}`;
}

/**
 * Turns untrusted input (a stored library) into a well-formed destination, or null.
 * Malformed story or trail IDs are dropped. The prototype stored questions as `topicId`;
 * those entries are read as story IDs, because the IDs did not change.
 */
export function parseDestination(value: unknown): Destination | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.countryId !== 'string' || !COUNTRY_ID.test(candidate.countryId)) {
    return null;
  }

  const result: Destination = { countryId: candidate.countryId };
  const storyId = candidate.storyId ?? candidate.topicId;
  if (typeof storyId === 'string' && SLUG_ID.test(storyId)) result.storyId = storyId;
  if (result.storyId && typeof candidate.trailId === 'string' && SLUG_ID.test(candidate.trailId)) {
    result.trailId = candidate.trailId;
  }
  return result;
}
