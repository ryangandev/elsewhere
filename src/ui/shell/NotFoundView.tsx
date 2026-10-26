'use client';

import { ArrowRight } from 'lucide-react';
import { messages } from '@/i18n';
import { DestinationLink } from '../DestinationLink';
import { QuestionSearch } from '../search/QuestionSearch';
import '../home/home.css';

/**
 * Shown for any address that is not a country or a question. The globe stays behind it, and
 * the question input offers a way back into the atlas.
 */
export function NotFoundView() {
  const text = messages.notFound;
  return (
    <section className="home" id="home-start" aria-labelledby="home-title">
      <p className="home-eyebrow">
        <span className="tiny-orbit" /> {text.eyebrow}
      </p>
      <h1 className="home-title home-title-small" id="home-title">
        {text.title}
      </h1>
      <p className="home-intro">{text.description}</p>
      <div className="home-ask">
        <QuestionSearch variant="home" />
      </div>
      <nav className="home-links" aria-label={messages.home.moreLabel}>
        <DestinationLink href="/" className="home-link">
          <span className="home-link-title">{text.back}</span>
          <ArrowRight size={13} />
        </DestinationLink>
      </nav>
    </section>
  );
}
