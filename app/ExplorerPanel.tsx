'use client';

import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, Compass, Link2, MapPin, Search, X } from 'lucide-react';
import type { Country, Place, Topic } from './data';
import { destinationKey, getCountry, getTopic, linkedCountry, nearbyCountries, placeNotes, relatedStories, topicDestination, trails, type Destination, type MapCountry } from './exploration';

type Props = {
  destination: Destination; country: MapCountry; profile: Country | null; topic: Topic | null;
  focus: Place | null; saved: boolean; onNavigate: (destination: Destination | null) => void;
  onFocus: (place: Place | null) => void; onSave: () => void; onShare: () => void;
  onSearch: () => void; compact: boolean; onCompact: () => void;
};

export function StoryLink({ destination, caption, onNavigate }: { destination: Destination; caption?: string; onNavigate: Props['onNavigate'] }) {
  const country = getCountry(destination.countryId);
  const topic = getTopic(destination);
  if (!country) return null;
  return <button className="story-link" onClick={() => onNavigate(destination)}>
    <span className="story-flag">{country.flag}</span>
    <span><small>{country.name}{topic ? ` · ${topic.category}` : ''}</small><strong>{topic?.title ?? country.kicker}</strong>{caption && <p>{caption}</p>}</span>
    <ArrowUpRight size={17} />
  </button>;
}

function MapConnections({ places, note, focus, onFocus, onNavigate, route }: {
  places: Place[]; note: string; focus: Place | null; onFocus: Props['onFocus']; onNavigate: Props['onNavigate']; route?: boolean;
}) {
  const related = focus ? linkedCountry(focus) : null;
  return <section className="map-connections" aria-label="Explore the geography">
    <div className="section-label"><MapPin size={14} /><span>SEE THE CONNECTION</span>{route && <span className="route-key">Illustrative route</span>}</div>
    <p>{note}</p>
    <div className="place-chips">{places.map(place => <button key={place.name} aria-pressed={focus?.name === place.name} onClick={() => onFocus(focus?.name === place.name ? null : place)}><span />{place.name}</button>)}</div>
    {focus ? <div className="place-detail" aria-live="polite"><strong>{focus.name}</strong><p>{placeNotes[focus.name] ?? `Locate ${focus.name} in the geographic context of this story.`}</p>
      <div>{related && <button onClick={() => onNavigate({ countryId: related.id })}>Explore {related.name} <ArrowRight size={13} /></button>}<button onClick={() => onFocus(null)}>Show the whole connection</button></div>
    </div> : <small className="map-instruction">Tap a place to find it on the globe.</small>}
  </section>;
}

export default function ExplorerPanel(props: Props) {
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
  return <aside className={`country-panel ${compact ? 'panel-compact' : ''}`} aria-label={`${country.name} explorer`}>
    <div className="panel-topline"><span className="desktop-mode"><span className="live-dot" />{topic ? 'A LITTLE DEEPER' : profile ? 'THE SHORT STORY' : 'ON THE MAP'}</span><button className="panel-mode" onClick={onCompact} aria-expanded={!compact} aria-label={compact ? 'Expand story' : 'Make more room for the map'}><span className="live-dot" />{topic ? 'A LITTLE DEEPER' : profile ? 'THE SHORT STORY' : 'ON THE MAP'}<span className="mobile-chevron">{compact ? '↑' : '↓'}</span></button>
      <div className="panel-tools"><button onClick={onSave} aria-label={saved ? 'Unsave this story' : 'Save this story'} aria-pressed={saved} title={saved ? 'Saved' : 'Save for later'}><Bookmark size={17} fill={saved ? 'currentColor' : 'none'} /></button><button onClick={onShare} aria-label="Share this view" title="Copy a link"><Link2 size={17} /></button><button onClick={() => onNavigate(null)} aria-label="Close country"><X size={18} /></button></div>
    </div>
    {compact && <button className="compact-story" onClick={onCompact}>{profile?.flag} {topic?.title ?? country.name}<span>Continue reading ↑</span></button>}
    <div className="panel-scroll" key={contentKey}>
      {trail && <div className="trail-progress"><div><Compass size={14} /><span>{trail.title}</span><button aria-label="Leave this trail" onClick={() => onNavigate({ countryId: destination.countryId, topicId: destination.topicId })}><X size={13} /></button></div><nav aria-label="Trail stops">{trail.stops.map((stop, index) => <button key={destinationKey(stop)} aria-current={index === stopIndex ? 'step' : undefined} title={getCountry(stop.countryId)?.name} onClick={() => onNavigate({ ...stop, trailId: trail.id })}><span>{index + 1}</span>{getCountry(stop.countryId)?.name}</button>)}</nav></div>}
      {topic && profile ? <>
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
        <section className="topics" id="curiosity-topics"><div className="topics-heading"><h4>Follow your curiosity</h4><span>GO A LITTLE DEEPER</span></div>{profile.topics.map((item, index) => <button key={item.title} onClick={() => onNavigate(topicDestination(profile, index))}><span><small>{item.category}</small>{item.title}</span><ArrowUpRight size={18} /></button>)}</section>
        <section className="related-stories"><div className="section-label">CONNECTED PLACES</div>{related.map(item => <StoryLink key={destinationKey(item)} destination={item} caption={item.connection} onNavigate={onNavigate} />)}</section>
      </> : <>
        <div className="country-region">{country.region}<span>· LOCATION GUIDE</span></div>
        <h2 ref={heading} tabIndex={-1} className="country-title">{country.name}</h2>
        <div className="map-only-icon"><Compass size={36} /></div><h3 className="country-kicker">A place to get your bearings.</h3>
        <p className="country-summary">You’re looking at {country.name} in {country.region}. Its full editorial story is still ahead of us.</p>
        <p className="location-note">The globe highlights its simplified outline. Explore a nearby country’s story while you’re here.</p>
        <section className="related-stories"><div className="section-label">STORIES NEAR HERE</div>{nearbyCountries(country).map(item => <StoryLink key={item.id} destination={{ countryId: item.id }} onNavigate={onNavigate} />)}</section>
        <p className="source-note">Location and regional names: Natural Earth. This simplified map includes countries and territories, and omits some small places. Boundaries are not an endorsement of territorial claims.</p>
      </>}
      {profile && <details className="small-details"><summary>{topic ? 'Sources & further reading' : 'The essentials & sources'}</summary>
        {!topic && <dl><div><dt>Language</dt><dd>{profile.language}</dd></div><div><dt>Currency</dt><dd>{profile.currency}</dd></div></dl>}
        <p>{topic && !topic.sources ? 'Country-level background sources for this editorial exploration. ' : ''}Population figures use a rounded 2024 reference. Map paths illustrate relationships, not exact routes.</p>
        {sources.map(source => <a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.name}<ArrowUpRight size={12} /></a>)}
      </details>}
    </div>
    <div className="panel-footer">{profile && !topic ? <button className="curiosity-jump" onClick={jump}><Compass size={16} /><span>Follow your curiosity</span><span>{profile.topics.length} questions <ArrowRight size={14} /></span></button> : <button className="curiosity-jump" onClick={onSearch}><Search size={15} /><span>Something else on your mind?</span><ArrowRight size={14} /></button>}</div>
  </aside>;
}
