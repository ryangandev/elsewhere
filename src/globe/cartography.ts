import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { GlobeInstance } from 'globe.gl';
import { countryContains } from './country-lookup';
import { labelCandidates } from './label-candidates';

export type CountryFeature = Feature<Polygon | MultiPolygon, { ADM0_A3: string; ADMIN: string }>;
export type Rect = { left: number; top: number; right: number; bottom: number };
type ScreenPoint = { x: number; y: number };
type GeoPoint = { lat: number; lng: number };
type Unproject = (x: number, y: number) => GeoPoint | null;
// The country whose land is at a point, by id; undefined at sea.
type CountryAt = (point: GeoPoint) => string | undefined;

// One entry of globe.gl's HTML element layer. The layer joins by object identity,
// so a stable datum keeps its element alive across scene changes; moving a label
// means changing its datum's coordinates and handing the same datums back.
export type LabelDatum = { lat: number; lng: number; element: HTMLButtonElement };

// A point a label may sit on, with its unit vector precomputed for cheap horizon tests.
export type SurfacePoint = {
  lat: number;
  lng: number;
  // Steradians of the land part under the point.
  area: number;
  // Open land around the point, in degrees (see LabelCandidate).
  room: number;
  x: number;
  y: number;
  z: number;
};

export type CountryLabel = {
  id: string;
  area: number;
  rank: number;
  anchor: { lat: number; lng: number };
  element: HTMLButtonElement;
  datum: LabelDatum;
  // Where the name may sit, anchor first. Built from the geometry the first time it is needed.
  positions?: SurfacePoint[];
  // Index into `positions` of the point the name currently uses.
  position: number;
  // Camera facing of each position, rewritten at every layout.
  facing: number[];
  // Measured once per style; zero until the element has been laid out.
  width: number;
  height: number;
  // The name broken onto two lines, for multi-word names; zero when it has one word.
  stackedWidth: number;
  stackedHeight: number;
  // Whether the name currently shows on two lines.
  stacked: boolean;
  // A small screen shift within the country, for a near miss at the position itself.
  nudgeX: number;
  nudgeY: number;
  visible: boolean;
  // A scene place with the same identity is labelled instead.
  suppressed: boolean;
  // Highlighted by the scene, so it wins collisions against ordinary names.
  emphasized: boolean;
};

export type PlaceLabel = {
  element: HTMLButtonElement;
  datum: LabelDatum;
  point: SurfacePoint;
  active: boolean;
  water: boolean;
  width: number;
  height: number;
};

export const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const pad = (rect: Rect, x: number, y = x): Rect => ({
  left: rect.left - x,
  right: rect.right + x,
  top: rect.top - y,
  bottom: rect.bottom + y,
});
const centered = (point: ScreenPoint, width: number, height: number): Rect => ({
  left: point.x - width / 2,
  right: point.x + width / 2,
  top: point.y - height / 2,
  bottom: point.y + height / 2,
});
const inside = (box: Rect, frame: Rect) =>
  box.left >= frame.left &&
  box.right <= frame.right &&
  box.top >= frame.top &&
  box.bottom <= frame.bottom;

// Type size steps with zoom, as on a printed atlas: smaller names at world scale let the
// large countries carry a name without writing across their neighbours.
export type LabelScale = 'world' | 'region' | 'local';
export function labelScale(altitude: number): LabelScale {
  if (altitude >= 1.4) return 'world';
  return altitude >= 0.6 ? 'region' : 'local';
}

// three-globe's polar convention, as a unit vector.
export function surfacePoint(lat: number, lng: number, area: number, room = 0): SurfacePoint {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  return {
    lat,
    lng,
    area,
    room,
    x: Math.sin(phi) * Math.cos(theta),
    y: Math.cos(phi),
    z: Math.sin(phi) * Math.sin(theta),
  };
}

export function labelPositions(
  label: Pick<CountryLabel, 'anchor' | 'area'>,
  feature?: CountryFeature,
) {
  const candidates = feature
    ? labelCandidates(feature.geometry, label.anchor)
    : [{ ...label.anchor, area: label.area, room: 0 }];
  return candidates.map((point) =>
    surfacePoint(point.lat, point.lng, point.area || label.area, point.room),
  );
}

const CONTEXT_OFFSETS = [
  [0, 0],
  [0, -30],
  [-36, 0],
  [36, 0],
  [0, 30],
  [-30, -30],
  [30, 30],
];

