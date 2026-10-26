'use client';

import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { CountryPageView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { DestinationLink } from '../DestinationLink';
import { MapConnections } from './MapConnections';
import { StoryLink } from './StoryLink';
import { useAutoFocus } from './use-auto-focus';

/** An edited country overview: the short story, quick facts, and the questions it leads with. */
export function CountryView({ view }: { view: CountryPageView }) {
  const heading = useAutoFocus<HTMLHeadingElement>();
  const text = messages.country;

  return (
    <>
      <div className="country-region">
        {view.country.region}
        <span>· {text.overview}</span>
      </div>
      <h2 ref={heading} tabIndex={-1} className="country-title">
        <span>{view.flag}</span>
        {view.title}
      </h2>
      {view.nativeName && <p className="native-name">{view.nativeName}</p>}
      <h3 className="country-kicker">{view.kicker}</h3>
      <p className="country-summary">{view.summary}</p>
      {view.quickFacts.length > 0 && (
        <div className="quick-facts">
          {view.quickFacts.map((fact) => (
            <div key={fact.label}>
              <span>
                {fact.asOf
                  ? format(text.factAsOf, { label: fact.label, asOf: fact.asOf })
                  : fact.label}
              </span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </div>
      )}
      <section className="matters">
        <h4>{text.whyItMatters}</h4>
        {view.whyItMatters.map((item, index) => (
          <div key={item.title}>
            <span>0{index + 1}</span>
            <p>
              <strong>{item.title}</strong>
              {item.text}
            </p>
          </div>
        ))}
      </section>
      <MapConnections map={view.map} />
      <section className="topics" id="curiosity-topics">
        <div className="topics-heading">
          <h4>{text.followCuriosity}</h4>
          <span>{text.goDeeper}</span>
        </div>
        {view.starters.map((link) => (
          <DestinationLink key={link.key} href={link.href}>
            <span>
              <small>{link.category}</small>
              {link.title}
            </span>
            <ArrowUpRight size={18} />
          </DestinationLink>
        ))}
      </section>
      {view.moreQuestions.length > 0 && (
        <details className="more-questions">
          <summary>
            {messages.story.moreQuestions} {view.title}
          </summary>
          {view.moreQuestions.map((link) => (
            <DestinationLink key={link.key} href={link.href}>
              {link.title}
              <ArrowRight size={14} />
            </DestinationLink>
          ))}
        </details>
      )}
      {view.connections.length > 0 && (
        <section className="related-stories">
          <div className="section-label">{text.connectedPlaces}</div>
          {view.connections.map((link) => (
            <StoryLink key={link.key} link={link} />
          ))}
        </section>
      )}
    </>
  );
}
