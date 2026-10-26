'use client';

import { RotateCcw } from 'lucide-react';
import { placeNotes } from '@/domain/place-notes';
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
export function MapCaption() {
  const { country, topic, focus, focusPlace } = useAtlas();
  if (!country) return null;
  const text = messages.caption;

  const title = focus ? text.closerLook : topic ? text.geographyMakesTheStory : text.everyPlace;
  const body = focus
    ? focus.name
    : topic
      ? topic.mapNote
      : `${country.region} · ${coordinates(country.lat, country.lng)}`;
  const context = focus ? placeNotes[focus.name] : undefined;

  return (
    <div className={`map-caption ${focus ? 'has-focus' : ''}`}>
      <span className="caption-line" />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {context && <small className="focus-context">{context}</small>}
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