// Where a place label goes: the first shift that keeps it inside the frame and clear of earlier
// labels. With `cover`, which measures how much of a box lies on land, it is instead the clear
// shift with the least land, stopping at the first with none; a shift covering more than
// `maxCover` does not qualify.
export function placeContextLabel(
  rect: Rect,
  occupied: readonly Rect[],
  frame: Rect,
  cover?: (box: Rect, limit: number) => number,
  maxCover = 0,
) {
  let best: { box: Rect; x: number; y: number } | null = null;
  let least = maxCover + 1;
  for (const [x, y] of CONTEXT_OFFSETS) {
    const box = {
      left: rect.left + x,
      right: rect.right + x,
      top: rect.top + y,
      bottom: rect.bottom + y,
    };
    if (!inside(box, frame) || occupied.some((other) => overlaps(pad(box, 3), other))) continue;
    if (!cover) return { box, x, y };
    const land = cover(box, least);
    if (land < least) {
      best = { box, x, y };
      least = land;
      if (!land) break;
    }
  }
  return best;
}

// How much of a box lies on land: how many of nine points (the center, the corners and the
// middles of the edges) are on land or off the globe, or Infinity when the center is. Counting
// stops at `limit`, since a caller comparing boxes needs no more.
export function landCover(box: Rect, unproject: Unproject, countryAt: CountryAt, limit = Infinity) {
  const x = (box.left + box.right) / 2;
  const y = (box.top + box.bottom) / 2;
  const onLand = (px: number, py: number) => {
    const point = unproject(px, py);
    return !point || countryAt(point) !== undefined;
  };
  if (onLand(x, y)) return Infinity;
  const points = [
    [box.left, box.top],
    [box.right, box.top],
    [box.left, box.bottom],
    [box.right, box.bottom],
    [x, box.top],
    [x, box.bottom],
    [box.left, y],
    [box.right, y],
  ];
  let land = 0;
  for (const [px, py] of points) {
    if (onLand(px, py) && ++land >= limit) break;
  }
  return land;
}

// The points a name is tested at, as bits of the mask `fitFailures` returns.
const CENTER = 1;
const TOP_LEFT = 2;
const TOP_RIGHT = 4;
const BOTTOM_LEFT = 8;
const BOTTOM_RIGHT = 16;

