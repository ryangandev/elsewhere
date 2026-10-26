// Build data/geo/gazetteer.json: named geographic features with stable IDs and label points.
// Run with `npm run maps:gazetteer` (after `npm run maps:countries`).
//
// Sources, all Natural Earth 10m and cached in .map-sources:
// - countries: every map identity, from data/geo/countries.json
// - marine: seas, straits, gulfs and bays (all named features)
// - rivers: major rivers (scalerank <= 2)
// - regions: islands, ranges, plains, deserts and other physical regions (scalerank <= 3)
// - places: major populated places (scalerank <= 2) and every national capital
// - data/geo/gazetteer-overrides.json: extra Natural Earth features by ne_id, English renames,
//   extra passages, canals from the river and lake centerlines, and the few features Natural
//   Earth lacks, anchored to Natural Earth geometry rather than typed coordinates
//
// Straits, channels, canals and the passages listed in the overrides get a passage path that
// sea routes follow (see passage-paths.mjs). The script reports passages without a way through
// and passage paths that cross land the globe draws.
import { readFileSync, writeFileSync } from 'node:fs';
import { geoArea, geoContains } from 'd3-geo';
import mapshaper from 'mapshaper';
import { createLandIndex, distanceKm } from '../src/content/geometry.ts';
import { joinLines, midpoint, simplifyLine, waterPath } from './passage-paths.mjs';
import {
  readDataset,
  round,
  slugify,
  sourceRecord,
  updateSourcesManifest,
} from './natural-earth.mjs';

const OUTPUT = 'data/geo/gazetteer.json';
const OVERRIDES = 'data/geo/gazetteer-overrides.json';
const LAND_GEOMETRY = 'public/maps/countries-detail.geojson';

const REGION_MAX_SCALERANK = 3;
const PLACE_MAX_SCALERANK = 2;
const RIVER_MAX_SCALERANK = 2;

const land = JSON.parse(readFileSync(LAND_GEOMETRY, 'utf8'));
const landIndex = createLandIndex(land);
const countries = JSON.parse(readFileSync('data/geo/countries.json', 'utf8'));
const overrides = JSON.parse(readFileSync(OVERRIDES, 'utf8'));
const datasets = {
  marine: await readDataset('marine'),
  rivers: await readDataset('rivers'),
  regions: await readDataset('regions'),
  places: await readDataset('places'),
  admin1: await readDataset('admin1'),
};

const included = new Map();
for (const { dataset, neId } of overrides.include) {
  if (!included.has(dataset)) included.set(dataset, new Set());
  included.get(dataset).add(neId);
}
const isIncluded = (dataset, properties) =>
  included.get(dataset)?.has(properties.ne_id ?? properties.NE_ID) ?? false;

function titleCase(value) {
  return value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (match) => match.toUpperCase());
}

function displayName(value) {
  if (!value) return null;
  const name = value.replace(/\s+/g, ' ').trim();
  const normalized = name === name.toUpperCase() ? titleCase(name) : name;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function englishName(properties) {
  return displayName(
    properties.name_en || properties.NAME_EN || properties.name || properties.NAME,
  );
}

/**
 * English names for a dataset's features. Where Natural Earth gives several features the same
 * English name (North and South Atlantic are both "Atlantic Ocean"), use their own names instead.
 */
function distinctNames(features) {
  const counts = new Map();
  for (const { properties } of features) {
    const name = englishName(properties);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return features.map(({ properties }) => {
    const name = englishName(properties);
    return counts.get(name) > 1 ? displayName(properties.name || properties.NAME) : name;
  });
}

/** Interior label points for polygon features, computed by mapshaper's inner-point algorithm. */
async function innerPoints(features) {
  // Tag each feature with its index so the output order does not matter.
  const indexed = features.map((feature, index) => ({
    type: 'Feature',
    properties: { index },
    geometry: feature.geometry,
  }));
  const input = JSON.stringify({ type: 'FeatureCollection', features: indexed });
  const output = await mapshaper.applyCommands('-i in.geojson -points inner -o out.geojson', {
    'in.geojson': input,
  });
  const points = new Array(features.length).fill(null);
  for (const feature of JSON.parse(output['out.geojson'].toString()).features) {
    points[feature.properties.index] = feature.geometry?.coordinates ?? null;
  }
  return points;
}

/**
 * d3-geo treats polygons as spherical, with clockwise exterior rings. Natural Earth files use
 * the GeoJSON (counter-clockwise) convention, so flip any polygon that covers more than a hemisphere.
 */
function forD3(feature) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  const coordinates = polygons.map((rings) =>
    geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI
      ? rings.map((ring) => [...ring].reverse())
      : rings,
  );
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates } };
}

