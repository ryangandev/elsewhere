'use client';

import { ArrowRight, Bookmark, Globe2, History, MapPin, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { linkFor, type AtlasLookup } from '@/domain/atlas-index';
import { destinationKey, type Destination } from '@/domain/destination';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useAtlasIndex } from '../atlas/use-indexes';
import { DestinationLink } from '../DestinationLink';
import { StoryLink } from '../panel/StoryLink';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../primitives/sheet';
import './dialogs.css';

type View = 'saved' | 'recent';

/** The first country offered from an empty library. */
const START_COUNTRY_ID = 'SGP';

const TAB_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

export function LibraryDrawer() {
  const { dialog, openDialog, library, persistenceFailed, toggleSave, go } = useAtlas();
  const [view, setView] = useState<View>('saved');
  const open = dialog === 'library';
  // Titles come from the atlas index; entries it no longer knows are not shown.
  const index = useAtlasIndex(open);
  const lookup = index.data;
  const text = messages.library;
  const items = lookup ? library[view].filter((item) => linkFor(lookup, item) !== undefined) : [];
  const start = lookup?.country(START_COUNTRY_ID);

  function changeTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!TAB_KEYS.includes(event.key)) return;
    event.preventDefault();
    const next: View =
      event.key === 'Home'
        ? 'saved'
        : event.key === 'End'
          ? 'recent'
          : view === 'saved'
            ? 'recent'
            : 'saved';
    setView(next);
    document.getElementById(`${next}-tab`)?.focus();
  }

  return (
    <Sheet open={open} onOpenChange={(next) => openDialog(next ? 'library' : null)}>
      <SheetContent className="atlas-drawer library-drawer">
        <Bookmark size={28} />
        <SheetTitle>{text.title}</SheetTitle>
        <SheetDescription>
          {text.description} {persistenceFailed ? text.storageUnavailable : text.storedLocally}
        </SheetDescription>
        <div className="library-tabs" role="tablist" aria-label={messages.topbar.atlas}>
          <button
            role="tab"
            id="saved-tab"
            aria-controls="library-items"
            aria-selected={view === 'saved'}
            tabIndex={view === 'saved' ? 0 : -1}
            onKeyDown={changeTab}
            onClick={() => setView('saved')}
          >
            <Bookmark size={14} />
            {text.saved}
            <span>{library.saved.length}</span>
          </button>
          <button
            role="tab"
            id="recent-tab"
            aria-controls="library-items"
            aria-selected={view === 'recent'}
            tabIndex={view === 'recent' ? 0 : -1}
            onKeyDown={changeTab}
            onClick={() => setView('recent')}
          >
            <History size={14} />
            {text.recent}
          </button>
        </div>
        <div
          id="library-items"
          role="tabpanel"
          aria-labelledby={`${view}-tab`}
          className="library-items"
        >
          {!lookup ? null : items.length ? (
            items.map((item) => (
              <LibraryRow
                key={destinationKey(item)}
                lookup={lookup}
                item={item}
                removable={view === 'saved'}
                onRemove={() => toggleSave(item)}
              />
            ))
          ) : (
            <div className="library-empty">
              <Globe2 size={44} />
              <h3>{view === 'saved' ? text.emptySavedTitle : text.emptyRecentTitle}</h3>
              <p>{view === 'saved' ? text.emptySaved : text.emptyRecent}</p>
              {start && (
                <button onClick={() => go(start.path)}>
                  {format(text.startWith, { name: start.name })}
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LibraryRow({
  lookup,
  item,
  removable,
  onRemove,
}: {
  lookup: AtlasLookup;
  item: Destination;
  removable: boolean;
  onRemove: () => void;
}) {
  const link = linkFor(lookup, item);
  if (!link) return null;
  const edited = lookup.country(item.countryId)?.edited ?? false;
  const label = link.category ? link.title : link.countryName;

  return (
    <div className="library-row">
      {edited ? (
        <StoryLink link={link} />
      ) : (
        <DestinationLink href={link.href} className="story-link">
          <MapPin size={17} />
          <span>
            <small>{messages.library.onTheMap}</small>
            <strong>{link.countryName}</strong>
          </span>
          <ArrowRight size={15} />
        </DestinationLink>
      )}
      {removable && (
        <button
          className="remove-saved"
          aria-label={format(messages.library.remove, { name: label })}
          onClick={onRemove}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
