'use client';

import { ArrowRight, ArrowUpRight, Compass, Shuffle } from 'lucide-react';
import { countries } from '@/content/legacy/data';
import { getCountry } from '@/domain/catalog';
import { getTopic } from '@/domain/destination';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { DestinationLink } from '../DestinationLink';

const STARTER_COUNT = 4;

/** The home view: a few places to begin, a random pick, and the way back to the last story. */
export function Discovery() {
  const { go, library, openDialog } = useAtlas();
  const text = messages.home;

  const lastRead = library.recent[0];
  const lastCountry = getCountry(lastRead?.countryId);
  const lastTopic = lastRead ? getTopic(lastRead) : undefined;

  function surprise() {
    const seen = new Set(library.recent.map((item) => item.countryId));
    const unseen = countries.filter((item) => !seen.has(item.id));
    const options = unseen.length ? unseen : countries;
    go({ countryId: options[Math.floor(Math.random() * options.length)].id });
  }

  return (
    <section className="discovery" id="discovery-start">
      <div className="eyebrow">
        <span className="tiny-orbit" /> {text.eyebrow}
      </div>
      <h1>
        {text.titleStart}
        <br /> {text.titleMiddle} <em>{text.titleEmphasis}</em>
      </h1>
      <p className="intro">
        {text.introFirst}
        <br />
        {text.introSecond}
      </p>
      <div className="discovery-label">
        {text.begin}
        <span>↘</span>
      </div>
      <div className="country-picks">
        {countries.slice(0, STARTER_COUNT).map((item) => (
          <DestinationLink key={item.id} destination={{ countryId: item.id }}>
            <span className="pick-flag">{item.flag}</span>
            <span>
              <strong>{item.name}</strong>
              <small>{item.kicker}</small>
            </span>
            <ArrowUpRight size={16} />
          </DestinationLink>
        ))}
      </div>
      <button className="surprise" onClick={surprise}>
        <Shuffle size={16} />
        {text.surprise}
        <ArrowRight size={15} />
      </button>
      <button className="home-trail" onClick={() => openDialog('trails')}>
        <Compass size={16} />
        <span>{text.followThread}</span>
        <ArrowRight size={14} />
      </button>
      {lastRead && lastCountry && (
        <button className="resume-story" onClick={() => go(lastRead)}>
          <span>{text.resume}</span>
          <strong>
            {lastCountry.flag} {lastTopic ? lastTopic.title : lastCountry.name}
          </strong>
          <ArrowUpRight size={14} />
        </button>
      )}
    </section>
  );
}
