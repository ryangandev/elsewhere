import { destinationKey, type Destination } from './destination';
import { trails } from './trails';

export type Recommendation = { countryId: string; topicId: string; connection: string };

/** Hand-picked connections to questions elsewhere, keyed by country ID. */
const related: Record<string, Recommendation[]> = {
  SGP: [
    {
      countryId: 'MYS',
      topicId: 'two-shores',
      connection: 'Meet the federation just across the strait.',
    },
    {
      countryId: 'TUR',
      topicId: 'straits',
      connection: 'Another narrow passage with an outsized role.',
    },
  ],
  JPN: [
    {
      countryId: 'CHN',
      topicId: 'manufacturing',
      connection: 'Follow the region’s connected manufacturing systems.',
    },
    {
      countryId: 'IND',
      topicId: 'technology',
      connection: 'A different path into the global economy.',
    },
  ],
  BRA: [
    {
      countryId: 'IDN',
      topicId: 'nature',
      connection: 'Explore another country with extraordinary biodiversity.',
    },
    {
      countryId: 'FRA',
      topicId: 'overseas',
      connection: 'See why France also belongs on a South American map.',
    },
  ],
  TUR: [
    {
      countryId: 'SGP',
      topicId: 'shipping',
      connection: 'Compare another strategic meeting point of seas.',
    },
    {
      countryId: 'FRA',
      topicId: 'europe',
      connection: 'Explore how geography becomes a political project.',
    },
  ],
  CHN: [
    {
      countryId: 'JPN',
      topicId: 'industry',
      connection: 'Look inside another East Asian industrial system.',
    },
    {
      countryId: 'MYS',
      topicId: 'electronics',
      connection: 'Trace production beyond one country’s borders.',
    },
  ],
  USA: [
    {
      countryId: 'CHN',
      topicId: 'manufacturing',
      connection: 'Another kind of economic influence: production networks.',
    },
    {
      countryId: 'BRA',
      topicId: 'agriculture',
      connection: 'How does land become a global economic resource?',
    },
  ],
  FRA: [
    {
      countryId: 'BRA',
      topicId: 'language',
      connection: 'Across the Atlantic, language carries a different colonial history.',
    },
    {
      countryId: 'TUR',
      topicId: 'republic',
      connection: 'Another republic shaped by an imperial past.',
    },
  ],
  IND: [
    {
      countryId: 'IDN',
      topicId: 'language',
      connection: 'Another multilingual society, another approach to a shared language.',
    },
    {
      countryId: 'BRA',
      topicId: 'amazon',
      connection: 'See how water connects nature to everyday life elsewhere.',
    },
  ],
  MYS: [
    {
      countryId: 'SGP',
      topicId: 'shipping',
      connection: 'Continue to the port at the peninsula’s southern tip.',
    },
    {
      countryId: 'IDN',
      topicId: 'islands',
      connection: 'Borneo’s southern neighbor stretches across an archipelago.',
    },
  ],
  IDN: [
    {
      countryId: 'MYS',
      topicId: 'two-shores',
      connection: 'Follow Borneo north into a different federation.',
    },
    {
      countryId: 'IND',
      topicId: 'languages',
      connection: 'Another large country brings many languages together.',
    },
  ],
};

/**
 * Up to two questions elsewhere to follow from here: the next stop of a trail this question
 * belongs to, then hand-picked connections. Never points back into the same country.
 */
export function relatedStories(destination: Destination) {
  const key = destinationKey(destination);
  const trail = trails.find((item) => item.stops.some((stop) => destinationKey(stop) === key));
  const stopIndex = trail ? trail.stops.findIndex((stop) => destinationKey(stop) === key) : -1;
  const next = trail?.stops[(stopIndex + 1) % trail.stops.length];
  const candidates = [...(next ? [next] : []), ...(related[destination.countryId] ?? [])];
  return candidates
    .filter(
      (item, index) =>
        item.countryId !== destination.countryId &&
        candidates.findIndex((other) => destinationKey(other) === destinationKey(item)) === index,
    )
    .slice(0, 2);
}
