// What the question input shows for a query: ranked results grouped for reading, or an honest
// "not answered yet" with the closest stories and the countries the query names.
// Pure and browser-safe; it reads only the atlas index. See docs/architecture.md#discovery-and-navigation.
import type { AtlasIndex } from './atlas-index';
import { isPlaceQuery, searchAtlas, storyResult, tokenize, type SearchResult } from './search';

export type ResultKind = SearchResult['kind'];
export type ResultGroup = { kind: ResultKind; results: SearchResult[] };

export type AskOutcome =
  /** Nothing meaningful typed yet. */
  | { kind: 'idle' }
  /** Results in reading order; the first result of the first group is the top result. */
  | { kind: 'results'; groups: ResultGroup[] }
  /**
   * No question in the atlas answers the query. This is where a Stage 2 live answer provider
   * would take over (see ./live-answers.ts); Stage 1 says so and offers what is closest.
   */
  | {
      kind: 'unanswered';
      /** True when the query reads like a question rather than a name or a topic. */
      question: boolean;
      /** Questions that share part of the query, best first; empty when none do. */
      closest: SearchResult[];
      /** Countries the query names. */
      countries: SearchResult[];
      /** The home screen's starting questions, offered when nothing is close. */
      suggestions: SearchResult[];
    };

const QUESTION_WORDS = new Set(
  (
    'why how what when where which who whose is are was were do does did can could should ' +
    'would will has have'
  ).split(' '),
);
const CLOSEST_COUNT = 3;
const COUNTRY_COUNT = 3;

/** A query reads like a question when it ends with a question mark or opens with a question word. */
export function readsLikeQuestion(query: string): boolean {
  const trimmed = query.trim();
  if (/[?？]$/.test(trimmed)) return true;
  const first = trimmed.toLowerCase().split(/\s+/)[0] ?? '';
  return QUESTION_WORDS.has(first);
}

/**
 * Whether a question covers enough of the query to count as its answer: both terms of a short
 * query, and all but one of a longer one, where one word is often phrased differently ("pass"
 * for a strait). When the query names edited countries, only their questions can answer it,
 * so "Why is France in South America?" is not answered by a question about Brazil.
 */
export function coversQuery(
  result: SearchResult,
  termCount: number,
  namedCountryIds: string[],
): boolean {
  const required = termCount <= 2 ? termCount : termCount - 1;
  return (
    result.kind === 'story' &&
    result.matches >= required &&
    (namedCountryIds.length === 0 || namedCountryIds.includes(result.countryId))
  );
}

/**
 * The order result kinds are listed in: questions first for a question, countries first for a
 * place name (or the start of one, while typing), and questions first otherwise.
 */
export function groupOrder(index: AtlasIndex, query: string): ResultKind[] {
  if (!readsLikeQuestion(query) && isPlaceQuery(index, query)) return ['country', 'map', 'story'];
  return ['story', 'country', 'map'];
}

export function askAtlas(index: AtlasIndex, query: string, currentCountryId?: string): AskOutcome {
  const termCount = tokenize(query).length;
  if (!termCount) return { kind: 'idle' };

  const results = searchAtlas(index, query, currentCountryId);
  const stories = results.filter((result) => result.kind === 'story');
  const named = results
    .filter((result) => result.kind === 'country' && result.named)
    .map((result) => result.countryId);
  const question = readsLikeQuestion(query);
  const answered = question
    ? stories.some((result) => coversQuery(result, termCount, named))
    : results.length > 0;

  if (!answered) {
    // Closest first: questions about a country the query names, then by how much they share.
    const closest = stories
      .filter((result) => result.matches > 0)
      .map((result) => ({ result, about: named.includes(result.countryId) ? 1 : 0 }))
      .sort(
        (a, b) =>
          b.about - a.about ||
          b.result.matches - a.result.matches ||
          b.result.score - a.result.score,
      )
      .map(({ result }) => result)
      .slice(0, CLOSEST_COUNT);
    return {
      kind: 'unanswered',
      question,
      closest,
      countries: results.filter((result) => result.kind !== 'story').slice(0, COUNTRY_COUNT),
      suggestions: closest.length ? [] : suggestedQuestions(index),
    };
  }

  // Questions that answer the query lead, so the top result is an answer and not a near miss.
  const answers = stories.filter((result) => coversQuery(result, termCount, named));
  const ranked = [...answers, ...results.filter((result) => !answers.includes(result))];
  const groups = groupOrder(index, query)
    .map((kind) => ({ kind, results: ranked.filter((result) => result.kind === kind) }))
    .filter((group) => group.results.length > 0);
  return { kind: 'results', groups };
}

/** The home screen's starting questions as result rows. */
export function suggestedQuestions(index: AtlasIndex): SearchResult[] {
  const countries = new Map(index.countries.map((country) => [country.id, country]));
  return index.suggestions.flatMap((ref) => {
    const story = index.stories.find(
      (item) => item.countryId === ref.countryId && item.id === ref.storyId,
    );
    return story ? [storyResult(story, countries.get(story.countryId))] : [];
  });
}

/** The result Enter opens: the first one shown, or none when the query is unanswered. */
export function topResult(outcome: AskOutcome): SearchResult | undefined {
  return outcome.kind === 'results' ? outcome.groups[0]?.results[0] : undefined;
}
