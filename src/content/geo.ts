// Geographic data behind the content: the gazetteer of named places, the table of map
// identities, and the route geometry built from them. Coordinates only ever come from here.
import countriesJson from '../../data/geo/countries.json';
import gazetteerJson from '../../data/geo/gazetteer.json';
import {
  expandRouteStops,
  findSeaRouteLandCrossings,
  routePolyline,
  type LandCrossing,
  type LandIndex,
  type LatLng,
  type RouteStop,
  type SeaRouteCheckOptions,
} from './geometry';
import { GazetteerPlace, MapCountry, type SceneRouteSpec } from './schema';

export * from './geometry';

/** Spacing of points on rendered route polylines. */
const ROUTE_STEP_KM = 50;

let gazetteerIndex: Map<string, GazetteerPlace> | undefined;
let mapCountryIndex: { byId: Map<string, MapCountry>; bySlug: Map<string, MapCountry> } | undefined;

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

/** The stops of a route, with passage paths for straits and channels. */
export function routeStops(route: Pick<SceneRouteSpec, 'via'>): RouteStop[] {
  return route.via.map((id) => {
    const place = requirePlace(id);
    return {
      id,
      point: [place.lat, place.lng],
      surface: place.surface,
      ...(place.path ? { path: place.path } : {}),
    };
  });
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** The polyline a route is drawn with: great circles through its stops, as [lat, lng] points. */
export function routePoints(route: Pick<SceneRouteSpec, 'via'>): LatLng[] {
  const waypoints = expandRouteStops(routeStops(route)).map((waypoint) => waypoint.point);
  return routePolyline(waypoints, ROUTE_STEP_KM).map(([lat, lng]) => [round(lat), round(lng)]);
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
