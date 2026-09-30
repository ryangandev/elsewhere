'use client';
import { useText } from './ui-text';

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, Compass, Link2, MapPin, Search, X } from 'lucide-react';
import { topicLabel, profileLabel, trailZh, placeName } from './localized-content';
import CountryOverview from './CountryOverview';
import { useLocale, countryName } from './locale';
import type { Country, Place, Topic } from './data';
import { destinationKey, getCountry, getTopic, linkedCountry, nearbyCountries, placeNotes, relatedStories, topicDestination, trails, type Destination, type MapCountry } from './exploration';

type Props = {
  destination: Destination; country: MapCountry; profile: Country | null; topic: Topic | null;
  focus: Place | null; saved: boolean; onNavigate: (destination: Destination | null) => void;
  onFocus: (place: Place | null) => void; onSave: () => void; onShare: () => void;
  onSearch: () => void; compact: boolean; onCompact: () => void;
};

export function StoryLink({ destination, caption, onNavigate }: { destination: Destination; caption?: string; onNavigate: Props['onNavigate'] }) {
  const { locale } = useLocale();
  const country = getCountry(destination.countryId);
  const topic = getTopic(destination);
  if (!country) return null;
  return <button className="story-link" onClick={() => onNavigate(destination)}>
    <span className="story-flag">{country.flag}</span>
    <span><small>{profileLabel(country, locale).name}{topic ? ` · ${locale === 'zh' ? '编辑问题' : topic.category}` : ''}</small><strong>{topic ? topicLabel(country, topic, locale) : profileLabel(country, locale).kicker}</strong>{caption && locale === 'en' && <p>{caption}</p>}</span>
    <ArrowUpRight size={17} />
  </button>;
}

function MapConnections({ places, note, focus, onFocus, onNavigate, route }: {
  places: Place[]; note: string; focus: Place | null; onFocus: Props['onFocus']; onNavigate: Props['onNavigate']; route?: boolean;
}) {
  const t = useText();
  const { locale } = useLocale();
  const related = focus ? linkedCountry(focus) : null;
  return <section className="map-connections" aria-label={t("Explore the geography")}>
    <div className="section-label"><MapPin size={14} /><span>{t("SEE THE CONNECTION")}</span>{route && <span className="route-key">{t("Illustrative route")}</span>}</div>
    <p>{note}</p>
    <div className="place-chips">{places.map(place => <button key={placeName(place.name, locale)} aria-pressed={focus?.name === place.name} onClick={() => onFocus(focus?.name === place.name ? null : place)}><span />{placeName(place.name, locale)}</button>)}</div>
    {focus ? <div className="place-detail" aria-live="polite"><strong>{placeName(focus.name, locale)}</strong><p>{locale === 'zh' ? `观察${placeName(focus.name, locale)}与当前国家的位置关系。地图标记和路线用于示意，并非精确路线。` : placeNotes[focus.name] ?? `Locate ${focus.name} in the geographic context of this story.`}</p>
      <div>{related && <button onClick={() => onNavigate({ countryId: related.id })}>{t("Explore")} {countryName(related.id, related.name, locale)} <ArrowRight size={13} /></button>}<button onClick={() => onFocus(null)}>{t("Show the whole connection")}</button></div>
    </div> : <small className="map-instruction">{t("Tap a place to find it on the globe.")}</small>}
  </section>;
}

