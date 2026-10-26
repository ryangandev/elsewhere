// Passage paths for straits, channels and canals: the line a sea route follows through a narrow
// passage. Used by build-gazetteer.mjs.
//
// A strait's path is the cheapest way through its water from one end to the other, on a grid
// over the Natural Earth polygon, preferring open water far from shore (so the path keeps to
// mid-channel), then simplified without moving onto land. Where the land geometry the globe
// draws closes the water body (a river channel narrower than the coastline detail), the path may
// cross that land, but only inside the water body's own polygon and as briefly as possible.
// A canal's path is its Natural Earth centerline, simplified.
import { distanceKm, interpolateGreatCircle } from '../src/content/geometry.ts';

const KM_PER_DEGREE = 111.195;
const RADIANS = Math.PI / 180;

/** Grid cells across the longer side of a passage; the cell size is clamped below. */
const GRID_CELLS_ALONG = 600;
const MIN_CELL_KM = 0.5;
const MAX_CELL_KM = 4;
/** Strength of the preference for open water: the step cost is 1 + this / clearance (km). */
const CLEARANCE_WEIGHT_KM = 6;
/** How far an end of the long axis may move to reach open water: a share of the passage's size. */
const SETTLE_FRACTION = 0.15;
const MIN_SETTLE_KM = 5;
const MAX_SETTLE_KM = 40;
const SETTLE_SHARE = 0.6;
/** Step cost multiplier on land the water body's polygon covers but the land geometry closes. */
const CLOSURE_COST = 40;
/** Sampling interval when measuring how much of a line lies on land. */
const LAND_STEP_KM = 1;

/** Planar bounds of polygons, as { west, south, east, north } in degrees. */
function polygonBounds(polygons) {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons) {
    for (const [lng, lat] of rings[0]) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return { west, south, east, north };
}

function createGrid(bounds, cellKm, paddingKm) {
  const lat0 = (bounds.south + bounds.north) / 2;
  const kmPerLng = KM_PER_DEGREE * Math.cos(lat0 * RADIANS);
  const dLat = cellKm / KM_PER_DEGREE;
  const dLng = cellKm / kmPerLng;
  const west = bounds.west - paddingKm / kmPerLng;
  const south = bounds.south - paddingKm / KM_PER_DEGREE;
  const cols = Math.ceil((bounds.east + paddingKm / kmPerLng - west) / dLng) + 1;
  const rows = Math.ceil((bounds.north + paddingKm / KM_PER_DEGREE - south) / dLat) + 1;
  return {
    cols,
    rows,
    cellKm,
    lat: (row) => south + row * dLat,
    lng: (col) => west + col * dLng,
    row: (lat) => Math.round((lat - south) / dLat),
    col: (lng) => Math.round((lng - west) / dLng),
    /** East-west size of a cell in a row, in km. */
    widthKm: (row) => dLng * KM_PER_DEGREE * Math.cos((south + row * dLat) * RADIANS),
  };
}

/** Mark the grid cells whose centers lie inside any of the polygons (even-odd per polygon). */
function fillPolygons(grid, polygons, mask) {
  for (const rings of polygons) {
    const lats = rings[0].map(([, lat]) => lat);
    const firstRow = Math.max(0, Math.ceil(grid.row(Math.min(...lats)) - 0.5));
    const lastRow = Math.min(grid.rows - 1, Math.floor(grid.row(Math.max(...lats)) + 0.5));
    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = grid.lat(row);
      const crossings = [];
      for (const ring of rings) {
        for (let index = 1; index < ring.length; index += 1) {
          const [x1, y1] = ring[index - 1];
          const [x2, y2] = ring[index];
          if (y1 > y !== y2 > y) crossings.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let index = 0; index + 1 < crossings.length; index += 2) {
        const from = Math.max(0, Math.ceil((crossings[index] - grid.lng(0)) / (grid.lng(1) - grid.lng(0))));
        const to = Math.min(
          grid.cols - 1,
          Math.floor((crossings[index + 1] - grid.lng(0)) / (grid.lng(1) - grid.lng(0))),
        );
        for (let col = from; col <= to; col += 1) mask[row * grid.cols + col] = 1;
      }
    }
  }
}

