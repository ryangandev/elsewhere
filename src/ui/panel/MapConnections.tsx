'use client';

import { ArrowRight, MapPin } from 'lucide-react';
import type { Place } from '@/content/legacy/data';
import { linkedCountry } from '@/domain/catalog';
import { placeNotes } from '@/domain/place-notes';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

type Props = {
  places: Place[];
  note: string;
  /** True when the globe draws an illustrative route for this story. */
  hasRoute?: boolean;
};

/** Places the reader can tap to find on the globe, with a short note about the one in focus. */
export function MapConnections({ places, note, hasRoute }: Props) {
  const { focus, focusPlace, go } = useAtlas();
  const text = messages.connections;
  const related = focus ? linkedCountry(focus) : null;

  return (
    <section className="map-connections" aria-label={text.label}>
      <div className="section-label">
        <MapPin size={14} />
        <span>{text.title}</span>
        {hasRoute && <span className="route-key">{text.illustrativeRoute}</span>}
      </div>
      <p>{note}</p>
      <div className="place-chips">
        {places.map((place) => (
          <button
            key={place.name}
            aria-pressed={focus?.name === place.name}
            onClick={() => focusPlace(focus?.name === place.name ? null : place)}
          >
            <span />
            {place.name}
          </button>
        ))}
      </div>
      {focus ? (
        <div className="place-detail" aria-live="polite">
          <strong>{focus.name}</strong>
          <p>{placeNotes[focus.name] ?? format(text.locate, { place: focus.name })}</p>
          <div>
            {related && (
              <button onClick={() => go({ countryId: related.id })}>
                {text.explore} {related.name} <ArrowRight size={13} />
              </button>
            )}
            <button onClick={() => focusPlace(null)}>{text.showWhole}</button>
          </div>
        </div>
      ) : (
        <small className="map-instruction">{text.instruction}</small>
      )}
    </section>
  );
}
