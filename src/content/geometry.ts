// Pure spherical geometry for map scenes: distances, great-circle polylines, and land checks.
// Nothing here knows about content or the gazetteer, so it can run in scripts, tests and the browser.
import { geoBounds, geoContains, geoDistance, geoInterpolate } from 'd3-geo';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';

/** A point as [lat, lng], matching the globe-level scene types. */
export type LatLng = [lat: number, lng: number];

export const EARTH_RADIUS_KM = 6371.0088;

const toLngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];
const toLatLng = ([lng, lat]: [number, number]): LatLng => [lat, lng];

export function distanceKm(a: LatLng, b: LatLng): number {
  return geoDistance(toLngLat(a), toLngLat(b)) * EARTH_RADIUS_KM;
}

/**
 * Points along the great circle from `a` to `b`, including both ends,
 * spaced no more than `maxStepKm` apart.
 */
export function interpolateGreatCircle(a: LatLng, b: LatLng, maxStepKm = 50): LatLng[] {
  const steps = Math.max(1, Math.ceil(distanceKm(a, b) / maxStepKm));
  const interpolate = geoInterpolate(toLngLat(a), toLngLat(b));
  const points: LatLng[] = [];
  for (let step = 0; step <= steps; step += 1) {
    points.push(toLatLng(interpolate(step / steps)));
  }
  return points;
}

/** A polyline through every waypoint, following great circles between consecutive waypoints. */
export function routePolyline(waypoints: LatLng[], maxStepKm = 50): LatLng[] {
  const points: LatLng[] = [];
  waypoints.forEach((waypoint, index) => {
    if (index === 0) {
      points.push(waypoint);
      return;
    }
    points.push(...interpolateGreatCircle(waypoints[index - 1], waypoint, maxStepKm).slice(1));
  });
  return points;
}

export interface LandIndex {
  isLand(point: LatLng): boolean;
}

type IndexedPolygon = {
  feature: Feature<Polygon>;
  west: number;
  south: number;
  east: number;
  north: number;
};

function withinBounds(polygon: IndexedPolygon, [lat, lng]: LatLng): boolean {
  if (lat < polygon.south || lat > polygon.north) return false;
  // Bounds that cross the antimeridian have west > east.
  return polygon.west <= polygon.east
    ? lng >= polygon.west && lng <= polygon.east
    : lng >= polygon.west || lng <= polygon.east;
}

/**
 * Point-in-land lookup over polygon features (for example the bundled country geometry).
 * Each polygon is indexed by its spherical bounding box so only nearby shapes are tested.
 */
export function createLandIndex(land: FeatureCollection<Polygon | MultiPolygon>): LandIndex {
  const polygons: IndexedPolygon[] = [];
  for (const feature of land.features) {
    const rings =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const coordinates of rings) {
      const polygon: Feature<Polygon> = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates },
      };
      const [[west, south], [east, north]] = geoBounds(polygon);
      polygons.push({ feature: polygon, west, south, east, north });
    }
  }
  return {
    isLand(point) {
      const lngLat = toLngLat(point);
      return polygons.some(
        (polygon) => withinBounds(polygon, point) && geoContains(polygon.feature, lngLat),
      );
    },
  };
}

export type RouteWaypoint = {
  id: string;
  point: LatLng;
  /** Whether the waypoint itself is at sea or on land (a port or coastal place). */
  surface: 'sea' | 'land';
  /**
   * For a point of a passage path, the index of its stop in the route. Segments between points
   * of the same passage follow the path the gazetteer build traced through the passage's water,
   * so the land check skips them.
   */
  passage?: number;
};

/** A route stop before expansion: a straits-like feature may carry a passage path. */
export type RouteStop = RouteWaypoint & {
  /** Points along a strait or channel, in either direction. The route follows them. */
  path?: LatLng[];
};

/**
 * Replace each stop that has a passage path with the path's points, oriented in the direction
 * of travel: the end nearer the previous point comes first (or, for the first stop, the end
 * farther from the next stop).
 */
