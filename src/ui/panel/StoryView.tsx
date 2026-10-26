'use client';

import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import type { Country, Topic } from '@/content/legacy/data';
import { destinationKey } from '@/domain/destination';
import { relatedStories } from '@/domain/recommendations';
import { stopDestination, type Trail, type TrailStop } from '@/domain/trails';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { DestinationLink } from '../DestinationLink';
import { MapConnections } from './MapConnections';
import { StoryLink } from './StoryLink';
import { useAutoFocus } from './use-auto-focus';

type Props = {
  profile: Country;
  topic: Topic;
  trail?: Trail;
  nextStop?: TrailStop;
};

/** One answered question: the short exploration, its map connections, and where to go next. */
export function StoryView({ profile, topic, trail, nextStop }: Props) {
  const { go } = useAtlas();
  const heading = useAutoFocus<HTMLHeadingElement>();
  const text = messages.story;
  const related = relatedStories({ countryId: profile.id, topicId: topic.id }).filter(
    (item) => !nextStop || destinationKey(item) !== destinationKey(nextStop),
  );

  return (
    <>
      <button className="back-link" onClick={() => go({ countryId: profile.id })}>
        <ArrowLeft size={14} />
        {profile.name} {text.overview}
      </button>
      <div className="topic-meta">
        {topic.category}
        <span>· {text.shortExploration}</span>
      </div>
      <h2 ref={heading} tabIndex={-1} className="topic-heading">
        {topic.title}
      </h2>
      <p className="topic-intro">{topic.intro}</p>
      <MapConnections
        places={topic.places ?? profile.neighbors}
        note={topic.mapNote}
        hasRoute={!!topic.route}
      />
      <div className="topic-sections">
        {topic.sections.map((section, index) => (
          <section key={section.title}>
            <span className="section-number">0{index + 1}</span>
            <div>
              <h3>{section.title}</h3>
              <p>{section.text}</p>
            </div>
          </section>
        ))}
      </div>
      <blockquote>{topic.takeaway}</blockquote>
      {trail && (
        <section className="next-stop">
          {nextStop ? (
            <>
              <div className="section-label">{text.nextOnTrail}</div>
              <StoryLink
                destination={stopDestination(trail, nextStop)}
                caption={nextStop.connection}
              />
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
      <section className="related-stories">
        <div className="section-label">{text.leadsToAnother}</div>
        {related.map((item) => (
          <StoryLink key={destinationKey(item)} destination={item} caption={item.connection} />
        ))}
      </section>
      <details className="more-questions">
        <summary>
          {text.moreQuestions} {profile.name}
        </summary>
        {profile.topics
          .filter((item) => item.id !== topic.id)
          .map((item) => (
            <DestinationLink
              key={item.id}
              destination={{ countryId: profile.id, topicId: item.id }}
            >
              {item.title}
              <ArrowRight size={14} />
            </DestinationLink>
          ))}
      </details>
    </>
  );
}
