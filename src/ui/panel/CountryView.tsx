'use client';

import { ArrowUpRight } from 'lucide-react';
import type { Country } from '@/content/legacy/data';
import { relatedStories } from '@/domain/recommendations';
import { destinationKey } from '@/domain/destination';
import { messages } from '@/i18n';
import { DestinationLink } from '../DestinationLink';
import { MapConnections } from './MapConnections';
import { StoryLink } from './StoryLink';
import { useAutoFocus } from './use-auto-focus';

/** The capital of Indonesia is moving, so its figure is dated. */
const DATED_CAPITAL = 'IDN';

/** An edited country overview: the short story, quick facts, and its questions. */
export function CountryView({ profile }: { profile: Country }) {
  const heading = useAutoFocus<HTMLHeadingElement>();
  const text = messages.country;
  const related = relatedStories({ countryId: profile.id });

  return (
    <>
      <div className="country-region">
        {profile.region}
        <span>· {text.overview}</span>
      </div>
      <h2 ref={heading} tabIndex={-1} className="country-title">
        <span>{profile.flag}</span>
        {profile.name}
      </h2>
      <p className="native-name">{profile.native}</p>
      <h3 className="country-kicker">{profile.kicker}</h3>
      <p className="country-summary">{profile.summary}</p>
      <div className="quick-facts">
        <div>
          <span>{text.population}</span>
          <strong>{profile.population}</strong>
        </div>
        <div>
          <span>
            {text.capital}
            {profile.id === DATED_CAPITAL ? ' · 2024' : ''}
          </span>
          <strong>{profile.capital}</strong>
        </div>
      </div>
      <section className="matters">
        <h4>{text.whyItMatters}</h4>
        {profile.matters.map((item, index) => (
          <div key={item.title}>
            <span>0{index + 1}</span>
            <p>
              <strong>{item.title}</strong>
              {item.text}
            </p>
          </div>
        ))}
      </section>
      <MapConnections places={profile.neighbors} note={profile.geography} />
      <section className="topics" id="curiosity-topics">
        <div className="topics-heading">
          <h4>{text.followCuriosity}</h4>
          <span>{text.goDeeper}</span>
        </div>
        {profile.topics.map((topic) => (
          <DestinationLink
            key={topic.id}
            destination={{ countryId: profile.id, topicId: topic.id }}
          >
            <span>
              <small>{topic.category}</small>
              {topic.title}
            </span>
            <ArrowUpRight size={18} />
          </DestinationLink>
        ))}
      </section>
      <section className="related-stories">
        <div className="section-label">{text.connectedPlaces}</div>
        {related.map((item) => (
          <StoryLink key={destinationKey(item)} destination={item} caption={item.connection} />
        ))}
      </section>
    </>
  );
}
