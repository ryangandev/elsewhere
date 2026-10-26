import Globe from 'globe.gl';
import { TextureLoader, type Texture } from 'three';
import { fetchCountries, type AtlasGlobeAssets } from './assets';
import { sameView, sceneTarget, sceneView, zoomView } from './camera';
import type { CountryFeature } from './cartography';
import type { HighlightRoles } from './fills';
import { createGeography } from './geography';
import { createPointerInteractions } from './interactions';
import { createLabelLayer, type CountryLabelData, type LabelDatum } from './label-layer';
import { createBasemapMaterial } from './materials';
import { createGlobeUnprojector } from './projection';
import { createRouteLayer } from './route-layer';
import type { CameraView, MapScene } from './scene';
import type { SceneChanges } from './scene-diff';

// The renderer-bound half of the controller. It is loaded on demand so that globe.gl and
// Three.js stay out of server rendering and out of the initial bundle.

const LABEL_ALTITUDE = 0.006;
// Label layout is the main per-frame cost while the camera moves, so it runs at most ~20 times a second.
const LAYOUT_INTERVAL_MS = 48;
const SETTLE_DELAY_MS = 180;
const MAX_PIXEL_RATIO = 2;
const SCENE_TRANSITION_MS = 1100;
const RESET_TRANSITION_MS = 850;
const ZOOM_TRANSITION_MS = 400;

export function loadBasemap(url: string): Promise<Texture> {
  return new TextureLoader().loadAsync(url);
}

