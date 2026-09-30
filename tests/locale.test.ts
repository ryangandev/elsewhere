import test from 'node:test';
import assert from 'node:assert/strict';
import { directory, searchAtlas, validDestination, destinationUrl, readDestination } from '../app/exploration';
import { countries } from '../app/data';
import { countryBasics, countryName } from '../app/locale';
import { chineseProfiles } from '../app/chinese-content';
import { topicLabel } from '../app/localized-content';

test('every map identity has a sourced Chinese name and retains its dated population reference', () => {
  assert.equal(directory.length, 258);
  assert.equal(Object.keys(countryBasics).length, directory.length);
  for (const country of directory) {
    const basics = countryBasics[country.id];
    assert.ok(basics, country.id);
    assert.match(countryName(country.id, country.name, 'zh'), /\p{Script=Han}/u, country.id);
    assert.equal(countryName(country.id, country.name, 'en'), country.name);
    if (basics.population !== null) {
      assert.ok(basics.population >= 0);
      assert.ok(basics.populationYear && basics.populationYear <= 2024, country.id);
    }
    assert.deepEqual(readDestination(new URL(destinationUrl({ countryId: country.id }), 'https://example.test').search), validDestination({ countryId: country.id }));
    assert.ok(searchAtlas(basics.nameZh, undefined, 'zh').some(result => result.destination.countryId === country.id), country.id);
  }
});

test('all thirty editorial questions have Chinese précis with stable navigation and bilingual retrieval', () => {
  let count = 0;
  for (const country of countries) {
    const content = chineseProfiles[country.id];
    assert.ok(content.summary && content.geography && content.capital);
    assert.equal(content.topics.length, country.topics.length);
    for (const topic of country.topics) {
      const title = topicLabel(country, topic, 'zh');
      assert.notEqual(title, topic.title);
      assert.ok(searchAtlas(title, country.id, 'zh').some(result => result.destination.topicId === topic.id && result.destination.countryId === country.id));
      assert.equal(topicLabel(country, topic, 'en'), topic.title);
      count++;
    }
  }
  assert.equal(count, 30);
  assert.ok(searchAtlas('德国', undefined, 'en').some(result => result.title === 'Germany'));
  assert.ok(searchAtlas('Germany', undefined, 'zh').some(result => result.title === '德国'));
});
