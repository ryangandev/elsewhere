'use client';

import { Compass, X } from 'lucide-react';
import { getCountry } from '@/domain/catalog';
import { destinationKey, type Destination } from '@/domain/destination';
import { stopDestination, type Trail } from '@/domain/trails';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

type Props = { trail: Trail; destination: Destination };

/** Where the reader is on a trail, with a way to jump to any stop or leave the trail. */
export function TrailProgress({ trail, destination }: Props) {
  const { go } = useAtlas();
  const text = messages.trail;
  const current = destinationKey(destination);

  return (
    <div className="trail-progress">
      <div>
        <Compass size={14} />
        <span>{trail.title}</span>
        <button
          aria-label={text.leave}
          onClick={() => go({ countryId: destination.countryId, topicId: destination.topicId })}
        >
          <X size={13} />
        </button>
      </div>
      <nav aria-label={text.stops}>
        {trail.stops.map((stop, index) => {
          const name = getCountry(stop.countryId)?.name ?? '';
          return (
            <button
              key={destinationKey(stop)}
              aria-current={destinationKey(stop) === current ? 'step' : undefined}
              title={name}
              onClick={() => go(stopDestination(trail, stop))}
            >
              <span>{index + 1}</span>
              {name}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
