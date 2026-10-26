import type { Destination } from './destination';

export type TrailStop = Destination & { connection: string };

export type Trail = {
  id: string;
  title: string;
  description: string;
  label: string;
  stops: TrailStop[];
};

export const trails: Trail[] = [
  {
    id: 'water-connects',
    title: 'The water between us',
    label: 'SEAS & CONNECTIONS',
    description:
      'A busy strait, two shores, a thousand islands. Follow the water that connects them.',
    stops: [
      {
        countryId: 'SGP',
        topicId: 'shipping',
        connection: 'Begin at a crossroads of world trade.',
      },
      {
        countryId: 'MYS',
        topicId: 'two-shores',
        connection: 'Across the strait, one federation stretches across two shores.',
      },
      {
        countryId: 'IDN',
        topicId: 'islands',
        connection: 'To the south, water connects an entire archipelago.',
      },
      {
        countryId: 'TUR',
        topicId: 'straits',
        connection: 'Now look west: another narrow passage connects whole regions.',
      },
    ],
  },
  {
    id: 'made-together',
    title: 'Made in many places',
    label: 'WORK & THE WORLD',
    description:
      'Look inside the things you use. Their stories cross more borders than their labels suggest.',
    stops: [
      {
        countryId: 'JPN',
        topicId: 'industry',
        connection: 'Start with the parts and systems inside familiar products.',
      },
      {
        countryId: 'CHN',
        topicId: 'manufacturing',
        connection: 'Follow the production networks across East Asia.',
      },
      {
        countryId: 'MYS',
        topicId: 'electronics',
        connection: 'Look closer at another link inside your electronics.',
      },
      {
        countryId: 'IND',
        topicId: 'technology',
        connection: 'Connections also carry services, not only physical goods.',
      },
    ],
  },
  {
    id: 'land-shapes-life',
    title: 'The land shapes the story',
    label: 'NATURE & EVERYDAY LIFE',
    description:
      'Rainforests, monsoon winds, and river corridors. See geography at work in everyday life.',
    stops: [
      {
        countryId: 'BRA',
        topicId: 'amazon',
        connection: 'Start with a forest that moves water through the atmosphere.',
      },
      {
        countryId: 'IND',
        topicId: 'monsoon',
        connection: 'Across the ocean, seasonal rain organizes everyday life.',
      },
      {
        countryId: 'USA',
        topicId: 'geography',
        connection: 'Follow a river system through a continental economy.',
      },
    ],
  },
];

/** The destination of a stop, carrying the trail so the reader keeps their place in it. */
export function stopDestination(trail: Trail, stop: TrailStop): Destination {
  return { countryId: stop.countryId, topicId: stop.topicId, trailId: trail.id };
}

export function getTrail(trailId?: string | null): Trail | undefined {
  return trails.find((trail) => trail.id === trailId);
}
