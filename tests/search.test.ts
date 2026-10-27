import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createAtlasLookup, linkFor } from '@/domain/atlas-index';
import { buildAtlasIndex, extractKeywords } from '@/domain/client-indexes';
import { isPlaceQuery, searchAtlas, tokenize } from '@/domain/search';

// The index exactly as the browser receives it.
const index = JSON.parse(JSON.stringify(buildAtlasIndex()));
const lookup = createAtlasLookup(index);
const search = (query: string, countryId?: string) => searchAtlas(index, query, countryId);

test('country names rank first, including native names and map-only places', () => {
  assert.equal(search('Canada')[0].kind, 'map');
  assert.equal(search('Canada')[0].href, '/canada');
  assert.equal(search('Singapore')[0].kind, 'country');
  assert.ok(search('Türkiye').some((result) => result.countryId === 'TUR'));
  assert.ok(isPlaceQuery(index, 'canada'));
  assert.ok(isPlaceQuery(index, 'cana'));
  assert.ok(!isPlaceQuery(index, 'shipping'));
  assert.ok(!isPlaceQuery(index, 'c'));
});

test('typed words match the start of a word, synonyms only whole words', () => {
  // While typing, "ship" already finds shipping.
  assert.equal(search('ship').find((result) => result.kind === 'story')?.storyId, 'shipping');
  // "port" stands for shipping, but must not find "Portuguese".
  assert.ok(!search('shipping').some((result) => result.storyId === 'language'));
  // A single letter matches whole words only.
  assert.equal(search('q').length, 0);
});

test('results count how much of the query they cover', () => {
  const wealth = search('Why is Singapore so rich?').find((result) => result.storyId === 'wealth');
  assert.equal(wealth?.matches, 2);
  const singapore = search('Singapore').find((result) => result.kind === 'country');
  assert.equal(singapore?.named, true);
  assert.equal(search('Singa').find((result) => result.kind === 'country')?.named, undefined);
});

test('natural questions find the question that answers them', () => {
  const firstStory = (query: string) => search(query).find((result) => result.kind === 'story');
  assert.equal(firstStory('Why is Singapore a shipping crossroads?')?.storyId, 'shipping');
  assert.equal(firstStory('Why is Singapore so rich?')?.storyId, 'wealth');
  assert.equal(firstStory('Why is Singapore so rich?')?.href, '/singapore/wealth');
  assert.ok(search('electronics').some((result) => result.countryId === 'MYS'));
  assert.ok(search('chips').some((result) => result.countryId === 'MYS'));
});

test('questions about the current country rank first', () => {
  assert.equal(search('language', 'IND')[0].countryId, 'IND');
});

test('empty and unmatched queries return nothing', () => {
  assert.equal(search('zzzzqqqq').length, 0);
  assert.equal(search('  ').length, 0);
  assert.equal(search('why is the').length, 0);
  assert.deepEqual(tokenize('Why is Singapore so rich?'), ['singapore', 'rich']);
});

test('keywords are the distinctive words of each document', () => {
  const [first, second] = extractKeywords(
    [
      { text: 'Ships pass the strait. Ships wait at the port.', exclude: 'port' },
      { text: 'Rain falls on the plains. The plains flood.' },
    ],
    3,
  );
  assert.deepEqual(first, ['ships', 'pass', 'strait']);
  assert.deepEqual(second, ['plains', 'rain', 'falls']);
  for (const story of index.stories) assert.ok(story.keywords.length > 0, story.id);
});

test('stored destinations resolve to links, and removed ones to nothing', () => {
  assert.equal(linkFor(lookup, { countryId: 'SGP' })?.href, '/singapore');
  assert.equal(linkFor(lookup, { countryId: 'CAN' })?.title, 'Canada');
  const story = linkFor(lookup, { countryId: 'SGP', storyId: 'shipping' });
  assert.equal(story?.href, '/singapore/shipping');
  assert.equal(story?.title, 'Why is Singapore a shipping crossroads?');
  assert.equal(
    linkFor(lookup, { countryId: 'SGP', storyId: 'shipping', trailId: 'water-connects' })?.href,
    '/singapore/shipping?trail=water-connects',
  );
  assert.equal(
    linkFor(lookup, { countryId: 'SGP', storyId: 'wealth', trailId: 'water-connects' })?.href,
    '/singapore/wealth',
  );
  assert.equal(linkFor(lookup, { countryId: 'SGP', storyId: 'gone' }), undefined);
  assert.equal(linkFor(lookup, { countryId: 'XXX' }), undefined);
});
