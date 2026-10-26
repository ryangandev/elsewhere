import { ArrowUpRight } from 'lucide-react';
import type { Country, Topic } from '@/content/legacy/data';
import { messages } from '@/i18n';

type Props = { profile: Country; topic: Topic | null };

/** Sources behind an edited country overview or one of its questions. */
export function SourcesDetails({ profile, topic }: Props) {
  const text = messages.sources;
  const sources = topic?.sources ?? profile.sources;

  return (
    <details className="small-details">
      <summary>{topic ? text.questionSummary : text.countrySummary}</summary>
      {!topic && (
        <dl>
          <div>
            <dt>{text.language}</dt>
            <dd>{profile.language}</dd>
          </div>
          <div>
            <dt>{text.currency}</dt>
            <dd>{profile.currency}</dd>
          </div>
        </dl>
      )}
      <p>
        {topic && !topic.sources ? `${text.countryLevel} ` : ''}
        {text.caveat}
      </p>
      {sources.map((source) => (
        <a href={source.url} key={source.url} target="_blank" rel="noreferrer">
          {source.name}
          <ArrowUpRight size={12} />
        </a>
      ))}
    </details>
  );
}