export function expandRouteStops(stops: RouteStop[]): RouteWaypoint[] {
  const waypoints: RouteWaypoint[] = [];
  stops.forEach((stop, index) => {
    if (!stop.path || stop.path.length < 2) {
      waypoints.push({ id: stop.id, point: stop.point, surface: stop.surface });
      return;
    }
    const forward = stop.path;
    const backward = [...stop.path].reverse();
    const previous = waypoints.at(-1)?.point;
    const next = stops[index + 1]?.point;
    let path = forward;
    if (previous) {
      path =
        distanceKm(previous, backward[0]) < distanceKm(previous, forward[0]) ? backward : forward;
    } else if (next) {
      path =
        distanceKm(next, backward.at(-1)!) < distanceKm(next, forward.at(-1)!) ? backward : forward;
    }
    for (const point of path) waypoints.push({ id: stop.id, point, surface: 'sea', passage: index });
  });
  return waypoints;
}

export type LandCrossing = {
  /** Waypoint IDs of the segment that crosses land. */
  from: string;
  to: string;
  /** First sampled point on land. */
  point: LatLng;
  /** Approximate length of the crossing. */
  lengthKm: number;
};

export type SeaRouteCheckOptions = {
  /** Sampling interval along each great-circle segment. */
  stepKm?: number;
  /**
   * Land within this distance of a land waypoint is allowed, so a route can start at,
   * stop at, or end at a port. Land anywhere else means the route crosses land.
   */
  portRadiusKm?: number;
  /**
   * Crossings this short or shorter are ignored. They are small islands, or the limit of
   * comparing a straight segment with simplified coastlines; neither is visible on the globe.
   */
  toleranceKm?: number;
};

export const SEA_ROUTE_CHECK_DEFAULTS: Required<SeaRouteCheckOptions> = {
  stepKm: 2,
  portRadiusKm: 50,
  toleranceKm: 15,
};

/**
 * Find places where a sea route crosses land.
 * Each segment between consecutive waypoints is sampled along its great circle;
 * consecutive land samples are reported as one crossing.
 * Segments inside one passage path (a strait, channel or canal) are not sampled: the gazetteer
 * build traced that path through the passage's own water and verified it, including where the
 * land geometry closes the water (a canal, or a river channel narrower than the coastline
 * detail). The segments into and out of a passage are checked like any other.
 */
export function findSeaRouteLandCrossings(
  waypoints: RouteWaypoint[],
  land: LandIndex,
  options: SeaRouteCheckOptions = {},
): LandCrossing[] {
  const { stepKm, portRadiusKm, toleranceKm } = { ...SEA_ROUTE_CHECK_DEFAULTS, ...options };
  const ports = waypoints.filter((waypoint) => waypoint.surface === 'land');
  const nearPort = (point: LatLng) =>
    ports.some((port) => distanceKm(port.point, point) <= portRadiusKm);
  const crossings: LandCrossing[] = [];

  for (let index = 1; index < waypoints.length; index += 1) {
    const from = waypoints[index - 1];
    const to = waypoints[index];
    if (from.passage !== undefined && from.passage === to.passage) continue;
    const samples = interpolateGreatCircle(from.point, to.point, stepKm);
    const spacingKm = distanceKm(from.point, to.point) / Math.max(1, samples.length - 1);
    let current: LandCrossing | undefined;
    for (const sample of samples) {
      const crossesLand = land.isLand(sample) && !nearPort(sample);
      if (crossesLand && current) {
        current.lengthKm += spacingKm;
      } else if (crossesLand) {
        current = { from: from.id, to: to.id, point: sample, lengthKm: spacingKm };
        crossings.push(current);
      } else {
        current = undefined;
      }
    }
  }
  return crossings
    .filter((crossing) => crossing.lengthKm > toleranceKm)
    .map((crossing) => ({ ...crossing, lengthKm: Math.round(crossing.lengthKm) }));
}
