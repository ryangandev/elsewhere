'use client';

import { ArrowRight, Compass, Search } from 'lucide-react';
import type { Country, Topic } from '@/content/legacy/data';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

type Props = { profile: Country | null; topic: Topic | null };

function scrollToQuestions() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById('curiosity-topics')
    ?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
}

/** A country overview points to its questions; every other view offers search. */
export function PanelFooter({ profile, topic }: Props) {
  const { openDialog } = useAtlas();
  const text = messages.panel;

  return (
    <div className="panel-footer">
      {profile && !topic ? (
        <button className="curiosity-jump" onClick={scrollToQuestions}>
          <Compass size={16} />
          <span>{messages.country.followCuriosity}</span>
          <span>
            {profile.topics.length} {text.questions}
            <ArrowRight size={14} />
          </span>
        </button>
      ) : (
        <button className="curiosity-jump" onClick={() => openDialog('search')}>
          <Search size={15} />
          <span>{text.somethingElse}</span>
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
