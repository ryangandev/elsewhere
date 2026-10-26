import assert from 'node:assert/strict';
import { test } from 'vitest';
import { countries } from '@/content/legacy/data';
import { directory, getCountry, nearbyCountries, topicIds } from '@/domain/catalog';
import { describeDestination } from '@/domain/describe';
import { destinationKey, getTopic, topicDestination, validDestination } from '@/domain/destination';
import { destinationFromPath, destinationPath, legacyQueryToPath } from '@/domain/paths';
import { relatedStories } from '@/domain/recommendations';
import { countryStaticParams, storyStaticParams } from '@/domain/static-params';
import { trails } from '@/domain/trails';

test('every country and question has a unique, round-trippable path', () => {
  assert.equal(countries.length, 10);
  assert.equal(countries.flatMap((country) => country.topics).length, 30);
  const paths = new Set<string>();
  for (const country of countries) {
    assert.equal(country.topics.length, topicIds[country.id].length);
    for (const [index, topic] of country.topics.entries()) {
      const destination = topicDestination(country, index);
      const path = destinationPath(destination);
      assert.ok(!paths.has(path));
      paths.add(path);
      assert.deepEqual(destinationFromPath(path), destination);
      assert.equal(getTopic(destination), topic);
      assert.ok(country.sources.length > 0);
      for (const source of topic.sources ?? country.sources) {
        assert.equal(new URL(source.url).protocol, 'https:');
      }
      for (const [lat, lng] of topic.route ?? []) {
        assert.ok(lat >= -90 && lat <= 90);
        assert.ok(lng >= -180 && lng <= 180);
      }
    }
  }
});

test('paths are lowercase slugs of permanent IDs', () => {
  assert.equal(destinationPath(null), '/');
  assert.equal(destinationPath({ countryId: 'SGP' }), '/sgp');
  assert.equal(destinationPath({ countryId: 'SGP', topicId: 'shipping' }), '/sgp/shipping');
  assert.equal(
    destinationPath({ countryId: 'SGP', topicId: 'shipping', trailId: 'water-connects' }),
    '/sgp/shipping?trail=water-connects',
  );
});

test('unknown paths are not destinations', () => {
  assert.equal(destinationFromPath('/'), null);
  assert.equal(destinationFromPath('/unknown'), null);
  assert.equal(destinationFromPath('/sgp/not-a-question'), null);
  assert.equal(destinationFromPath('/jpn/shipping'), null);
  assert.equal(destinationFromPath('/sgp/shipping/extra'), null);
  assert.deepEqual(destinationFromPath('/sgp/'), { countryId: 'SGP' });
  assert.deepEqual(destinationFromPath('/can'), { countryId: 'CAN' });
});

test('a trail is kept only for a question that is a stop on it', () => {
  assert.deepEqual(destinationFromPath('/sgp/shipping', 'water-connects'), {
    countryId: 'SGP',
    topicId: 'shipping',
    trailId: 'water-connects',
  });
  assert.deepEqual(destinationFromPath('/sgp/wealth', 'water-connects'), {
    countryId: 'SGP',
    topicId: 'wealth',
  });
  assert.deepEqual(destinationFromPath('/sgp/shipping', 'no-such-trail'), {
    countryId: 'SGP',
    topicId: 'shipping',
  });
});

test('prototype query URLs translate to path URLs and degrade to a valid page', () => {
  assert.equal(legacyQueryToPath('?country=sgp&topic=shipping'), '/sgp/shipping');
  assert.equal(
    legacyQueryToPath('?country=sgp&topic=shipping&trail=water-connects'),
    '/sgp/shipping?trail=water-connects',
  );
  assert.equal(legacyQueryToPath('?country=sgp'), '/sgp');
  assert.equal(legacyQueryToPath('?country=jpn&topic=shipping'), '/jpn');
  assert.equal(legacyQueryToPath('?country=can&topic=shipping'), '/can');
  assert.equal(legacyQueryToPath('?country=sgp&topic=wealth&trail=water-connects'), '/sgp/wealth');
  assert.equal(legacyQueryToPath('?country=unknown&topic=shipping'), null);
  assert.equal(legacyQueryToPath(''), null);
  assert.equal(legacyQueryToPath('?other=1'), null);
});

test('untrusted input becomes a valid destination or nothing', () => {
  assert.equal(validDestination({ countryId: 123 }), null);
  assert.equal(validDestination(null), null);
  assert.equal(validDestination('SGP'), null);
});

test('every page is generated statically', () => {
  assert.equal(countryStaticParams().length, directory.length);
  assert.equal(directory.length, 258);
  assert.equal(storyStaticParams().length, 30);
  const paths = [...countryStaticParams().map((p) => `/${p.country}`)];
  paths.push(...storyStaticParams().map((p) => `/${p.country}/${p.story}`));
  assert.equal(new Set(paths).size, paths.length);
  for (const path of paths) assert.ok(destinationFromPath(path), path);
});

test('every page has a real title and description', () => {
  for (const params of countryStaticParams()) {
    const destination = destinationFromPath(`/${params.country}`)!;
    const summary = describeDestination(destination);
    assert.ok(
      summary && summary.title.length > 0 && summary.description.length > 20,
      params.country,
    );
  }
  for (const params of storyStaticParams()) {
    const destination = destinationFromPath(`/${params.country}/${params.story}`)!;
    const summary = describeDestination(destination);
    assert.equal(summary?.title, getTopic(destination)?.title);
  }
});

test('trails have valid, distinct questions and preserve their exact step in a link', () => {
  for (const trail of trails) {
    assert.equal(new Set(trail.stops.map(destinationKey)).size, trail.stops.length);
    for (const stop of trail.stops) {
      const destination = { countryId: stop.countryId, topicId: stop.topicId, trailId: trail.id };
      assert.ok(getTopic(stop));
      assert.deepEqual(
        destinationFromPath(...splitPath(destinationPath(destination))),
        destination,
      );
    }
  }
});

/** Splits a path URL into the pathname and trail parameter that a page receives. */
function splitPath(url: string): [string, string | null] {
  const parsed = new URL(url, 'https://example.test');
  return [parsed.pathname, parsed.searchParams.get('trail')];
}

test('every editorial destination leads to valid stories in another country', () => {
  for (const country of countries) {
    for (const index of country.topics.keys()) {
      const related = relatedStories(topicDestination(country, index));
      assert.ok(related.length > 0);
      for (const next of related) {
        assert.ok(getTopic(next));
        assert.notEqual(next.countryId, country.id);
      }
    }
  }
});

test('the location directory has unique identities and valid, non-placeholder coordinates', () => {
  assert.equal(new Set(directory.map((c) => c.id)).size, directory.length);
  for (const location of directory) {
    assert.ok(Number.isFinite(location.lat) && Math.abs(location.lat) <= 90, location.name);
    assert.ok(Number.isFinite(location.lng) && Math.abs(location.lng) <= 180, location.name);
  }
  const canada = directory.find((c) => c.id === 'CAN')!;
  assert.ok(canada.lat > 40 && canada.lng < -50);
  assert.equal(nearbyCountries(canada)[0].id, 'USA');
  const singapore = directory.find((c) => c.id === 'SGP')!;
  assert.equal(nearbyCountries(singapore)[0].id, 'MYS');
  assert.ok(getCountry('SGP'));
});
