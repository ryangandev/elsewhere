'use client';

import { ArrowUpRight, MapPin, MessageCircleQuestionMark } from 'lucide-react';
import type { SearchResult } from '@/domain/search';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { CommandItem } from '../primitives/command';

function subtitle(result: SearchResult): string {
  if (result.kind === 'story') return result.subtitle;
  const kind =
    result.kind === 'country' ? messages.search.countryStory : messages.search.basicOverview;
  return `${result.subtitle} · ${kind}`;
}

function ResultIcon({ result }: { result: SearchResult }) {
  if (result.kind === 'story') return <MessageCircleQuestionMark size={16} />;
  if (result.kind === 'map' && !result.flag) return <MapPin size={16} />;
  return (
    <span className="result-flag" aria-hidden>
      {result.flag}
    </span>
  );
}

/** One row of search results: a question, an edited country, or a place on the map. */
export function ResultItem({ result }: { result: SearchResult }) {
  const { go } = useAtlas();
  return (
    <CommandItem value={result.key} onSelect={() => go(result.href)} className="result-item">
      <ResultIcon result={result} />
      <span className="result-text">
        <strong>{result.title}</strong>
        <small>{subtitle(result)}</small>
      </span>
      <ArrowUpRight size={15} className="result-arrow" />
    </CommandItem>
  );
}
