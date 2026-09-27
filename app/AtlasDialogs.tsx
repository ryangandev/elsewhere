'use client';

import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { ArrowRight, ArrowUpRight, Bookmark, Compass, Globe2, History, MapPin, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem } from '@/components/ui/command';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { countries } from './data';
import { destinationKey, directory, getCountry, getTopic, searchAtlas, topicDestination, trails, type Destination } from './exploration';
import type { Library } from './use-atlas';
import { StoryLink } from './ExplorerPanel';

type Navigate = (destination: Destination | null) => void;
export function AtlasSearch({ open, onOpenChange, onNavigate, countryId }: { open: boolean; onOpenChange: (open: boolean) => void; onNavigate: Navigate; countryId?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="atlas-search" showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus(); }}>
    <DialogTitle className="sr-only">Where does your curiosity lead?</DialogTitle><DialogDescription className="sr-only">Search countries, places, and questions in our editorial stories.</DialogDescription>
    {open && <SearchContents inputRef={inputRef} onNavigate={onNavigate} countryId={countryId} onClose={() => onOpenChange(false)} />}
  </DialogContent></Dialog>;
}
function SearchContents({ onNavigate, countryId, onClose, inputRef }: { onNavigate: Navigate; countryId?: string; onClose: () => void; inputRef: RefObject<HTMLInputElement | null> }) {
  const [query, setQuery] = useState('');
  const results = searchAtlas(query, countryId);
  const country = getCountry(countryId);
  const hasQuery = query.trim().length > 0;
  const isPlaceQuery = results.some(result => result.kind !== 'story' && (result.title.toLowerCase() === query.trim().toLowerCase() || result.destination.countryId.toLowerCase() === query.trim().toLowerCase() || getCountry(result.destination.countryId)?.native.toLowerCase().includes(query.trim().toLowerCase())));
  const groups = isPlaceQuery
    ? [{ kind: 'country', title: 'COUNTRY STORIES' }, { kind: 'map', title: 'LOCATE ON THE GLOBE' }, { kind: 'story', title: 'QUESTIONS TO EXPLORE' }]
    : [{ kind: 'story', title: 'QUESTIONS TO EXPLORE' }, { kind: 'country', title: 'COUNTRY STORIES' }, { kind: 'map', title: 'LOCATE ON THE GLOBE' }];
  return <Command shouldFilter={false} className="search-command">
    <div className="search-heading"><span>FOLLOW A QUESTION</span><button aria-label="Close search" onClick={onClose}><X size={17} /></button></div>
    <CommandInput ref={inputRef} value={query} onValueChange={setQuery} placeholder="A country, a topic, a question…" aria-label="Search the atlas" />
    <CommandList>
      {hasQuery ? results.length ? groups.map(group => {
        const matches = results.filter(result => result.kind === group.kind);
        return matches.length > 0 && <CommandGroup heading={group.title} key={group.kind}>{matches.map(result => <CommandItem key={`${result.kind}:${destinationKey(result.destination)}`} value={`${result.kind}:${destinationKey(result.destination)}`} onSelect={() => onNavigate(result.destination)}>
          {result.kind === 'story' ? <Search size={16} /> : result.kind === 'map' ? <MapPin size={17} /> : <span className="search-flag">{getCountry(result.destination.countryId)?.flag}</span>}
          <span><strong>{result.title}</strong><small>{result.subtitle}</small></span><ArrowUpRight size={15} />
        </CommandItem>)}</CommandGroup>;
      }) : <div className="search-empty"><Compass size={27} /><h3>A question for another day.</h3><p>We don’t have a story matching that yet. Try a country name or a topic like shipping, language, or forests.</p><button onClick={() => setQuery('')}>Browse the atlas <ArrowRight size={14} /></button></div> : <>
        {country && <CommandGroup heading={`STAY CURIOUS ABOUT ${country.name.toUpperCase()}`}>{country.topics.map((topic, index) => <CommandItem key={topic.title} value={topic.title} onSelect={() => onNavigate(topicDestination(country, index))}><Search size={15} /><span><strong>{topic.title}</strong><small>{topic.category}</small></span><ArrowRight size={15} /></CommandItem>)}</CommandGroup>}
        <CommandGroup heading="TEN PLACES. MANY WAYS IN.">{countries.map(item => <CommandItem value={item.id} key={item.id} onSelect={() => onNavigate({ countryId: item.id })}><span className="search-flag">{item.flag}</span><span><strong>{item.name}</strong><small>{item.region}</small></span><ArrowUpRight size={15} /></CommandItem>)}</CommandGroup>
      </>}
    </CommandList>
    <div className="search-foot"><span>↑ ↓ to explore · ↵ to go</span><span>Editorial search · {directory.length} map locations</span></div>
  </Command>;
}

