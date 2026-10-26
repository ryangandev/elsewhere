import type { GlobeInstance } from 'globe.gl';
import {
  arrangeContextLabels,
  arrangeLabels,
  type CountryFeature,
  type CountryLabel,
  type Rect,
} from './cartography';
import { diffKeyed, samePlace } from './scene-diff';
import type { ScenePlace } from './scene';

export type CountryLabelData = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  // Steradians, as produced by d3-geo's geoArea.
  area: number;
  // Natural Earth label rank: lower is more important.
  rank: number;
};

// One entry of globe.gl's HTML element layer. The layer joins by object identity,
// so a stable datum keeps its element alive across scene changes.
export type LabelDatum = { lat: number; lng: number; element: HTMLButtonElement };

type ContextLabel = { place: ScenePlace; datum: LabelDatum };

export type LabelScene = {
  selectedId?: string;
  emphasizedIds: ReadonlySet<string>;
  places: readonly ScenePlace[];
  focusPlaceId?: string;
};

export type LabelLayoutContext = {
  globe: GlobeInstance;
  features: ReadonlyMap<string, CountryFeature>;
  unproject: (x: number, y: number) => { lat: number; lng: number } | null;
  bounds: DOMRect;
  occluders: Iterable<Element>;
};

type LabelCallbacks = {
  onSelectCountry: (id: string) => void;
  onFocusPlace: (id: string) => void;
  onHoverCountry: (id: string | undefined) => void;
};

const nameKey = (name: string) => name.trim().toLowerCase();

// Which places get their own label, and which country names they replace.
// The selected country already has its own name, so it is not repeated as a place;
// a place with a country's identity replaces that country's ordinary name.
export function planLabels(
  countries: readonly Pick<CountryLabelData, 'id' | 'name'>[],
  scene: Pick<LabelScene, 'selectedId' | 'places'>,
) {
  const selected = countries.find((country) => country.id === scene.selectedId);
  const places = scene.places.filter(
    (place) =>
      !selected || (place.id !== selected.id && nameKey(place.name) !== nameKey(selected.name)),
  );
  const keys = new Set(places.flatMap((place) => [place.id, nameKey(place.name)]));
  const suppressedIds = new Set(
    countries
      .filter((country) => keys.has(country.id) || keys.has(nameKey(country.name)))
      .map((country) => country.id),
  );
  return { places, suppressedIds };
}

// Place labels keyed by id: unchanged and renamed places keep their element,
// new and moved places get a new datum, and removed ones leave the layer.
export function planPlaceLabels(
  previous: ReadonlyMap<string, ScenePlace>,
  places: readonly ScenePlace[],
) {
  const diff = diffKeyed(previous, places, samePlace);
  const moved = diff.updated.filter((place) => {
    const before = previous.get(place.id)!;
    return before.lat !== place.lat || before.lng !== place.lng;
  });
  const create = new Set([...diff.added, ...moved].map((place) => place.id));
  return {
    places: diff.next,
    create,
    removed: diff.removed,
    dataChanged: create.size > 0 || diff.removed.length > 0,
  };
}

// A drag that starts on a label is a globe drag, not a click; keyboard activation still works.
function createLabelButton(onActivate: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  let press: { x: number; y: number } | null = null;
  button.addEventListener('pointerdown', (event) => {
    press = { x: event.clientX, y: event.clientY };
  });
  button.addEventListener('pointercancel', () => {
    press = null;
  });
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const moved =
      event.detail > 0 && press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5;
    press = null;
    if (!moved) onActivate();
  });
  return button;
}

