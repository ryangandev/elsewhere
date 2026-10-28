// Geographic data behind the content: the gazetteer of named places, the table of map
// identities, and the route geometry built from them. Coordinates only ever come from here.
import { readFileSync } from 'node:fs';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { labelCandidates } from '@/globe/label-candidates';
import countriesJson from '../../data/geo/countries.json';
import gazetteerJson from '../../data/geo/gazetteer.json';
import {
  distanceKm,
  expandRouteStops,
  findSeaRouteLandCrossings,
  routePolyline,
  type LandCrossing,
  type LandIndex,
  type LatLng,
  type RouteStop,
  type SeaRouteCheckOptions,
} from './geometry';
import { GazetteerPlace, MapCountry, type RouteKind, type SceneRouteSpec } from './schema';

export * from './geometry';

/** Spacing of points on rendered route polylines. */
const ROUTE_STEP_KM = 50;
/** The globe's base country geometry, relative to the repository root. */
const COUNTRY_GEOMETRY = 'public/maps/countries.geojson';
/**
 * A country place moves off its anchor only to a label point this much closer to the scene's
 * center, so it keeps its usual place unless another part of the country is clearly nearer.
 */
const NEARER_PART_RATIO = 0.5;

let gazetteerIndex: Map<string, GazetteerPlace> | undefined;
let mapCountryIndex: { byId: Map<string, MapCountry>; bySlug: Map<string, MapCountry> } | undefined;
let countryShapes: Map<string, Polygon | MultiPolygon> | undefined;
const countryPoints = new Map<string, LatLng[]>();

function gazetteer(): Map<string, GazetteerPlace> {
  gazetteerIndex ??= new Map(
    GazetteerPlace.array()
      .parse(gazetteerJson)
      .map((place) => [place.id, place]),
  );
  return gazetteerIndex;
}

function mapCountries() {
  if (!mapCountryIndex) {
    const all = MapCountry.array().parse(countriesJson);
    mapCountryIndex = {
      byId: new Map(all.map((country) => [country.id, country])),
      bySlug: new Map(all.map((country) => [country.slug, country])),
    };
  }
  return mapCountryIndex;
}

export function getPlace(id: string): GazetteerPlace | undefined {
  return gazetteer().get(id);
}

export function listPlaces(): GazetteerPlace[] {
  return [...gazetteer().values()];
}

/** Label point of a gazetteer place, as [lat, lng]. Throws for an unknown ID. */
export function placeCoordinates(id: string): LatLng {
  const place = requirePlace(id);
  return [place.lat, place.lng];
}

function requirePlace(id: string): GazetteerPlace {
  const place = gazetteer().get(id);
  if (!place) throw new Error(`Unknown gazetteer place "${id}"`);
  return place;
}

/** Any of the 258 Natural Earth map identities, by ADM0_A3 ID (any case) or slug. */
export function getMapCountry(idOrSlug: string): MapCountry | undefined {
  const { byId, bySlug } = mapCountries();
  return byId.get(idOrSlug.toUpperCase()) ?? bySlug.get(idOrSlug.toLowerCase());
}

export function listMapCountries(): MapCountry[] {
  return [...mapCountries().byId.values()];
}

function countryShape(countryId: string): Polygon | MultiPolygon | undefined {
  if (!countryShapes) {
    const geometry = JSON.parse(readFileSync(COUNTRY_GEOMETRY, 'utf8')) as FeatureCollection<
      Polygon | MultiPolygon,
      { ADM0_A3: string }
    >;
    countryShapes = new Map(
      geometry.features.map((feature) => [feature.properties.ADM0_A3, feature.geometry]),
    );
  }
  return countryShapes.get(countryId);
}

/**
 * Points a country's name may sit on, as [lat, lng]: its gazetteer label point first, then the
 * interior points the globe also labels from (see src/globe/label-candidates.ts).
 */
export function countryLabelPoints(place: GazetteerPlace): LatLng[] {
  const id = place.countryId ?? place.id;
  let points = countryPoints.get(id);
  if (!points) {
    const shape = countryShape(id);
    points = shape
      ? labelCandidates(shape, place).map((point): LatLng => [round(point.lat), round(point.lng)])
      : [[place.lat, place.lng]];
    countryPoints.set(id, points);
  }
  return points;
}