export function TrailDrawer({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; onNavigate: Navigate }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="atlas-drawer trail-drawer"><Compass size={30} /><SheetTitle>One question.<br /><em>A wider world.</em></SheetTitle><SheetDescription>Short trails through connected ideas. Start anywhere. Leave whenever curiosity takes you elsewhere.</SheetDescription>
    <div className="trail-list">{trails.map((trail, index) => <article className="trail-card" key={trail.id}><div className="section-label"><span>0{index + 1}</span>{trail.label}</div><h3>{trail.title}</h3><p>{trail.description}</p><div className="trail-countries">{trail.stops.map((stop, i) => <span key={destinationKey(stop)}>{i > 0 && <span className="trail-dash" />}<span title={getCountry(stop.countryId)?.name}>{getCountry(stop.countryId)?.flag}</span></span>)}</div><button onClick={() => onNavigate({ ...trail.stops[0], trailId: trail.id })}>Follow this trail <span>{trail.stops.length} stops <ArrowRight size={15} /></span></button></article>)}</div>
  </SheetContent></Sheet>;
}

export function LibraryDrawer({ open, onOpenChange, library, onNavigate, onToggleSave, persistenceFailed }: { open: boolean; onOpenChange: (open: boolean) => void; library: Library; onNavigate: Navigate; onToggleSave: (destination: Destination) => void; persistenceFailed: boolean }) {
  const [view, setView] = useState<'saved' | 'recent'>('saved');
  const items = library[view];
  function changeTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'saved' : event.key === 'End' ? 'recent' : view === 'saved' ? 'recent' : 'saved';
    setView(next);
    document.getElementById(`${next}-tab`)?.focus();
  }
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="atlas-drawer library-drawer"><Bookmark size={28} /><SheetTitle>Your little atlas.</SheetTitle><SheetDescription>A few places to come back to. {persistenceFailed ? 'Browser storage is unavailable; kept for this session only.' : 'Saved on this browser, just for you.'}</SheetDescription>
    <div className="library-tabs" role="tablist" aria-label="Your atlas"><button role="tab" onKeyDown={changeTab} tabIndex={view === 'saved' ? 0 : -1} id="saved-tab" aria-controls="library-items" aria-selected={view === 'saved'} onClick={() => setView('saved')}><Bookmark size={14} />Saved <span>{library.saved.length}</span></button><button role="tab" onKeyDown={changeTab} tabIndex={view === 'recent' ? 0 : -1} id="recent-tab" aria-controls="library-items" aria-selected={view === 'recent'} onClick={() => setView('recent')}><History size={14} />Recent</button></div>
    <div id="library-items" role="tabpanel" aria-labelledby={`${view}-tab`} className="library-items">
      {items.length ? items.map(item => {
        const profile = getCountry(item.countryId);
        const country = directory.find(c => c.id === item.countryId);
        return <div className="library-row" key={destinationKey(item)}>{profile ? <StoryLink destination={item} onNavigate={onNavigate} /> : <button className="story-link" onClick={() => onNavigate(item)}><MapPin size={17} /><span><small>On the map</small><strong>{country?.name}</strong></span><ArrowRight size={15} /></button>}{view === 'saved' && <button className="remove-saved" aria-label={`Remove ${getTopic(item)?.title ?? country?.name} from saved`} onClick={() => onToggleSave(item)}><X size={14} /></button>}</div>;
      }) : <div className="library-empty"><Globe2 size={44} /><h3>{view === 'saved' ? 'Keep a little curiosity for later.' : 'Your next discovery starts here.'}</h3><p>{view === 'saved' ? 'Tap the bookmark on a country or question. It will be waiting here when you return.' : 'The places and questions you explore will appear here.'}</p><button onClick={() => onNavigate({ countryId: 'SGP' })}>Start with Singapore <ArrowRight size={15} /></button></div>}
    </div>
  </SheetContent></Sheet>;
}
