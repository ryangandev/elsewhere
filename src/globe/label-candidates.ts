import { geoArea } from 'd3-geo';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { ringContains } from './country-lookup';

// Where a country's name may sit. The Natural Earth label point comes first, followed by a
// few well-spread interior points with the most room around them. Layout picks the first
// one that is visible and fits, so a country whose label point lies near the horizon or an
// edge can still be named from its visible side.

export type LabelCandidate = {
  lat: number;
  lng: number;
  // Steradians of the land part the point sits on, for the on-screen size estimate.
  area: number;
  // Distance to the nearest edge of that part, in degrees with horizontal room
  // down-weighted: how much open land surrounds the point.
  room: number;
};

type Part = {
  rings: Position[][];
  area: number;
  west: number;
  east: number;
  south: number;
  north: number;
};

// Grid cells along the longer side of each part; enough to find open interiors cheaply.
const GRID = 10;
// Labels are wide, so horizontal room counts for less than vertical room when ranking points.
const HORIZONTAL_WEIGHT = 0.5;
// Parts smaller than this fraction of the largest part get no extra candidates.
const MIN_PART_SHARE = 0.2;
const MAX_PARTS = 3;
const MIN_ROOM_SHARE = 0.5;

const partContains = (part: Part, lng: number, lat: number) =>
  ringContains(part.rings[0], lng, lat) &&
  !part.rings.slice(1).some((hole) => ringContains(hole, lng, lat));

function toPart(rings: Position[][]): Part {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of rings[0]) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return {
    rings,
    area: geoArea({ type: 'Polygon', coordinates: rings }),
    west,
    east,
    south,
    north,
  };
}

// Squared distance from a point to the nearest edge, in a local plane where a degree of
// longitude shrinks with latitude and horizontal distance is down-weighted.
function clearance(part: Part, lng: number, lat: number, xScale: number) {
  let best = Infinity;
  const px = lng * xScale;
  for (const ring of part.rings) {
    for (let i = 1; i < ring.length; i++) {
      const ax = ring[i - 1][0] * xScale;
      const ay = ring[i - 1][1];
      const dx = ring[i][0] * xScale - ax;
      const dy = ring[i][1] - ay;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / length)) : 0;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - lat;
      best = Math.min(best, ex * ex + ey * ey);
    }
  }
  return best;
}

const cosineOf = (part: Part) =>
  Math.max(0.2, Math.cos((((part.south + part.north) / 2) * Math.PI) / 180));

function interiorPoints(part: Part, quota: number, taken: LabelCandidate[]) {
  const cosLat = cosineOf(part);
  const width = (part.east - part.west) * cosLat;
  const height = part.north - part.south;
  const step = Math.max(width, height) / GRID;
  if (!step) return [];
  const lngStep = step / cosLat;
  const xScale = cosLat * HORIZONTAL_WEIGHT;
  const points: { lng: number; lat: number; room: number }[] = [];
  for (let lat = part.south + step / 2; lat < part.north; lat += step) {
    for (let lng = part.west + lngStep / 2; lng < part.east; lng += lngStep) {
      if (partContains(part, lng, lat))
        points.push({ lng, lat, room: clearance(part, lng, lat, xScale) });
    }
  }
  points.sort((a, b) => b.room - a.room);
  // Spread the picks out, so the alternatives cover different sides of the country.
  const separation = (0.3 * Math.max(width, height)) ** 2;
  const distance = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) =>
    ((a.lng - b.lng) * cosLat) ** 2 + (a.lat - b.lat) ** 2;
  const picked: LabelCandidate[] = [];
  // Thin tails and peninsulas never hold a name, so only open interiors qualify:
  // at least half the room of the most open point (room is a squared distance).
  const minRoom = (points[0]?.room ?? 0) * MIN_ROOM_SHARE ** 2;
  for (const point of points) {
    if (picked.length >= quota || point.room < minRoom) break;
    if ([...taken, ...picked].some((other) => distance(point, other) < separation)) continue;
    picked.push({ lat: point.lat, lng: point.lng, area: part.area, room: Math.sqrt(point.room) });
  }
  return picked;
}

// The anchor first, then up to `limit - 1` interior alternatives from the country's largest parts.
export function labelCandidates(
  geometry: Polygon | MultiPolygon,
  anchor: { lat: number; lng: number },
  limit = 6,
): LabelCandidate[] {
  const parts = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).map(
    toPart,
  );
  const home = parts.find((part) => partContains(part, anchor.lng, anchor.lat));
  const first = {
    lat: anchor.lat,
    lng: anchor.lng,
    area: home?.area ?? 0,
    room: home
      ? Math.sqrt(clearance(home, anchor.lng, anchor.lat, cosineOf(home) * HORIZONTAL_WEIGHT))
      : 0,
  };
  const candidates: LabelCandidate[] = [first];
  const largest = [...parts].sort((a, b) => b.area - a.area).slice(0, MAX_PARTS);
  for (const [index, part] of largest.entries()) {
    if (part.area < largest[0].area * MIN_PART_SHARE) break;
    const quota = Math.min(index === 0 ? 4 : 2, limit - candidates.length);
    if (quota <= 0) break;
    candidates.push(...interiorPoints(part, quota, candidates));
  }
  return candidates;
}
