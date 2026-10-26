// Shared helpers for scripts that derive data from Natural Earth.
// Raw downloads are cached in the ignored .map-sources directory; only compact outputs are committed.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const NATURAL_EARTH_BASE =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

export const CACHE_DIR = '.map-sources';

/** Natural Earth 10m datasets used by the geo data scripts, keyed by a short name. */
export const DATASETS = {
  countries: {
    file: 'countries-10m.geojson',
    url: `${NATURAL_EARTH_BASE}/ne_10m_admin_0_countries.geojson`,
  },
  marine: {
    file: 'ne_10m_geography_marine_polys.geojson',
    url: `${NATURAL_EARTH_BASE}/ne_10m_geography_marine_polys.geojson`,
  },
  regions: {
    file: 'ne_10m_geography_regions_polys.geojson',
    url: `${NATURAL_EARTH_BASE}/ne_10m_geography_regions_polys.geojson`,
  },
  places: {
    file: 'ne_10m_populated_places_simple.geojson',
    url: `${NATURAL_EARTH_BASE}/ne_10m_populated_places_simple.geojson`,
  },
  rivers: {
    file: 'ne_10m_rivers_lake_centerlines.geojson',
    url: `${NATURAL_EARTH_BASE}/ne_10m_rivers_lake_centerlines.geojson`,
  },
  admin1: {
    file: 'ne_10m_admin_1_states_provinces.geojson',
    url: `${NATURAL_EARTH_BASE}/ne_10m_admin_1_states_provinces.geojson`,
  },
};

export function cachePath(name) {
  return `${CACHE_DIR}/${DATASETS[name].file}`;
}

/** Download a dataset into the cache unless it is already there. */
export async function ensureDataset(name) {
  const path = cachePath(name);
  if (existsSync(path)) return path;
  mkdirSync(CACHE_DIR, { recursive: true });
  const { url } = DATASETS[name];
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

export async function readDataset(name) {
  return JSON.parse(readFileSync(await ensureDataset(name), 'utf8'));
}

export function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Source record for the data/geo/sources.json manifest. */
export function sourceRecord(name) {
  return { url: DATASETS[name].url, sha256: sha256(cachePath(name)) };
}

/** Readable, URL-safe identifier: "Washington, D.C." -> "washington-dc", "Côte d'Ivoire" -> "cote-divoire". */
export function slugify(value) {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

/** Merge one section into data/geo/sources.json, keeping the other sections intact. */
export function updateSourcesManifest(section, record) {
  const path = 'data/geo/sources.json';
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  manifest[section] = record;
  writeJson(path, manifest);
}
