'use client';

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { StoryPageView, TrailView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { MapConnections } from './MapConnections';
import { NextQuestions } from './NextQuestions';
import { ProvenanceNote } from './ProvenanceNote';
import { SectionSources, SourcesDetails } from './SourcesDetails';
import { StoryLink } from './StoryLink';
import { useAutoFocus } from './use-auto-focus';

type Props = { view: StoryPageView; trail?: TrailView };

/**
 * One answered question: the short answer, its map connections and sources, and then the way
 * onward: the trail's next stop when on a trail, and the next questions.
 */
export function StoryView({ view, trail }: Props) {
  const { go } = useAtlas();
  const heading = useAutoFocus<HTMLHeadingElement>();
  const text = messages.story;

  const key = view.shell.destination.key;
  const stopIndex = trail ? trail.stops.findIndex((stop) => stop.key === key) : -1;
  const nextStop = trail?.stops[stopIndex + 1];
  // The trail's next stop is offered on its own, so it is not repeated as a next question.
  const next = view.next.filter((link) => link.key !== nextStop?.key);

  return (
    <>
      <button className="back-link" onClick={() => go(view.country.href)}>
        <ArrowLeft size={14} />
        {view.country.name} {text.overview}
      </button>
      <div className="topic-meta">
        {view.category}
        <span>· {text.shortExploration}</span>
      </div>
      <h2 ref={heading} tabIndex={-1} className="topic-heading">
        {view.title}
      </h2>
      <p className="topic-intro">{view.summary}</p>
      <MapConnections map={view.map} />
      <div className="topic-sections">
        {view.sections.map((section, index) => (
          <section key={section.title}>
            <span className="section-number">0{index + 1}</span>
            <div>
              <h3>{section.title}</h3>
              <p>{section.text}</p>
              <SectionSources sources={section.sources} />
            </div>
          </section>
        ))}
      </div>
      <blockquote>{view.takeaway}</blockquote>
      <SourcesDetails sources={view.sources} question />
      <ProvenanceNote provenance={view.provenance} />
      {trail && (
        <section className="next-stop">
          {nextStop ? (
            <>
              <div className="section-label">{text.nextOnTrail}</div>
              <StoryLink link={nextStop} />
            </>
          ) : (
            <>
              <div className="section-label">
                <Check size={14} /> {text.lastStop}
              </div>
              <h3>{format(text.trailSummary, { count: trail.stops.length })}</h3>
              <p>{text.trailClosing}</p>
              <button onClick={() => go(null)}>
                {text.backToGlobe} <ArrowRight size={15} />
              </button>
            </>
          )}
        </section>
      )}
      <NextQuestions next={next} />
    </>
  );
}