/** A binary min-heap of cell indexes keyed by cost. */
function createHeap() {
  const cells = [];
  const costs = [];
  const swap = (a, b) => {
    [cells[a], cells[b]] = [cells[b], cells[a]];
    [costs[a], costs[b]] = [costs[b], costs[a]];
  };
  return {
    get size() {
      return cells.length;
    },
    push(cell, cost) {
      cells.push(cell);
      costs.push(cost);
      let index = cells.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (costs[parent] <= costs[index]) break;
        swap(parent, index);
        index = parent;
      }
    },
    pop() {
      const top = { cell: cells[0], cost: costs[0] };
      const lastCell = cells.pop();
      const lastCost = costs.pop();
      if (cells.length) {
        cells[0] = lastCell;
        costs[0] = lastCost;
        let index = 0;
        for (;;) {
          const left = 2 * index + 1;
          const right = left + 1;
          let smallest = index;
          if (left < cells.length && costs[left] < costs[smallest]) smallest = left;
          if (right < cells.length && costs[right] < costs[smallest]) smallest = right;
          if (smallest === index) break;
          swap(smallest, index);
          index = smallest;
        }
      }
      return top;
    },
  };
}

/** The eight neighbours of a cell with the length of the step to each, in km. */
function* neighbours(grid, cell) {
  const row = Math.floor(cell / grid.cols);
  const col = cell % grid.cols;
  const dy = grid.cellKm;
  const dx = grid.widthKm(row);
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (!dr && !dc) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
      yield { cell: r * grid.cols + c, km: Math.hypot(dr * dy, dc * dx) };
    }
  }
}

/** Distance in km from every cell to the nearest source cell, along the grid. */
function distanceField(grid, isSource) {
  const distance = new Float64Array(grid.rows * grid.cols).fill(Infinity);
  const heap = createHeap();
  for (let cell = 0; cell < distance.length; cell += 1) {
    if (isSource(cell)) {
      distance[cell] = 0;
      heap.push(cell, 0);
    }
  }
  while (heap.size) {
    const { cell, cost } = heap.pop();
    if (cost > distance[cell]) continue;
    for (const next of neighbours(grid, cell)) {
      const candidate = cost + next.km;
      if (candidate < distance[next.cell]) {
        distance[next.cell] = candidate;
        heap.push(next.cell, candidate);
      }
    }
  }
  return distance;
}

/** Length of a great-circle segment that lies on land, sampled every LAND_STEP_KM. */
function landKm(land, a, b) {
  const samples = interpolateGreatCircle(a, b, LAND_STEP_KM);
  const spacing = distanceKm(a, b) / Math.max(1, samples.length - 1);
  return samples.filter((point) => land.isLand(point)).length * spacing;
}

