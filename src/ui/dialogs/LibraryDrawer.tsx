'use client';

import { ArrowRight, Bookmark, Globe2, History, MapPin, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { getCountry, getMapCountry } from '@/domain/catalog';
import { destinationKey, getTopic, type Destination } from '@/domain/destination';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { DestinationLink } from '../DestinationLink';
import { StoryLink } from '../panel/StoryLink';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../primitives/sheet';

type View = 'saved' | 'recent';

const TAB_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

export function LibraryDrawer() {
  const { dialog, openDialog, library, persistenceFailed, toggleSave, go } = useAtlas();
  const [view, setView] = useState<View>('saved');
  const text = messages.library;
  const items = library[view];

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
    <Sheet open={dialog === 'library'} onOpenChange={(open) => openDialog(open ? 'library' : null)}>
      <SheetContent className="atlas-drawer library-drawer">
        <Bookmark size={28} />
        <SheetTitle>{text.title}</SheetTitle>
        <SheetDescription>
          {text.description}
          {persistenceFailed ? text.storageUnavailable : text.storedLocally}
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
          {items.length ? (
            items.map((item) => (
              <LibraryRow
                key={destinationKey(item)}
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
              <button onClick={() => go({ countryId: 'SGP' })}>
                {text.startWithSingapore}
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LibraryRow({
  item,
  removable,
  onRemove,
}: {
  item: Destination;
  removable: boolean;
  onRemove: () => void;
}) {
  const profile = getCountry(item.countryId);
  const country = getMapCountry(item.countryId);
  const label = getTopic(item)?.title ?? country?.name ?? '';

  return (
    <div className="library-row">
      {profile ? (
        <StoryLink destination={item} />
      ) : (
        <DestinationLink destination={item} className="story-link">
          <MapPin size={17} />
          <span>
            <small>{messages.library.onTheMap}</small>
            <strong>{country?.name}</strong>
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
