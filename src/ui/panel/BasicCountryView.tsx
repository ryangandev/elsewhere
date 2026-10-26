'use client';

import { ArrowUpRight, Compass } from 'lucide-react';
import { countryBasics, nearbyCountries, type MapCountry } from '@/domain/catalog';
import { format, messages } from '@/i18n';
import { StoryLink } from './StoryLink';
import { useAutoFocus } from './use-auto-focus';

const NATURAL_EARTH_URL =
  'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/';

function anchor(country: MapCountry): string {
  const lat = `${Math.abs(country.lat).toFixed(1)}°${country.lat >= 0 ? 'N' : 'S'}`;
  const lng = `${Math.abs(country.lng).toFixed(1)}°${country.lng >= 0 ? 'E' : 'W'}`;
  return `${lat}, ${lng}`;
}

/** Sourced geographic basics for a country or territory without an edited story yet. */
export function BasicCountryView({ country }: { country: MapCountry }) {
  const heading = useAutoFocus<HTMLHeadingElement>();
  const text = messages.basic;
  const facts = countryBasics[country.id];
  const values = { name: country.name, region: country.region };

  const guides = [
    { title: format(text.guideWhereTitle, values), body: format(text.guideWhere, values) },
    { title: text.guideLifeTitle, body: text.guideLife },
    { title: text.guideVerifyTitle, body: text.guideVerify },
  ];

  return (
    <>
      <div className="country-region">
        {country.region}
        <span>· {text.badge}</span>
      </div>
      <h2 ref={heading} tabIndex={-1} className="country-title">
        {country.name}
      </h2>
      <p className="country-summary">{format(text.summary, values)}</p>
      <div className="quick-facts">
        <div>
          <span>{text.region}</span>
          <strong>{country.region}</strong>
        </div>
        <div>
          <span>{text.anchor}</span>
          <strong>{anchor(country)}</strong>
        </div>
      </div>
      {facts?.population != null && facts.populationYear && (
        <div className="reference-population">
          <span>
            {text.population} · {facts.populationYear}
          </span>
          <strong>{new Intl.NumberFormat('en').format(facts.population)}</strong>
          <small>{text.populationNote}</small>
        </div>
      )}
      <p className="location-note">{text.notYetEdited}</p>
      <section className="learning-prompts">
        <div className="section-label">
          <Compass size={14} />
          {text.keepLearning}
        </div>
        {guides.map((guide) => (
          <details className="small-details" key={guide.title}>
            <summary>{guide.title}</summary>
            <p>{guide.body}</p>
          </details>
        ))}
      </section>
      <details className="small-details">
        <summary>{text.sourcesSummary}</summary>
        <p>{text.sourcesNote}</p>
        <a href={NATURAL_EARTH_URL} target="_blank" rel="noreferrer">
          Natural Earth · Admin 0 <ArrowUpRight size={12} />
        </a>
      </details>
      <section className="related-stories">
        <div className="section-label">{text.nearby}</div>
        {nearbyCountries(country).map((item) => (
          <StoryLink key={item.id} destination={{ countryId: item.id }} />
        ))}
      </section>
    </>
  );
}