/**
 * A sea label point must be at sea in the geometry the globe draws, or route checks would
 * treat it as land. When the inner point of a narrow water body falls on simplified land,
 * use the nearest grid point that is inside the water body and off land. Returns null when the
 * water body is entirely covered by simplified land (a few slivers in Natural Earth).
 * Points are tested as stored, after rounding, so rounding cannot move them onto land.
 */
function seaPoint(source, [lng, lat]) {
  const atSea = ([x, y]) => !landIndex.isLand([y, x]);
  const stored = [round(lng), round(lat)];
  if (atSea(stored)) return stored;
  const feature = forD3(source);
  let best = null;
  for (const step of [0.05, 0.02, 0.01]) {
    for (let dLat = -1.5; dLat <= 1.5; dLat += step) {
      for (let dLng = -1.5; dLng <= 1.5; dLng += step) {
        const candidate = [round(lng + dLng), round(lat + dLat)];
        if (!geoContains(feature, candidate) || !atSea(candidate)) {
          continue;
        }
        const distance = distanceKm([lat, lng], [candidate[1], candidate[0]]);
        if (!best || distance < best.distance) best = { point: candidate, distance };
      }
    }
    if (best) return best.point;
  }
  return null;
}

const PASSAGE_CLASSES = new Set(['strait', 'channel']);
/** Other marine features that sea routes pass through end to end, such as the Gulf of Suez. */
const passageOverrides = new Map(overrides.passages.map((passage) => [passage.neId, passage]));
// Bands per unit of length-to-width ratio: narrow, winding straits get more points.
const PASSAGE_BANDS_PER_RATIO = 2.5;
const PASSAGE_MIN_BANDS = 3;
const PASSAGE_MAX_BANDS = 12;
/** How far outside its loosely drawn polygon a passage path may use open water. */
const PASSAGE_MARGIN_KM = 30;
/** Canal centerlines are simplified to within this distance. */
const CANAL_TOLERANCE_KM = 0.5;

/**
 * The two ends of a strait or channel: interior points at either end of the feature's long axis,
 * found by slicing the polygon into bands across its principal axis and taking the interior point
 * of the first and last band.
 */
async function passageEnds(feature) {
  const ring =
    feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates[0]
      : feature.geometry.coordinates.flatMap((polygon) => polygon[0]);
  const lat0 = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const lng0 = ring.reduce((sum, [lng]) => sum + lng, 0) / ring.length;
  const scale = Math.cos((lat0 * Math.PI) / 180);
  // Local planar coordinates in degrees of latitude.
  const local = ring.map(([lng, lat]) => [(lng - lng0) * scale, lat - lat0]);
  const toLngLat = ([x, y]) => [lng0 + x / scale, lat0 + y];

  // Principal axis of the outline's vertices.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of local) {
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const axis = [Math.cos(angle), Math.sin(angle)];
  const across = [-axis[1], axis[0]];
  const along = local.map(([x, y]) => x * axis[0] + y * axis[1]);
  const width = local.map(([x, y]) => x * across[0] + y * across[1]);
  const [start, end] = [Math.min(...along), Math.max(...along)];
  const half = Math.max(...width.map(Math.abs)) + 1;
  const ratio = (end - start) / Math.max(1e-6, Math.max(...width) - Math.min(...width));
  const bands = Math.min(
    PASSAGE_MAX_BANDS,
    Math.max(PASSAGE_MIN_BANDS, Math.round(ratio * PASSAGE_BANDS_PER_RATIO)),
  );
  const step = (end - start) / bands;

  const path = [];
  for (let band = 0; band < bands; band += 1) {
    const [a, b] = [start + band * step, start + (band + 1) * step];
    const corner = (t, w) => toLngLat([axis[0] * t + across[0] * w, axis[1] * t + across[1] * w]);
    const slice = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [corner(a, -half), corner(b, -half), corner(b, half), corner(a, half), corner(a, -half)],
        ],
      },
    };
    const output = await mapshaper.applyCommands(
      '-i strait.geojson -clip slice.geojson -points inner -o out.geojson',
      {
        'strait.geojson': JSON.stringify({
          type: 'FeatureCollection',
          features: [{ ...feature, properties: { band } }],
        }),
        'slice.geojson': JSON.stringify({ type: 'FeatureCollection', features: [slice] }),
      },
    );
    const inner = JSON.parse(output['out.geojson'].toString()).features?.[0]?.geometry?.coordinates;
    const point = inner && seaPoint(feature, inner);
    if (point) path.push([round(point[1]), round(point[0])]);
  }
  // Moving a point off simplified land can reorder neighbours; keep the path in axis order.
  const position = ([lat, lng]) => (lng - lng0) * scale * axis[0] + (lat - lat0) * axis[1];
  path.sort((a, b) => position(a) - position(b));
  return path.length >= 2 ? [path[0], path.at(-1)] : undefined;
}

