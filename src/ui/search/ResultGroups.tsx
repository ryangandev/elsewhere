'use client';

import type { ResultGroup, ResultKind } from '@/domain/ask';
import type { SearchResult } from '@/domain/search';
import { messages } from '@/i18n';
import { CommandGroup } from '../primitives/command';
import { ResultItem } from './ResultItem';

const GROUP_HEADINGS: Record<ResultKind, string> = {
  story: messages.search.groupQuestions,
  country: messages.search.groupCountries,
  map: messages.search.groupMap,
};

/** A headed group of result rows. Renders nothing for an empty list. */
export function ResultSection({ heading, results }: { heading: string; results: SearchResult[] }) {
  if (!results.length) return null;
  return (
    <CommandGroup heading={heading}>
      {results.map((result) => (
        <ResultItem key={result.key} result={result} />
      ))}
    </CommandGroup>
  );
}

/** Matching questions and places, in the order the query calls for. */
export function ResultGroups({ groups }: { groups: ResultGroup[] }) {
  return groups.map((group) => (
    <ResultSection key={group.kind} heading={GROUP_HEADINGS[group.kind]} results={group.results} />
  ));
}
