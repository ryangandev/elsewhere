'use client';

import { ArrowUpRight } from 'lucide-react';
import { getCountry } from '@/domain/catalog';
import { getTopic, type Destination } from '@/domain/destination';
import { DestinationLink } from '../DestinationLink';

type Props = {
  destination: Destination;
  /** Why this is worth following next, shown under the title. */
  caption?: string;
};

/** A card that leads to a country overview or one of its questions. */
export function StoryLink({ destination, caption }: Props) {
  const country = getCountry(destination.countryId);
  const topic = getTopic(destination);
  if (!country) return null;

  return (
    <DestinationLink destination={destination} className="story-link">
      <span className="story-flag">{country.flag}</span>
      <span>
        <small>
          {country.name}
          {topic ? ` · ${topic.category}` : ''}
        </small>
        <strong>{topic ? topic.title : country.kicker}</strong>
        {caption && <p>{caption}</p>}
      </span>
      <ArrowUpRight size={17} />
    </DestinationLink>
  );
}
