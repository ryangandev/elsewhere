import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as content from '../../src/content';
import { contentTreeRevision, localeContentDir, readContentTree } from '../../src/content/files';
import { createContentStore } from '../../src/content/store';
import { FIXTURE_CONTENT_DIR } from './load';

// These tests work on a copy of the fixture tree (tests/fixtures/content/en), which, like
// content/en, has a claims/ directory next to its content. Only the test that the loaders find
// the files of content/en itself reads that tree, and it compares the loaders with the tree
// rather than assuming what is in it.
describe('content discovery', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'elsewhere-content-'));
    cpSync(FIXTURE_CONTENT_DIR, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds every country file, ordered by file name', () => {
    const tree = readContentTree(FIXTURE_CONTENT_DIR);
    expect(tree.countryFiles.map(({ file }) => file)).toEqual(
      ['france', 'malaysia', 'singapore', 'united-states'].map((slug) =>
        join(FIXTURE_CONTENT_DIR, 'countries', `${slug}.json`),
      ),
    );
    expect(tree.trails.file).toBe(join(FIXTURE_CONTENT_DIR, 'trails.json'));
    expect(tree.placeNotes.file).toBe(join(FIXTURE_CONTENT_DIR, 'places.json'));
    expect(tree.home.file).toBe(join(FIXTURE_CONTENT_DIR, 'home.json'));
  });

  it('orders country files by name, not by when they were written', () => {
    writeFileSync(join(dir, 'countries', 'aaa.json'), '{}');
    writeFileSync(join(dir, 'countries', 'zzz.json'), '{}');
    expect(readContentTree(dir).countryFiles.map(({ file }) => file)).toEqual(
      ['aaa', 'france', 'malaysia', 'singapore', 'united-states', 'zzz'].map((slug) =>
        join(dir, 'countries', `${slug}.json`),
      ),
    );
  });

  it('gives the loaders every country file of content/en without registration', () => {
    const ids = readContentTree(localeContentDir('en')).countryFiles.map(
      ({ data }) => (data as { country: { id: string } }).country.id,
    );
    expect(content.listCountries().map((country) => country.id)).toEqual(
      expect.arrayContaining(ids),
    );
    expect(content.listCountries()).toHaveLength(ids.length);
  });

  it('names a file that is not JSON', () => {
    writeFileSync(join(dir, 'countries', 'broken.json'), '{ "country": ');
    expect(() => readContentTree(dir)).toThrow(
      `Content file ${join(dir, 'countries', 'broken.json')} is not valid JSON`,
    );
  });

  it('rejects an unknown top-level file', () => {
    writeFileSync(join(dir, 'notes.json'), '{}');
    expect(() => readContentTree(dir)).toThrow(`Unknown content file ${join(dir, 'notes.json')}`);
  });

  it('ignores the claim check results kept next to the content', () => {
    // The copy already has claim results next to the content. Add more, even one that is not JSON.
    const before = contentTreeRevision(dir);
    const files = () => readContentTree(dir).countryFiles.map(({ file }) => file);
    const countryFiles = files();
    mkdirSync(join(dir, 'claims'), { recursive: true });
    writeFileSync(join(dir, 'claims', 'malaysia.json'), '{ "countryId": "MYS", "checks": {} }');
    writeFileSync(join(dir, 'claims', 'not-a-country.json'), 'not JSON at all');
    expect(files()).toEqual(countryFiles);
    expect(contentTreeRevision(dir)).toBe(before);

    // Without any claims directory, the tree reads the same.
    rmSync(join(dir, 'claims'), { recursive: true });
    expect(files()).toEqual(countryFiles);
    expect(contentTreeRevision(dir)).toBe(before);
  });

  it('names a missing directory or file', () => {
    rmSync(join(dir, 'trails.json'));
    expect(() => readContentTree(dir)).toThrow(
      `Cannot read content file ${join(dir, 'trails.json')}`,
    );
    expect(() => readContentTree(join(dir, 'missing'))).toThrow('Cannot read content directory');
  });

  it('names a file that does not match the schema when content is first read', () => {
    writeFileSync(join(dir, 'countries', 'atlantis.json'), '{ "country": {}, "stories": [] }');
    const store = createContentStore(readContentTree(dir), { includeDrafts: true });
    expect(() => store.listCountries()).toThrow(
      `Content file ${join(dir, 'countries', 'atlantis.json')} does not match the schema`,
    );
  });

  it('reloads content when the revision changes', () => {
    const store = createContentStore(() => readContentTree(dir), {
      includeDrafts: true,
      revision: () => contentTreeRevision(dir),
    });
    const before = store.listCountries().length;
    rmSync(join(dir, 'countries', 'singapore.json'));
    // Trails and next questions that pointed at Singapore are dropped with it.
    expect(store.listCountries()).toHaveLength(before - 1);
    expect(store.getCountry('SGP')).toBeUndefined();
  });
});
