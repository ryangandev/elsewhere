// The gazetteer as the model sees it. Places are chosen by ID from these listings; the model
// never writes coordinates. Coordinates are shown, rounded, only so it can judge what is near
// what and put route waypoints in a sensible order.
//
// - sharedListing: every water body, river and country. Identical for every request, so it sits
//   in the cached system prompt.
// - countryCandidates: cities and regions in and around one country, in that country's task.
// - findPlaces: the find_places tool, a search over the whole gazetteer for anything else.
import { readFileSync } from 'node:fs';
import { geoBounds } from 'd3-geo';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { distanceKm } from '../../src/content/geometry';
import type { GazetteerPlace } from '../../src/content/schema';
import { LAND_GEOMETRY_FILE } from '../config';
import { gazetteerPlaces, requireMapCountry } from '../content-tree';

const round = (value: number) => Math.round(value * 10) / 10;

/** Natural Earth's river centerlines give the gazetteer its rivers and its canals. */
const isRiver = (place: GazetteerPlace) =>
  place.source === 'rivers' && !/\bcanal$/i.test(place.name);

function describe(place: GazetteerPlace): string {
  const kind =
    place.kind === 'water'
      ? isRiver(place)
        ? 'river (a route follows its course, from or to the point nearest a city beside it)'
        : place.path
          ? 'passage (a route follows it end to end)'
          : place.surface === 'land'
            ? 'lake'
            : 'sea'
      : place.kind === 'country'
        ? `country ${place.countryId}`
        : place.kind === 'place'
          ? `city${place.countryId ? ` in ${place.countryId}` : ''}`
          : `region${place.countryId ? ` in ${place.countryId}` : ''}`;
  return `${place.id} | ${place.name} | ${kind} | ${round(place.lat)}, ${round(place.lng)}`;
}

const isShared = (place: GazetteerPlace) => place.kind === 'water' || place.kind === 'country';

/** Every water body, river and country, one per line, sorted by ID. */
export function sharedListing(): string {
  const places = gazetteerPlaces().filter(isShared);
  const section = (title: string, list: GazetteerPlace[]) =>
    [`## ${title}`, ...list.map(describe)].join('\n');
  return [
    'Format: id | name | kind | lat, lng (for orientation only; never write coordinates).',
    section(
      'Seas, straits, canals and rivers',
      places.filter((place) => place.kind === 'water'),
    ),
    section(
      'Countries',
      places.filter((place) => place.kind === 'country'),
    ),
  ].join('\n\n');
}

type Bounds = { west: number; south: number; east: number; north: number };

let featureBounds: Map<string, Bounds> | undefined;

/** Spherical bounding boxes of every map identity; west > east when crossing the antimeridian. */
function countryBounds(countryId: string): Bounds | undefined {
  if (!featureBounds) {
    const geometry = JSON.parse(readFileSync(LAND_GEOMETRY_FILE, 'utf8')) as FeatureCollection<
      Polygon | MultiPolygon,
      { ADM0_A3: string }
    >;
    featureBounds = new Map(
      geometry.features.map((feature: Feature<Polygon | MultiPolygon, { ADM0_A3: string }>) => {
        const [[west, south], [east, north]] = geoBounds(feature);
        return [feature.properties.ADM0_A3, { west, south, east, north }];
      }),
    );
  }
  return featureBounds.get(countryId);
}

const normalizeLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

function withinExpanded(bounds: Bounds, place: GazetteerPlace): boolean {
  const lngSpan = (bounds.east - bounds.west + 360) % 360 || 360;
  const margin = Math.min(12, Math.max(3, 0.25 * Math.max(lngSpan, bounds.north - bounds.south)));
  if (place.lat < bounds.south - margin || place.lat > bounds.north + margin) return false;
  if (lngSpan + 2 * margin >= 360) return true;
  const offset = normalizeLng(place.lng - (bounds.west - margin));
  const fromWest = offset < 0 ? offset + 360 : offset;
  return fromWest <= lngSpan + 2 * margin;
}

/**
 * Cities and regions in and around a country: everything inside its bounding box widened by a
 * margin, the country's own places first, then by distance from its label point.
 */
export function countryCandidates(countryId: string, limit = 250): GazetteerPlace[] {
  const country = requireMapCountry(countryId);
  const bounds = countryBounds(country.id);
  const anchor: [number, number] = [country.lat, country.lng];
  return gazetteerPlaces()
    .filter((place) => !isShared(place))
    .filter((place) => place.countryId === country.id || (bounds && withinExpanded(bounds, place)))
    .map((place) => ({
      place,
      own: place.countryId === country.id ? 0 : 1,
      distance: distanceKm(anchor, [place.lat, place.lng]),
    }))
    .sort((a, b) => a.own - b.own || a.distance - b.distance)
    .slice(0, limit)
    .map(({ place }) => place);
}

export function candidateListing(countryId: string): string {
  return countryCandidates(countryId).map(describe).join('\n');
}

export type FindPlacesInput = {
  query: string | null;
  /** One map country, or several for places in any of them (the agent places command). */
  countryId: string | readonly string[] | null;
  near: string | null;
};

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** The find_places tool: name or ID search, optionally within a country or near a place. */
export function findPlaces(input: FindPlacesInput, limit = 25): string {
  const places = gazetteerPlaces();
  const near = input.near ? places.find((place) => place.id === input.near) : undefined;
  if (input.near && !near) return `Unknown place "${input.near}". Search by name first.`;
  const query = input.query ? fold(input.query.trim()) : '';
  const countryIds = new Set([input.countryId ?? []].flat().map((id) => id.toUpperCase()));
  const matches = places
    .filter((place) => !countryIds.size || countryIds.has(place.countryId ?? ''))
    .filter(
      (place) =>
        !query || fold(place.name).includes(query) || place.id.includes(query.replace(/\s+/g, '-')),
    )
    .map((place) => ({
      place,
      distance: near ? distanceKm([near.lat, near.lng], [place.lat, place.lng]) : 0,
    }))
    .sort((a, b) => a.distance - b.distance || a.place.id.localeCompare(b.place.id))
    .slice(0, limit);
  if (!matches.length) {
    return 'No gazetteer places match. Try a shorter name, another spelling, or a nearby feature.';
  }
  return matches
    .map(
      ({ place, distance }) => `${describe(place)}${near ? ` | ${Math.round(distance)} km` : ''}`,
    )
    .join('\n');
}
