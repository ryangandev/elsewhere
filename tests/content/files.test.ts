import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as content from '../../src/content';
import {
  contentTreeRevision,
  localeContentDir,
  readContentTree,
} from '../../src/content/files';
import { createContentStore } from '../../src/content/store';

describe('content discovery', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'elsewhere-content-'));
    cpSync(localeContentDir('en'), dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds every country file, ordered by file name', () => {
    const tree = readContentTree(localeContentDir('en'));
    const names = readdirSync('content/en/countries')
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(tree.countryFiles.map(({ file }) => file)).toEqual(
      names.map((name) => join('content/en/countries', name)),
    );
    expect(tree.trails.file).toBe(join('content/en', 'trails.json'));
    expect(tree.placeNotes.file).toBe(join('content/en', 'places.json'));
  });

  it('gives the loaders every country file without registration', () => {
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

  it('names a missing directory or file', () => {
    rmSync(join(dir, 'trails.json'));
    expect(() => readContentTree(dir)).toThrow(`Cannot read content file ${join(dir, 'trails.json')}`);
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
