'use client';

import { ArrowUpRight } from 'lucide-react';
import type { NextQuestionView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { DestinationLink } from '../DestinationLink';

/**
 * The way onward at the end of an answer: at most three questions, each saying whether it goes
 * deeper into the same place or follows a connection elsewhere, and why.
 */
export function NextQuestions({ next }: { next: NextQuestionView[] }) {
  const text = messages.story;
  if (!next.length) return null;

  return (
    <section className="next-questions" aria-labelledby="next-questions">
      <h3 className="section-label" id="next-questions">
        {text.nextQuestions}
      </h3>
      {next.map((link) => (
        <DestinationLink
          key={link.key}
          href={link.href}
          className={`next-question next-question-${link.relation}`}
        >
          <span className="next-question-relation">
            {link.relation === 'elsewhere' && <span aria-hidden>{link.flag}</span>}
            {format(link.relation === 'deeper' ? text.deeper : text.elsewhere, {
              country: link.countryName,
            })}
          </span>
          <strong>{link.title}</strong>
          {link.caption && <p>{link.caption}</p>}
          <ArrowUpRight size={17} />
        </DestinationLink>
      ))}
    </section>
  );
}
