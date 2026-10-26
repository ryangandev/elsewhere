'use client';

import { ChevronRight, Globe2 } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

export function MapBreadcrumb() {
  const { country, topic, go } = useAtlas();
  if (!country) return null;

  return (
    <nav className="map-breadcrumb" aria-label={messages.breadcrumb.label}>
      <button onClick={() => go(null)}>
        <Globe2 size={15} />
        {messages.breadcrumb.world}
      </button>
      <ChevronRight size={13} />
      <button onClick={() => go({ countryId: country.id })}>{country.name}</button>
      {topic && (
        <>
          <ChevronRight size={12} />
          <span>{topic.category}</span>
        </>
      )}
    </nav>
  );
}
