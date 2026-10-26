'use client';

import { ArrowRight, Compass, Search } from 'lucide-react';
import type { PageView } from '@/domain/view-models';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

function scrollToQuestions() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document
    .getElementById('curiosity-topics')
    ?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
}

/** A country overview points to its questions; every other view offers search. */
export function PanelFooter({ view }: { view: PageView }) {
  const { openDialog } = useAtlas();
  const text = messages.panel;

  return (
    <div className="panel-footer">
      {view.kind === 'country' ? (
        <button className="curiosity-jump" onClick={scrollToQuestions}>
          <Compass size={16} />
          <span>{messages.country.followCuriosity}</span>
          <span>
            {view.starters.length + view.moreQuestions.length} {text.questions}
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
