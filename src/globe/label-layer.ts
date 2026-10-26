import type { GlobeInstance } from 'globe.gl';
import {
  arrangeLabels,
  createLabelView,
  surfacePoint,
  type CountryFeature,
  type CountryLabel,
  type LabelDatum,
  type PlaceLabel,
  type Rect,
  stackedName,
} from './cartography';
import { diffKeyed, samePlace } from './scene-diff';
import type { ScenePlace } from './scene';

export type { LabelDatum } from './cartography';

export type CountryLabelData = {
  id: string;
  name: string;
  /** The short form an atlas prints on the land ("Russia"); the full name stays accessible. */
  shortName?: string;
  lat: number;
  lng: number;
  // Steradians, as produced by d3-geo's geoArea.
  area: number;
  // Natural Earth label rank: lower is more important.
  rank: number;
};

type ContextLabel = PlaceLabel & { place: ScenePlace };

export type LabelScene = {
  selectedId?: string;
  emphasizedIds: ReadonlySet<string>;
  places: readonly ScenePlace[];
  focusPlaceId?: string;
};

export type LabelLayoutContext = {
  globe: GlobeInstance;
  container: HTMLElement;
  features: ReadonlyMap<string, CountryFeature>;
  unproject: (x: number, y: number) => { lat: number; lng: number } | null;
  bounds: DOMRect;
  occluders: Iterable<Element>;
};

