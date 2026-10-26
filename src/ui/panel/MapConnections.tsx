'use client';

import { ArrowRight, MapPin } from 'lucide-react';
import type { MapView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

/** Places the reader can tap to find on the globe, with a short note about the one in focus. */
export function MapConnections({ map }: { map: MapView }) {
  const { focus, focusPlace, go } = useAtlas();
  const text = messages.connections;
  const focused = focus ? map.places.find((place) => place.id === focus.id) : undefined;

  return (
    <section className="map-connections" aria-label={text.label}>
      <div className="section-label">
        <MapPin size={14} />
        <span>{text.title}</span>
        {map.hasRoute && <span className="route-key">{text.illustrativeRoute}</span>}
      </div>
      <p>{map.note}</p>
      {map.places.length > 0 && (
        <div className="place-chips">
          {map.places.map((place) => (
            <button
              key={place.id}
              aria-pressed={focused?.id === place.id}
              onClick={() => focusPlace(focused?.id === place.id ? null : place.id)}
            >
              <span />
              {place.name}
            </button>
          ))}
        </div>
      )}
      {focused ? (
        <div className="place-detail" aria-live="polite">
          <strong>{focused.name}</strong>
          <p>{focused.note ?? format(text.locate, { place: focused.name })}</p>
          <div>
            {focused.country && (
              <button onClick={() => go(focused.country!.href)}>
                {text.explore} {focused.country.name} <ArrowRight size={13} />
              </button>
            )}
            <button onClick={() => focusPlace(null)}>{text.showWhole}</button>
          </div>
        </div>
      ) : (
        map.places.length > 0 && <small className="map-instruction">{text.instruction}</small>
      )}
    </section>
  );
}
