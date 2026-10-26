import assert from 'node:assert/strict';
import { test } from 'vitest';
import { searchAtlas } from '@/domain/search';

test('search handles country aliases, natural questions, map-only places, and no results', () => {
  assert.ok(searchAtlas('Türkiye').some((r) => r.destination.countryId === 'TUR'));
  assert.equal(
    searchAtlas('Why is Singapore a shipping crossroads?').filter((r) => r.kind === 'story')[0]
      .destination.topicId,
    'shipping',
  );
  assert.equal(searchAtlas('Canada')[0].kind, 'map');
  assert.equal(searchAtlas('zzzzqqqq').length, 0);
  assert.equal(searchAtlas('  ').length, 0);
  assert.ok(searchAtlas('electronics').some((r) => r.destination.countryId === 'MYS'));
});

test('questions about the current country rank first', () => {
  const results = searchAtlas('language', 'IND');
  assert.equal(results[0].destination.countryId, 'IND');
});
