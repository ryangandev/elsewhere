'use client';

import { Bookmark, Link2, X } from 'lucide-react';
import { useRef } from 'react';
import type { Destination } from '@/domain/destination';
import type { PageView } from '@/domain/view-models';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

type Props = {
  view: PageView;
  destination: Destination;
  /** On a phone the panel can collapse to a strip so the globe has the room. */
  compact: boolean;
  onToggleCompact: () => void;
  /** The id of the panel body the toggle shows and hides. */
  bodyId: string;
};

/** Mode label, save/share/close tools, and the collapsed strip on small screens. */
export function PanelHeader({ view, destination, compact, onToggleCompact, bodyId }: Props) {
  const { go, save, share, isSaved } = useAtlas();
  const toggle = useRef<HTMLButtonElement>(null);
  const text = messages.panel;
  const saved = isSaved(destination);
  const mode =
    view.kind === 'story'
      ? text.modeQuestion
      : view.kind === 'country'
        ? text.modeStory
        : text.modeMap;

  return (
    <>
      <div className="panel-topline">
        <span className="desktop-mode">
          <span className="live-dot" />
          {mode}
        </span>
        <button
          ref={toggle}
          className="panel-mode"
          onClick={onToggleCompact}
          aria-expanded={!compact}
          aria-controls={bodyId}
          aria-label={compact ? text.expand : text.makeRoom}
        >
          <span className="live-dot" />
          {mode}
          <span className="mobile-chevron" aria-hidden="true">
            {compact ? '↑' : '↓'}
          </span>
        </button>
        <div className="panel-tools">
          <button
            onClick={() => save(destination)}
            aria-label={saved ? text.unsave : text.save}
            aria-pressed={saved}
            title={saved ? text.saved : text.saveForLater}
          >
            <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} />
          </button>
          <button onClick={() => void share()} aria-label={text.share} title={text.copyLink}>
            <Link2 size={17} />
          </button>
          <button onClick={() => go(null)} aria-label={text.close}>
            <X size={18} />
          </button>
        </div>
      </div>
      {compact && (
        <button
          className="compact-story"
          aria-expanded="false"
          aria-controls={bodyId}
          onClick={() => {
            onToggleCompact();
            // The strip goes away when the panel opens, so focus moves to the toggle that stays.
            toggle.current?.focus();
          }}
        >
          <span className="compact-title">
            {view.kind !== 'map' && view.flag} {view.title}
          </span>
          <span className="compact-hint">{text.continueReading}</span>
        </button>
      )}
    </>
  );
}