const landPolygons = land.features.flatMap((feature) =>
  feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates,
);
const polygonsOf = (feature) =>
  feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
/** Passages whose path crosses land the globe draws, with the length on land, for the report. */
const closedPassages = [];
/** Straits and channels with no way through their water, so no passage path. */
const pathless = [];

/**
 * Straits and channels are long and narrow, so their label point (the widest spot) is a poor
 * route waypoint. Give them a passage path instead: the way through the water from one end to
 * the other (see passage-paths.mjs). A route through the strait follows this path.
 */
async function passagePath(name, feature, ends) {
  const settleEnds = !ends;
  ends ??= await passageEnds(feature);
  if (!ends) return undefined;
  const result = waterPath({
    polygons: polygonsOf(feature),
    start: ends[0],
    end: ends[1],
    land: landIndex,
    landPolygons,
    marginKm: PASSAGE_MARGIN_KM,
    settleEnds,
  });
  if (!result) {
    pathless.push(name);
    return undefined;
  }
  const { path, landKm } = result;
  if (landKm > 0) closedPassages.push(`${name} (${Math.round(landKm)} km)`);
  return path.map(([lat, lng]) => [round(lat), round(lng)]);
}

const entries = [];
const byId = new Map();
const skipped = [];
const dropped = [];
const KIND_SUFFIX = { water: 'water', region: 'region', place: 'city', country: 'country' };

const renames = new Map(
  overrides.rename.map((rename) => [`${rename.dataset}:${rename.from}`, rename]),
);
const renamesUsed = new Set();

function add(candidate) {
  const renameKey = `${candidate.source}:${candidate.name}`;
  const rename = renames.get(renameKey);
  if (rename) renamesUsed.add(renameKey);
  const entry = rename ? { ...candidate, name: rename.to } : candidate;
  let id = slugify(entry.name);
  if (byId.has(id)) {
    const existing = byId.get(id);
    if (existing.kind === entry.kind) {
      // Same name and kind: keep the higher-ranked feature that was added first.
      skipped.push(`${entry.name} (${entry.source})`);
      return;
    }
    id = `${id}-${KIND_SUFFIX[entry.kind]}`;
    if (byId.has(id)) {
      skipped.push(`${entry.name} (${entry.source})`);
      return;
    }
  }
  const complete = { id, ...entry, lat: round(entry.lat), lng: round(entry.lng) };
  entries.push(complete);
  byId.set(id, complete);
}

const byRank = (key) => (a, b) =>
  (a.properties[key] ?? 99) - (b.properties[key] ?? 99) ||
  (englishName(a.properties) ?? '').localeCompare(englishName(b.properties) ?? '');

// Countries first, so a country keeps the plain slug (singapore) over its capital (singapore-city).
for (const country of countries) {
  add({
    name: country.name,
    kind: 'country',
    surface: 'land',
    lat: country.lat,
    lng: country.lng,
    countryId: country.id,
    source: 'countries',
  });
}

// Seas, straits, gulfs and bays. Natural Earth's river-mouth polygons are left to the rivers set.
{
  const features = datasets.marine.features
    .filter(
      (f) => englishName(f.properties) && !['river', 'generic'].includes(f.properties.featurecla),
    )
    .sort(byRank('scalerank'));
  const names = distinctNames(features);
  const points = await innerPoints(features);
  for (const [index, feature] of features.entries()) {
    const point = seaPoint(feature, points[index]);
    if (!point) {
      dropped.push(names[index]);
      continue;
    }
    const [lng, lat] = point;
    const isPassage =
      PASSAGE_CLASSES.has(feature.properties.featurecla) ||
      passageOverrides.has(feature.properties.ne_id);
    // Passages that end where they meet named water bodies get their path once those are added.
    const path =
      isPassage && !passageOverrides.get(feature.properties.ne_id)?.between
        ? await passagePath(names[index], feature)
        : undefined;
    add({
      name: names[index],
      kind: 'water',
      surface: 'sea',
      lat,
      lng,
      ...(path ? { path } : {}),
      source: 'marine',
      neId: feature.properties.ne_id,
    });
  }
}

