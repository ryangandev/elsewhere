'use client';

import { ChevronRight, Globe2 } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import './map-overlays.css';

type Props = {
  country: { name: string; href: string };
  /** The question's category, on a question page. */
  category?: string;
};

export function MapBreadcrumb({ country, category }: Props) {
  const { go } = useAtlas();

  return (
    <nav className="map-breadcrumb" aria-label={messages.breadcrumb.label}>
      <button onClick={() => go(null)}>
        <Globe2 size={15} />
        {messages.breadcrumb.world}
      </button>
      <ChevronRight size={13} />
      <button onClick={() => go(country.href)}>{country.name}</button>
      {category && (
        <>
          <ChevronRight size={12} />
          <span>{category}</span>
        </>
      )}
    </nav>
  );
}