/** Distance in km from a point to the segment a-b, in a local plane around the segment. */
function offsetKm(point, a, b) {
  const kmPerLng = KM_PER_DEGREE * Math.cos(((a[0] + b[0]) / 2) * RADIANS);
  const project = ([lat, lng]) => [(lng - a[1]) * kmPerLng, (lat - a[0]) * KM_PER_DEGREE];
  const [px, py] = project(point);
  const [bx, by] = project(b);
  const length2 = bx * bx + by * by;
  const t = length2 ? Math.max(0, Math.min(1, (px * bx + py * by) / length2)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * Douglas-Peucker simplification that never adds land: a run of points is replaced by a straight
 * segment only when the segment stays within `tolerance(i, j)` km of the run and crosses no
 * more land than the run did. Returns the kept points.
 */
function simplify(points, land, tolerance) {
  const stepLand = [0];
  for (let index = 1; index < points.length; index += 1) {
    stepLand.push(stepLand[index - 1] + landKm(land, points[index - 1], points[index]));
  }
  const keep = new Set([0, points.length - 1]);
  const visit = (first, last) => {
    if (last - first < 2) return;
    let worst = first + 1;
    let worstOffset = -1;
    for (let index = first + 1; index < last; index += 1) {
      const offset = offsetKm(points[index], points[first], points[last]);
      if (offset > worstOffset) [worst, worstOffset] = [index, offset];
    }
    const runLand = stepLand[last] - stepLand[first];
    if (
      worstOffset <= tolerance(first, last) &&
      landKm(land, points[first], points[last]) <= runLand + LAND_STEP_KM
    ) {
      return;
    }
    keep.add(worst);
    visit(first, worst);
    visit(worst, last);
  };
  visit(0, points.length - 1);
  return [...keep].sort((a, b) => a - b).map((index) => points[index]);
}

/**
 * The path through a water body between two points in it, as [lat, lng] points.
 *
 * - `polygons`: the water body, as GeoJSON polygon coordinates ([lng, lat] rings).
 * - `start`, `end`: [lat, lng] points near the two ends of the passage; each moves to open water
 *   nearby, or with `settleEnds: false` only to the nearest water (for ends placed deliberately,
 *   such as the entrance of a strait).
 * - `land`: the land index of the geometry the globe draws; `landPolygons` the same geometry as
 *   polygon coordinates, for rasterizing.
 *
 * Natural Earth's marine polygons are drawn loosely around the water, so the path may use open
 * water up to `marginKm` outside the polygon. Returns the path and the length of it that lies on
 * land (non-zero only where the land geometry closes the water body), or null when there is no
 * way through (Natural Earth draws a few water bodies as slivers).
 */
export function waterPath({
  polygons,
  start,
  end,
  land,
  landPolygons,
  marginKm,
  settleEnds = true,
}) {
  const bounds = polygonBounds(polygons);
  // The planar grid relies on this; no strait or channel crosses the antimeridian.
  if (bounds.east - bounds.west > 180) throw new Error('Passage crosses the antimeridian');
  const extentKm = Math.max(
    (bounds.north - bounds.south) * KM_PER_DEGREE,
    (bounds.east - bounds.west) *
      KM_PER_DEGREE *
      Math.cos(((bounds.south + bounds.north) / 2) * RADIANS),
  );
  const cellKm = Math.min(MAX_CELL_KM, Math.max(MIN_CELL_KM, extentKm / GRID_CELLS_ALONG));
  const grid = createGrid(bounds, cellKm, marginKm + 2 * cellKm);
  const size = grid.rows * grid.cols;

  const water = new Uint8Array(size);
  fillPolygons(grid, polygons, water);
  // Polygons thinner than a cell (Natural Earth draws some straits as slivers along each shore)
  // fill no cell, so their vertices count as water too.
  for (const rings of polygons) {
    for (const [lng, lat] of rings[0]) {
      const [row, col] = [grid.row(lat), grid.col(lng)];
      if (row >= 0 && col >= 0 && row < grid.rows && col < grid.cols) water[row * grid.cols + col] = 1;
    }
  }
  const isLand = new Uint8Array(size);
  fillPolygons(
    grid,
    landPolygons.filter((rings) => {
      const box = polygonBounds([rings]);
      return (
        box.east >= grid.lng(0) &&
        box.west <= grid.lng(grid.cols - 1) &&
        box.north >= grid.lat(0) &&
        box.south <= grid.lat(grid.rows - 1)
      );
    }),
    isLand,
  );

  const fromWater = distanceField(grid, (cell) => water[cell] === 1);
  const clearance = distanceField(grid, (cell) => isLand[cell] === 1);
  // Open water near the polygon, and land only where the polygon itself covers it.
  const passable = (cell) =>
    isLand[cell] ? fromWater[cell] <= 1.5 * cellKm : fromWater[cell] <= marginKm;
  const stepCost = (cell) =>
    isLand[cell] ? CLOSURE_COST : 1 + CLEARANCE_WEIGHT_KM / Math.max(clearance[cell], cellKm);

  // The ends move to open water nearby: the ends of the long axis often sit against a shore,
  // especially where Natural Earth draws a strait as slivers along its shores. Within `settleKm`
  // of the given point, each end becomes the nearest passable sea cell whose clearance is at
  // least SETTLE_SHARE of the best clearance there, so it moves only as far as it must.
  const settleKm = Math.min(MAX_SETTLE_KM, Math.max(MIN_SETTLE_KM, extentKm * SETTLE_FRACTION));
  const settle = ([lat, lng]) => {
    const candidates = [];
    const [row0, col0] = [grid.row(lat), grid.col(lng)];
    const reach = Math.ceil(settleKm / cellKm) + 1;
    for (let row = row0 - reach; row <= row0 + reach; row += 1) {
      for (let col = col0 - reach; col <= col0 + reach; col += 1) {
        if (row < 0 || col < 0 || row >= grid.rows || col >= grid.cols) continue;
        const cell = row * grid.cols + col;
        if (isLand[cell] || !passable(cell)) continue;
        const distance = distanceKm([lat, lng], [grid.lat(row), grid.lng(col)]);
        if (distance <= settleKm) candidates.push({ cell, distance, open: clearance[cell] });
      }
    }
    if (!candidates.length) return -1;
    const share = settleEnds ? SETTLE_SHARE : 0;
    const enough = share * Math.max(...candidates.map(({ open }) => open));
    const open = candidates.filter((candidate) => candidate.open >= enough);
    return open.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best))
      .cell;
  };
  const source = settle(start);
  const target = settle(end);
  if (source < 0 || target < 0) return null;

  const cost = new Float64Array(size).fill(Infinity);
  const previous = new Int32Array(size).fill(-1);
  const heap = createHeap();
  cost[source] = 0;
  heap.push(source, 0);
  while (heap.size) {
    const { cell, cost: current } = heap.pop();
    if (cell === target) break;
    if (current > cost[cell]) continue;
    for (const next of neighbours(grid, cell)) {
      if (!passable(next.cell)) continue;
      const candidate = current + (next.km * (stepCost(cell) + stepCost(next.cell))) / 2;
      if (candidate < cost[next.cell]) {
        cost[next.cell] = candidate;
        previous[next.cell] = cell;
        heap.push(next.cell, candidate);
      }
    }
  }
  if (!Number.isFinite(cost[target])) return null;

  const cells = [];
  for (let cell = target; cell !== -1; cell = previous[cell]) cells.unshift(cell);
  const pointOf = (cell) => [grid.lat(Math.floor(cell / grid.cols)), grid.lng(cell % grid.cols)];
  const points = cells.map(pointOf);
  const clearances = cells.map((cell) => clearance[cell]);

  // Stay within a third of the channel's half-width of the grid path, so the simplified path
  // keeps to mid-channel, but never closer than a cell or farther than 10 km.
  const path = simplify(points, land, (first, last) => {
    let narrowest = Infinity;
    for (let index = first; index <= last; index += 1) {
      narrowest = Math.min(narrowest, clearances[index]);
    }
    return Math.min(10, Math.max(2 * cellKm, narrowest / 3));
  });
  let onLandKm = 0;
  for (let index = 1; index < path.length; index += 1) {
    onLandKm += landKm(land, path[index - 1], path[index]);
  }
  return { path, landKm: onLandKm };
}

