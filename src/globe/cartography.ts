import { geoContains } from 'd3-geo';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { GlobeInstance } from 'globe.gl';

export type CountryFeature = Feature<Polygon | MultiPolygon, { ADM0_A3: string; ADMIN: string }>;
export type CountryLabel = {
  id: string; name: string; lat: number; lng: number; area: number; rank: number;
  element: HTMLButtonElement; visible: boolean;
};
type Rect = { left: number; top: number; right: number; bottom: number };
export const overlaps = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const pad = (rect: Rect, amount: number): Rect => ({ left: rect.left - amount, right: rect.right + amount, top: rect.top - amount, bottom: rect.bottom + amount });

export function placeContextLabel(rect: Rect, occupied: Rect[], frame: Rect) {
  for (const [x, y] of [[0, 0], [0, -30], [-36, 0], [36, 0], [0, 30], [-30, -30], [30, 30]]) {
    const box = { left: rect.left + x, right: rect.right + x, top: rect.top + y, bottom: rect.bottom + y };
    if (box.left >= frame.left && box.right <= frame.right && box.top >= frame.top && box.bottom <= frame.bottom && !occupied.some(other => overlaps(pad(box, 3), other))) return { box, x, y };
  }
  return null;
}

// Story labels can move a few pixels, but never crowd the selected country.
// If no safe space exists, the same place remains available in the reading panel.
export function arrangeContextLabels(elements: HTMLButtonElement[], selected: CountryLabel | undefined, bounds: DOMRect, blocked: Rect[]) {
  const occupied = [...blocked];
  const localBox = (box: DOMRect): Rect => ({ left: box.left - bounds.left, right: box.right - bounds.left, top: box.top - bounds.top, bottom: box.bottom - bounds.top });
  if (selected) {
    const box = selected.element.getBoundingClientRect();
    if (box.width) occupied.push(pad(localBox(box), 7));
  }
  const contextBoxes: Rect[] = [];
  const frame = { left: Math.max(8, 8 - bounds.left), right: Math.min(bounds.width - 8, window.innerWidth - bounds.left - 8), top: Math.max(8, 8 - bounds.top), bottom: Math.min(bounds.height - 8, window.innerHeight - bounds.top - 8) };
  for (const element of [...elements].sort((a, b) => Number(b.classList.contains('active')) * 10 + Number(b.classList.contains('water-label')) - Number(a.classList.contains('active')) * 10 - Number(a.classList.contains('water-label')))) {
    element.style.translate = '0 0';
    const rect = element.getBoundingClientRect();
    const placement = rect.width ? placeContextLabel(localBox(rect), occupied, frame) : null;
    element.style.visibility = placement ? 'visible' : 'hidden';
    element.style.pointerEvents = placement ? 'auto' : 'none';
    element.setAttribute('aria-hidden', String(!placement));
    element.tabIndex = placement ? 0 : -1;
    if (placement) {
      element.style.translate = `${placement.x}px ${placement.y}px`;
      const box = pad(placement.box, 5);
      occupied.push(box);
      contextBoxes.push(box);
    }
  }
  return contextBoxes;
}

// A real screen-space fit: land must sit under the center and all four corners.
// This prevents area-only heuristics from writing across thin countries or seas.
export function fitsCountry(feature: CountryFeature, rect: Rect, unproject: (x: number, y: number) => { lat: number; lng: number } | null) {
  const points = [[(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
    [rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom]];
  return points.every(([x, y]) => {
    const point = unproject(x, y);
    return !!point && geoContains(feature, [point.lng, point.lat]);
  });
}

export function arrangeLabels(globe: GlobeInstance, labels: CountryLabel[], features: Map<string, CountryFeature>, unproject: (x: number, y: number) => { lat: number; lng: number } | null, selectedId?: string, contextBoxes: Rect[] = []) {
  const camera = globe.camera();
  const distance = camera.position.length();
  const radius = globe.getGlobeRadius();
  const fov = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 50;
  const focal = globe.height() / (2 * Math.tan(fov * Math.PI / 360));
  const candidates = labels.map(label => {
    const position = globe.getCoords(label.lat, label.lng);
    const cosine = (position.x * camera.position.x + position.y * camera.position.y + position.z * camera.position.z) / (radius * distance);
    const facing = (distance * cosine - radius) / Math.sqrt(distance ** 2 + radius ** 2 - 2 * distance * radius * cosine);
    const scale = focal / (distance / radius - cosine);
    const screen = globe.getScreenCoords(label.lat, label.lng, .006);
    const selected = label.id === selectedId;
    const width = label.element.offsetWidth;
    const height = label.element.offsetHeight;
    const padding = label.visible ? 1 : 3;
    const rect = { left: screen.x - width / 2 - padding, right: screen.x + width / 2 + padding, top: screen.y - height / 2 - padding, bottom: screen.y + height / 2 + padding };
    const approximateSpace = Math.sqrt(label.area) * scale * Math.sqrt(Math.max(0, facing));
    const priority = (selected ? 10000 : 0) + (7 - label.rank) * 20 + Math.min(100, approximateSpace) + (label.visible ? 4 : 0);
    return { label, selected, facing, rect, approximateSpace, width, priority };
  }).sort((a, b) => b.priority - a.priority);
  const occupied = [...contextBoxes];
  for (const item of candidates) {
    const { label, selected, facing, rect } = item;
    const feature = features.get(label.id);
    const inFrame = rect.left > 12 && rect.top > 18 && rect.right < globe.width() - 12 && rect.bottom < globe.height() - 12;
    const eligible = facing > .25 && inFrame && !occupied.some(other => overlaps(rect, other));
    const show = eligible && (selected || (item.approximateSpace > item.width * .65 && !!feature && fitsCountry(feature, rect, unproject)));
    label.visible = show;
    label.element.classList.toggle('is-visible', show);
    label.element.classList.toggle('is-selected', selected);
    label.element.classList.toggle('is-callout', selected && label.area < .0003);
    label.element.style.opacity = show ? String(Math.min(1, (facing - .2) / .35)) : '0';
    label.element.tabIndex = show ? 0 : -1;
    label.element.setAttribute('aria-hidden', String(!show));
    if (show) occupied.push({ left: rect.left - 8, right: rect.right + 8, top: rect.top - 5, bottom: rect.bottom + 5 });
  }
}
