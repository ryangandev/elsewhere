'use client';

import type { AskOutcome } from '@/domain/ask';
import { messages } from '@/i18n';
import { ResultSection } from './ResultGroups';

type Props = { outcome: Extract<AskOutcome, { kind: 'unanswered' }> };

/**
 * What the atlas says when no reviewed question answers the query: no invented answer, only
 * an honest note and the closest real stories. A Stage 2 live answer provider would take over
 * here (src/domain/live-answers.ts).
 */
export function UnansweredResults({ outcome }: Props) {
  const text = messages.search;
  return (
    <>
      <div className="unanswered" role="status">
        <strong>{outcome.question ? text.unansweredTitle : text.noMatchTitle}</strong>
        <p>{outcome.closest.length ? text.unansweredClosest : text.unansweredNothingClose}</p>
      </div>
      <ResultSection heading={text.groupClosest} results={outcome.closest} />
      <ResultSection heading={text.groupNamed} results={outcome.countries} />
      <ResultSection heading={text.groupSuggested} results={outcome.suggestions} />
    </>
  );
}