/**
 * Join line pieces (as [lng, lat] coordinate lists) into one line, as Natural Earth splits a
 * canal into river and lake centerline pieces. Pieces must meet end to end within `gapKm`.
 */
export function joinLines(lines, gapKm = 2) {
  const toLatLng = ([lng, lat]) => [lat, lng];
  const remaining = lines.map((line) => line.map(toLatLng));
  remaining.sort((a, b) => b.length - a.length);
  let chain = remaining.shift();
  while (remaining.length) {
    let best;
    for (const [index, line] of remaining.entries()) {
      const options = [
        { gap: distanceKm(chain.at(-1), line[0]), join: () => [...chain, ...line] },
        { gap: distanceKm(chain.at(-1), line.at(-1)), join: () => [...chain, ...line.reverse()] },
        { gap: distanceKm(chain[0], line.at(-1)), join: () => [...line, ...chain] },
        { gap: distanceKm(chain[0], line[0]), join: () => [...line.reverse(), ...chain] },
      ];
      for (const option of options) {
        if (!best || option.gap < best.gap) best = { ...option, index };
      }
    }
    if (best.gap > gapKm) throw new Error(`Line pieces do not meet (gap of ${best.gap} km)`);
    chain = best.join();
    remaining.splice(best.index, 1);
  }
  return chain;
}

/** A centerline simplified to within `toleranceKm`, as [lat, lng] points. */
export function simplifyLine(points, toleranceKm) {
  const noLand = { isLand: () => false };
  return simplify(points, noLand, () => toleranceKm);
}

/** The point halfway along a line, by length. */
export function midpoint(points) {
  const total = points
    .slice(1)
    .reduce((sum, point, index) => sum + distanceKm(points[index], point), 0);
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const step = distanceKm(points[index - 1], points[index]);
    if (travelled + step >= total / 2) {
      const t = step ? (total / 2 - travelled) / step : 0;
      const [a, b] = [points[index - 1], points[index]];
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    travelled += step;
  }
  return points.at(-1);
}
