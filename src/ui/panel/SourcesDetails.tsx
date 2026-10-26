import { ArrowUpRight } from 'lucide-react';
import type { SourceView } from '@/domain/view-models';
import { messages } from '@/i18n';

type Props = { sources: SourceView[]; question: boolean };

/** Every source behind an edited country overview or one of its questions. */
export function SourcesDetails({ sources, question }: Props) {
  const text = messages.sources;

  return (
    <details className="small-details">
      <summary>{question ? text.questionSummary : text.countrySummary}</summary>
      <p>{text.caveat}</p>
      {sources.map((source) => (
        <a href={source.url} key={source.id} target="_blank" rel="noreferrer">
          {source.title} · {source.publisher}
          <ArrowUpRight size={12} />
        </a>
      ))}
    </details>
  );
}

/** The sources one section of an answer cites, shown under it. */
export function SectionSources({ sources }: { sources: SourceView[] }) {
  if (!sources.length) return null;
  return (
    <p className="section-sources">
      <span>{messages.sources.cited}</span>
      {sources.map((source, index) => (
        <span key={source.id}>
          {index > 0 && ', '}
          <a href={source.url} target="_blank" rel="noreferrer" title={source.title}>
            {source.publisher}
          </a>
        </span>
      ))}
    </p>
  );
}
