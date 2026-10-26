'use client';

import type { HomeView as HomeViewModel } from '@/domain/view-models';
import { messages } from '@/i18n';
import { QuestionSearch } from '../search/QuestionSearch';
import { HomeLinks } from './HomeLinks';
import { SuggestedQuestions } from './SuggestedQuestions';
import './home.css';

/**
 * The home page over the globe: a question input first, a few starting questions for a reader
 * who arrived without one, and quieter ways back into a wander or onto a trail.
 */
export function HomeView({ view }: { view: HomeViewModel }) {
  const text = messages.home;
  return (
    <section className="home" id="home-start" aria-labelledby="home-title">
      <p className="home-eyebrow">
        <span className="tiny-orbit" /> {text.eyebrow}
      </p>
      <h1 className="home-title" id="home-title">
        {text.titleStart} <em>{text.titleEmphasis}</em>
      </h1>
      <p className="home-intro">{text.intro}</p>
      <div className="home-ask">
        <QuestionSearch variant="home" />
      </div>
      <SuggestedQuestions links={view.suggestions} />
      <HomeLinks />
    </section>
  );
}
