'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Bookmark, Check, ChevronRight, Compass, Globe2, Link2, Minus, Plus, RotateCcw, Search, Shuffle, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import GlobeView, { type GlobeAction, type GlobeStatus } from './Globe';
import ExplorerPanel from './ExplorerPanel';
import { AtlasSearch, LibraryDrawer, TrailDrawer } from './AtlasDialogs';
import { countries, type Place } from './data';
import { destinationKey, destinationUrl, directory, getCountry, getTopic, placeNotes, type Destination } from './exploration';
import { useAtlas } from './use-atlas';

export default function Home() {
  const { destination, navigate, library, toggleSave, isSaved, persistenceFailed } = useAtlas();
  const [search, setSearch] = useState(false);
  const [about, setAbout] = useState(false);
  const [showTrails, setShowTrails] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [status, setStatus] = useState<GlobeStatus>('loading');
  const [action, setAction] = useState<GlobeAction>({ type: 'reset', seq: 0 });
  const [focusState, setFocusState] = useState<{ key: string; place: Place } | null>(null);
  const [compactKey, setCompactKey] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const key = destination ? destinationKey(destination) : '';
  const country = directory.find(item => item.id === destination?.countryId) ?? null;
  const profile = getCountry(destination?.countryId) ?? null;
  const topic = getTopic(destination) ?? null;
  const focus = focusState?.key === key ? focusState.place : null;
  const compact = compactKey === key && !!key;
  const lastRead = library.recent[0];
  const lastCountry = getCountry(lastRead?.countryId);
  const modalOpen = search || about || showTrails || showLibrary || !!shareUrl;

  const go = useCallback((next: Destination | null) => {
    setFocusState(null); setCompactKey(null);
    setSearch(false); setShowLibrary(false); setShowTrails(false);
    navigate(next);
  }, [navigate]);
  const select = useCallback((id: string) => {
    if (directory.some(item => item.id === id)) go({ countryId: id });
  }, [go]);
  const focusPlace = useCallback((place: Place | null) => {
    setFocusState(place ? { key, place } : null);
  }, [key]);
  const control = (type: GlobeAction['type']) => {
    if (type === 'reset') setFocusState(null);
    setAction(current => ({ type, seq: current.seq + 1 }));
  };
  const announce = (message: string) => {
    clearTimeout(timer.current); setNotice(message);
    timer.current = setTimeout(() => setNotice(''), 3500);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearch(value => !value); return; }
      if (event.key !== 'Escape' || modalOpen || event.defaultPrevented) return;
      if (focus) setFocusState(null);
      else if (topic && country) go({ countryId: country.id });
      else if (country) go(null);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [modalOpen, topic, country, focus, go]);
  async function share() {
    const url = new URL(destinationUrl(destination), location.origin).href;
    try { await navigator.clipboard.writeText(url); announce('Link copied. A little curiosity, ready to share.'); }
    catch { setShareUrl(url); }
  }
  function surprise() {
    const unseen = countries.filter(item => item.id !== country?.id && !library.recent.some(recent => recent.countryId === item.id));
    const options = unseen.length ? unseen : countries.filter(item => item.id !== country?.id);
    go({ countryId: options[Math.floor(Math.random() * options.length)].id });
  }

  return <main className={`world-app ${country ? 'has-selection' : ''} ${compact ? 'map-expanded' : ''}`}>
    <a className="skip-link" href={country ? '#country-reading' : '#discovery-start'}>Skip to stories</a>
    <header className="topbar"><button className="brand" onClick={() => go(null)} aria-label="Elsewhere home"><span className="brand-icon"><Globe2 size={23} /></span>elsewhere<span className="brand-period">.</span></button><span className="topbar-note">A little curiosity. A wider world.</span>
      <div className="header-actions"><button className="nav-button" onClick={() => setShowTrails(true)} aria-label="Explore trails"><Compass size={16} /><span>Trails</span></button><button className="nav-button" onClick={() => setShowLibrary(true)} aria-label="Open your atlas"><Bookmark size={16} /><span>Your atlas</span>{library.saved.length > 0 && <i className="saved-indicator" />}</button><button className="search-trigger" aria-label="Search countries and questions" onClick={() => setSearch(true)}><Search size={17} /><span>Where next?</span><kbd>⌘ K</kbd></button></div>
    </header>
    <div className="globe-area"><GlobeView country={country} profile={profile} topic={topic} focus={focus} onSelect={select} onFocus={focusPlace} action={action} onStatus={setStatus} /></div>
    {status === 'loading' && <div className="globe-loading" role="status"><span />Bringing the world closer</div>}
    {!country && <section className="discovery" id="discovery-start"><div className="eyebrow"><span className="tiny-orbit" /> YOUR WORLD, A LITTLE CLOSER</div><h1>Every place<br />has a <em>story.</em></h1><p className="intro">Follow a little curiosity.<br />See where it takes you.</p>
      <div className="discovery-label">SOMEWHERE TO BEGIN <span>↘</span></div><div className="country-picks">{countries.slice(0, 4).map(item => <button key={item.id} onClick={() => go({ countryId: item.id })}><span className="pick-flag">{item.flag}</span><span><strong>{item.name}</strong><small>{item.kicker}</small></span><ArrowUpRight size={16} /></button>)}</div>
      <button className="surprise" onClick={surprise}><Shuffle size={16} />Take me somewhere <ArrowRight size={15} /></button>
      <button className="home-trail" onClick={() => setShowTrails(true)}><Compass size={16} /><span>Or follow a thread across the world</span><ArrowRight size={14} /></button>
      {lastRead && lastCountry && <button className="resume-story" onClick={() => go(lastRead)}><span>CONTINUE YOUR WANDER</span><strong>{lastCountry.flag} {getTopic(lastRead)?.title ?? lastCountry.name}</strong><ArrowUpRight size={14} /></button>}
    </section>}
    {country && destination && <>
      <nav className="map-breadcrumb" aria-label="Current place"><button onClick={() => go(null)}><Globe2 size={15} />World</button><ChevronRight size={13} /><button onClick={() => go({ countryId: country.id })}>{country.name}</button>{topic && <><ChevronRight size={12} /><span>{topic.category}</span></>}</nav>
      <div id="country-reading"><ExplorerPanel destination={destination} country={country} profile={profile} topic={topic} focus={focus} saved={isSaved} onNavigate={go} onFocus={focusPlace} onSave={() => { toggleSave(destination); announce(isSaved ? 'Removed from your atlas.' : persistenceFailed ? 'Saved for this session.' : 'Saved to your atlas.'); }} onShare={() => void share()} onSearch={() => setSearch(true)} compact={compact} onCompact={() => setCompactKey(compact ? null : key)} /></div>
      <div className={`map-caption ${focus ? 'has-focus' : ''}`}><span className="caption-line" /><div><strong>{focus ? 'A CLOSER LOOK' : topic ? 'GEOGRAPHY MAKES THE STORY' : 'EVERY PLACE IS CONNECTED'}</strong><p>{focus ? focus.name : topic ? topic.mapNote : `${country.region} · ${Math.abs(country.lat).toFixed(1)}° ${country.lat >= 0 ? 'N' : 'S'}, ${Math.abs(country.lng).toFixed(1)}° ${country.lng >= 0 ? 'E' : 'W'}`}</p>{focus && placeNotes[focus.name] && <small className="focus-context">{placeNotes[focus.name]}</small>}{focus && <button onClick={() => focusPlace(null)}>Back to the connection <RotateCcw size={12} /></button>}</div></div>
    </>}
    <div className="map-controls" aria-label="Globe controls"><button onClick={() => control('reset')} aria-label="Reset map view" title="Return to this view"><RotateCcw size={17} /></button><span /><button onClick={() => control('in')} aria-label="Zoom in" disabled={status !== 'ready'}><Plus size={18} /></button><button onClick={() => control('out')} aria-label="Zoom out" disabled={status !== 'ready'}><Minus size={18} /></button></div>
    <footer className="world-footer"><div><span className={`connection-dot ${status === 'ready' ? 'ready' : ''}`} />{status === 'ready' ? 'ONE PLANET. MANY PERSPECTIVES.' : status === 'error' ? 'THE STORIES ARE STILL HERE.' : 'BRINGING THE WORLD CLOSER...'}</div><span className="gesture-hint">Drag to explore <span>·</span> Scroll to zoom <span>·</span> Follow a question</span><button onClick={() => setAbout(true)}>About this atlas <ArrowUpRight size={12} /></button></footer>
    <div className={`atlas-notice ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice && <><Check size={15} />{notice}</>}</div>
    <AtlasSearch open={search} onOpenChange={setSearch} onNavigate={go} countryId={country?.id} />
    <TrailDrawer open={showTrails} onOpenChange={setShowTrails} onNavigate={go} />
    <LibraryDrawer open={showLibrary} onOpenChange={setShowLibrary} library={library} onNavigate={go} onToggleSave={toggleSave} persistenceFailed={persistenceFailed} />
    <Sheet open={about} onOpenChange={setAbout}><SheetContent className="about-sheet atlas-drawer"><Globe2 size={35} /><SheetTitle>Curiosity is enough.</SheetTitle><SheetDescription>You don’t need a study plan to understand the world. Just a place that catches your eye.</SheetDescription><p>Elsewhere is an atlas for the questions that come before the deep dive. Where is it? Why does it matter? How did it get this way?</p><p>Start with a minute. Follow a connection. The map is always home.</p><div className="about-rule" /><h3>Ten places. Thirty questions.</h3><p>Edited country stories, interactive geographic context, and three trails between ideas. Search also locates the countries and territories in our simplified map.</p><p>Questions search the stories already in this edition. There is no AI-generated advice or live news. Population figures are a dated 2024 reference.</p><p>Your atlas and recent explorations stay in this browser. No account is needed, and these choices are not sent to a server.</p><p className="credits">Earth imagery: NASA Blue Marble via three-globe. Boundaries: Natural Earth. Sources and further reading accompany the stories. Boundaries are simplified, omit some small places, and do not express a political position. Map routes are illustrative.</p></SheetContent></Sheet>
    <Dialog open={!!shareUrl} onOpenChange={open => { if (!open) setShareUrl(''); }}><DialogContent className="share-dialog"><Link2 size={24} /><DialogTitle>A little curiosity, shared.</DialogTitle><DialogDescription>Copy this link to return to this exact country, question, or trail.</DialogDescription><input aria-label="Share link" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} /><button onClick={() => setShareUrl('')}>Done <X size={14} /></button></DialogContent></Dialog>
  </main>;
}
