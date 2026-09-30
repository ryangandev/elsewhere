'use client';
import { useText } from './ui-text';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Bookmark, Check, ChevronRight, Compass, Globe2, Link2, Minus, Plus, RotateCcw, Search, Shuffle, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import GlobeView, { type GlobeAction, type GlobeStatus } from './Globe';
import ExplorerPanel from './ExplorerPanel';
import { AtlasSearch, LibraryDrawer, TrailDrawer } from './AtlasDialogs';
import { countries, type Place } from './data';
import { destinationKey, destinationUrl, directory, getCountry, getTopic, placeNotes, type Destination } from './exploration';
import { profileLabel, topicLabel, placeName } from './localized-content';
import { LocaleProvider, useLocale, countryName, regionName } from './locale';
import { useAtlas } from './use-atlas';

export default function Home() { return <LocaleProvider><AtlasHome /></LocaleProvider>; }
function AtlasHome() {
  const t = useText();
  const { locale, setLocale } = useLocale();
  const { destination, navigate, library, toggleSave, isSaved, persistenceFailed } = useAtlas();
  const [search, setSearch] = useState(false);
  const [about, setAbout] = useState(false);
  const [showTrails, setShowTrails] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showPerformance, setShowPerformance] = useState(false);
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
    try { await navigator.clipboard.writeText(url); announce(t("Link copied. A little curiosity, ready to share.")); }
    catch { setShareUrl(url); }
  }
  function surprise() {
    const unseen = countries.filter(item => item.id !== country?.id && !library.recent.some(recent => recent.countryId === item.id));
    const options = unseen.length ? unseen : countries.filter(item => item.id !== country?.id);
    go({ countryId: options[Math.floor(Math.random() * options.length)].id });
  }

  return <main className={`world-app ${country ? 'has-selection' : ''} ${compact ? 'map-expanded' : ''}`}>
    <a className="skip-link" href={country ? '#country-reading' : '#discovery-start'}>{t("Skip to stories")}</a>
    <header className="topbar"><button className="brand" onClick={() => go(null)} aria-label={t("Elsewhere home")}><span className="brand-icon"><Globe2 size={23} /></span>elsewhere<span className="brand-period">.</span></button><span className="topbar-note">{t("A little curiosity. A wider world.")}</span>
      <div className="header-actions"><button className="language-toggle nav-button" onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')} aria-label={locale === 'zh' ? 'Switch to English' : '切换到简体中文'}>{locale === 'zh' ? 'English' : '简体中文'}</button><button className="nav-button" onClick={() => setShowTrails(true)} aria-label={t("Explore trails")}><Compass size={16} /><span>{t("Trails")}</span></button><button className="nav-button" onClick={() => setShowLibrary(true)} aria-label={t("Open your atlas")}><Bookmark size={16} /><span>{t("Your atlas")}</span>{library.saved.length > 0 && <i className="saved-indicator" />}</button><button className="search-trigger" aria-label={t("Search countries and questions")} onClick={() => setSearch(true)}><Search size={17} /><span>{t("Where next?")}</span><kbd>⌘ K</kbd></button></div>
    </header>
    <div className="globe-area"><GlobeView country={country} profile={profile} topic={topic} focus={focus} onSelect={select} onFocus={focusPlace} action={action} onStatus={setStatus} performanceEnabled={showPerformance} onClosePerformance={() => setShowPerformance(false)} /></div>
    {status === 'loading' && <div className="globe-loading" role="status"><span />{t("Bringing the world closer")}</div>}
    {!country && <section className="discovery" id="discovery-start"><div className="eyebrow"><span className="tiny-orbit" /> {t("YOUR WORLD, A LITTLE CLOSER")}</div><h1>{t("Every place")}<br /> {t("has a")}{locale === 'en' ? ' ' : ''}<em>{t("story.")}</em></h1><p className="intro">{t("Follow a little curiosity.")}<br />{t("See where it takes you.")}</p>
      <div className="discovery-label">{t("SOMEWHERE TO BEGIN")}<span>↘</span></div><div className="country-picks">{countries.slice(0, 4).map(item => <button key={item.id} onClick={() => go({ countryId: item.id })}><span className="pick-flag">{item.flag}</span><span><strong>{countryName(item.id, item.name, locale)}</strong><small>{profileLabel(item, locale).kicker}</small></span><ArrowUpRight size={16} /></button>)}</div>
      <button className="surprise" onClick={surprise}><Shuffle size={16} />{t("Take me somewhere")}<ArrowRight size={15} /></button>
      <button className="home-trail" onClick={() => setShowTrails(true)}><Compass size={16} /><span>{t("Or follow a thread across the world")}</span><ArrowRight size={14} /></button>
      {lastRead && lastCountry && <button className="resume-story" onClick={() => go(lastRead)}><span>{t("CONTINUE YOUR WANDER")}</span><strong>{lastCountry.flag} {getTopic(lastRead) ? topicLabel(lastCountry, getTopic(lastRead)!, locale) : countryName(lastCountry.id, lastCountry.name, locale)}</strong><ArrowUpRight size={14} /></button>}
    </section>}
    {country && destination && <>
      <nav className="map-breadcrumb" aria-label={t("Current place")}><button onClick={() => go(null)}><Globe2 size={15} />{t("World")}</button><ChevronRight size={13} /><button onClick={() => go({ countryId: country.id })}>{countryName(country.id, country.name, locale)}</button>{topic && <><ChevronRight size={12} /><span>{locale === 'zh' ? '编辑问题' : topic.category}</span></>}</nav>
      <div id="country-reading"><ExplorerPanel destination={destination} country={country} profile={profile} topic={topic} focus={focus} saved={isSaved} onNavigate={go} onFocus={focusPlace} onSave={() => { toggleSave(destination); announce(isSaved ? t("Removed from your atlas.") : persistenceFailed ? t("Saved for this session.") : t("Saved to your atlas.")); }} onShare={() => void share()} onSearch={() => setSearch(true)} compact={compact} onCompact={() => setCompactKey(compact ? null : key)} /></div>
      <div className={`map-caption ${focus ? 'has-focus' : ''}`}><span className="caption-line" /><div><strong>{focus ? t("A CLOSER LOOK") : topic ? t("GEOGRAPHY MAKES THE STORY") : t("EVERY PLACE IS CONNECTED")}</strong><p>{focus ? placeName(focus.name, locale) : topic ? locale === 'zh' ? '地图路线用于展示联系，仅为示意。' : topic.mapNote : `${regionName(country.region, locale)} · ${Math.abs(country.lat).toFixed(1)}° ${country.lat >= 0 ? 'N' : 'S'}, ${Math.abs(country.lng).toFixed(1)}° ${country.lng >= 0 ? 'E' : 'W'}`}</p>{locale === 'en' && focus && placeNotes[focus.name] && <small className="focus-context">{placeNotes[focus.name]}</small>}{focus && <button onClick={() => focusPlace(null)}>{t("Back to the connection")}<RotateCcw size={12} /></button>}</div></div>
    </>}
    <div className="map-controls" aria-label={t("Globe controls")}><button onClick={() => control('reset')} aria-label={t("Reset map view")} title={t("Return to this view")}><RotateCcw size={17} /></button><span /><button onClick={() => control('in')} aria-label={t("Zoom in")} disabled={status !== 'ready'}><Plus size={18} /></button><button onClick={() => control('out')} aria-label={t("Zoom out")} disabled={status !== 'ready'}><Minus size={18} /></button><span /><button className="performance-toggle" onClick={() => setShowPerformance(value => !value)} aria-label={t("Show frame rate checker")} aria-pressed={showPerformance} disabled={status !== 'ready'} title={t("Check globe frame rate")}>FPS</button></div>
    <footer className="world-footer"><div><span className={`connection-dot ${status === 'ready' ? 'ready' : ''}`} />{status === 'ready' ? t("ONE PLANET. MANY PERSPECTIVES.") : status === 'error' ? t("THE STORIES ARE STILL HERE.") : t("BRINGING THE WORLD CLOSER...")}</div><span className="gesture-hint">{t("Drag to explore")}<span>·</span> {t("Scroll to zoom")}<span>·</span> {t("Follow a question")}</span><button onClick={() => setAbout(true)}>{t("About this atlas")}<ArrowUpRight size={12} /></button></footer>
    <div className={`atlas-notice ${notice ? 'visible' : ''}`} role="status" aria-live="polite">{notice && <><Check size={15} />{notice}</>}</div>
    <AtlasSearch open={search} onOpenChange={setSearch} onNavigate={go} countryId={country?.id} />
    <TrailDrawer open={showTrails} onOpenChange={setShowTrails} onNavigate={go} />
    <LibraryDrawer open={showLibrary} onOpenChange={setShowLibrary} library={library} onNavigate={go} onToggleSave={toggleSave} persistenceFailed={persistenceFailed} />
    <Sheet open={about} onOpenChange={setAbout}><SheetContent className="about-sheet atlas-drawer"><Globe2 size={35} /><SheetTitle>{t("Curiosity is enough.")}</SheetTitle><SheetDescription>{t("You don’t need a study plan to understand the world. Just a place that catches your eye.")}</SheetDescription><p>{t("Elsewhere is an atlas for the questions that come before the deep dive. Where is it? Why does it matter? How did it get this way?")}</p><p>{t("Start with a minute. Follow a connection. The map is always home.")}</p><div className="about-rule" /><h3>{t("A whole map. Ten edited profiles.")}</h3><p>{t("All 258 country and territory units have sourced geographic basics and static learning guides. Ten edited profiles, thirty questions, and three trails offer a deeper starting point.")}</p><p>{t("Questions search the stories already in this edition. There is no AI-generated advice or live news. Population figures are a dated 2024 reference.")}</p><p>{t("Your atlas and recent explorations stay in this browser. No account is needed, and these choices are not sent to a server.")}</p><p className="credits">{t("Vector boundaries: Natural Earth. Terrain shading: NASA Earth Observatory / GEBCO. Sources and further reading accompany the stories. Boundaries are generalized for exploration and do not express a political position. Map routes are illustrative.")}</p></SheetContent></Sheet>
    <Dialog open={!!shareUrl} onOpenChange={open => { if (!open) setShareUrl(''); }}><DialogContent className="share-dialog"><Link2 size={24} /><DialogTitle>{t("A little curiosity, shared.")}</DialogTitle><DialogDescription>{t("Copy this link to return to this exact country, question, or trail.")}</DialogDescription><input aria-label={t("Share link")} readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} /><button onClick={() => setShareUrl('')}>{t("Done")}<X size={14} /></button></DialogContent></Dialog>
  </main>;
}