// Passages whose ends are where they meet two named water bodies, such as the Northwest Passage
// between Baffin Bay and the Amundsen Gulf; Natural Earth's archipelago polygon has no single
// long axis to find them by.
for (const { neId, name, between } of overrides.passages) {
  if (!between) continue;
  const entry = entries.find((candidate) => candidate.source === 'marine' && candidate.neId === neId);
  if (!entry) throw new Error(`Override passage not found: ${neId} (${name})`);
  const feature = datasets.marine.features.find((f) => f.properties.ne_id === neId);
  const ends = between.map((placeId) => {
    const middle = sharedBoundaryMiddle(feature, marineFeature(placeId));
    if (!middle) throw new Error(`Override passage ${name}: does not meet ${placeId}`);
    return [middle[1], middle[0]];
  });
  const path = await passagePath(entry.name, feature, ends);
  if (path) entry.path = path;
}

// Major rivers: one entry per river, labelled at the middle vertex of its longest line.
{
  const rivers = new Map();
  for (const feature of datasets.rivers.features) {
    const { properties } = feature;
    if (properties.featurecla !== 'River' || !properties.name) continue;
    if (properties.scalerank > RIVER_MAX_SCALERANK && !isIncluded('rivers', properties)) continue;
    // Natural Earth splits long rivers into several features; join them by name.
    const key = englishName(properties);
    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    const river = rivers.get(key) ?? { properties, lines: [] };
    river.lines.push(...lines);
    if (properties.scalerank < river.properties.scalerank) river.properties = properties;
    rivers.set(key, river);
  }
  const lineLength = (line) =>
    line
      .slice(1)
      .reduce((sum, [lng, lat], i) => sum + distanceKm([line[i][1], line[i][0]], [lat, lng]), 0);
  const sorted = [...rivers.values()].sort(
    (a, b) =>
      a.properties.scalerank - b.properties.scalerank ||
      a.properties.name.localeCompare(b.properties.name),
  );
  for (const { properties, lines } of sorted) {
    const longest = lines.reduce((best, line) =>
      lineLength(line) > lineLength(best) ? line : best,
    );
    const [lng, lat] = longest[Math.floor(longest.length / 2)];
    const base = englishName(properties);
    const name = /river/i.test(base) ? base : `${base} River`;
    add({
      name,
      kind: 'water',
      surface: 'land',
      lat,
      lng,
      source: 'rivers',
      neId: properties.ne_id,
    });
  }
}

// Canals listed in the overrides. Natural Earth draws them as river and lake centerlines; the
// joined centerline is the canal's passage path, and its label point is halfway along it.
for (const canal of overrides.canals) {
  const lines = datasets.rivers.features
    .filter((feature) => englishName(feature.properties) === canal.name)
    .flatMap((feature) =>
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates,
    );
  if (!lines.length) throw new Error(`Override canal not found: ${canal.name}`);
  const centerline = joinLines(lines);
  const path = simplifyLine(centerline, CANAL_TOLERANCE_KM);
  const [lat, lng] = midpoint(centerline);
  add({
    name: canal.name,
    kind: 'water',
    surface: landIndex.isLand([round(lat), round(lng)]) ? 'land' : 'sea',
    lat,
    lng,
    path: path.map(([pointLat, pointLng]) => [round(pointLat), round(pointLng)]),
    source: 'rivers',
  });
  if (!byId.has(slugify(canal.name))) throw new Error(`Override canal shadowed: ${canal.name}`);
}

// Physical regions: islands, peninsulas, ranges, plains, deserts, basins.
{
  const features = datasets.regions.features
    .filter((f) => f.properties.FEATURECLA !== 'Dragons-be-here')
    .filter(
      (f) => f.properties.SCALERANK <= REGION_MAX_SCALERANK || isIncluded('regions', f.properties),
    )
    .sort(byRank('SCALERANK'));
  // Natural Earth names both the Brazilian Highlands and the Planalto Central "Brazilian Highlands".
  const names = distinctNames(features);
  const points = await innerPoints(features);
  features.forEach((feature, index) => {
    const { properties } = feature;
    const name = names[index];
    const [lng, lat] = points[index];
    const isLake = properties.FEATURECLA === 'Lake';
    add({
      name,
      kind: isLake ? 'water' : 'region',
      surface: 'land',
      lat,
      lng,
      source: 'regions',
      neId: properties.NE_ID,
    });
  });
}

