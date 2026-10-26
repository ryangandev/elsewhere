'use client';

import { suggestedQuestions } from '@/domain/ask';
import type { AtlasLookup } from '@/domain/atlas-index';
import { storyResult } from '@/domain/search';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { ResultSection } from './ResultGroups';

/**
 * What the search dialog offers before anything is typed: the other questions about the place
 * being read, and the home screen's starting questions. A handful, never the whole atlas.
 */
export function IdleResults({ lookup }: { lookup: AtlasLookup }) {
  const { destination } = useAtlas();
  const country = destination ? lookup.country(destination.countryId) : undefined;
  // The question being read is not offered again.
  const current = destination?.storyId && `story:${destination.countryId}:${destination.storyId}`;
  const here = country
    ? lookup
        .stories(country.id)
        .map((story) => storyResult(story, country))
        .filter((result) => result.key !== current)
    : [];
  const shown = new Set([current, ...here.map((result) => result.key)]);
  const suggestions = suggestedQuestions(lookup.index).filter((result) => !shown.has(result.key));

  return (
    <>
      {country && (
        <ResultSection
          heading={format(messages.search.groupHere, { country: country.name })}
          results={here}
        />
      )}
      <ResultSection heading={messages.search.groupSuggested} results={suggestions} />
    </>
  );
}
