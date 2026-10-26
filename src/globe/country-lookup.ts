import { geoArea } from 'd3-geo';
import type { Position } from 'geojson';
import type { CountryFeature } from './cartography';

// Point-in-country tests for picking and label layout, which run many times per frame.
// Natural Earth rings are drawn in longitude and latitude and cut at the antimeridian, so a
// planar even-odd test on them is exact for the map's own edges and costs a fraction of a
// spherical one. Each part keeps its bounds, so most parts are rejected without a ring scan.

type Bounds = { west: number; east: number; south: number; north: number };
type PreparedPart = Bounds & { rings: Position[][] };
type PreparedCountry = Bounds & { parts: PreparedPart[] };

// Even-odd test. A ring's own vertices count as inside, as some atoll anchors are one.
export function ringContains(ring: Position[], lng: number, lat: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (xi === lng && yi === lat) return true;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function boundsOf(ring: Position[]): Bounds {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, east, south, north };
}

const within = (bounds: Bounds, lng: number, lat: number) =>
  lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east;

// Prepared once per feature object; detailed geometry brings new objects, which prepare anew.
const prepared = new WeakMap<CountryFeature, PreparedCountry>();

function prepare(feature: CountryFeature): PreparedCountry {
  const { geometry } = feature;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const parts = polygons.map((rings) => ({ rings, ...boundsOf(rings[0]) }));
  const country = {
    parts,
    west: Math.min(...parts.map((part) => part.west)),
    east: Math.max(...parts.map((part) => part.east)),
    south: Math.min(...parts.map((part) => part.south)),
    north: Math.max(...parts.map((part) => part.north)),
  };
  prepared.set(feature, country);
  return country;
}

const partsOf = (feature: CountryFeature) => (prepared.get(feature) ?? prepare(feature)).parts;

/** Whether a point lies on the country's land, outside its holes. */
export function countryContains(feature: CountryFeature, lng: number, lat: number) {
  const country = prepared.get(feature) ?? prepare(feature);
  if (!within(country, lng, lat)) return false;
  for (const part of country.parts) {
    if (
      within(part, lng, lat) &&
      ringContains(part.rings[0], lng, lat) &&
      !part.rings.slice(1).some((hole) => ringContains(hole, lng, lat))
    )
      return true;
  }
  return false;
}

// Coarse cells of longitude and latitude, each listing the countries with a part there.
const CELL = 10;
const COLUMNS = 360 / CELL;
const ROWS = 180 / CELL;
const cellOf = (lng: number, lat: number) =>
  Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / CELL))) * COLUMNS +
  Math.min(COLUMNS - 1, Math.max(0, Math.floor((lng + 180) / CELL)));

// The country under a point, or undefined at sea or off the globe. Smaller countries are tested
// first, so an enclave wins over a country drawn around it.
export function createCountryLookup(features: CountryFeature[]) {
  const cells: CountryFeature[][] = Array.from({ length: COLUMNS * ROWS }, () => []);
  const bySize = features
    .map((feature) => ({ feature, area: geoArea(feature) }))
    .sort((a, b) => a.area - b.area);
  for (const { feature } of bySize) {
    const seen = new Set<number>();
    for (const part of partsOf(feature)) {
      const first = cellOf(part.west, part.south);
      const last = cellOf(part.east, part.north);
      for (let row = Math.floor(first / COLUMNS); row <= Math.floor(last / COLUMNS); row++) {
        for (let column = first % COLUMNS; column <= last % COLUMNS; column++) {
          const cell = row * COLUMNS + column;
          if (seen.has(cell)) continue;
          seen.add(cell);
          cells[cell].push(feature);
        }
      }
    }
  }
  return (point: { lat: number; lng: number } | null) => {
    if (!point) return undefined;
    const { lat, lng } = point;
    return cells[cellOf(lng, lat)].find((feature) => countryContains(feature, lng, lat));
  };
}