// First-level administrative regions, only when listed in the overrides (e.g. Sabah, French Guiana).
{
  const features = datasets.admin1.features.filter((f) => isIncluded('admin1', f.properties));
  for (const { properties } of features) {
    add({
      name: englishName(properties),
      kind: 'region',
      surface: 'land',
      lat: properties.latitude,
      lng: properties.longitude,
      source: 'admin1',
      neId: properties.ne_id,
    });
  }
}

// Populated places: major cities and every national capital.
{
  const features = datasets.places.features
    .filter(
      (f) =>
        f.properties.scalerank <= PLACE_MAX_SCALERANK ||
        f.properties.featurecla === 'Admin-0 capital' ||
        isIncluded('places', f.properties),
    )
    .sort(byRank('scalerank'));
  for (const { properties } of features) {
    add({
      name: displayName(properties.name),
      kind: 'place',
      surface: 'land',
      lat: properties.latitude,
      lng: properties.longitude,
      countryId: properties.adm0_a3,
      source: 'places',
      neId: properties.ne_id,
    });
  }
}

for (const key of renames.keys()) {
  if (!renamesUsed.has(key)) throw new Error(`Override rename not used: ${key}`);
}
for (const { neId, name } of overrides.passages) {
  if (!entries.some((entry) => entry.source === 'marine' && entry.neId === neId && entry.path)) {
    throw new Error(`Override passage not found or without a path: ${neId} (${name})`);
  }
}
for (const { dataset, neId, name } of overrides.include) {
  if (!entries.some((entry) => entry.source === dataset && entry.neId === neId)) {
    throw new Error(`Override include not found or shadowed: ${dataset} ${neId} (${name})`);
  }
}

/** The Natural Earth marine polygon behind a gazetteer water body. */
function marineFeature(placeId) {
  const place = byId.get(placeId);
  const feature =
    place?.source === 'marine' &&
    datasets.marine.features.find((f) => f.properties.ne_id === place.neId);
  if (!feature) throw new Error(`No marine polygon for gazetteer place ${placeId}`);
  return feature;
}

/**
 * Where two Natural Earth marine polygons meet: the middle of the line between the two farthest
 * apart of their shared vertices, as [lng, lat]. Null when they share fewer than two vertices.
 */
function sharedBoundaryMiddle(a, b) {
  const vertices = (feature) => polygonsOf(feature).flatMap((rings) => rings.flat());
  const other = new Set(vertices(b).map(([lng, lat]) => `${lng},${lat}`));
  const shared = vertices(a).filter(([lng, lat]) => other.has(`${lng},${lat}`));
  let line;
  for (const p of shared) {
    for (const q of shared) {
      const length = distanceKm([p[1], p[0]], [q[1], q[0]]);
      if (!line || length > line.length) line = { p, q, length };
    }
  }
  return line?.length ? [(line.p[0] + line.q[0]) / 2, (line.p[1] + line.q[1]) / 2] : null;
}

/** A polygon approximating a circle of `radiusKm` around [lng, lat], counter-clockwise. */
function circlePolygon([lng, lat], radiusKm, sides = 72) {
  const dLat = radiusKm / 111.195;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const ring = Array.from({ length: sides + 1 }, (_, index) => {
    const angle = (2 * Math.PI * (index % sides)) / sides;
    return [lng + dLng * Math.cos(angle), lat + dLat * Math.sin(angle)];
  });
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * A strait Natural Earth draws only as the line where two marine polygons meet (the Strait of
 * Hormuz between the Persian Gulf and the Gulf of Oman). The label point is the middle of the
 * shared boundary; the passage runs from the part of one water body within `radiusKm` of it to
 * the part of the other.
 */
async function junctionPassage(name, { placeIds, radiusKm }) {
  const features = placeIds.map(marineFeature);
  const middle = sharedBoundaryMiddle(features[0], features[1]);
  if (!middle) throw new Error(`${name}: ${placeIds.join(' and ')} do not meet`);
  const union = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: features.flatMap(polygonsOf) },
  };
  const point = seaPoint(union, middle);
  if (!point) throw new Error(`${name}: no sea point where ${placeIds.join(' and ')} meet`);

  const circle = JSON.stringify({
    type: 'FeatureCollection',
    features: [circlePolygon(middle, radiusKm)],
  });
  const ends = [];
  for (const feature of features) {
    const output = await mapshaper.applyCommands(
      '-i water.geojson -clip circle.geojson -points inner -o out.geojson',
      {
        'water.geojson': JSON.stringify({ type: 'FeatureCollection', features: [feature] }),
        'circle.geojson': circle,
      },
    );
    const inner = JSON.parse(output['out.geojson'].toString()).features?.[0]?.geometry?.coordinates;
    const end = inner && seaPoint(feature, inner);
    if (!end) throw new Error(`${name}: no sea point in ${feature.properties.name}`);
    ends.push([end[1], end[0]]);
  }
  const path = await passagePath(name, union, ends);
  if (!path) throw new Error(`${name}: no way through`);
  return { point, path };
}

