'use client';

import { Compass, X } from 'lucide-react';
import type { TrailView } from '@/domain/view-models';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

type Props = {
  trail: TrailView;
  /** destinationKey of the question being read. */
  currentKey: string;
  /** The same question without the trail. */
  leaveHref: string;
};

/** Where the reader is on a trail, with a way to jump to any stop or leave the trail. */
export function TrailProgress({ trail, currentKey, leaveHref }: Props) {
  const { go } = useAtlas();
  const text = messages.trail;

  return (
    <div className="trail-progress">
      <div>
        <Compass size={14} />
        <span>{trail.title}</span>
        <button aria-label={text.leave} onClick={() => go(leaveHref)}>
          <X size={13} />
        </button>
      </div>
      <nav aria-label={text.stops}>
        {trail.stops.map((stop, index) => (
          <button
            key={stop.key}
            aria-current={stop.key === currentKey ? 'step' : undefined}
            title={stop.countryName}
            onClick={() => go(stop.href)}
          >
            <span>{index + 1}</span>
            {stop.countryName}
          </button>
        ))}
      </nav>
    </div>
  );
}