// A real screen-space fit: land of this country must sit under the center and all four
// corners. Returns the points that fail, so a near miss can shift away from them.
export function fitFailures(feature: CountryFeature, rect: Rect, unproject: Unproject) {
  const onLand = (x: number, y: number) => {
    const point = unproject(x, y);
    return !!point && countryContains(feature, point.lng, point.lat);
  };
  if (!onLand((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)) return CENTER;
  return (
    (onLand(rect.left, rect.top) ? 0 : TOP_LEFT) |
    (onLand(rect.right, rect.top) ? 0 : TOP_RIGHT) |
    (onLand(rect.left, rect.bottom) ? 0 : BOTTOM_LEFT) |
    (onLand(rect.right, rect.bottom) ? 0 : BOTTOM_RIGHT)
  );
}

// This prevents area-only heuristics from writing across thin countries or seas.
export const fitsCountry = (feature: CountryFeature, rect: Rect, unproject: Unproject) =>
  fitFailures(feature, rect, unproject) === 0;

// A looser fit for a name that cannot fit inside its country, as an atlas letters a narrow or
// island country across the water beside it: the center must be on the country's land, and the
// points halfway from the center to each end on that land or at sea. Only the ends and corners
// may reach over a neighbour's edge. Returns failures in the same bits as `fitFailures`.
export function overflowFailures(
  feature: CountryFeature,
  rect: Rect,
  unproject: Unproject,
  countryAt: CountryAt,
) {
  const own = (point: GeoPoint | null) => !!point && countryContains(feature, point.lng, point.lat);
  const y = (rect.top + rect.bottom) / 2;
  if (!own(unproject((rect.left + rect.right) / 2, y))) return CENTER;
  const clear = (x: number) => {
    const point = unproject(x, y);
    return !!point && (own(point) || countryAt(point) === undefined);
  };
  const quarter = (rect.right - rect.left) / 4;
  return (
    (clear(rect.left + quarter) ? 0 : TOP_LEFT | BOTTOM_LEFT) |
    (clear(rect.right - quarter) ? 0 : TOP_RIGHT | BOTTOM_RIGHT)
  );
}

// Which way to shift a name whose center fits but some corners do not: away from the
// failing corners, as a sign per axis. Opposite failures cancel out.
export function nudgeDirection(failures: number) {
  const x =
    (failures & TOP_LEFT ? 1 : 0) +
    (failures & BOTTOM_LEFT ? 1 : 0) -
    (failures & TOP_RIGHT ? 1 : 0) -
    (failures & BOTTOM_RIGHT ? 1 : 0);
  const y =
    (failures & TOP_LEFT ? 1 : 0) +
    (failures & TOP_RIGHT ? 1 : 0) -
    (failures & BOTTOM_LEFT ? 1 : 0) -
    (failures & BOTTOM_RIGHT ? 1 : 0);
  return { x: Math.sign(x), y: Math.sign(y) };
}

// One collision space with a fixed order: the selected country's name, then the scene's
// places (the focused one, then water, then the rest), then other country names by
// emphasis, rank and on-screen size. Earlier labels always win; arrangeLabels settles how the
// selected name and the places share space.
export type LabelOrderInput =
  | { kind: 'selected' }
  | { kind: 'place'; active: boolean; water: boolean }
  | { kind: 'country'; emphasized: boolean; rank: number; space: number; visible: boolean };

export function labelOrder(item: LabelOrderInput) {
  switch (item.kind) {
    case 'selected':
      return 3_000_000;
    case 'place':
      return 2_000_000 + Number(item.active) * 10 + Number(item.water);
    case 'country':
      return (
        (item.emphasized ? 150 : 0) +
        (7 - item.rank) * 20 +
        Math.min(100, item.space) +
        // A visible name keeps its place against an equal newcomer, so labels do not flicker.
        (item.visible ? 4 : 0)
      );
  }
}

// The current position keeps its turn while it still faces the camera this well, and shows at
// least this share of the open land the best position shows, so names hold still while the
// camera moves but do not stay on a poor position once the camera settles somewhere else.
const KEEP_FACING = 0.4;
const KEEP_SHARE = 0.75;

// Names fade out toward the horizon.
const labelOpacity = (facing: number) => Math.max(0, Math.min(1, (facing - 0.2) / 0.35));

// Candidate positions to try, in order: the current one (-1 for none) while it still faces the
// camera well and is nearly as good as the best, then the rest by how much open land they show:
// their room, foreshortened by the view and faded toward the horizon. A country whose label
// point sits near the horizon is named from its visible side, and a large one from its widest
// interior. Writes into `order`.
export function positionOrder(
  current: number,
  facing: readonly number[],
  positions: readonly { room: number }[],
  order: number[],
) {
  order.length = 0;
  // A name near the horizon fades, so a faded position is worth that much less.
  const score = (index: number) =>
    facing[index] * positions[index].room * labelOpacity(facing[index]);
  if (current >= 0 && facing[current] >= KEEP_FACING) {
    let best = 0;
    for (let index = 0; index < facing.length; index++) best = Math.max(best, score(index));
    if (score(current) >= best * KEEP_SHARE) order.push(current);
  }
  const fixed = order.length;
  for (let index = 0; index < facing.length; index++) {
    if (order.includes(index)) continue;
    let at = order.length;
    while (at > fixed && score(order[at - 1]) < score(index)) at--;
    order.splice(at, 0, index);
  }
  return order;
}

// Names closer to the horizon than this are too foreshortened to show.
const MIN_FACING = 0.25;
// Matches the HTML layer's altitude, so projected boxes sit where globe.gl draws them.
export const LABEL_ALTITUDE = 0.006;

export type LabelView = {
  facing(point: SurfacePoint): number;
  // Pixels per globe radius at the point, before foreshortening.
  scale(point: SurfacePoint): number;
  screen(point: SurfacePoint): ScreenPoint;
  unproject: Unproject;
  countryAt: CountryAt;
  frame: Rect;
};

export function createLabelView(
  globe: GlobeInstance,
  unproject: Unproject,
  countryAt: CountryAt,
  frame: Rect,
): LabelView {
  const camera = globe.camera();
  const { x: cx, y: cy, z: cz } = camera.position;
  const distance = camera.position.length();
  const radius = globe.getGlobeRadius();
  const fov = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 50;
  const focal = globe.height() / (2 * Math.tan((fov * Math.PI) / 360));
  const cosine = (point: SurfacePoint) => (point.x * cx + point.y * cy + point.z * cz) / distance;
  return {
    facing(point) {
      const c = cosine(point);
      return (
        (distance * c - radius) / Math.sqrt(distance ** 2 + radius ** 2 - 2 * distance * radius * c)
      );
    },
    scale: (point) => focal / (distance / radius - cosine(point)),
    screen: (point) => globe.getScreenCoords(point.lat, point.lng, LABEL_ALTITUDE),
    unproject,
    countryAt,
    frame,
  };
}

export type ArrangeInput = {
  view: LabelView;
  countries: readonly CountryLabel[];
  places: readonly PlaceLabel[];
  selectedId?: string;
  features: ReadonlyMap<string, CountryFeature>;
  // Occluding panels, in container pixels.
  blocked: readonly Rect[];
};

type Entry = { order: number; place: PlaceLabel } | { order: number; country: CountryLabel };

// Reused across layouts to keep allocation out of the motion path.
const scratchOrder: number[] = [];
const SINGLE = [false] as const;
const STACKING = [false, true] as const;

// Lays out every label and writes visibility, offsets and accessibility state. Names that fit
// inside their countries are placed first, in priority order; the names left over then try the
// looser overflow fit in the space that remains, so an overflowing name never displaces one
// that fits. Returns whether a country name changed position, so the HTML layer must re-read
// its datum.
export function arrangeLabels({
  view,
  countries,
  places,
  selectedId,
  features,
  blocked,
}: ArrangeInput) {
  const entries: Entry[] = [];
  for (const place of places) {
    entries.push({
      order: labelOrder({ kind: 'place', active: place.active, water: place.water }),
      place,
    });
  }
  for (const country of countries) {
    if (country.suppressed || !country.width) {
      hideCountry(country);
      continue;
    }
    country.positions ??= labelPositions(country, features.get(country.id));
    const { positions, facing } = country;
    facing.length = positions.length;
    let best = 0;
    for (let index = 0; index < positions.length; index++) {
      facing[index] = view.facing(positions[index]);
      if (facing[index] > facing[best]) best = index;
    }
    if (facing[best] <= MIN_FACING) {
      hideCountry(country);
      continue;
    }
    const point = positions[best];
    const space = Math.sqrt(point.area) * view.scale(point) * Math.sqrt(facing[best]);
    entries.push({
      order:
        country.id === selectedId
          ? labelOrder({ kind: 'selected' })
          : labelOrder({
              kind: 'country',
              emphasized: country.emphasized,
              rank: country.rank,
              space,
              visible: country.visible,
            }),
      country,
    });
  }
  entries.sort((a, b) => b.order - a.order);

  const occupied: Rect[] = [...blocked];
  const leftover: CountryLabel[] = [];
  let moved = false;
  const settle = (country: CountryLabel, found: Placement | null) => {
    showCountry(country, found ? country.facing[found.index] : 0);
    if (!found) return;
    moved = applyPlacement(country, found) || moved;
    occupied.push(pad(found.rect, 8, 5));
  };
  const placeAll = (labels: readonly PlaceLabel[]) => {
    for (const label of labels) placePlace(label, view, occupied);
  };
  let next = 0;
  // The selected name and the scene's places come first. The places are placed, then the
  // selected name steps around them; only when it finds no room does it go first, preferring
  // space clear of the places' points, and the places step around it instead.
  const selected = entries[0] && 'country' in entries[0] && entries[0].country.id === selectedId;
  const sceneLabels: PlaceLabel[] = [];
  for (next = selected ? 1 : 0; next < entries.length; next++) {
    const entry = entries[next];
    if (!('place' in entry)) break;
    sceneLabels.push(entry.place);
  }
  const before = occupied.length;
  placeAll(sceneLabels);
  if (selected) {
    const { country } = entries[0] as { country: CountryLabel };
    const feature = features.get(country.id);
    const found = findPosition(country, 'selected', view, feature, occupied);
    if (found) settle(country, found);
    else {
      occupied.length = before;
      settle(
        country,
        findPosition(country, 'selected', view, feature, [
          ...occupied,
          ...placeBoxes(sceneLabels, view),
        ]) ?? findPosition(country, 'selected', view, feature, occupied),
      );
      placeAll(sceneLabels);
    }
  }
  // Then the other names, which come after every place in the order.
  for (const entry of entries.slice(next)) {
    if (!('country' in entry)) continue;
    const { country } = entry;
    const found = findPosition(country, 'inside', view, features.get(country.id), occupied);
    // A name that does not fit keeps its state until the overflow pass has had its turn.
    if (found) settle(country, found);
    else leftover.push(country);
  }
  for (const country of leftover) {
    settle(country, findPosition(country, 'overflow', view, features.get(country.id), occupied));
  }
  return moved;
}

// Writes a found position to the label. Returns whether its datum moved.
function applyPlacement(country: CountryLabel, found: Placement) {
  if (found.stacked !== country.stacked) {
    country.stacked = found.stacked;
    country.element.classList.toggle('is-stacked', found.stacked);
  }
  if (found.nudgeX !== country.nudgeX || found.nudgeY !== country.nudgeY) {
    country.nudgeX = found.nudgeX;
    country.nudgeY = found.nudgeY;
    country.element.style.translate = `${found.nudgeX}px ${found.nudgeY}px`;
  }
  if (found.index === country.position && country.datum.lat === found.point.lat) return false;
  country.position = found.index;
  country.datum.lat = found.point.lat;
  country.datum.lng = found.point.lng;
  return true;
}

// Where each visible place label would sit without any shift.
function placeBoxes(places: readonly PlaceLabel[], view: LabelView) {
  const boxes: Rect[] = [];
  for (const place of places) {
    if (place.width > 0 && view.facing(place.point) > 0)
      boxes.push(pad(centered(view.screen(place.point), place.width, place.height), 3));
  }
  return boxes;
}

type Placement = {
  index: number;
  point: SurfacePoint;
  rect: Rect;
  stacked: boolean;
  nudgeX: number;
  nudgeY: number;
};

// Shift sizes for a near miss, as fractions of the label box, and how many steps to try.
const NUDGE_X = 0.18;
const NUDGE_Y = 0.35;
const NUDGE_STEPS = 2;
const SIDE_STEPS = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];
// The on-screen size estimate a name needs before its fit is tested, as a share of its width.
// An overflowing name may reach past its country, so it asks for less.
const INSIDE_SPACE = 0.65;
const OVERFLOW_SPACE = 0.35;