export default function ExplorerPanel(props: Props) {
  const t = useText();
  const { locale } = useLocale();
  const { destination, country, profile, topic, focus, saved, onNavigate, onFocus, onSave, onShare, onSearch, compact, onCompact } = props;
  const heading = useRef<HTMLHeadingElement>(null);
  const trail = trails.find(item => item.id === destination.trailId);
  const stopIndex = trail?.stops.findIndex(stop => destinationKey(stop) === destinationKey(destination)) ?? -1;
  const nextStop = trail?.stops[stopIndex + 1];
  const related = relatedStories(destination).filter(item => !nextStop || destinationKey(item) !== destinationKey(nextStop));
  const contentKey = destinationKey(destination);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [contentKey]);
  const jump = () => document.getElementById('curiosity-topics')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  const sources = topic?.sources ?? profile?.sources ?? [];
  return <aside className={`country-panel ${compact ? 'panel-compact' : ''}`} aria-label={locale === 'zh' ? `${countryName(country.id, country.name, locale)}概览` : `${country.name} explorer`}>
    <div className="panel-topline"><span className="desktop-mode"><span className="live-dot" />{topic ? t("A LITTLE DEEPER") : profile ? t("THE SHORT STORY") : t("ON THE MAP")}</span><button className="panel-mode" onClick={onCompact} aria-expanded={!compact} aria-label={compact ? t("Expand story") : t("Make more room for the map")}><span className="live-dot" />{topic ? t("A LITTLE DEEPER") : profile ? t("THE SHORT STORY") : t("ON THE MAP")}<span className="mobile-chevron">{compact ? '↑' : '↓'}</span></button>
      <div className="panel-tools"><button onClick={onSave} aria-label={saved ? t("Unsave this story") : t("Save this story")} aria-pressed={saved} title={saved ? t("Saved") : t("Save for later")}><Bookmark size={17} fill={saved ? 'currentColor' : 'none'} /></button><button onClick={onShare} aria-label={t("Share this view")} title={t("Copy a link")}><Link2 size={17} /></button><button onClick={() => onNavigate(null)} aria-label={t("Close country")}><X size={18} /></button></div>
    </div>
    {compact && <button className="compact-story" onClick={onCompact}>{profile?.flag} {locale === 'zh' ? countryName(country.id, country.name, locale) : topic?.title ?? country.name}<span>{t("Continue reading ↑")}</span></button>}
    <div className="panel-scroll" key={contentKey}>
      {trail && <div className="trail-progress"><div><Compass size={14} /><span>{locale === 'zh' ? trailZh[trail.id].title : trail.title}</span><button aria-label={t("Leave this trail")} onClick={() => onNavigate({ countryId: destination.countryId, topicId: destination.topicId })}><X size={13} /></button></div><nav aria-label={t("Trail stops")}>{trail.stops.map((stop, index) => <button key={destinationKey(stop)} aria-current={index === stopIndex ? 'step' : undefined} title={countryName(stop.countryId, getCountry(stop.countryId)?.name ?? '', locale)} onClick={() => onNavigate({ ...stop, trailId: trail.id })}><span>{index + 1}</span>{countryName(stop.countryId, getCountry(stop.countryId)?.name ?? '', locale)}</button>)}</nav></div>}
      {locale === 'zh' || !profile ? <><CountryOverview country={country} profile={profile} topic={topic} onNavigate={onNavigate} />{profile && <MapConnections places={topic?.places ?? profile.neighbors} note={locale === 'zh' ? '在地图上观察相关位置，点击名称可聚焦。' : profile.geography} focus={focus} onFocus={onFocus} onNavigate={onNavigate} route={!!topic?.route} />}{nextStop && <section className="next-stop"><div className="section-label">{locale === 'zh' ? '路线下一站' : 'NEXT ON YOUR TRAIL'}</div><StoryLink destination={{ ...nextStop, trailId: trail!.id }} onNavigate={onNavigate} /></section>}<section className="related-stories"><div className="section-label">{locale === 'zh' ? profile ? '连接其他地方' : '附近的编辑故事' : 'STORIES NEAR HERE'}</div>{(profile ? related : nearbyCountries(country).map(item => ({ countryId: item.id }))).map(item => <StoryLink key={destinationKey(item)} destination={item} onNavigate={onNavigate} />)}</section></> : topic && profile ? <>
        <button className="back-link" onClick={() => onNavigate({ countryId: profile.id })}><ArrowLeft size={14} />{profile.name} overview</button>
        <div className="topic-meta">{topic.category}<span>· A SHORT EXPLORATION</span></div>
        <h2 ref={heading} tabIndex={-1} className="topic-heading">{topic.title}</h2>
        <p className="topic-intro">{topic.intro}</p>
        <MapConnections places={topic.places ?? profile.neighbors} note={topic.mapNote} focus={focus} onFocus={onFocus} onNavigate={onNavigate} route={!!topic.route} />
        <div className="topic-sections">{topic.sections.map((section, index) => <section key={section.title}><span className="section-number">0{index + 1}</span><div><h3>{section.title}</h3><p>{section.text}</p></div></section>)}</div>
        <blockquote>{topic.takeaway}</blockquote>
        {trail && <section className="next-stop">{nextStop ? <><div className="section-label">NEXT ON YOUR TRAIL</div><StoryLink destination={{ ...nextStop, trailId: trail.id }} caption={nextStop.connection} onNavigate={onNavigate} /></> : <><div className="section-label"><Check size={14} /> THE LAST STOP</div><h3>{trail.stops.length} places. One shared thread.</h3><p>The world is full of other ways in.</p><button onClick={() => onNavigate(null)}>Back to the globe <ArrowRight size={15} /></button></>}</section>}
        <section className="related-stories"><div className="section-label">ONE QUESTION LEADS TO ANOTHER</div>{related.map(item => <StoryLink key={destinationKey(item)} destination={item} caption={item.connection} onNavigate={onNavigate} />)}</section>
        <details className="more-questions"><summary>More questions about {profile.name}</summary>{profile.topics.map((item, index) => item !== topic && <button key={item.title} onClick={() => onNavigate(topicDestination(profile, index))}>{item.title}<ArrowRight size={14} /></button>)}</details>
      </> : profile ? <>
        <div className="country-region">{profile.region}<span>· 60 SECOND OVERVIEW</span></div>
        <h2 ref={heading} tabIndex={-1} className="country-title"><span>{profile.flag}</span>{profile.name}</h2>
        <p className="native-name">{profile.native}</p>
        <h3 className="country-kicker">{profile.kicker}</h3><p className="country-summary">{profile.summary}</p>
        <div className="quick-facts"><div><span>POPULATION · 2024</span><strong>{profile.population}</strong></div><div><span>CAPITAL{profile.id === 'IDN' ? ' · 2024' : ''}</span><strong>{profile.capital}</strong></div></div>
        <section className="matters"><h4>Why it matters</h4>{profile.matters.map((item, index) => <div key={item.title}><span>0{index + 1}</span><p><strong>{item.title}</strong>{item.text}</p></div>)}</section>
        <MapConnections places={profile.neighbors} note={profile.geography} focus={focus} onFocus={onFocus} onNavigate={onNavigate} />
        <section className="topics" id="curiosity-topics"><div className="topics-heading"><h4>{t("Follow your curiosity")}</h4><span>{t("GO A LITTLE DEEPER")}</span></div>{profile.topics.map((item, index) => <button key={item.title} onClick={() => onNavigate(topicDestination(profile, index))}><span><small>{item.category}</small>{item.title}</span><ArrowUpRight size={18} /></button>)}</section>
        <section className="related-stories"><div className="section-label">CONNECTED PLACES</div>{related.map(item => <StoryLink key={destinationKey(item)} destination={item} caption={item.connection} onNavigate={onNavigate} />)}</section>
      </> : null}
      {profile && locale === 'en' && <details className="small-details"><summary>{topic ? t("Sources & further reading") : t("The essentials & sources")}</summary>
        {!topic && <dl><div><dt>{t("Language")}</dt><dd>{profile.language}</dd></div><div><dt>{t("Currency")}</dt><dd>{profile.currency}</dd></div></dl>}
        <p>{topic && !topic.sources ? 'Country-level background sources for this editorial exploration. ' : ''}{t("Population figures use a rounded 2024 reference. Map paths illustrate relationships, not exact routes.")}</p>
        {sources.map(source => <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.name}<ArrowUpRight size={12} /></a>)}
      </details>}
    </div>
    <div className="panel-footer">{profile && !topic ? <button className="curiosity-jump" onClick={jump}><Compass size={16} /><span>{t("Follow your curiosity")}</span><span>{profile.topics.length} {t("questions")}<ArrowRight size={14} /></span></button> : <button className="curiosity-jump" onClick={onSearch}><Search size={15} /><span>{t("Something else on your mind?")}</span><ArrowRight size={14} /></button>}</div>
  </aside>;
}
