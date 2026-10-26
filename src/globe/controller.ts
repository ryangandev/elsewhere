import { fetchCountries, type AtlasGlobeAssets } from './assets';
import { HOME_VIEW } from './camera';
import type { GlobeEngine } from './engine';
import type { CountryLabelData } from './label-layer';
import { EMPTY_SCENE, type CameraView, type MapScene } from './scene';
import { diffScene, type SceneChanges } from './scene-diff';

export { DEFAULT_GLOBE_ASSETS, type AtlasGlobeAssets } from './assets';
export type { CountryLabelData } from './label-layer';

export type GlobeStatus = 'loading' | 'ready' | 'error';

export type AtlasGlobeEvents = {
  // A country was clicked on the globe or activated through its name.
  select: string;
  // A scene place label was activated.
  focusPlace: string;
  status: GlobeStatus;
};

export type AtlasGlobeOptions = {
  // Country names and anchors. Read once; the globe never imports app or content data.
  labels: readonly CountryLabelData[];
  assets: AtlasGlobeAssets;
  // Elements the labels must not cover, such as panels over the globe. Measured at each layout.
  occluders?: () => Iterable<Element>;
  // The camera for a scene with no explicit camera and no focus country.
  homeView?: CameraView;
};

export type AtlasGlobe = {
  readonly status: GlobeStatus;
  setScene(scene: MapScene): void;
  zoom(direction: 'in' | 'out' | 'reset'): void;
  on<K extends keyof AtlasGlobeEvents>(
    event: K,
    handler: (value: AtlasGlobeEvents[K]) => void,
  ): () => void;
  dispose(): void;
};

const ALL_CHANGED: SceneChanges = {
  camera: true,
  focusCountry: true,
  focusPlace: true,
  highlights: true,
  places: true,
  routes: true,
  any: true,
};

// A framework-free globe driven by a declarative MapScene.
// Creation is synchronous; the renderer loads in the background and reports through `status`.
// Scenes set before it is ready are applied as soon as it is.
export function createAtlasGlobe(container: HTMLElement, options: AtlasGlobeOptions): AtlasGlobe {
  const listeners: { [K in keyof AtlasGlobeEvents]: Set<(value: AtlasGlobeEvents[K]) => void> } = {
    select: new Set(),
    focusPlace: new Set(),
    status: new Set(),
  };
  const emit = <K extends keyof AtlasGlobeEvents>(event: K, value: AtlasGlobeEvents[K]) => {
    for (const handler of [...listeners[event]]) handler(value);
  };

  let scene: MapScene = EMPTY_SCENE;
  let status: GlobeStatus = 'loading';
  let engine: GlobeEngine | undefined;
  let disposed = false;
  const requests = new AbortController();

  const setStatus = (next: GlobeStatus) => {
    if (status === next || disposed) return;
    status = next;
    emit('status', next);
  };
  const fail = (error: unknown) => {
    if (disposed || status === 'error') return;
    console.error('Globe failed:', error);
    setStatus('error');
  };

  const start = async () => {
    const engineModule = import('./engine');
    const [{ createGlobeEngine }, features, basemap] = await Promise.all([
      engineModule,
      fetchCountries(options.assets.countries, requests.signal),
      engineModule.then((module) => module.loadBasemap(options.assets.basemap)),
    ]);
    if (disposed) {
      basemap.dispose();
      return;
    }
    engine = createGlobeEngine({
      container,
      labels: options.labels,
      assets: options.assets,
      homeView: options.homeView ?? HOME_VIEW,
      occluders: options.occluders ?? (() => []),
      features,
      basemap,
      signal: requests.signal,
      onSelect: (id) => emit('select', id),
      onFocusPlace: (id) => emit('focusPlace', id),
      onError: fail,
    });
    engine.applyScene(scene, ALL_CHANGED);
    setStatus('ready');
  };
  start().catch(fail);

  return {
    get status() {
      return status;
    },

    setScene(next) {
      const changes = diffScene(scene, next);
      scene = next;
      if (changes.any) engine?.applyScene(next, changes);
    },

    zoom(direction) {
      if (status === 'ready') engine?.zoom(direction);
    },

    on(event, handler) {
      listeners[event].add(handler);
      return () => listeners[event].delete(handler);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      requests.abort();
      engine?.dispose();
      engine = undefined;
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
