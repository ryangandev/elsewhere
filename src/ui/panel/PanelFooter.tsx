'use client';

import { ArrowRight, Search } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

/** Always one step from a new question: opens the same search as the home page. */
export function PanelFooter() {
  const { openDialog } = useAtlas();

  return (
    <div className="panel-footer">
      <button className="curiosity-jump" onClick={() => openDialog('search')}>
        <Search size={15} />
        <span>{messages.panel.somethingElse}</span>
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
