import assert from 'node:assert/strict';
import { test } from 'vitest';
import { listMapCountries, listStories, listTrails } from '@/content';
import { destinationKey, parseDestination } from '@/domain/destination';
import {
  countryStaticParams,
  matchCountryRoute,
  matchStoryRoute,
  storyStaticParams,
} from '@/domain/page-views';
import { destinationPath } from '@/domain/paths';
import { countryFromSegment, countrySlug, storyFromSegment } from '@/domain/slugs';

test('paths use readable slugs of permanent IDs', () => {
  assert.equal(destinationPath(null), '/');
  assert.equal(destinationPath({ countryId: 'SGP' }), '/singapore');
  assert.equal(destinationPath({ countryId: 'CAN' }), '/canada');
  assert.equal(destinationPath({ countryId: 'USA' }), '/united-states');
  assert.equal(destinationPath({ countryId: 'SGP', storyId: 'shipping' }), '/singapore/shipping');
  assert.equal(
    destinationPath({ countryId: 'SGP', storyId: 'shipping', trailId: 'water-connects' }),
    '/singapore/shipping?trail=water-connects',
  );
  assert.throws(() => destinationPath({ countryId: 'XXX' }));
  assert.throws(() => destinationPath({ countryId: 'SGP', storyId: 'no-such-story' }));
});

test('every map identity has a unique slug that maps back to its ID', () => {
  const countries = listMapCountries();
  assert.equal(countries.length, 258);
  const slugs = new Set(countries.map((country) => countrySlug(country.id)));
  assert.equal(slugs.size, countries.length);
  for (const country of countries) {
    assert.deepEqual(countryFromSegment(countrySlug(country.id)), {
      countryId: country.id,
      canonical: true,
    });
    // Interim ID paths must never collide with a readable slug.
    assert.ok(!slugs.has(country.id.toLowerCase()), country.id);
  }
});

test('every question has a unique path that round-trips to its IDs', () => {
  const paths = new Set<string>();
  for (const story of listStories()) {
    const path = destinationPath({ countryId: story.countryId, storyId: story.id });
    assert.ok(!paths.has(path), path);
    paths.add(path);
    const [, countrySegment, storySegment] = path.split('/');
    const country = countryFromSegment(countrySegment)!;
    assert.equal(country.countryId, story.countryId);
    assert.equal(storyFromSegment(country.countryId, storySegment, true), story.id);
  }
  assert.equal(paths.size, listStories().length);
});

test('unknown paths are not pages', () => {
  assert.equal(matchCountryRoute('atlantis'), undefined);
  assert.equal(matchCountryRoute('SGP'), undefined);
  assert.equal(matchStoryRoute('singapore', 'not-a-question'), undefined);
  assert.equal(matchStoryRoute('japan', 'shipping'), undefined);
  assert.equal(matchStoryRoute('canada', 'shipping'), undefined);
});

test('interim ID paths redirect to readable paths', () => {
  assert.deepEqual(matchCountryRoute('sgp'), { kind: 'redirect', href: '/singapore' });
  assert.deepEqual(matchCountryRoute('can'), { kind: 'redirect', href: '/canada' });
  assert.deepEqual(matchStoryRoute('sgp', 'shipping'), {
    kind: 'redirect',
    href: '/singapore/shipping',
  });
  assert.equal(matchStoryRoute('sgp', 'not-a-question'), undefined);
  assert.equal(matchCountryRoute('singapore')?.kind, 'page');
  assert.equal(matchStoryRoute('singapore', 'shipping')?.kind, 'page');
});

test('every page and interim redirect is generated statically', () => {
  const countries = countryStaticParams();
  const stories = storyStaticParams();
  assert.equal(countries.length, 258 * 2);
  assert.equal(stories.length, listStories().length * 2);
  const paths = [
    ...countries.map((params) => `/${params.country}`),
    ...stories.map((params) => `/${params.country}/${params.story}`),
  ];
  assert.equal(new Set(paths).size, paths.length);
  for (const params of countries) assert.ok(matchCountryRoute(params.country), params.country);
  for (const params of stories) {
    assert.ok(matchStoryRoute(params.country, params.story), `${params.country}/${params.story}`);
  }
});

test('trail stops are distinct questions that keep their trail in a link', () => {
  for (const trail of listTrails()) {
    assert.equal(new Set(trail.stops.map(destinationKey)).size, trail.stops.length);
    for (const stop of trail.stops) {
      const path = destinationPath({ ...stop, trailId: trail.id });
      const url = new URL(path, 'https://example.test');
      assert.equal(url.searchParams.get('trail'), trail.id);
    }
  }
});

test('stored destinations are parsed structurally, including prototype entries', () => {
  assert.equal(parseDestination({ countryId: 123 }), null);
  assert.equal(parseDestination(null), null);
  assert.equal(parseDestination('SGP'), null);
  assert.equal(parseDestination({ countryId: 'sgp' }), null);
  assert.deepEqual(parseDestination({ countryId: 'SGP', topicId: 'shipping' }), {
    countryId: 'SGP',
    storyId: 'shipping',
  });
  assert.deepEqual(
    parseDestination({ countryId: 'SGP', storyId: 'shipping', trailId: 'water-connects' }),
    { countryId: 'SGP', storyId: 'shipping', trailId: 'water-connects' },
  );
  // A trail only makes sense on a question; malformed IDs are dropped.
  assert.deepEqual(parseDestination({ countryId: 'SGP', trailId: 'water-connects' }), {
    countryId: 'SGP',
  });
  assert.deepEqual(parseDestination({ countryId: 'SGP', storyId: 'Not A Slug' }), {
    countryId: 'SGP',
  });
});
