import { getCountry, getMapCountry } from './catalog';
import { getTopic, type Destination } from './destination';

export type PageSummary = { title: string; description: string };

/** The title and description of the page for a destination, used for metadata and link previews. */
export function describeDestination(destination: Destination): PageSummary | null {
  const country = getMapCountry(destination.countryId);
  if (!country) return null;

  const topic = getTopic(destination);
  if (topic) return { title: topic.title, description: topic.intro };

  const profile = getCountry(destination.countryId);
  if (profile) return { title: profile.name, description: profile.summary };

  return {
    title: country.name,
    description: `${country.name} in ${country.region}: sourced geographic basics and its place on the map.`,
  };
}
