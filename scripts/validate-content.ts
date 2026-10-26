// Validate all content: `npm run content:check`. Exits non-zero on any issue.
// Checks shapes, cross-references, the gazetteer, and that sea routes stay at sea.
// Source URL reachability is checked by the content pipeline, not here.
import { readFileSync, readdirSync } from 'node:fs';
import { createLandIndex } from '../src/content/geometry';
import { englishContent } from '../src/content/registry';
import { validateContent, type ContentIssue } from '../src/content/validate';

// Sea routes are checked against the detailed geometry: the base geometry's coarser coastlines
// close narrow straits such as the Bosporus.
const LAND_GEOMETRY = 'public/maps/countries-detail.geojson';
const COUNTRIES_DIR = 'content/en/countries';

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const entry = (file: string) => ({ file, data: readJson(file) });

const countryFiles = readdirSync(COUNTRIES_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => entry(`${COUNTRIES_DIR}/${name}`));

const issues: ContentIssue[] = validateContent({
  countryFiles,
  trails: entry('content/en/trails.json'),
  placeNotes: entry('content/en/places.json'),
  gazetteer: entry('data/geo/gazetteer.json'),
  mapCountries: entry('data/geo/countries.json'),
  land: createLandIndex(JSON.parse(readFileSync(LAND_GEOMETRY, 'utf8'))),
});

// The loaders import content through src/content/registry.ts; every file must be registered.
const slugOf = (data: unknown) => (data as { country?: { slug?: string } })?.country?.slug;
const registered = new Set(englishContent.countryFiles.map(slugOf));
for (const { file, data } of countryFiles) {
  if (!registered.has(slugOf(data))) {
    issues.push({ file, path: '', message: 'Not imported in src/content/registry.ts' });
  }
}
if (englishContent.countryFiles.length !== countryFiles.length) {
  issues.push({
    file: 'src/content/registry.ts',
    path: '',
    message: `Imports ${englishContent.countryFiles.length} country files; ${COUNTRIES_DIR} has ${countryFiles.length}`,
  });
}

if (issues.length) {
  for (const issue of issues) {
    console.error(`${issue.file}${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`);
  }
  console.error(`\n${issues.length} content issue${issues.length === 1 ? '' : 's'}.`);
  process.exit(1);
}

const stories = countryFiles.reduce(
  (sum, { data }) => sum + ((data as { stories?: unknown[] }).stories?.length ?? 0),
  0,
);
console.log(`Content OK: ${countryFiles.length} countries, ${stories} stories.`);
