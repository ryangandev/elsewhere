// Reads content trees from disk the way `npm run content:check` does.
//
// Two trees are in play. The unit tests build on the small fixture tree below, so they hold
// however many countries content/en has and whatever its review state. Only the tests that
// exist to check production content read the live tree (see `liveContentInput`).
import { readFileSync } from 'node:fs';
import { localeContentDir, readContentTree } from '../../src/content/files';
import { createLandIndex, type LandIndex } from '../../src/content/geometry';
import type { ContentInput } from '../../src/content/validate';

/**
 * A small, valid content tree committed for the tests: four reviewed countries (FRA, MYS, SGP,
 * USA) with three stories each, two trails, and a home screen with four suggested questions.
 * It also holds a claims/ directory, as content/en does once claims are checked.
 */
export const FIXTURE_CONTENT_DIR = 'tests/fixtures/content/en';

export const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const entry = (file: string) => ({ file, data: readJson(file) });

function contentInput(dir: string): Omit<ContentInput, 'land'> {
  return {
    ...readContentTree(dir),
    gazetteer: entry('data/geo/gazetteer.json'),
    mapCountries: entry('data/geo/countries.json'),
  };
}

/** The fixture tree, with the generated geo data it is checked against. Passes validation. */
export const fixtureInput = () => contentInput(FIXTURE_CONTENT_DIR);

/** The real content/en tree. Use it only in tests that validate production content. */
export const liveContentInput = () => contentInput(localeContentDir('en'));

let land: LandIndex | undefined;

/** The detailed land geometry that sea routes are checked against. Built once per test file. */
export function landIndex(): LandIndex {
  land ??= createLandIndex(
    JSON.parse(readFileSync('public/maps/countries-detail.geojson', 'utf8')),
  );
  return land;
}
