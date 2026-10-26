// Reading one locale's content tree from disk. Content files are discovered, not registered:
// every country file in `countries/` and every known top-level file is read at load time, in a
// fixed order, so adding a country is only a matter of writing its file.
// Used by the loaders (Next.js server components at build time), `npm run content:check`, the
// pipeline and the tests. Server-side only: it uses the file system.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** One content file as read from disk: its path and its parsed, not yet validated, JSON. */
export type ContentFile = { file: string; data: unknown };

/** Every file of one locale's content tree. */
export type ContentTree = {
  /** content/<locale>/countries/*.json, ordered by file name. */
  countryFiles: ContentFile[];
  trails: ContentFile;
  placeNotes: ContentFile;
  home: ContentFile;
};

/** The top-level files of a content tree, by their key in ContentTree. */
export const TOP_LEVEL_FILES = {
  trails: 'trails.json',
  placeNotes: 'places.json',
  home: 'home.json',
} as const satisfies Record<Exclude<keyof ContentTree, 'countryFiles'>, string>;

export const COUNTRIES_DIR = 'countries';

/**
 * The content tree of a locale, relative to the working directory, so messages name files the
 * way the repository does. Next.js, the scripts and Vitest all run from the repository root.
 */
export function localeContentDir(locale = 'en'): string {
  return join('content', locale);
}

// Plain code-unit order, so the result never depends on the machine's locale.
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function listJson(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    throw new Error(`Cannot read content directory ${dir}: ${(error as Error).message}`);
  }
  return names.filter((name) => name.endsWith('.json')).sort(byName);
}

function readContentFile(file: string): ContentFile {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read content file ${file}: ${(error as Error).message}`);
  }
  try {
    return { file, data: JSON.parse(text) };
  } catch (error) {
    throw new Error(`Content file ${file} is not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * Read every file of a content tree. Throws, naming the file, when a file cannot be read or is
 * not JSON, when a known top-level file is missing, or when an unknown top-level JSON file is
 * present (add new content files to TOP_LEVEL_FILES and ContentTree). Shapes are validated by
 * the loaders and `content:check`, not here.
 */
export function readContentTree(dir: string): ContentTree {
  const known = new Set<string>(Object.values(TOP_LEVEL_FILES));
  for (const name of listJson(dir)) {
    if (!known.has(name)) {
      throw new Error(
        `Unknown content file ${join(dir, name)}; known top-level files are ${[...known].join(', ')}`,
      );
    }
  }
  const countriesDir = join(dir, COUNTRIES_DIR);
  return {
    countryFiles: listJson(countriesDir).map((name) => readContentFile(join(countriesDir, name))),
    trails: readContentFile(join(dir, TOP_LEVEL_FILES.trails)),
    placeNotes: readContentFile(join(dir, TOP_LEVEL_FILES.placeNotes)),
    home: readContentFile(join(dir, TOP_LEVEL_FILES.home)),
  };
}

/**
 * A fingerprint of a content tree that changes whenever a content file is added, removed or
 * written. The development server uses it to reload content without a restart.
 */
export function contentTreeRevision(dir: string): string {
  const countriesDir = join(dir, COUNTRIES_DIR);
  const files = [
    ...listJson(dir).map((name) => join(dir, name)),
    ...listJson(countriesDir).map((name) => join(countriesDir, name)),
  ];
  return files
    .map((file) => {
      const stats = statSync(file);
      return `${file}:${stats.size}:${stats.mtimeMs}`;
    })
    .join('\n');
}
