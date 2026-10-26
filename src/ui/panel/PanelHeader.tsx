'use client';

import { Bookmark, Link2, X } from 'lucide-react';
import type { Country, Topic } from '@/content/legacy/data';
import type { MapCountry } from '@/domain/catalog';
import type { Destination } from '@/domain/destination';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

type Props = {
  destination: Destination;
  country: MapCountry;
  profile: Country | null;
  topic: Topic | null;
};

/** Mode label, save/share/close tools, and the collapsed one-line state on small screens. */
export function PanelHeader({ destination, country, profile, topic }: Props) {
  const { go, save, share, isSaved, compact, toggleCompact } = useAtlas();
  const text = messages.panel;
  const saved = isSaved(destination);
  const mode = topic ? text.modeQuestion : profile ? text.modeStory : text.modeMap;

  return (
    <>
      <div className="panel-topline">
        <span className="desktop-mode">
          <span className="live-dot" />
          {mode}
        </span>
        <button
          className="panel-mode"
          onClick={toggleCompact}
          aria-expanded={!compact}
          aria-label={compact ? text.expand : text.makeRoom}
        >
          <span className="live-dot" />
          {mode}
          <span className="mobile-chevron">{compact ? '↑' : '↓'}</span>
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
        <button className="compact-story" onClick={toggleCompact}>
          {profile?.flag} {topic?.title ?? country.name}
          <span>{text.continueReading}</span>
        </button>
      )}
    </>
  );
}