// Country names are created once and updated in place. Scene places are diffed by id,
// so navigation touches only the place labels that actually changed.
export function createLabelLayer(
  countries: readonly CountryLabelData[],
  callbacks: LabelCallbacks,
) {
  const countryLabels: CountryLabel[] = [];
  const countryData: LabelDatum[] = [];
  for (const country of countries) {
    const element = createLabelButton(() => callbacks.onSelectCountry(country.id));
    element.className = 'atlas-country-name';
    element.dataset.country = country.id;
    element.textContent = country.name;
    element.setAttribute('aria-label', `Explore ${country.name}`);
    element.setAttribute('aria-hidden', 'true');
    element.tabIndex = -1;
    element.addEventListener('mouseenter', () => callbacks.onHoverCountry(country.id));
    element.addEventListener('focus', () => callbacks.onHoverCountry(country.id));
    element.addEventListener('mouseleave', () => callbacks.onHoverCountry(undefined));
    element.addEventListener('blur', () => callbacks.onHoverCountry(undefined));
    countryLabels.push({
      ...country,
      element,
      visible: false,
      suppressed: false,
      emphasized: false,
    });
    countryData.push({ lat: country.lat, lng: country.lng, element });
  }

  let contextLabels = new Map<string, ContextLabel>();
  let selectedId: string | undefined;
  let data: LabelDatum[] = [...countryData];

  const renderPlace = (label: ContextLabel, focusPlaceId: string | undefined) => {
    const { place, datum } = label;
    const element = datum.element;
    element.className = 'globe-pin context-label';
    element.classList.toggle('water-label', place.kind === 'water');
    element.classList.toggle('active', place.id === focusPlaceId);
    element.dataset.place = place.id;
    element.textContent = place.name;
    element.setAttribute('aria-label', `Locate ${place.name}`);
  };
  const createPlace = (place: ScenePlace): ContextLabel => {
    const element = createLabelButton(() => callbacks.onFocusPlace(place.id));
    // Hidden until the first layout places it clear of other labels.
    element.style.visibility = 'hidden';
    element.tabIndex = -1;
    return { place, datum: { lat: place.lat, lng: place.lng, element } };
  };

  return {
    // The current datums for globe.gl's HTML element layer.
    get data(): LabelDatum[] {
      return data;
    },

    // Returns true when the set of datums changed and the HTML layer needs new data.
    setScene(scene: LabelScene) {
      selectedId = scene.selectedId;
      const { places, suppressedIds } = planLabels(countryLabels, scene);
      const previous = new Map([...contextLabels].map(([id, label]) => [id, label.place]));
      const plan = planPlaceLabels(previous, places);
      const next = new Map<string, ContextLabel>();
      for (const place of plan.places.values()) {
        const existing = contextLabels.get(place.id);
        const label =
          !existing || plan.create.has(place.id) ? createPlace(place) : { ...existing, place };
        renderPlace(label, scene.focusPlaceId);
        next.set(place.id, label);
      }
      contextLabels = next;
      for (const label of countryLabels) {
        label.suppressed = suppressedIds.has(label.id);
        label.emphasized = scene.emphasizedIds.has(label.id);
      }
      if (plan.dataChanged) {
        data = [...countryData, ...[...contextLabels.values()].map((label) => label.datum)];
      }
      return plan.dataChanged;
    },

    layout({ globe, features, unproject, bounds, occluders }: LabelLayoutContext) {
      const blocked: Rect[] = [];
      for (const element of occluders) {
        if (!element.isConnected) continue;
        const box = element.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        blocked.push({
          left: box.left - bounds.left - 8,
          right: box.right - bounds.left + 8,
          top: box.top - bounds.top - 5,
          bottom: box.bottom - bounds.top + 5,
        });
      }
      const selected = countryLabels.find((label) => label.id === selectedId);
      const elements = [...contextLabels.values()].map((label) => label.datum.element);
      const contextBoxes = arrangeContextLabels(elements, selected, bounds, blocked);
      arrangeLabels(globe, countryLabels, features, unproject, selectedId, [
        ...blocked,
        ...contextBoxes,
      ]);
    },
  };
}

export type LabelLayer = ReturnType<typeof createLabelLayer>;
