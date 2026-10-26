// Search over paraphrases on a small hand-built index, so the ranking rules are tested apart
// from whatever the content bank currently holds. tests/ask.test.ts covers the real index.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { askAtlas, topResult } from '@/domain/ask';
import type { AtlasIndex, IndexCountry, IndexStory } from '@/domain/atlas-index';
import { phrasingWords } from '@/domain/client-indexes';
import { searchAtlas } from '@/domain/search';

const country = (id: string, name: string, edited = true): IndexCountry => ({
  id,
  name,
  path: `/${name.toLowerCase()}`,
  region: 'Somewhere',
  flag: '',
  edited,
});

function story(
  countryId: string,
  id: string,
  question: string,
  paraphrases: string[],
  summary = '',
): IndexStory {
  return {
    id,
    countryId,
    path: `/${countryId.toLowerCase()}/${id}`,
    question,
    category: 'Topic',
    summary,
    keywords: '',
    phrasings: phrasingWords({
      question,
      paraphrases: paraphrases.length
        ? { question, phrasings: paraphrases, generatedBy: 'human', generatedAt: '2026-10-26' }
        : undefined,
    }),
  };
}

const stories = [
  story('SGP', 'wealth', 'How did a tiny island become so wealthy?', [
    'Why is Singapore so rich?',
    'Why is Singapore loaded?',
    'How did Singapore get so rich?',
    'What made Singapore wealthy?',
  ]),
  story('SGP', 'shipping', 'Why is Singapore a shipping crossroads?', [
    'Why do so many ships stop in Singapore?',
    "Why is Singapore's port so busy?",
  ]),
  story('JPN', 'aging', 'What changes when a country grows older?', [
    "Why is Japan's population so old?",
    'Why does Japan have so many elderly people?',
  ]),
];

const index: AtlasIndex = {
  countries: [country('SGP', 'Singapore'), country('JPN', 'Japan'), country('CHL', 'Chile', false)],
  stories,
  trails: [],
  suggestions: [{ countryId: 'SGP', storyId: 'shipping' }],
};
const withoutParaphrases: AtlasIndex = {
  ...index,
  stories: stories.map((entry) => ({ ...entry, phrasings: '' })),
};

const ask = (query: string, atlas = index) => askAtlas(atlas, query);
const top = (query: string, atlas = index) => topResult(ask(query, atlas))?.href;

test('the index keeps only paraphrase words the question lacks, once each', () => {
  // "wealthy" is already in the question, and "get" and "made" are stop words.
  assert.equal(stories[0].phrasings, 'singapore rich loaded');
  assert.equal(stories[1].phrasings, 'ships stop port busy');
  assert.equal(phrasingWords({ question: 'Why is Singapore rich?', paraphrases: undefined }), '');
});

test('a question phrased like a paraphrase finds its story, and opens it on Enter', () => {
  assert.equal(ask('Why is Singapore loaded?', withoutParaphrases).kind, 'unanswered');
  assert.equal(ask('Why is Singapore loaded?').kind, 'results');
  assert.equal(top('Why is Singapore loaded?'), '/sgp/wealth');
  assert.equal(top('why is singapore so rich'), '/sgp/wealth');
  assert.equal(top('Why is the port in Singapore so busy?'), '/sgp/shipping');
  assert.equal(top('Why does Japan have so many elderly people?'), '/jpn/aging');
});

test('paraphrase words weigh like words of the question', () => {
  const ranked = searchAtlas(index, 'busy port').filter((result) => result.kind === 'story');
  assert.equal(ranked[0].storyId, 'shipping');
  // A word in the question or a paraphrase scores the question bonus; the summary does not.
  const [shipping] = searchAtlas(index, 'busy');
  assert.equal(shipping.score, 4);
});

test('a near miss stays unanswered and Enter opens nothing', () => {
  // Shares the country, but no story is about the heat.
  const hot = ask('Why is Singapore so hot?');
  assert.equal(hot.kind, 'unanswered');
  assert.equal(topResult(hot), undefined);
  if (hot.kind === 'unanswered') {
    assert.deepEqual(hot.closest.map((result) => result.countryId).sort(), ['SGP', 'SGP']);
  }

  // "Loaded" asks about Singapore's wealth; it does not answer a question about Japan.
  const japan = ask('Why is Japan loaded?');
  assert.equal(japan.kind, 'unanswered');
  assert.equal(topResult(japan), undefined);
  if (japan.kind === 'unanswered') {
    assert.equal(japan.closest[0].storyId, 'aging');
  }

  // A paraphrase word alone is not an answer to a longer question about something else.
  assert.equal(ask('Why are Chilean ports so busy in winter?').kind, 'unanswered');
});

test('nonsense is unanswered and offers the starting questions', () => {
  for (const query of ['zzzzqqqq', 'Why is the moon made of cheese?']) {
    const outcome = ask(query);
    assert.equal(outcome.kind, 'unanswered', query);
    assert.equal(topResult(outcome), undefined);
    if (outcome.kind === 'unanswered') {
      assert.deepEqual(outcome.closest, []);
      assert.deepEqual(
        outcome.suggestions.map((result) => result.storyId),
        ['shipping'],
      );
    }
  }
});
