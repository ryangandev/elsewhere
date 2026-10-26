// Reading and writing one locale's content tree on disk. The pipeline works on a directory
// (content/en by default, a temporary copy in tests) instead of the loaders' static registry,
// so it sees every file, including drafts written moments ago.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLandIndex, type LandIndex } from '../src/content/geometry';
import {
  CountryFile,
  GazetteerPlace,
  MapCountry,
  type CountryFile as CountryFileData,
} from '../src/content/schema';
import type { ContentInput } from '../src/content/validate';
import { GAZETTEER_FILE, LAND_GEOMETRY_FILE, MAP_COUNTRIES_FILE } from './config';

export type RawFile = { file: string; data: unknown };

export const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

/** JSON as the content tree stores it: two-space indent and a trailing newline. */
export function writeJson(file: string, data: unknown): void {
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export const countriesDir = (contentDir: string) => join(contentDir, 'countries');

export const countryFilePath = (contentDir: string, slug: string) =>
  join(countriesDir(contentDir), `${slug}.json`);

export function readCountryFiles(contentDir: string): RawFile[] {
  const dir = countriesDir(contentDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ file: join(dir, name), data: readJson(join(dir, name)) }));
}

/** Every country file that passes the schema, keyed by country ID. Invalid files are skipped. */
export function parsedCountryFiles(contentDir: string): Map<string, CountryFileData> {
  const files = new Map<string, CountryFileData>();
  for (const { data } of readCountryFiles(contentDir)) {
    const parsed = CountryFile.safeParse(data);
    if (parsed.success) files.set(parsed.data.country.id, parsed.data);
  }
  return files;
}

export function readCountryFile(contentDir: string, slug: string): CountryFileData | undefined {
  const file = countryFilePath(contentDir, slug);
  return existsSync(file) ? CountryFile.parse(readJson(file)) : undefined;
}

export function writeCountryFile(contentDir: string, data: CountryFileData): string {
  mkdirSync(countriesDir(contentDir), { recursive: true });
  const file = countryFilePath(contentDir, data.country.slug);
  writeJson(file, data);
  return file;
}

/** Validator input for a content tree, optionally with some country files replaced or added. */
export function contentInput(
  contentDir: string,
  replace: RawFile[] = [],
): Omit<ContentInput, 'land'> {
  const replaced = new Set(replace.map(({ file }) => file));
  return {
    countryFiles: [
      ...readCountryFiles(contentDir).filter(({ file }) => !replaced.has(file)),
      ...replace,
    ],
    trails: {
      file: join(contentDir, 'trails.json'),
      data: readJson(join(contentDir, 'trails.json')),
    },
    placeNotes: {
      file: join(contentDir, 'places.json'),
      data: readJson(join(contentDir, 'places.json')),
    },
    home: {
      file: join(contentDir, 'home.json'),
      data: readJson(join(contentDir, 'home.json')),
    },
    gazetteer: { file: GAZETTEER_FILE, data: readJson(GAZETTEER_FILE) },
    mapCountries: { file: MAP_COUNTRIES_FILE, data: readJson(MAP_COUNTRIES_FILE) },
  };
}

let land: LandIndex | undefined;

/** Land geometry for the sea-route check, built once per process (about a second). */
export function landIndex(): LandIndex {
  land ??= createLandIndex(JSON.parse(readFileSync(LAND_GEOMETRY_FILE, 'utf8')));
  return land;
}

let gazetteer: GazetteerPlace[] | undefined;
let mapCountries: MapCountry[] | undefined;

export function gazetteerPlaces(): GazetteerPlace[] {
  gazetteer ??= GazetteerPlace.array().parse(readJson(GAZETTEER_FILE));
  return gazetteer;
}

export function mapCountryList(): MapCountry[] {
  mapCountries ??= MapCountry.array().parse(readJson(MAP_COUNTRIES_FILE));
  return mapCountries;
}

export function requireMapCountry(id: string): MapCountry {
  const country = mapCountryList().find((entry) => entry.id === id.toUpperCase());
  if (!country) throw new Error(`Unknown map country "${id}"`);
  return country;
}
