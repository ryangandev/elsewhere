'use client';

import { ArrowRight, Compass, History } from 'lucide-react';
import { linkFor } from '@/domain/atlas-index';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useAtlasIndex } from '../atlas/use-indexes';
import { DestinationLink } from '../DestinationLink';

/** Secondary ways in: back to the last place read, or onto a trail. */
export function HomeLinks() {
  const { library, openDialog } = useAtlas();
  const text = messages.home;

  // The last destination's title comes from the atlas index, loaded only when there is one.
  const lastRead = library.recent[0];
  const index = useAtlasIndex(!!lastRead);
  const resume = lastRead && index.data ? linkFor(index.data, lastRead) : undefined;

  return (
    <nav className="home-links" aria-label={text.moreLabel}>
      {resume && (
        <DestinationLink href={resume.href} className="home-link">
          <History size={14} />
          <span className="home-link-label">{text.resume}</span>
          <span className="home-link-title">
            {resume.category ? resume.title : resume.countryName}
          </span>
          <ArrowRight size={13} />
        </DestinationLink>
      )}
      <button className="home-link" onClick={() => openDialog('trails')}>
        <Compass size={14} />
        <span className="home-link-title">{text.trails}</span>
        <ArrowRight size={13} />
      </button>
    </nav>
  );
}
