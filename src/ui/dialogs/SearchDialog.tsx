'use client';

import { ArrowRight, ArrowUpRight, Compass, MapPin, Search, X } from 'lucide-react';
import { useRef, useState, type RefObject } from 'react';
import { countries } from '@/content/legacy/data';
import { directory, getCountry } from '@/domain/catalog';
import { destinationKey, topicDestination } from '@/domain/destination';
import { searchAtlas, type SearchResult } from '@/domain/search';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
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

/** True when the query names a place, so places should be listed before questions. */
function isPlaceQuery(results: SearchResult[], query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return results.some(
    (result) =>
      result.kind !== 'story' &&
      (result.title.toLowerCase() === normalized ||
        result.destination.countryId.toLowerCase() === normalized ||
        !!getCountry(result.destination.countryId)?.native.toLowerCase().includes(normalized)),
  );
}

function ResultIcon({ result }: { result: SearchResult }) {
  if (result.kind === 'story') return <Search size={16} />;
  if (result.kind === 'map') return <MapPin size={17} />;
  return <span className="search-flag">{getCountry(result.destination.countryId)?.flag}</span>;
}

function SearchContents({
  inputRef,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  const { country: current, go } = useAtlas();
  const [query, setQuery] = useState('');
  const text = messages.search;

  const results = searchAtlas(query, current?.id);
  const profile = getCountry(current?.id);
  const groups = groupOrder(isPlaceQuery(results, query));

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
        {query.trim().length === 0 ? (
          <>
            {profile && (
              <CommandGroup
                heading={format(text.stayCurious, { country: profile.name.toUpperCase() })}
              >
                {profile.topics.map((topic, index) => (
                  <CommandItem
                    key={topic.id}
                    value={topic.title}
                    onSelect={() => go(topicDestination(profile, index))}
                  >
                    <Search size={15} />
                    <span>
                      <strong>{topic.title}</strong>
                      <small>{topic.category}</small>
                    </span>
                    <ArrowRight size={15} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading={text.tenPlaces}>
              {countries.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => go({ countryId: item.id })}
                >
                  <span className="search-flag">{item.flag}</span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.region}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : results.length === 0 ? (
          <div className="search-empty">
            <Compass size={27} />
            <h3>{text.emptyTitle}</h3>
            <p>{text.empty}</p>
            <button onClick={() => setQuery('')}>
              {text.browse}
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          groups.map((group) => {
            const matches = results.filter((result) => result.kind === group.kind);
            if (!matches.length) return null;
            return (
              <CommandGroup heading={group.title} key={group.kind}>
                {matches.map((result) => {
                  const value = `${result.kind}:${destinationKey(result.destination)}`;
                  return (
                    <CommandItem key={value} value={value} onSelect={() => go(result.destination)}>
                      <ResultIcon result={result} />
                      <span>
                        <strong>{result.title}</strong>
                        <small>{result.subtitle}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            );
          })
        )}
      </CommandList>
      <div className="search-foot">
        <span>{text.keys}</span>
        <span>{format(text.footer, { count: directory.length })}</span>
      </div>
    </Command>
  );
}
