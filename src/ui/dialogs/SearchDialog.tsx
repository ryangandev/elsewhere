'use client';

import { ArrowRight, ArrowUpRight, Compass, MapPin, Search, X } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import type { AtlasLookup } from '@/domain/atlas-index';
import { isPlaceQuery, searchAtlas, type SearchResult } from '@/domain/search';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useAtlasIndex } from '../atlas/use-indexes';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../primitives/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../primitives/dialog';

export function SearchDialog() {
  const { dialog, openDialog } = useAtlas();
  const inputRef = useRef<HTMLInputElement>(null);
  const open = dialog === 'search';
  const close = () => openDialog(null);

  return (
    <Dialog open={open} onOpenChange={(next) => openDialog(next ? 'search' : null)}>
      <DialogContent
        className="atlas-search"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{messages.search.title}</DialogTitle>
        <DialogDescription className="sr-only">{messages.search.description}</DialogDescription>
        {open && <SearchContents inputRef={inputRef} onClose={close} />}
      </DialogContent>
    </Dialog>
  );
}

type ResultKind = SearchResult['kind'];

function groupOrder(prefersPlaces: boolean): { kind: ResultKind; title: string }[] {
  const text = messages.search;
  const story = { kind: 'story' as const, title: text.groupQuestions };
  const country = { kind: 'country' as const, title: text.groupCountries };
  const map = { kind: 'map' as const, title: text.groupMap };
  return prefersPlaces ? [country, map, story] : [story, country, map];
}

function resultSubtitle(result: SearchResult): string {
  if (result.kind === 'story') return result.subtitle;
  const kind =
    result.kind === 'country' ? messages.search.countryStory : messages.search.basicOverview;
  return `${result.subtitle} · ${kind}`;
}

function ResultIcon({ result }: { result: SearchResult }) {
  if (result.kind === 'story') return <Search size={16} />;
  if (result.kind === 'map') return <MapPin size={17} />;
  return <span className="search-flag">{result.flag}</span>;
}

function SearchContents({
  inputRef,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  const index = useAtlasIndex();
  const [query, setQuery] = useState('');
  const text = messages.search;

  return (
    <Command shouldFilter={false} className="search-command">
      <div className="search-heading">
        <span>{text.heading}</span>
        <button aria-label={text.close} onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        placeholder={text.placeholder}
        aria-label={text.inputLabel}
      />
      <CommandList>
        {index.data ? (
          <SearchResults lookup={index.data} query={query} onBrowse={() => setQuery('')} />
        ) : (
          <div className="search-empty" role="status">
            <Compass size={27} />
            <p>{index.failed ? text.unavailable : text.loading}</p>
          </div>
        )}
      </CommandList>
      <div className="search-foot">
        <span>{text.keys}</span>
        {index.data && (
          <span>{format(text.footer, { count: index.data.index.countries.length })}</span>
        )}
      </div>
    </Command>
  );
}

function SearchResults({
  lookup,
  query,
  onBrowse,
}: {
  lookup: AtlasLookup;
  query: string;
  onBrowse: () => void;
}) {
  const { destination, go } = useAtlas();
  const text = messages.search;
  const { index } = lookup;

  if (query.trim().length === 0) {
    const current = destination ? lookup.country(destination.countryId) : undefined;
    const currentStories = current ? lookup.stories(current.id) : [];
    const edited = index.countries.filter((country) => country.edited);
    return (
      <>
        {current && currentStories.length > 0 && (
          <CommandGroup heading={format(text.stayCurious, { country: current.name.toUpperCase() })}>
            {currentStories.map((story) => (
              <CommandItem key={story.id} value={story.path} onSelect={() => go(story.path)}>
                <Search size={15} />
                <span>
                  <strong>{story.question}</strong>
                  <small>{story.category}</small>
                </span>
                <ArrowRight size={15} />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={format(text.editedPlaces, { count: edited.length })}>
          {edited.map((country) => (
            <CommandItem key={country.id} value={country.path} onSelect={() => go(country.path)}>
              <span className="search-flag">{country.flag}</span>
              <span>
                <strong>{country.name}</strong>
                <small>{country.region}</small>
              </span>
              <ArrowUpRight size={15} />
            </CommandItem>
          ))}
        </CommandGroup>
      </>
    );
  }

  const results = searchAtlas(index, query, destination?.countryId);
  if (results.length === 0) {
    return (
      <div className="search-empty">
        <Compass size={27} />
        <h3>{text.emptyTitle}</h3>
        <p>{text.empty}</p>
        <button onClick={onBrowse}>
          {text.browse}
          <ArrowRight size={14} />
        </button>
      </div>
    );
  }

  return groupOrder(isPlaceQuery(index, query)).map((group) => {
    const matches = results.filter((result) => result.kind === group.kind);
    if (!matches.length) return null;
    return (
      <CommandGroup heading={group.title} key={group.kind}>
        {matches.map((result) => (
          <CommandItem key={result.key} value={result.key} onSelect={() => go(result.href)}>
            <ResultIcon result={result} />
            <span>
              <strong>{result.title}</strong>
              <small>{resultSubtitle(result)}</small>
            </span>
            <ArrowUpRight size={15} />
          </CommandItem>
        ))}
      </CommandGroup>
    );
  });
}
