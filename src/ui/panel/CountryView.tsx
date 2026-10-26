'use client';

import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { CountryPageView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { DestinationLink } from '../DestinationLink';
import { MapConnections } from './MapConnections';
import { ProvenanceNote } from './ProvenanceNote';
import { SourcesDetails } from './SourcesDetails';
import { useAutoFocus } from './use-auto-focus';

/**
 * An edited country overview, kept brief: the short story, then its starter questions as the
 * obvious next step, quick facts and the map, and the rest behind disclosures.
 */
export function CountryView({ view }: { view: CountryPageView }) {
  const heading = useAutoFocus<HTMLHeadingElement>();
  const text = messages.country;

  return (
    <>
      <div className="country-region">
        {view.country.region}
        <span>{text.overview}</span>
      </div>
      <h2 ref={heading} tabIndex={-1} className="country-title">
        <span>{view.flag}</span>
        {view.title}
      </h2>
      {view.nativeName && <p className="native-name">{view.nativeName}</p>}
      <h3 className="country-kicker">{view.kicker}</h3>
      <p className="country-summary">{view.summary}</p>
      <section className="topics" aria-labelledby="starter-questions">
        <h4 className="section-label" id="starter-questions">
          {text.startWith}
        </h4>
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
          <summary>{format(text.moreQuestions, { country: view.title })}</summary>
          {view.moreQuestions.map((link) => (
            <DestinationLink key={link.key} href={link.href}>
              {link.title}
              <ArrowRight size={14} />
            </DestinationLink>
          ))}
        </details>
      )}
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
      <MapConnections map={view.map} />
      <details className="small-details matters">
        <summary>{format(text.whyItMatters, { country: view.title })}</summary>
        {view.whyItMatters.map((item, index) => (
          <div key={item.title}>
            <span>0{index + 1}</span>
            <p>
              <strong>{item.title}</strong>
              {item.text}
            </p>
          </div>
        ))}
      </details>
      <SourcesDetails sources={view.sources} question={false} />
      <ProvenanceNote provenance={view.provenance} />
    </>
  );
}