/**
 * Where a country place sits in a scene centered on `center`: its label point, unless one of
 * its other interior label points is much closer, as Peninsular Malaysia is to the Strait of
 * Malacca while Malaysia's label point is on Borneo.
 */
export function countryPlacePoint(place: GazetteerPlace, center: LatLng): LatLng {
  const [anchor, ...others] = countryLabelPoints(place);
  let best = anchor;
  let bestDistance = distanceKm(anchor, center) * NEARER_PART_RATIO;
  for (const point of others) {
    const distance = distanceKm(point, center);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Route kinds that follow a place's path: a ship's course through a strait, channel or canal,
 * and a river's course. Land routes and flows are illustrative arcs, not courses, so they pass
 * through every place's label point, a strait or river as much as a city.
 */
const FOLLOWS_PATHS: ReadonlySet<RouteKind> = new Set(['sea', 'river']);

/**
 * The stops of a route. In a sea or river route, straits, channels, canals and rivers carry
 * their paths.
 */
export function routeStops(route: Pick<SceneRouteSpec, 'kind' | 'via'>): RouteStop[] {
  const followsPaths = FOLLOWS_PATHS.has(route.kind);
  return route.via.map((id) => {
    const place = requirePlace(id);
    return {
      id,
      point: [place.lat, place.lng],
      surface: place.surface,
      ...(followsPaths && place.path ? { path: place.path } : {}),
    };
  });
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * The polyline a route is drawn with: great circles through its stops, as [lat, lng] points,
 * along the paths of the passages and rivers a sea or river route names.
 */
export function routePoints(route: Pick<SceneRouteSpec, 'kind' | 'via'>): LatLng[] {
  const waypoints = expandRouteStops(routeStops(route)).map((waypoint) => waypoint.point);
  return routePolyline(waypoints, ROUTE_STEP_KM).map(([lat, lng]) => [round(lat), round(lng)]);
}

/**
 * Whether a place's label point is only a spot in a large open sea: an ocean, sea or gulf from
 * Natural Earth's marine areas. Straits, channels and canals carry a path, and lakes and rivers
 * lie on land, so they are never open sea.
 */
export function isOpenSea(place: GazetteerPlace): boolean {
  return place.kind === 'water' && place.surface === 'sea' && !place.path;
}

/**
 * Whether a scene about `focusCountryId` names a place only as a direction, so the globe reaches
 * only a bounded way toward it: an open sea, or a country other than the focus country. Both are
 * label points somewhere in a large area, often far from the part the scene is about.
 */
export function isDirection(place: GazetteerPlace, focusCountryId?: string): boolean {
  return isOpenSea(place) || (place.kind === 'country' && place.countryId !== focusCountryId);
}

/**
 * The points a route is drawn through before the great-circle steps between them: its stops, and
 * the path points of the passages and rivers a sea or river route follows. Stops that are only a
 * direction (see `isDirection`) are marked.
 */
export function routeWaypoints(
  route: Pick<SceneRouteSpec, 'kind' | 'via'>,
  focusCountryId?: string,
): { lat: number; lng: number; direction?: true }[] {
  return expandRouteStops(routeStops(route)).map(({ id, point: [lat, lng], passage }) => ({
    lat: round(lat),
    lng: round(lng),
    ...(passage === undefined && isDirection(requirePlace(id), focusCountryId)
      ? { direction: true as const }
      : {}),
  }));
}

/**
 * Where a route crosses land. Only sea routes are checked: land and river routes are on land
 * by definition, and flows are illustrative arcs.
 */
export function findRouteLandCrossings(
  route: Pick<SceneRouteSpec, 'kind' | 'via'>,
  land: LandIndex,
  options?: SeaRouteCheckOptions,
): LandCrossing[] {
  if (route.kind !== 'sea') return [];
  return findSeaRouteLandCrossings(expandRouteStops(routeStops(route)), land, options);
}
