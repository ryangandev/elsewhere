import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  askAtlas,
  groupOrder,
  readsLikeQuestion,
  suggestedQuestions,
  topResult,
} from '@/domain/ask';
import { createAtlasLookup, type AtlasIndex } from '@/domain/atlas-index';
import { buildAtlasIndex } from '@/domain/client-indexes';

// The index exactly as the browser receives it.
const index: AtlasIndex = JSON.parse(JSON.stringify(buildAtlasIndex()));
const lookup = createAtlasLookup(index);
const ask = (query: string) => askAtlas(index, query);
const top = (query: string) => topResult(ask(query));

test('place names list countries first, questions and topics list questions first', () => {
  assert.deepEqual(groupOrder(index, 'Japan'), ['country', 'map', 'story']);
  assert.deepEqual(groupOrder(index, 'Jap'), ['country', 'map', 'story']);
  assert.deepEqual(groupOrder(index, 'shipping'), ['story', 'country', 'map']);
  // "Is" begins "Israel", but a question is a question.
  assert.deepEqual(groupOrder(index, 'Is Turkey European or Asian?'), ['story', 'country', 'map']);

  assert.ok(readsLikeQuestion('why is india'));
  assert.ok(readsLikeQuestion('Singapore wealth?'));
  assert.ok(!readsLikeQuestion('Singapore wealth'));

  assert.equal(top('japan')?.href, '/japan');
  // An edited country comes before map-only ones that begin the same way.
  assert.equal(top('ch')?.countryId, 'CHN');
});

test('a question opens its answer first', () => {
  assert.equal(ask('Why is Singapore so rich?').kind, 'results');
  assert.equal(top('Why is Singapore so rich?')?.href, '/singapore/wealth');
  assert.equal(top('Why do so many ships pass through Turkey?')?.href, '/turkey/straits');
  assert.equal(top('Why does India have so many languages?')?.href, '/india/languages');
  assert.equal(top('Why is Japan so old?')?.href, '/japan/aging');
  assert.equal(top('dollar')?.href, '/united-states/dollar');
});

test('an unanswered question says so and offers what is closest', () => {
  const chile = ask('Why does Chile look like that?');
  assert.equal(chile.kind, 'unanswered');
  if (chile.kind !== 'unanswered') return;
  assert.equal(chile.question, true);
  assert.deepEqual(
    chile.countries.map((result) => result.href),
    ['/chile'],
  );
  // Nothing in the atlas is close, so the starting questions are offered instead.
  assert.deepEqual(chile.closest, []);
  assert.deepEqual(
    chile.suggestions.map((result) => result.key),
    index.suggestions.map((ref) => `story:${ref.countryId}:${ref.storyId}`),
  );

  // A question naming an edited country is only answered by that country's questions.
  const france = ask('Why is France in South America?');
  assert.equal(france.kind, 'unanswered');
  if (france.kind !== 'unanswered') return;
  assert.ok(france.closest.length > 0);
  assert.ok(france.closest.every((result) => result.countryId === 'FRA'));
  assert.ok(france.closest.some((result) => result.href === '/france/overseas'));
  assert.equal(france.countries[0].href, '/france');
  assert.deepEqual(france.suggestions, []);

  assert.equal(ask('Why does Japan have earthquakes?').kind, 'unanswered');
  assert.equal(top('Why does Japan have earthquakes?')?.countryId, 'JPN');
});

test('a name or topic without a match is unanswered too; stop words alone are idle', () => {
  const none = ask('zzzzqqqq');
  assert.equal(none.kind, 'unanswered');
  if (none.kind === 'unanswered') {
    assert.equal(none.question, false);
    assert.equal(none.suggestions.length, index.suggestions.length);
  }
  assert.deepEqual(ask('why is the'), { kind: 'idle' });
  assert.deepEqual(ask('   '), { kind: 'idle' });
  assert.equal(topResult({ kind: 'idle' }), undefined);
});

test('the starting questions resolve to their pages', () => {
  const suggestions = suggestedQuestions(index);
  assert.equal(suggestions.length, index.suggestions.length);
  assert.ok(suggestions.length >= 3 && suggestions.length <= 4);
  for (const result of suggestions) {
    assert.equal(result.kind, 'story');
    assert.equal(result.href, lookup.story(result.countryId, result.storyId!)?.path);
  }
});
