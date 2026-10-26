'use client';

import { ArrowRight, ArrowUpRight, Compass, Shuffle } from 'lucide-react';
import { linkFor } from '@/domain/atlas-index';
import type { HomeView } from '@/domain/view-models';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useAtlasIndex } from '../atlas/use-indexes';
import { DestinationLink } from '../DestinationLink';

/** The home view: a few places to begin, a random pick, and the way back to the last story. */
export function Discovery({ view }: { view: HomeView }) {
  const { go, library, openDialog } = useAtlas();
  const text = messages.home;

  // The last story's title comes from the atlas index, loaded only when there is one.
  const lastRead = library.recent[0];
  const index = useAtlasIndex(!!lastRead);
  const resume = lastRead && index.data ? linkFor(index.data, lastRead) : undefined;

  function surprise() {
    const seen = new Set(library.recent.map((item) => item.countryId));
    const unseen = view.surprise.filter((item) => !seen.has(item.countryId));
    const options = unseen.length ? unseen : view.surprise;
    go(options[Math.floor(Math.random() * options.length)].href);
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
        {view.picks.map((pick) => (
          <DestinationLink key={pick.key} href={pick.href}>
            <span className="pick-flag">{pick.flag}</span>
            <span>
              <strong>{pick.countryName}</strong>
              <small>{pick.title}</small>
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
      {resume && (
        <button className="resume-story" onClick={() => go(resume.href)}>
          <span>{text.resume}</span>
          <strong>
            {resume.flag} {resume.category ? resume.title : resume.countryName}
          </strong>
          <ArrowUpRight size={14} />
        </button>
      )}
    </section>
  );
}
