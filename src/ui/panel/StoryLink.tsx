'use client';

import { ArrowUpRight } from 'lucide-react';
import type { StoryLinkView } from '@/domain/view-models';
import { DestinationLink } from '../DestinationLink';
import './story-link.css';

/** A card that leads to a country overview or one of its questions. */
export function StoryLink({ link }: { link: StoryLinkView }) {
  return (
    <DestinationLink href={link.href} className="story-link">
      <span className="story-flag">{link.flag}</span>
      <span>
        <small>
          {link.countryName}
          {link.category ? ` · ${link.category}` : ''}
        </small>
        <strong>{link.title}</strong>
        {link.caption && <p>{link.caption}</p>}
      </span>
      <ArrowUpRight size={17} />
    </DestinationLink>
  );
}
