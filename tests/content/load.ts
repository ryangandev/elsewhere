// Reads the content tree from disk the way `npm run content:check` does.
import { readFileSync } from 'node:fs';
import { localeContentDir, readContentTree } from '../../src/content/files';
import { createLandIndex, type LandIndex } from '../../src/content/geometry';
import type { ContentInput } from '../../src/content/validate';

export const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const entry = (file: string) => ({ file, data: readJson(file) });

export function contentInput(): Omit<ContentInput, 'land'> {
  return {
    ...readContentTree(localeContentDir('en')),
    gazetteer: entry('data/geo/gazetteer.json'),
    mapCountries: entry('data/geo/countries.json'),
  };
}

let land: LandIndex | undefined;

/** The detailed land geometry that sea routes are checked against. Built once per test file. */
export function landIndex(): LandIndex {
  land ??= createLandIndex(
    JSON.parse(readFileSync('public/maps/countries-detail.geojson', 'utf8')),
  );
  return land;
}