export type EngineOptions = {
  container: HTMLElement;
  labels: readonly CountryLabelData[];
  assets: AtlasGlobeAssets;
  homeView: CameraView;
  occluders: () => Iterable<Element>;
  features: CountryFeature[];
  basemap: Texture;
  signal: AbortSignal;
  onSelect: (countryId: string) => void;
  onFocusPlace: (placeId: string) => void;
  onError: (error: unknown) => void;
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const duration = (ms: number) => (prefersReducedMotion() ? 0 : ms);

function rolesOf(scene: MapScene): HighlightRoles {
  const ids = (role: 'related' | 'contrast') =>
    scene.highlights
      .filter((item) => item.role === role && item.countryId !== scene.focusCountryId)
      .map((item) => item.countryId);
  return { related: ids('related'), contrast: ids('contrast') };
}

export function createGlobeEngine(options: EngineOptions) {
  const { container } = options;
  const countries = new Map(options.labels.map((label) => [label.id, label]));
  let disposed = false;
  let failed = false;

  const basemap = createBasemapMaterial();
  const globe = new Globe(container, {
    animateIn: false,
    rendererConfig: { antialias: true, alpha: true },
  })
    .width(container.clientWidth)
    .height(container.clientHeight)
    .backgroundColor('rgba(0,0,0,0)')
    .globeMaterial(basemap.material)
    .globeCurvatureResolution(1.5)
    .showAtmosphere(true)
    .atmosphereColor('#7badce')
    .atmosphereAltitude(0.11)
    // Picking uses sphere intersection, so globe.gl's scene raycasts stay off.
    .enablePointerInteraction(false)
    .lights(basemap.lights);
  const renderer = globe.renderer();
  basemap.setImage(options.basemap, renderer.capabilities.getMaxAnisotropy());
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  globe.pointOfView(options.homeView);
  const controls = globe.controls();
  controls.enablePan = false;
  controls.minDistance = 106;
  controls.maxDistance = 600;
  controls.autoRotate = false;
  controls.rotateSpeed = 0.42;
  controls.zoomSpeed = 0.65;

  const unproject = createGlobeUnprojector(globe.camera(), globe.getGlobeRadius());
  const surfacePoint = (x: number, y: number) => unproject(x, y, globe.width(), globe.height());

  let frame = 0;
  let lastLayout = 0;
  const layout = (now: number) => {
    if (disposed) return;
    if (now - lastLayout < LAYOUT_INTERVAL_MS) {
      frame = requestAnimationFrame(layout);
      return;
    }
    frame = 0;
    lastLayout = now;
    globe.camera().updateMatrixWorld();
    labels.layout({
      globe,
      features: geography.features,
      unproject: surfacePoint,
      bounds: container.getBoundingClientRect(),
      occluders: options.occluders(),
    });
  };
  const scheduleLayout = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(layout);
  };

  const geography = createGeography({
    scene: globe.scene(),
    features: options.features,
    loadDetail: () => fetchCountries(options.assets.countriesDetail, options.signal),
    onFeaturesChange: scheduleLayout,
  });

  const labels = createLabelLayer(options.labels, {
    onSelectCountry: options.onSelect,
    onFocusPlace: options.onFocusPlace,
    onHoverCountry: (id) => geography.setHovered(id),
  });
  globe
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude(LABEL_ALTITUDE)
    .htmlTransitionDuration(0)
    // Set once: changing this accessor makes globe.gl recreate every element.
    .htmlElement((item) => (item as LabelDatum).element)
    .htmlElementsData(labels.data);

  const routes = createRouteLayer(globe, duration);

  const canvas = renderer.domElement;
  const interactions = createPointerInteractions({
    container,
    canvas,
    countryAt: (clientX, clientY) => {
      const bounds = container.getBoundingClientRect();
      globe.camera().updateMatrixWorld();
      const feature = geography.countryAt(
        surfacePoint(clientX - bounds.left, clientY - bounds.top),
      );
      if (!feature) return undefined;
      const id = feature.properties.ADM0_A3;
      return { id, name: countries.get(id)?.name ?? feature.properties.ADMIN };
    },
    onHover: (id) => geography.setHovered(id),
    onSelect: options.onSelect,
  });

  let detailTimer: ReturnType<typeof setTimeout> | undefined;
  globe.onZoom(() => {
    interactions.cameraMoved();
    basemap.followCamera(globe.camera());
    scheduleLayout();
    clearTimeout(detailTimer);
    detailTimer = setTimeout(() => geography.refine(globe.pointOfView().altitude), SETTLE_DELAY_MS);
  });
  basemap.followCamera(globe.camera());

  const observer = new ResizeObserver(() => {
    globe.width(container.clientWidth).height(container.clientHeight);
    scheduleLayout();
  });
  observer.observe(container);

  // Rendering pauses while the tab is hidden and resumes with a fresh label layout.
  const visibility = () => {
    if (failed) return;
    if (document.hidden) globe.pauseAnimation();
    else {
      globe.resumeAnimation();
      scheduleLayout();
    }
  };
  document.addEventListener('visibilitychange', visibility);

  const contextLost = () => {
    failed = true;
    globe.pauseAnimation();
    options.onError(new Error('WebGL context lost'));
  };
  canvas.addEventListener('webglcontextlost', contextLost);

  // The overview is where reset returns; the target is where the scene last sent the camera.
  let overview = options.homeView;
  let target: CameraView | undefined;

  return {
    applyScene(scene: MapScene, changes: SceneChanges) {
      if (changes.focusCountry) geography.setSelected(scene.focusCountryId);
      if (changes.focusCountry || changes.highlights) geography.setRoles(rolesOf(scene));
      const dataChanged = labels.setScene({
        selectedId: scene.focusCountryId,
        emphasizedIds: new Set(scene.highlights.map((item) => item.countryId)),
        places: scene.places,
        focusPlaceId: scene.focusPlaceId,
      });
      if (dataChanged) globe.htmlElementsData(labels.data);
      if (changes.routes) routes.setRoutes(scene.routes);
      overview = sceneView(scene, countries, options.homeView);
      const next = sceneTarget(scene, countries, options.homeView);
      // The camera only moves when the scene asks for a different view.
      if (!target || !sameView(target, next)) {
        target = next;
        globe.pointOfView(next, duration(SCENE_TRANSITION_MS));
      }
      scheduleLayout();
    },

    zoom(direction: 'in' | 'out' | 'reset') {
      if (direction === 'reset') {
        target = overview;
        globe.pointOfView(overview, duration(RESET_TRANSITION_MS));
      } else {
        globe.pointOfView(zoomView(globe.pointOfView(), direction), duration(ZOOM_TRANSITION_MS));
      }
    },

    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(detailTimer);
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', contextLost);
      interactions.dispose();
      geography.dispose();
      globe._destructor();
      basemap.dispose();
      // Release the GPU context now rather than at garbage collection, so a retry gets a fresh one.
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      container.replaceChildren();
    },
  };
}

export type GlobeEngine = ReturnType<typeof createGlobeEngine>;
