import assert from 'node:assert/strict';
import test from 'node:test';
import { countries } from '../app/data';
import { destinationKey, destinationUrl, directory, getCountry, getTopic, nearbyCountries, readDestination, relatedStories, searchAtlas, topicDestination, topicIds, trails, validDestination } from '../app/exploration';
import { parseLibrary } from '../app/use-atlas';

test('every country and question has a unique, round-trippable share link', () => {
  assert.equal(countries.length, 10);
  assert.equal(countries.flatMap(c => c.topics).length, 30);
  const links = new Set<string>();
  for (const country of countries) {
    assert.equal(country.topics.length, topicIds[country.id].length);
    for (const [index, topic] of country.topics.entries()) {
      const destination = topicDestination(country, index);
      const link = destinationUrl(destination);
      assert.ok(!links.has(link)); links.add(link);
      assert.deepEqual(readDestination(link.slice(1)), destination);
      assert.equal(getTopic(destination), topic);
      assert.ok(country.sources.length > 0);
      for (const source of topic.sources ?? country.sources) assert.equal(new URL(source.url).protocol, 'https:');
      for (const [lat, lng] of topic.route ?? []) { assert.ok(lat >= -90 && lat <= 90); assert.ok(lng >= -180 && lng <= 180); }
    }
  }
});

test('invalid and cross-country topic links degrade to a valid view', () => {
  assert.equal(readDestination('?country=unknown&topic=shipping'), null);
  assert.deepEqual(readDestination('?country=jpn&topic=shipping'), { countryId: 'JPN' });
  assert.deepEqual(readDestination('?country=can&topic=shipping'), { countryId: 'CAN' });
  assert.deepEqual(readDestination('?country=sgp&topic=wealth&trail=water-connects'), { countryId: 'SGP', topicId: 'wealth' });
  assert.equal(validDestination({ countryId: 123 }), null);
  assert.equal(destinationUrl(null), '/');
});

test('trails have valid, distinct questions and preserve their exact step in a link', () => {
  for (const trail of trails) {
    assert.equal(new Set(trail.stops.map(destinationKey)).size, trail.stops.length);
    for (const stop of trail.stops) {
      const destination = { countryId: stop.countryId, topicId: stop.topicId, trailId: trail.id };
      assert.ok(getTopic(stop));
      assert.deepEqual(readDestination(destinationUrl(destination).slice(1)), destination);
    }
  }
});

test('every editorial destination leads to valid stories in another country', () => {
  for (const country of countries) {
    for (const [index] of country.topics.entries()) {
      const destination = topicDestination(country, index);
      const related = relatedStories(destination);
      assert.ok(related.length > 0);
      for (const next of related) { assert.ok(getTopic(next)); assert.notEqual(next.countryId, country.id); }
    }
  }
});

test('the location directory has unique identities and valid, non-placeholder coordinates', () => {
  assert.equal(new Set(directory.map(c => c.id)).size, directory.length);
  for (const location of directory) {
    assert.ok(Number.isFinite(location.lat) && Math.abs(location.lat) <= 90, location.name);
    assert.ok(Number.isFinite(location.lng) && Math.abs(location.lng) <= 180, location.name);
  }
  const canada = directory.find(c => c.id === 'CAN')!;
  assert.ok(canada.lat > 40 && canada.lng < -50);
  assert.equal(nearbyCountries(canada)[0].id, 'USA');
  const singapore = directory.find(c => c.id === 'SGP')!;
  assert.equal(nearbyCountries(singapore)[0].id, 'MYS');
});

test('search handles country aliases, natural questions, map-only places, and no results', () => {
  assert.ok(searchAtlas('新加坡').some(r => r.destination.countryId === 'SGP'));
  assert.ok(searchAtlas('Türkiye').some(r => r.destination.countryId === 'TUR'));
  assert.equal(searchAtlas('Why is Singapore a shipping crossroads?').filter(r => r.kind === 'story')[0].destination.topicId, 'shipping');
  assert.equal(searchAtlas('Canada')[0].kind, 'map');
  assert.equal(searchAtlas('zzzzqqqq').length, 0);
  assert.equal(searchAtlas('  ').length, 0);
  assert.ok(searchAtlas('electronics').some(r => r.destination.countryId === 'MYS'));
});

test('malformed, obsolete, duplicate, and overlong local libraries are safe to restore', () => {
  assert.deepEqual(parseLibrary('not json'), { saved: [], recent: [] });
  assert.deepEqual(parseLibrary('null'), { saved: [], recent: [] });
  const restore = parseLibrary(JSON.stringify({ saved: [null, {}, { countryId: 'BAD' }, { countryId: 'SGP', topicId: 'shipping' }, { countryId: 'SGP', topicId: 'shipping' }], recent: directory.map(c => ({ countryId: c.id })) }));
  assert.equal(restore.saved.length, 1);
  assert.ok(getCountry(restore.saved[0].countryId));
  assert.equal(restore.recent.length, 20);
});
