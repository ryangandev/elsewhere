// Keep source attributes separate from the generated label directory.
import { readFileSync, writeFileSync } from 'node:fs';
const source = JSON.parse(readFileSync(new URL('../.map-sources/countries-10m.geojson', import.meta.url), 'utf8'));
const basics = Object.fromEntries(source.features.map(({ properties: p }) => [p.ADM0_A3, {
  nameZh: p.NAME_ZH || p.NAME_LONG || p.ADMIN,
  region: p.SUBREGION, continent: p.CONTINENT, type: p.TYPE,
  population: p.POP_EST >= 0 ? p.POP_EST : null, populationYear: p.POP_YEAR > 0 ? p.POP_YEAR : null,
}]));
writeFileSync(new URL('../src/content/legacy/country-basics.json', import.meta.url), JSON.stringify(basics, null, 2) + '\n');
