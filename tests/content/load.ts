// Reads the content tree from disk the way `npm run content:check` does, so tests see every file
// in content/en, not only the ones registered for the loaders.
import { readFileSync, readdirSync } from 'node:fs';
import { createLandIndex, type LandIndex } from '../../src/content/geometry';
import type { ContentInput } from '../../src/content/validate';

const COUNTRIES_DIR = 'content/en/countries';

export const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const entry = (file: string) => ({ file, data: readJson(file) });

export function contentInput(): Omit<ContentInput, 'land'> {
  return {
    countryFiles: readdirSync(COUNTRIES_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => entry(`${COUNTRIES_DIR}/${name}`)),
    trails: entry('content/en/trails.json'),
    placeNotes: entry('content/en/places.json'),
    home: entry('content/en/home.json'),
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
