// Validate all content: `npm run content:check`. Exits non-zero on any issue.
// Checks shapes, cross-references, the gazetteer, and that sea routes stay at sea.
// Source URL reachability is checked by the content pipeline, not here.
import { readFileSync } from 'node:fs';
import { localeContentDir, readContentTree } from '../src/content/files';
import { createLandIndex } from '../src/content/geometry';
import { validateContent, type ContentIssue } from '../src/content/validate';

// Sea routes are checked against the detailed geometry: the base geometry's coarser coastlines
// close narrow straits such as the Bosporus.
const LAND_GEOMETRY = 'public/maps/countries-detail.geojson';

const entry = (file: string) => ({ file, data: JSON.parse(readFileSync(file, 'utf8')) });

const tree = readContentTree(localeContentDir('en'));
const { countryFiles } = tree;

const issues: ContentIssue[] = validateContent({
  ...tree,
  gazetteer: entry('data/geo/gazetteer.json'),
  mapCountries: entry('data/geo/countries.json'),
  land: createLandIndex(JSON.parse(readFileSync(LAND_GEOMETRY, 'utf8'))),
});

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