/** Accessible names for label buttons, supplied by the app so the globe holds no interface text. */
export type GlobeLabelMessages = {
  /** A country name, which opens that country. */
  exploreCountry(name: string): string;
  /** A scene place, which finds that place on the globe. */
  locatePlace(name: string): string;
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

type Measured = { element: HTMLElement; width: number; height: number };

// Sizes are cached per style. globe.gl attaches an element only once its datum faces the
// camera, but layout needs the size to choose where the label goes. An element it has not
// attached yet is parked in a hidden host, which globe.gl moves it out of when it first shows
// it; an element it hides with `display: none` is briefly displayed. Reads happen in batches.
function measureUnsized<T extends Measured>(
  items: Iterable<T>,
  host: HTMLElement,
  read: (pending: T[]) => void,
) {
  const pending: T[] = [];
  for (const item of items) if (!item.width) pending.push(item);
  if (!pending.length) return;
  const undisplayed: HTMLElement[] = [];
  for (const { element } of pending) {
    if (!element.isConnected) host.append(element);
    else if (element.style.display === 'none') {
      element.style.display = '';
      undisplayed.push(element);
    }
  }
  read(pending);
  for (const element of undisplayed) element.style.display = 'none';
}

const readSizes = (pending: Measured[]) => {
  for (const item of pending) {
    item.width = item.element.offsetWidth;
    item.height = item.element.offsetHeight;
  }
};

// Country names are measured on one line and, for multi-word names, on two.
const readCountrySizes = (pending: CountryLabel[]) => {
  for (const label of pending) label.element.classList.remove('is-stacked');
  readSizes(pending);
  const stackable = pending.filter((label) => label.element.textContent?.includes('\n'));
  for (const label of stackable) label.element.classList.add('is-stacked');
  for (const label of stackable) {
    label.stackedWidth = label.element.offsetWidth;
    label.stackedHeight = label.element.offsetHeight;
  }
  for (const label of pending) label.element.classList.toggle('is-stacked', label.stacked);
};

function occluderRects(occluders: Iterable<Element>, bounds: DOMRect) {
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
  return blocked;
}

// Country names are created once and updated in place. Scene places are diffed by id,
// so navigation touches only the place labels that actually changed.
export function createLabelLayer(
  countries: readonly CountryLabelData[],
  messages: GlobeLabelMessages,
  callbacks: LabelCallbacks,
) {
  const countryLabels: CountryLabel[] = [];
  for (const country of countries) {
    const element = createLabelButton(() => callbacks.onSelectCountry(country.id));
    element.className = 'atlas-country-name';
    element.dataset.country = country.id;
    const name = country.shortName ?? country.name;
    element.textContent = stackedName(name) ?? name;
    element.setAttribute('aria-label', messages.exploreCountry(country.name));
    element.setAttribute('aria-hidden', 'true');
    element.tabIndex = -1;
    element.addEventListener('mouseenter', () => callbacks.onHoverCountry(country.id));
    element.addEventListener('focus', () => callbacks.onHoverCountry(country.id));
    element.addEventListener('mouseleave', () => callbacks.onHoverCountry(undefined));
    element.addEventListener('blur', () => callbacks.onHoverCountry(undefined));
    countryLabels.push({
      id: country.id,
      area: country.area,
      rank: country.rank,
      anchor: { lat: country.lat, lng: country.lng },
      element,
      datum: { lat: country.lat, lng: country.lng, element },
      position: 0,
      facing: [],
      width: 0,
      height: 0,
      stackedWidth: 0,
      stackedHeight: 0,
      stacked: false,
      nudgeX: 0,
      nudgeY: 0,
      visible: false,
      suppressed: false,
      emphasized: false,
    });
  }
  const countryData = countryLabels.map((label) => label.datum);

  let contextLabels = new Map<string, ContextLabel>();
  let selectedId: string | undefined;
  let data: LabelDatum[] = [...countryData];
  let measureHost: HTMLElement | undefined;

  const renderPlace = (label: ContextLabel, focusPlaceId: string | undefined) => {
    const { place, element } = label;
    label.active = place.id === focusPlaceId;
    label.water = place.kind === 'water';
    element.className = 'globe-pin context-label';
    element.classList.toggle('water-label', label.water);
    element.classList.toggle('active', label.active);
    element.dataset.place = place.id;
    element.textContent = place.name;
    element.setAttribute('aria-label', messages.locatePlace(place.name));
    // The text or style may have changed.
    label.width = 0;
  };
  const createPlace = (place: ScenePlace): ContextLabel => {
    const element = createLabelButton(() => callbacks.onFocusPlace(place.id));
    // Hidden until the first layout places it clear of other labels.
    element.style.visibility = 'hidden';
    element.tabIndex = -1;
    return {
      place,
      element,
      datum: { lat: place.lat, lng: place.lng, element },
      point: surfacePoint(place.lat, place.lng, 0),
      active: false,
      water: false,
      width: 0,
      height: 0,
    };
  };

  return {
    // The current datums for globe.gl's HTML element layer.
    get data(): LabelDatum[] {
      return data;
    },

    // Returns true when the set of datums changed and the HTML layer needs new data.
    setScene(scene: LabelScene) {
      selectedId = scene.selectedId;
      const { places, suppressedIds } = planLabels(countries, scene);
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
        const selected = label.id === selectedId;
        // The selected style is bolder, so its size is measured again.
        if (label.element.classList.contains('is-selected') !== selected) {
          label.element.classList.toggle('is-selected', selected);
          label.width = 0;
        }
        label.element.classList.toggle('is-callout', selected && label.area < 0.0003);
        label.suppressed = suppressedIds.has(label.id);
        label.emphasized = scene.emphasizedIds.has(label.id);
      }
      if (plan.dataChanged) {
        data = [...countryData, ...[...contextLabels.values()].map((label) => label.datum)];
      }
      return plan.dataChanged;
    },

    // Country names changed type size, so every cached size is stale.
    invalidateSizes() {
      for (const label of countryLabels) label.width = 0;
    },

    // Returns true when a country name moved and the HTML layer must re-read the datums.
    layout({ globe, container, features, unproject, bounds, occluders }: LabelLayoutContext) {
      if (!measureHost) {
        measureHost = document.createElement('div');
        measureHost.className = 'globe-label-measure';
        measureHost.setAttribute('aria-hidden', 'true');
      }
      if (!measureHost.isConnected) container.append(measureHost);
      measureUnsized(countryLabels, measureHost, readCountrySizes);
      measureUnsized(contextLabels.values(), measureHost, readSizes);
      // Labels stay inside the globe area and, where it overflows the page sideways as on
      // phones, inside the page. Vertical scrolling moves the page, not the frame.
      const pageWidth = document.documentElement.clientWidth;
      const frame = {
        left: Math.max(12, 8 - bounds.left),
        right: Math.min(bounds.width - 12, pageWidth - bounds.left - 8),
        top: 18,
        bottom: bounds.height - 12,
      };
      return arrangeLabels({
        view: createLabelView(globe, unproject, frame),
        countries: countryLabels,
        places: [...contextLabels.values()],
        selectedId,
        features,
        blocked: occluderRects(occluders, bounds),
      });
    },
  };
}

export type LabelLayer = ReturnType<typeof createLabelLayer>;
