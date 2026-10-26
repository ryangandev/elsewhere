'use client';

import { useEffect, useRef, useState } from 'react';
import type { GlobeInstance } from 'globe.gl';
import type { Country, Place, Topic } from '@/content/legacy/data';
import { directory, type MapCountry } from '@/domain/catalog';
import mapIndex from '@/content/legacy/country-index.json';
import PerformanceMonitor from './PerformanceMonitor';
import type { BasemapMode } from './globe/materials';
import { createCountryLookup } from './globe/country-lookup';
import { arrangeContextLabels, arrangeLabels, type CountryFeature, type CountryLabel } from './globe/cartography';

export type GlobeAction = { type: 'in' | 'out' | 'reset'; seq: number };
export type GlobeStatus = 'loading' | 'ready' | 'error';
type MapLabel = Place & { id?: string; area?: number; rank?: number };
const mapLabels: MapLabel[] = mapIndex.map(item => ({ ...item, name: directory.find(c => c.id === item.id)?.name ?? item.name }));
const homeView = { lat: 23, lng: 83, altitude: 1.95 };
const duration = (ms: number) => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;

type Props = {
  country: MapCountry | null; profile: Country | null; topic: Topic | null; focus: Place | null;
  action: GlobeAction; onSelect: (id: string) => void; onFocus: (place: Place) => void;
  onStatus: (status: GlobeStatus) => void;
  performanceEnabled: boolean; onClosePerformance: () => void;
};
export default function GlobeView({ country, profile, topic, focus, action, onSelect, onFocus, onStatus, performanceEnabled, onClosePerformance }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeInstance | null>(null);
  const sceneView = useRef(homeView);
  const labels = useRef<CountryLabel[]>([]);
  const contextElements = useRef<HTMLButtonElement[]>([]);
  const features = useRef(new Map<string, CountryFeature>());
  const scheduleLayout = useRef<() => void>(() => {});
  const repaint = useRef<() => void>(() => {});
  const highlight = useRef<(id?: string) => void>(() => {});
  const current = useRef({ onSelect, onFocus, onStatus, country, focus });
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState(false);
  const [basemap, setBasemap] = useState<BasemapMode>('texture');
  const [showLabels, setShowLabels] = useState(true);
  const labelVisibility = useRef(true);
  const changeBasemap = useRef<(mode: BasemapMode) => void>(() => {});
  useEffect(() => { changeBasemap.current(basemap); }, [basemap]);
  useEffect(() => { labelVisibility.current = showLabels; scheduleLayout.current(); }, [showLabels]);
  useEffect(() => { current.current = { onSelect, onFocus, onStatus, country, focus }; }, [onSelect, onFocus, onStatus, country, focus]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let frame = 0;
    let detailTimer: ReturnType<typeof setTimeout> | undefined;
    let lastLayout = 0;
    let releaseMaterials = () => {};
    let releaseInteractions = () => {};
    const requests = new AbortController();
    const failed = () => {
      if (disposed) return;
      setError(true);
      globe.current?.pauseAnimation();
      current.current.onStatus('error');
    };
    const visibility = () => {
      if (document.hidden) globe.current?.pauseAnimation();
      else { globe.current?.resumeAnimation(); scheduleLayout.current(); }
    };
    const readGeometry = async (path: string) => {
      const response = await fetch(path, { signal: AbortSignal.any([requests.signal, AbortSignal.timeout(18000)]) });
      if (!response.ok) throw new Error('Map unavailable');
      return await response.json() as { features: CountryFeature[] };
    };
    const init = async () => {
      try {
        const [{ default: Globe }, { createAtlasMaterials, TextureLoader, SRGBColorSpace }, { createGlobeUnprojector }, { createCountryBorders }, { createCountryFills }, geometry] = await Promise.all([
          import('globe.gl'), import('./globe/materials'), import('./globe/projection'), import('./globe/borders'), import('./globe/fills'), readGeometry('/maps/countries.geojson'),
        ]);
        if (disposed || !host.current) return;
        const element = host.current;
        const materials = createAtlasMaterials();
        releaseMaterials = materials.dispose;
        let hoveredId: string | undefined;
        let detailed = false;
        let detailRequested = false;
        let reliefWidth = 0;
        let highReliefRequested = false;
        const loader = new TextureLoader();
        let mode: BasemapMode = 'texture';
        const borders = createCountryBorders(100.12);
        const fills = createCountryFills(100.15);
        const image = await loader.loadAsync('/maps/earth.jpg');
        if (disposed) { image.dispose(); borders.dispose(); fills.dispose(); materials.dispose(); return; }
        image.colorSpace = SRGBColorSpace;
        materials.photo.map = image;
        let lookup = createCountryLookup(geometry.features);
        const setFeatures = (items: CountryFeature[]) => {
          features.current = new Map(items.map(feature => [feature.properties.ADM0_A3, feature]));
          lookup = createCountryLookup(items);
          borders.setFeatures(items);
          fills.setFeatures(items);
          fills.highlight(current.current.country?.id, hoveredId);
          borders.highlight(current.current.country?.id, hoveredId);
          instance.polygonsData(mode === 'vector' ? items : []);
          scheduleLayout.current();
        };
        const capMaterial = (item: object) => {
          const id = (item as CountryFeature).properties.ADM0_A3;
          return id === current.current.country?.id ? materials.selected : id === hoveredId ? materials.hover : materials.base;
        };
        const stroke = (item: object) => {
          const id = (item as CountryFeature).properties.ADM0_A3;
          return id === current.current.country?.id ? '#58775c' : id === hoveredId ? '#6b8270' : 'rgba(64,87,76,0.30)';
        };
        const instance = new Globe(element, { animateIn: false, rendererConfig: { antialias: true, alpha: true } })
          .width(element.clientWidth).height(element.clientHeight).backgroundColor('rgba(0,0,0,0)')
          .globeMaterial(materials.photo).globeCurvatureResolution(1.5)
          .showAtmosphere(true).atmosphereColor('#7badce').atmosphereAltitude(.11).enablePointerInteraction(false)
          .polygonAltitude(.004).polygonCapCurvatureResolution(1.5)
          // A falsy side color omits side geometry; transparent sides still draw twice.
          .polygonCapMaterial(capMaterial).polygonSideColor(() => '')
          .polygonStrokeColor(stroke).polygonsTransitionDuration(0)
          .polygonLabel(item => {
            const feature = item as CountryFeature;
            const label = document.createElement('div');
            label.className = 'map-tooltip';
            label.textContent = directory.find(c => c.id === feature.properties.ADM0_A3)?.name ?? feature.properties.ADMIN;
            return label;
          })
          .onPolygonHover(item => highlight.current(item ? (item as CountryFeature).properties.ADM0_A3 : undefined))
          .onPolygonClick(item => current.current.onSelect((item as CountryFeature).properties.ADM0_A3));
        globe.current = instance;
        instance.scene().add(borders.group, fills.group);
        image.anisotropy = Math.min(8, instance.renderer().capabilities.getMaxAnisotropy());
        instance.lights(materials.lights);
        instance.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 2));
        instance.pointOfView(homeView);
        const controls = instance.controls();
        controls.enablePan = false;
        controls.minDistance = 106;
        controls.maxDistance = 600;
        controls.autoRotate = false;
        controls.rotateSpeed = .42;
        controls.zoomSpeed = .65;
        repaint.current = () => {
          borders.highlight(current.current.country?.id, hoveredId);
          if (mode === 'texture') fills.highlight(current.current.country?.id, hoveredId);
          else instance.polygonCapMaterial(capMaterial).polygonStrokeColor(stroke);
        };
        highlight.current = id => { if (hoveredId !== id) { hoveredId = id; repaint.current(); } };
        const unproject = createGlobeUnprojector(instance.camera(), instance.getGlobeRadius());
        const layout = (now: number) => {
          if (disposed) return;
          if (now - lastLayout < 48) { frame = requestAnimationFrame(layout); return; }
          frame = 0;
          lastLayout = now;
          instance.camera().updateMatrixWorld();
          const bounds = element.getBoundingClientRect();
          const interfaceElements = [...element.closest('.world-app')?.querySelectorAll<HTMLElement>('.country-panel, .topbar, .map-controls, .map-caption, .map-breadcrumb, .discovery') ?? []];
          const interfaceBoxes = interfaceElements.filter(el => el.isConnected).map(el => {
            const box = el.getBoundingClientRect();
            return { left: box.left - bounds.left - 8, right: box.right - bounds.left + 8, top: box.top - bounds.top - 5, bottom: box.bottom - bounds.top + 5 };
          });
          const selected = labels.current.find(label => label.id === current.current.country?.id);
          const contextBoxes = arrangeContextLabels(contextElements.current, selected, bounds, interfaceBoxes);
          if (labelVisibility.current) {
            const surfacePoint = (x: number, y: number) => unproject(x, y, instance.width(), instance.height());
            arrangeLabels(instance, labels.current, features.current, surfacePoint, current.current.country?.id, [...interfaceBoxes, ...contextBoxes]);
          } else for (const label of labels.current) {
            label.visible = false; label.element.classList.remove('is-visible'); label.element.style.opacity = '0';
            label.element.tabIndex = -1; label.element.setAttribute('aria-hidden', 'true');
          }
        };
        scheduleLayout.current = () => { if (!frame && !disposed) frame = requestAnimationFrame(layout); };
        const loadRelief = (width: number) => {
          loader.load(`/maps/relief-${width}.jpg`, texture => {
            if (disposed || width < reliefWidth) { texture.dispose(); return; }
            reliefWidth = width;
            texture.anisotropy = Math.min(8, instance.renderer().capabilities.getMaxAnisotropy());
            materials.setRelief(texture, width);
          }, undefined, () => { /* Vector geography stays fully usable without the optional relief. */ });
        };
        const refine = () => {
          if (disposed || instance.pointOfView().altitude > 1.1) return;
          if (!detailRequested && !detailed) {
            detailRequested = true;
            void readGeometry('/maps/countries-detail.geojson').then(data => {
              if (disposed) return;
              detailed = true;
              setFeatures(data.features);
            }).catch(() => { /* Retain complete base geometry if refinement is unavailable. */ });
          }
          if (mode === 'vector' && !highReliefRequested && element.clientWidth > 900 && instance.renderer().capabilities.maxTextureSize >= 8192) {
            highReliefRequested = true;
            loadRelief(8192);
          }
        };
        let pointerTimer: ReturnType<typeof setTimeout> | undefined;
        const tooltip = document.createElement('div');
        tooltip.className = 'map-tooltip texture-tooltip';
        tooltip.hidden = true;
        element.appendChild(tooltip);
        const clearHover = () => { clearTimeout(pointerTimer); pointerTimer = undefined; tooltip.hidden = true; highlight.current(); };
        let pointer: { x: number; y: number } | null = null;
        let press: { id: number; x: number; y: number; moved: boolean } | null = null;
        const activePointers = new Set<number>();
        const countryAt = (x: number, y: number) => {
          const bounds = element.getBoundingClientRect();
          instance.camera().updateMatrixWorld();
          return lookup(unproject(x - bounds.left, y - bounds.top, instance.width(), instance.height()));
        };
        const showHover = () => {
          if (!pointer || mode !== 'texture' || activePointers.size) return;
          const feature = countryAt(pointer.x, pointer.y);
          highlight.current(feature?.properties.ADM0_A3);
          tooltip.hidden = !feature;
          if (feature) {
            const bounds = element.getBoundingClientRect();
            tooltip.textContent = directory.find(c => c.id === feature.properties.ADM0_A3)?.name ?? feature.properties.ADMIN;
            tooltip.style.left = `${Math.max(8, Math.min(pointer.x - bounds.left + 12, bounds.width - tooltip.offsetWidth - 8))}px`;
            tooltip.style.top = `${Math.max(8, Math.min(pointer.y - bounds.top + 12, bounds.height - tooltip.offsetHeight - 8))}px`;
          }
        };
        const move = (event: PointerEvent) => {
          pointer = { x: event.clientX, y: event.clientY };
          if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.moved = true;
          if (!pointerTimer && mode === 'texture') pointerTimer = setTimeout(() => { pointerTimer = undefined; showHover(); }, 50);
        };
        const down = (event: PointerEvent) => {
          activePointers.add(event.pointerId);
          if (event.button === 0 && activePointers.size === 1) press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
          else press = null;
          clearHover();
        };
        const up = (event: PointerEvent) => {
          activePointers.delete(event.pointerId);
          if (mode === 'texture' && press?.id === event.pointerId && !press.moved && event.type === 'pointerup' && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 5) {
            const feature = countryAt(event.clientX, event.clientY);
            if (feature) current.current.onSelect(feature.properties.ADM0_A3);
          }
          press = null;
          pointer = { x: event.clientX, y: event.clientY };
          if (event.type === 'pointerup' && !pointerTimer) pointerTimer = setTimeout(() => { pointerTimer = undefined; showHover(); }, 50);
        };
        const leave = () => { pointer = null; clearHover(); };
        changeBasemap.current = next => {
          mode = next; clearHover();
          borders.group.visible = fills.group.visible = next === 'texture';
          instance.enablePointerInteraction(next === 'vector');
          instance.globeMaterial(next === 'texture' ? materials.photo : materials.ocean);
          instance.polygonsData(next === 'vector' ? [...features.current.values()] : []);
          instance.atmosphereColor(next === 'texture' ? '#7badce' : '#92b8c3').atmosphereAltitude(next === 'texture' ? .11 : .075);
          if (next === 'vector' && !reliefWidth) loadRelief(4096);
          repaint.current(); scheduleLayout.current(); refine();
        };
        instance.onZoom(() => {
          if (mode === 'texture') { clearHover(); pointerTimer = setTimeout(() => { pointerTimer = undefined; showHover(); }, 180); }
          materials.followCamera(instance.camera());
          scheduleLayout.current();
          clearTimeout(detailTimer);
          detailTimer = setTimeout(refine, 180);
        });
        observer = new ResizeObserver(() => {
          instance.width(element.clientWidth).height(element.clientHeight);
          scheduleLayout.current();
        });
        observer.observe(element);
        canvas = instance.renderer().domElement;
        canvas.addEventListener('webglcontextlost', failed);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('pointerleave', leave);
        releaseInteractions = () => {
          clearTimeout(pointerTimer); tooltip.remove(); borders.dispose(); fills.dispose();
          canvas?.removeEventListener('pointermove', move); canvas?.removeEventListener('pointerdown', down);
          canvas?.removeEventListener('pointerup', up); canvas?.removeEventListener('pointercancel', up); canvas?.removeEventListener('pointerleave', leave);
        };
        document.addEventListener('visibilitychange', visibility);
        setFeatures(geometry.features);
        materials.followCamera(instance.camera());
        setLoaded(version => version + 1);
        current.current.onStatus('ready');
      } catch (error) {
        if (!disposed) { console.error('Globe initialization failed:', error); failed(); }
      }
    };
    void init();
    return () => {
      disposed = true;
      requests.abort();
      cancelAnimationFrame(frame);
      clearTimeout(detailTimer);
      scheduleLayout.current = () => {};
      repaint.current = () => {};
      highlight.current = () => {};
      changeBasemap.current = () => {};
      releaseInteractions();
      labels.current = [];
      contextElements.current = [];
      observer?.disconnect();
      canvas?.removeEventListener('webglcontextlost', failed);
      document.removeEventListener('visibilitychange', visibility);
      globe.current?._destructor();
      globe.current = null;
      releaseMaterials();
    };
  }, []);

  useEffect(() => {
    const instance = globe.current;
    if (!instance || !loaded) return;
    const area = mapIndex.find(item => item.id === country?.id)?.area ?? .1;
    const altitude = profile?.altitude ?? Math.max(.16, Math.min(1.3, Math.sqrt(area) * 5));
    const overview = topic?.view ?? (country ? { lat: country.lat, lng: country.lng, altitude } : homeView);
    const view = focus ? { lat: focus.lat, lng: focus.lng, altitude: Math.max(.12, Math.min(overview.altitude * .75, .7)) } : overview;
    sceneView.current = overview;
    instance.pointOfView(view, duration(1100));
    repaint.current();
    const context = (topic?.places ?? profile?.neighbors ?? []).filter(place => place.name !== country?.name);
    const items: MapLabel[] = [...mapLabels.filter(label => !context.some(place => place.name === label.name)), ...context];
    labels.current = [];
    contextElements.current = [];
    instance.htmlElementsData(items).htmlLat('lat').htmlLng('lng').htmlAltitude(.006).htmlElement(item => {
      const place = item as MapLabel;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `${place.id ? 'Explore' : 'Locate'} ${place.name}`);
      if (place.id) {
        button.className = 'atlas-country-name';
        button.classList.toggle('is-callout', place.id === country?.id && (place.area ?? 0) < .0003);
        button.dataset.country = place.id;
        button.textContent = place.name;
        button.tabIndex = -1;
        button.setAttribute('aria-hidden', 'true');
        labels.current.push({ id: place.id, name: place.name, lat: place.lat, lng: place.lng, area: place.area ?? 0, rank: place.rank ?? 6, element: button, visible: false });
        button.onmouseenter = button.onfocus = () => highlight.current(place.id);
        button.onmouseleave = button.onblur = () => highlight.current();
      } else {
        button.dataset.place = place.name;
        button.className = `globe-pin context-label ${place.kind === 'water' ? 'water-label' : ''} ${place.name === focus?.name ? 'active' : ''}`;
        button.textContent = place.name;
        contextElements.current.push(button);
      }
      let labelPress: { x: number; y: number } | null = null;
      button.onpointerdown = event => { labelPress = { x: event.clientX, y: event.clientY }; };
      button.onpointercancel = () => { labelPress = null; };
      button.onclick = event => {
        event.stopPropagation();
        const moved = event.detail > 0 && labelPress && Math.hypot(event.clientX - labelPress.x, event.clientY - labelPress.y) > 5;
        labelPress = null;
        if (moved) return;
        if (place.id) current.current.onSelect(place.id);
        else current.current.onFocus(place);
      };
      scheduleLayout.current();
      return button;
    });
    instance.pathsData(topic?.route ? [topic.route] : [])
      .pathPoints(item => item as number[][]).pathPointLat(point => (point as number[])[0])
      .pathPointLng(point => (point as number[])[1]).pathPointAlt(.006)
      .pathColor(() => '#ebd49f').pathStroke(1.6).pathDashLength(.06).pathDashGap(.018)
      .pathDashAnimateTime(duration(24000)).pathTransitionDuration(duration(600));
  }, [country, profile, topic, focus, loaded]);

  useEffect(() => {
    const instance = globe.current;
    if (!instance || !action.seq) return;
    const view = instance.pointOfView();
    if (action.type === 'in') instance.pointOfView({ ...view, altitude: Math.max(.06, view.altitude * .76) }, duration(400));
    if (action.type === 'out') instance.pointOfView({ ...view, altitude: Math.min(4.5, view.altitude * 1.26) }, duration(400));
    if (action.type === 'reset') instance.pointOfView(sceneView.current, duration(850));
  }, [action]);

  return <><div className="globe-render" data-basemap={basemap} ref={host} aria-label="Interactive 3D world globe">
    {error && <div className="globe-error" role="status"><strong>The globe couldn’t load.</strong><p>All stories, search, and your saved places are still available.</p><button onClick={() => location.reload()}>Try again</button></div>}
  </div>{performanceEnabled && loaded > 0 && !error && <PerformanceMonitor globeRef={globe} readyKey={loaded} basemap={basemap} onBasemapChange={setBasemap} showLabels={showLabels} onLabelsChange={setShowLabels} onClose={onClosePerformance} />}</>;
}