// Features Natural Earth lacks. Each is anchored to Natural Earth geometry, never typed coordinates.
for (const feature of overrides.features) {
  const { anchor } = feature;
  let point;
  let path;
  if (anchor.type === 'junction') {
    ({ point, path } = await junctionPassage(feature.name, anchor));
  } else if (anchor.type === 'place') {
    const target = byId.get(anchor.placeId);
    if (!target) throw new Error(`Override ${feature.id}: unknown anchor place ${anchor.placeId}`);
    point = [target.lng, target.lat];
  } else if (anchor.type === 'countryPart') {
    const country = land.features.find((f) => f.properties.ADM0_A3 === anchor.countryId);
    const target = byId.get(anchor.containingPlaceId);
    if (!country || !target) throw new Error(`Override ${feature.id}: unknown country part anchor`);
    const parts =
      country.geometry.type === 'Polygon'
        ? [country.geometry.coordinates]
        : country.geometry.coordinates;
    const part = parts.find((coordinates) =>
      geoContains({ type: 'Polygon', coordinates }, [target.lng, target.lat]),
    );
    if (!part)
      throw new Error(
        `Override ${feature.id}: ${anchor.containingPlaceId} is not inside ${anchor.countryId}`,
      );
    [point] = await innerPoints([
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: part } },
    ]);
  } else {
    throw new Error(`Override ${feature.id}: unknown anchor type ${anchor.type}`);
  }
  if (byId.has(feature.id))
    throw new Error(`Override ${feature.id} collides with a Natural Earth feature`);
  const entry = {
    id: feature.id,
    name: feature.name,
    kind: feature.kind,
    surface: feature.surface ?? 'land',
    lat: round(point[1]),
    lng: round(point[0]),
    ...(path ? { path } : {}),
    source: 'override',
  };
  entries.push(entry);
  byId.set(entry.id, entry);
}

entries.sort((a, b) => a.id.localeCompare(b.id));
// One feature per line keeps the file compact and its diffs readable.
writeFileSync(
  OUTPUT,
  `[\n${entries.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}\n]\n`,
);
updateSourcesManifest('gazetteer', {
  source: 'Natural Earth, public domain',
  datasets: Object.fromEntries(Object.keys(datasets).map((name) => [name, sourceRecord(name)])),
  filters: {
    marine: 'all named features except river mouths',
    rivers: `featurecla River, scalerank <= ${RIVER_MAX_SCALERANK}; canals named in gazetteer-overrides.json`,
    regions: `scalerank <= ${REGION_MAX_SCALERANK}`,
    places: `scalerank <= ${PLACE_MAX_SCALERANK}, or a national capital`,
    admin1: 'only features listed in gazetteer-overrides.json',
  },
  overrides: OVERRIDES,
  seaPointGeometry: LAND_GEOMETRY,
  features: entries.length,
});

const counts = entries.reduce(
  (sum, entry) => ({ ...sum, [entry.source]: (sum[entry.source] ?? 0) + 1 }),
  {},
);
console.log(`${OUTPUT}: ${entries.length} features`, counts);
if (dropped.length)
  console.log(
    `Dropped ${dropped.length} water bodies with no sea label point: ${dropped.join(', ')}`,
  );
if (pathless.length)
  console.log(`No passage path through ${pathless.length} straits: ${pathless.join(', ')}`);
if (closedPassages.length)
  console.log(
    `Passage paths across land the globe draws closed: ${closedPassages.join(', ')}`,
  );
if (skipped.length) console.log(`Skipped ${skipped.length} duplicate names: ${skipped.join(', ')}`);
