// Free-text search over the atlas index: countries by name, questions by what they answer.
// Runs in the browser on the index loaded on demand; see ./atlas-index.ts.
import type { AtlasIndex, IndexCountry } from './atlas-index';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'become',
  'can',
  'did',
  'do',
  'does',
  'how',
  'in',
  'is',
  'it',
  'of',
  'so',
  'the',
  'to',
  'what',
  'why',
]);

/**
 * Words people ask with that answers tend to phrase differently. Each group is matched as one
 * term, so "Why is Singapore so rich?" finds the question about wealth.
 * General language only: country-specific terms belong in content, not here.
 */
const SYNONYMS: string[][] = [
  ['rich', 'wealth', 'wealthy', 'prosperous'],
  ['poor', 'poverty'],
  ['old', 'aging', 'ageing', 'older', 'elderly'],
  ['chips', 'semiconductor', 'electronics'],
  ['ships', 'shipping', 'port', 'maritime'],
  ['money', 'currency', 'dollar', 'finance'],
  ['factory', 'factories', 'manufacturing', 'industry'],
  ['rain', 'rainfall', 'monsoon'],
  ['forest', 'rainforest', 'forests'],
  ['language', 'languages', 'speak', 'spoken'],
];

const synonymsOf = new Map<string, string[]>();
for (const group of SYNONYMS) {
  for (const word of group) synonymsOf.set(word, group);
}

export type SearchResult = {
  /** Country or question ID, unique within its kind and country. */
  key: string;
  countryId: string;
  storyId?: string;
  href: string;
  title: string;
  subtitle: string;
  /** story: a question; country: an edited country; map: a map identity without content. */
  kind: 'story' | 'country' | 'map';
  flag: string;
  score: number;
};

const RESULT_LIMIT = 16;

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[?？.,!"“”‘’']/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token));
}

/** How many query terms appear in the text. A term matches through any of its synonyms. */
function matchCount(terms: string[][], text: string): number {
  const lower = text.toLowerCase();
  return terms.reduce(
    (total, alternatives) => total + (alternatives.some((word) => lower.includes(word)) ? 1 : 0),
    0,
  );
}

function countryText(country: IndexCountry): string {
  return [country.name, country.id, country.nativeName ?? ''].join(' ');
}

/**
 * Ranks countries and questions against a free-text query.
 * A country name weighs most, so "Canada" lists Canada first; questions score on their
 * wording and keywords and inherit a little from a matching country name.
 * `currentCountryId` boosts questions about the country the reader is already looking at.
 */
export function searchAtlas(
  index: AtlasIndex,
  query: string,
  currentCountryId?: string,
): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const terms = tokens.map((token) => synonymsOf.get(token) ?? [token]);
  const nameTerms = tokens.map((token) => [token]);

  const countries = new Map(index.countries.map((country) => [country.id, country]));
  const results: SearchResult[] = [];
  const countryScores = new Map<string, number>();
  for (const country of index.countries) {
    const score = matchCount(nameTerms, countryText(country));
    if (!score) continue;
    countryScores.set(country.id, score);
    results.push({
      key: `country:${country.id}`,
      countryId: country.id,
      href: country.path,
      title: country.name,
      subtitle: country.region,
      kind: country.edited ? 'country' : 'map',
      flag: country.flag,
      score: score * 4,
    });
  }

  for (const story of index.stories) {
    const countryScore = countryScores.get(story.countryId) ?? 0;
    const storyScore = matchCount(
      terms,
      `${story.question} ${story.category} ${story.summary} ${story.keywords}`,
    );
    if (!storyScore && !countryScore) continue;
    const country = countries.get(story.countryId);
    results.push({
      key: `story:${story.countryId}:${story.id}`,
      countryId: story.countryId,
      storyId: story.id,
      href: story.path,
      title: story.question,
      subtitle: `${country?.name ?? ''} · ${story.category}`,
      kind: 'story',
      flag: country?.flag ?? '',
      score: storyScore * 3 + countryScore + (story.countryId === currentCountryId ? 2 : 0),
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, RESULT_LIMIT);
}

/** True when the query names a place, so places should be listed before questions. */
export function isPlaceQuery(index: AtlasIndex, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  return index.countries.some(
    (country) =>
      country.name.toLowerCase() === normalized ||
      country.id.toLowerCase() === normalized ||
      !!country.nativeName?.toLowerCase().includes(normalized),
  );
}