// How a name must fit: the selected name anywhere clear, others inside their country, or
// overflowing it (see overflowFailures).
type FitMode = 'selected' | 'inside' | 'overflow';

function findPosition(
  country: CountryLabel,
  mode: FitMode,
  view: LabelView,
  feature: CountryFeature | undefined,
  occupied: readonly Rect[],
): Placement | null {
  const { facing } = country;
  const positions = country.positions!;
  const selected = mode === 'selected';
  const minSpace = mode === 'overflow' ? OVERFLOW_SPACE : INSIDE_SPACE;
  // A visible name needs slightly less clearance than a newcomer, so it does not flicker.
  const padding = country.visible ? 1 : 3;
  // Only a name on screen has a position worth keeping.
  const current = country.visible ? country.position : -1;
  for (const index of positionOrder(current, facing, positions, scratchOrder)) {
    if (facing[index] <= MIN_FACING) continue;
    const point = positions[index];
    const center = view.screen(point);
    const space = Math.sqrt(point.area) * view.scale(point) * Math.sqrt(facing[index]);
    // One line first; a multi-word name may then try two shorter lines, as atlases do.
    for (const stacked of country.stackedWidth ? STACKING : SINGLE) {
      const width = stacked ? country.stackedWidth : country.width;
      const height = stacked ? country.stackedHeight : country.height;
      // The cheap size estimate rules out most names before any geometry is touched.
      if (!selected && (space < width * minSpace || !feature)) continue;
      // Returns the fit failures at a shift, or -1 when the box is off the map or taken.
      const attempt = (x: number, y: number): Placement | number => {
        const box = centered({ x: center.x + x, y: center.y + y }, width, height);
        const rect = pad(box, padding);
        if (!inside(rect, view.frame) || occupied.some((other) => overlaps(rect, other))) return -1;
        const placement = { index, point, rect, stacked, nudgeX: x, nudgeY: y };
        if (selected) return placement;
        // Test where the ink is: the button's padding and the leading above the first and
        // below the last line may overhang a border, and so may the outer tips of the letters.
        const ink = pad(box, -3 - (width - 6) * 0.1, -country.height * 0.25);
        const failures =
          mode === 'overflow'
            ? overflowFailures(feature!, ink, view.unproject, view.countryAt)
            : fitFailures(feature!, ink, view.unproject);
        return failures === 0 ? placement : failures;
      };
      // A shift that worked last time is tried first, so names hold still while the camera moves.
      const keep = country.position === index && country.stacked === stacked;
      if (keep && (country.nudgeX || country.nudgeY)) {
        const held = attempt(country.nudgeX, country.nudgeY);
        if (typeof held !== 'number') return held;
      }
      const result = attempt(0, 0);
      if (typeof result !== 'number') return result;
      // The selected name skips the fit test, so it may step just below or above its point.
      if (selected) {
        for (const y of [height + 4, -height - 4]) {
          const shifted = attempt(0, y);
          if (typeof shifted !== 'number') return shifted;
        }
        continue;
      }
      if (result > 0 && result & CENTER) continue;
      // A name that only misses a few corners shifts away from them; one that is taken or off
      // the map looks a step or two around its point.
      const fitMiss = result > 0 ? nudgeDirection(result) : undefined;
      if (fitMiss && !fitMiss.x && !fitMiss.y) continue;
      for (let step = 1; step <= NUDGE_STEPS; step++) {
        for (const direction of fitMiss ? [fitMiss] : SIDE_STEPS) {
          const nudged = attempt(
            Math.round(direction.x * step * NUDGE_X * width),
            Math.round(direction.y * step * NUDGE_Y * height),
          );
          if (typeof nudged !== 'number') return nudged;
        }
      }
    }
  }
  return null;
}

