'use client';

import { RotateCcw } from 'lucide-react';
import type { PageView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

/** Describes the latitude and longitude as "1.4° N, 103.8° E". */
function coordinates(lat: number, lng: number): string {
  return format(messages.caption.coordinates, {
    lat: Math.abs(lat).toFixed(1),
    latHemisphere: lat >= 0 ? 'N' : 'S',
    lng: Math.abs(lng).toFixed(1),
    lngHemisphere: lng >= 0 ? 'E' : 'W',
  });
}

/** The line of context under the globe: the place in focus, the story's map note, or where the country is. */
export function MapCaption({ view }: { view: PageView }) {
  const { focus, focusPlace } = useAtlas();
  const text = messages.caption;
  const story = view.kind === 'story';

  const title = focus ? text.closerLook : story ? text.geographyMakesTheStory : text.everyPlace;
  const body = focus
    ? focus.name
    : story
      ? view.map.note
      : `${view.country.region} · ${coordinates(view.country.lat, view.country.lng)}`;

  return (
    <div className={`map-caption ${focus ? 'has-focus' : ''}`}>
      <span className="caption-line" />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {focus?.note && <small className="focus-context">{focus.note}</small>}
        {focus && (
          <button onClick={() => focusPlace(null)}>
            {text.backToConnection}
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
