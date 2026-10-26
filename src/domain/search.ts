// Free-text search over the atlas index: countries by name, questions by what they answer.
// Runs in the browser on the index loaded on demand; see ./atlas-index.ts.
// How results are ordered and when a question counts as unanswered lives in ./ask.ts.
import type { AtlasIndex, IndexCountry, IndexStory } from './atlas-index';

/** Words that carry no meaning on their own in a question about a place. */
const STOP_WORDS = new Set(
  (
    'a about also an and are as at be became become becomes been but by can could did do does ' +
    'for from get got had has have how i if in into is it its just like look looks make made ' +
    'many me more most much my of on or our really so some still such than that the their them ' +
    'there these they this those through to very was we were what when where which who whom ' +
    'whose why will with would you your'
  ).split(' '),
);

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
  /** Unique across results: kind plus IDs. */
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
  /**
   * How many query terms the result covers: a country by its names; a question by its own
   * text and its country's names. Compared with the term count, it tells a full answer from a
   * question that only shares a word.
   */
  matches: number;
  /** On a country: the query names it in full, not only a word that begins its name. */
  named?: boolean;
};

const RESULT_LIMIT = 16;
/** Shorter terms match whole words only, so a single letter does not match everything. */
const MIN_PREFIX_LENGTH = 2;

/** The meaningful words of a query, lowercased, without punctuation or stop words. */
export function tokenize(query: string): string[] {
  return words(query).filter((token) => !STOP_WORDS.has(token));
}

function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKC')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/** A text's words, ready for term matching. Cached per text object, since indexes are reused. */
type WordSet = string[];

const storyWords = new WeakMap<IndexStory, WordSet>();
const questionWords = new WeakMap<IndexStory, WordSet>();
const countryWords = new WeakMap<IndexCountry, WordSet>();

function wordsOfStory(story: IndexStory): WordSet {
  let cached = storyWords.get(story);
  if (!cached) {
    cached = words(
      `${story.question} ${story.phrasings} ${story.category} ${story.summary} ${story.keywords}`,
    );
    storyWords.set(story, cached);
  }
  return cached;
}

/** The question and the words of its paraphrases: the ways readers ask it. */
function wordsOfQuestion(story: IndexStory): WordSet {
  let cached = questionWords.get(story);
  if (!cached) {
    cached = words(`${story.question} ${story.phrasings}`);
    questionWords.set(story, cached);
  }
  return cached;
}

function wordsOfCountry(country: IndexCountry): WordSet {
  let cached = countryWords.get(country);
  if (!cached) {
    cached = words(`${country.name} ${country.id} ${country.nativeName ?? ''}`);
    countryWords.set(country, cached);
  }
  return cached;
}

/** One meaningful word of the query and the words it stands for. */
type Term = { typed: string; synonyms: string[] };

function toTerm(token: string, withSynonyms: boolean): Term {
  const synonyms = withSynonyms ? (synonymsOf.get(token) ?? []) : [];
  return { typed: token, synonyms: synonyms.filter((word) => word !== token) };
}

/**
 * The typed word matches a word it begins, so "ship" finds "shipping" while the reader is still
 * typing, but "long" does not find "along". A synonym matches a whole word or its plural only,
 * so "port" (for ships) does not find "Portuguese".
 */
function termMatches(term: Term, textWords: WordSet): boolean {
  return textWords.some(
    (word) =>
      (term.typed.length >= MIN_PREFIX_LENGTH
        ? word.startsWith(term.typed)
        : word === term.typed) ||
      term.synonyms.some((synonym) => word === synonym || word === `${synonym}s`),
  );
}

/** Which query terms appear in any of the texts. */
function matchedTerms(terms: Term[], ...texts: WordSet[]): boolean[] {
  return terms.map((term) => texts.some((text) => termMatches(term, text)));
}

const count = (flags: boolean[]) => flags.filter(Boolean).length;

/**
 * Ranks countries and questions against a free-text query.
 * A country name weighs most, so "Canada" lists Canada first; questions score on their
 * wording, their paraphrases (other ways readers ask them, written by the content pipeline)
 * and keywords, and inherit a little from a matching country name.
 * `currentCountryId` boosts questions about the country the reader is already looking at.
 */
export function searchAtlas(
  index: AtlasIndex,
  query: string,
  currentCountryId?: string,
): SearchResult[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const terms = tokens.map((token) => toTerm(token, true));
  const nameTerms = tokens.map((token) => toTerm(token, false));

  const countries = new Map(index.countries.map((country) => [country.id, country]));
  const results: SearchResult[] = [];
  const countryScores = new Map<string, number>();
  for (const country of index.countries) {
    const names = wordsOfCountry(country);
    const score = count(matchedTerms(nameTerms, names));
    if (!score) continue;
    countryScores.set(country.id, score);
    // Among equal matches, a whole word beats the start of one, and an edited country beats a
    // map-only one: "ch" lists China before Chad, "america" the United States before Samoa.
    const whole = tokens.filter((token) => names.includes(token)).length;
    const named = [country.name, country.nativeName ?? ''].some((name) => {
      const nameWords = tokenize(name);
      return nameWords.length > 0 && nameWords.every((word) => tokens.includes(word));
    });
    results.push({
      key: `country:${country.id}`,
      countryId: country.id,
      href: country.path,
      title: country.name,
      subtitle: country.region,
      kind: country.edited ? 'country' : 'map',
      flag: country.flag,
      score: score * 4 + whole + (country.edited ? 1 : 0),
      matches: score,
      ...(named ? { named } : {}),
    });
  }

  for (const story of index.stories) {
    const countryScore = countryScores.get(story.countryId) ?? 0;
    const storyScore = count(matchedTerms(terms, wordsOfStory(story)));
    if (!storyScore && !countryScore) continue;
    // Words in the question or its paraphrases say more than words in its summary or keywords.
    const questionScore = count(matchedTerms(terms, wordsOfQuestion(story)));
    const country = countries.get(story.countryId);
    const covered = matchedTerms(
      terms,
      wordsOfStory(story),
      country ? wordsOfCountry(country) : [],
    );
    results.push({
      ...storyResult(story, country),
      score:
        storyScore * 3 +
        questionScore +
        countryScore +
        (story.countryId === currentCountryId ? 2 : 0),
      matches: count(covered),
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, RESULT_LIMIT);
}

/** A question as a result row, for lists that are not ranked against a query. */
export function storyResult(story: IndexStory, country?: IndexCountry): SearchResult {
  return {
    key: `story:${story.countryId}:${story.id}`,
    countryId: story.countryId,
    storyId: story.id,
    href: story.path,
    title: story.question,
    subtitle: `${country?.name ?? ''} · ${story.category}`,
    kind: 'story',
    flag: country?.flag ?? '',
    score: 0,
    matches: 0,
  };
}

/** True when the query is a place's name, or the start of one. */
export function isPlaceQuery(index: AtlasIndex, query: string): boolean {
  const normalized = query.trim().toLowerCase().normalize('NFKC');
  if (normalized.length < MIN_PREFIX_LENGTH) return false;
  return index.countries.some((country) =>
    [country.name, country.id, country.nativeName ?? ''].some((name) =>
      name.toLowerCase().normalize('NFKC').startsWith(normalized),
    ),
  );
}