const hideCountry = (country: CountryLabel) => showCountry(country, 0);

function showCountry(country: CountryLabel, facing: number) {
  const show = facing > 0;
  country.visible = show;
  const { element } = country;
  element.classList.toggle('is-visible', show);
  element.style.opacity = show ? String(labelOpacity(facing)) : '0';
  element.tabIndex = show ? 0 : -1;
  element.setAttribute('aria-hidden', String(!show));
}

// The rounded corners of a water label's box may touch a coast.
const WATER_INSET = 2;
// The most of landCover's nine points a water name may have on land.
const MAX_WATER_LAND = 3;

// Place labels can move a few pixels, but never crowd a label placed before them.
// If no safe space exists, the same place remains available in the reading panel.
// A water name sits on water: the shift with the least land under it, which for a strait or a
// small bay may reach over a shore but never has its center on land. When every shift covers too
// much land it is left out at this zoom, unless the reader focused it.
function placePlace(place: PlaceLabel, view: LabelView, occupied: Rect[]) {
  const visible = place.width > 0 && view.facing(place.point) > 0;
  const rect = visible ? centered(view.screen(place.point), place.width, place.height) : null;
  const cover = (box: Rect, limit: number) =>
    landCover(pad(box, -WATER_INSET), view.unproject, view.countryAt, limit);
  let placement =
    rect &&
    (place.water
      ? placeContextLabel(rect, occupied, view.frame, cover, MAX_WATER_LAND)
      : placeContextLabel(rect, occupied, view.frame));
  if (rect && !placement && place.active) placement = placeContextLabel(rect, occupied, view.frame);
  const { element } = place;
  element.style.visibility = placement ? 'visible' : 'hidden';
  element.style.pointerEvents = placement ? 'auto' : 'none';
  element.setAttribute('aria-hidden', String(!placement));
  element.tabIndex = placement ? 0 : -1;
  element.style.translate = placement ? `${placement.x}px ${placement.y}px` : '0 0';
  if (placement) occupied.push(pad(placement.box, 5));
}

// The name on two lines, broken at the space that keeps the longer line shortest.
// Single-word names stay whole. The line break collapses to a space while the name
// renders on one line, so the same text serves both forms.
export function stackedName(name: string): string | undefined {
  let best: string | undefined;
  let longest = Infinity;
  for (let at = name.indexOf(' '); at > 0; at = name.indexOf(' ', at + 1)) {
    const length = Math.max(at, name.length - at - 1);
    if (length < longest) {
      longest = length;
      best = `${name.slice(0, at)}\n${name.slice(at + 1)}`;
    }
  }
  return best;
}
