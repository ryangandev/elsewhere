// Builds the compact indexes the browser loads instead of content (see ./atlas-index.ts).
// They are served as static JSON by the route handlers in app/atlas/, generated at build time.
import 'server-only';
import {
  getCountry,
  getHome,
  listMapCountries,
  listStories,
  listTrails,
  type Story,
} from '@/content';
import type { AtlasIndex, CountryLabel, IndexCountry, IndexStory } from './atlas-index';
import { countryFlag, countryName, trailView } from './page-views';
import { destinationPath } from './paths';
import { tokenize } from './search';

/** Keywords kept per question: enough to find it, small enough for a large question bank. */
const KEYWORDS_PER_STORY = 16;
const MIN_KEYWORD_LENGTH = 4;

const KEYWORD_STOP_WORDS = new Set(
  (
    'about above across after again against also among another around because been before being ' +
    'below between both could does doing down during each even ever every from further have having ' +
    'here into itself just like made make makes many more most much must only other over same ' +
    'should some still such than that their them then there these they this those through today ' +
    'under until very were what when where which while whose will with within without would your'
  ).split(' '),
);

/** Globe labels for every map identity, each with the page it opens. */
export function buildCountryLabels(): CountryLabel[] {
  return listMapCountries().map((country) => {
    const name = countryName(country.id);
    // Natural Earth's short map name, unless the edited name is already as short.
    const shortName =
      country.shortName && country.shortName.length < name.length ? country.shortName : undefined;
    return {
      id: country.id,
      name,
      ...(shortName ? { shortName } : {}),
      lat: country.lat,
      lng: country.lng,
      area: country.area,
      rank: country.labelRank,
      path: destinationPath({ countryId: country.id }),
    };
  });
}

export function buildAtlasIndex(): AtlasIndex {
  const stories = listStories();
  const keywords = extractKeywords(
    stories.map((story) => ({
      text: storyBody(story),
      exclude: `${story.question} ${story.category} ${story.summary}`,
    })),
  );

  const countries: IndexCountry[] = listMapCountries()
    .map((map) => {
      const profile = getCountry(map.id);
      return {
        id: map.id,
        name: countryName(map.id),
        path: destinationPath({ countryId: map.id }),
        region: profile?.region ?? map.region,
        flag: countryFlag(map.id),
        edited: !!profile,
        ...(profile?.nativeName ? { nativeName: profile.nativeName } : {}),
        ...(profile ? { kicker: profile.kicker } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const storyEntries: IndexStory[] = stories.map((story, index) => ({
    id: story.id,
    countryId: story.countryId,
    path: destinationPath({ countryId: story.countryId, storyId: story.id }),
    question: story.question,
    category: story.category,
    summary: story.summary,
    keywords: keywords[index].join(' '),
    phrasings: phrasingWords(story),
  }));

  return {
    countries,
    stories: storyEntries,
    trails: listTrails().map(trailView),
    suggestions: getHome().suggestedQuestions.map(({ countryId, storyId }) => ({
      countryId,
      storyId,
    })),
  };
}

/**
 * The words of a story's paraphrases that its question lacks, each once, in first-appearance
 * order. Search matches words, not sentences, so this keeps what search needs in a fraction of
 * the bytes. Stale paraphrases (written for an earlier question) fail validation, so they never
 * reach a build.
 */
export function phrasingWords(story: Pick<Story, 'question' | 'paraphrases'>): string {
  const question = new Set(tokenize(story.question));
  const words = new Set<string>();
  for (const phrasing of story.paraphrases?.phrasings ?? []) {
    for (const word of tokenize(phrasing)) {
      // Single letters are left from possessives ("Singapore's") and match nothing alone.
      if (word.length > 1 && !question.has(word)) words.add(word);
    }
  }
  return [...words].join(' ');
}

/** The answer text a question's keywords are drawn from. */
function storyBody(story: Story): string {
  return [
    ...story.sections.flatMap((section) => [section.title, section.text]),
    story.takeaway,
    story.scene.mapNote,
  ].join(' ');
}

function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFKC')
      .match(/\p{L}[\p{L}'-]*/gu) ?? []
  )
    .map((word) => word.replace(/['-]+$/, '').replace(/'s$/, ''))
    .filter((word) => word.length >= MIN_KEYWORD_LENGTH && !KEYWORD_STOP_WORDS.has(word));
}

/**
 * The most distinctive words of each document, by TF-IDF across all documents.
 * Words in `exclude` (the question and summary, which search reads anyway) are skipped.
 * Ties keep first-appearance order, so the output is deterministic.
 */
export function extractKeywords(
  documents: { text: string; exclude?: string }[],
  limit = KEYWORDS_PER_STORY,
): string[][] {
  const tokenized = documents.map((document) => words(document.text));
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const word of new Set(tokens)) {
      documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
    }
  }

  return tokenized.map((tokens, index) => {
    const excluded = new Set(words(documents[index].exclude ?? ''));
    const counts = new Map<string, number>();
    for (const word of tokens) {
      if (!excluded.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    const idf = (word: string) => Math.log((documents.length + 1) / documentFrequency.get(word)!);
    return [...counts.entries()]
      .map(([word, count], order) => ({ word, score: count * idf(word), order }))
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, limit)
      .map((entry) => entry.word);
  });
}
