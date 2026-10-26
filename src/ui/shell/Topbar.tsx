'use client';

import { Bookmark, Compass, Globe2, Search } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useApplePlatform } from './use-apple-platform';

export function Topbar() {
  const { go, openDialog, library } = useAtlas();
  const text = messages.topbar;
  // Both labels are laid out in one cell so the key keeps its width while the platform is unknown.
  const apple = useApplePlatform();
  const platform = apple === undefined ? undefined : apple ? 'apple' : 'other';

  return (
    <header className="topbar">
      <button className="brand" onClick={() => go(null)} aria-label={text.home}>
        <span className="brand-icon">
          <Globe2 size={23} />
        </span>
        elsewhere<span className="brand-period">.</span>
      </button>
      <span className="topbar-note">{text.tagline}</span>
      <div className="header-actions">
        <button
          className="nav-button"
          onClick={() => openDialog('trails')}
          aria-label={text.trailsLabel}
        >
          <Compass size={16} />
          <span>{text.trails}</span>
        </button>
        <button
          className="nav-button"
          onClick={() => openDialog('library')}
          aria-label={text.atlasLabel}
        >
          <Bookmark size={16} />
          <span>{text.atlas}</span>
          {library.saved.length > 0 && <i className="saved-indicator" />}
        </button>
        <button
          className="search-trigger"
          aria-label={text.searchLabel}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={() => openDialog('search')}
        >
          <Search size={17} />
          <span>{text.search}</span>
          <kbd data-platform={platform} aria-hidden>
            <span>{text.shortcutApple}</span>
            <span>{text.shortcutOther}</span>
          </kbd>
        </button>
      </div>
    </header>
  );
}
