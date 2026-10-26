import type { Country, Topic } from '@/content/legacy/data';
import { directory, getCountry, topicIds } from './catalog';
import { trails } from './trails';

/**
 * Where the reader is: a country, optionally one of its questions, optionally as a stop on a trail.
 * Country and topic IDs are permanent identifiers, never array positions or titles.
 */
export type Destination = { countryId: string; topicId?: string; trailId?: string };

/** Identifies the content shown, ignoring which trail it was reached from. */
export function destinationKey(destination: Destination): string {
  return `${destination.countryId}:${destination.topicId ?? ''}`;
}

export function getTopic(destination: Destination | null): Topic | undefined {
  if (!destination?.topicId) return undefined;
  return getCountry(destination.countryId)?.topics.find(
    (topic) => topic.id === destination.topicId,
  );
}

export function topicDestination(country: Country, index: number): Destination {
  return { countryId: country.id, topicId: country.topics[index].id };
}

/**
 * Turns untrusted input (stored libraries, URLs) into a valid destination.
 * Unknown countries are rejected. An unknown topic or a trail that does not include this
 * destination is dropped, so the result always points at something that exists.
 */
export function validDestination(value: unknown): Destination | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.countryId !== 'string') return null;
  if (!directory.some((item) => item.id === candidate.countryId)) return null;

  const result: Destination = { countryId: candidate.countryId };
  if (
    typeof candidate.topicId === 'string' &&
    topicIds[result.countryId]?.includes(candidate.topicId)
  ) {
    result.topicId = candidate.topicId;
  }
  if (typeof candidate.trailId === 'string') {
    const key = destinationKey(result);
    const onTrail = trails.some(
      (trail) =>
        trail.id === candidate.trailId && trail.stops.some((stop) => destinationKey(stop) === key),
    );
    if (onTrail) result.trailId = candidate.trailId;
  }
  return result;
}
