'use client';

import { useEffect, useRef, useState } from 'react';
import type { GlobeInstance } from 'globe.gl';
import { type Country, type Place, type Topic } from './data';
import { directory, type MapCountry } from './exploration';
import mapIndex from './country-index.json';

export type GlobeAction = { type: 'in' | 'out' | 'reset'; seq: number };
export type GlobeStatus = 'loading' | 'ready' | 'error';
type GeoFeature = { properties: { ADM0_A3: string; ADMIN: string }; geometry: object };
type MapLabel = Place & { id?: string; area?: number };
type MarkerElement = { place: MapLabel; button: HTMLButtonElement; label: HTMLSpanElement };
const countryMarkers: MapLabel[] = directory.map(country => {
  const geometry = mapIndex.find(item => item.id === country.id);
  return { ...country, lat: geometry?.lat ?? country.lat, lng: geometry?.lng ?? country.lng, area: geometry?.area ?? 0 };
});
const homeView = { lat: 18, lng: 87, altitude: 2.05 };
const duration = (ms: number) => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;

// Use the land's projected size, then reserve space for each visible name.
// Every country keeps its dot, even when there is not room for its name.
function arrangeCountryNames(instance: GlobeInstance, markers: MarkerElement[]) {
  const camera = instance.camera();
  const distance = camera.position.length();
  const radius = instance.getGlobeRadius();
  const fov = 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 50;
  const focalLength = instance.height() / (2 * Math.tan(fov * Math.PI / 360));
  const candidates = markers.map(marker => {
    const { place, button, label } = marker;
    const point = instance.getCoords(place.lat, place.lng);
    const cosine = (point.x * camera.position.x + point.y * camera.position.y + point.z * camera.position.z) / (radius * distance);
    const facing = (distance * cosine - radius) / Math.sqrt(distance ** 2 + radius ** 2 - 2 * distance * radius * cosine);
    const scale = focalLength / (distance / radius - cosine);
    const space = Math.sqrt(place.area ?? 0) * scale * Math.sqrt(Math.max(0, facing)) * .85;
    const screen = instance.getScreenCoords(place.lat, place.lng, .006);
    const width = label.offsetWidth;
    const active = button.classList.contains('active');
    button.classList.remove('show-country-name');
    return { button, active, space, width, x: screen.x, y: screen.y, visible: facing > .08 };
  }).filter(item => item.visible && item.x > 12 && item.x < instance.width() - 12 && item.y > 20 && item.y < instance.height() - 12)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.space - a.space);
  const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
  for (const item of candidates) {
    if (!item.active && item.space < item.width + 14) continue;
    const box = { left: item.x - item.width / 2 - 7, right: item.x + item.width / 2 + 7, top: item.y - 34, bottom: item.y - 7 };
    if (!item.active && occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue;
    item.button.classList.add('show-country-name');
    occupied.push(box);
  }
}

type Props = {
  country: MapCountry | null; profile: Country | null; topic: Topic | null; focus: Place | null;
  action: GlobeAction; onSelect: (id: string) => void; onFocus: (place: Place) => void;
  onStatus: (status: GlobeStatus) => void;
};
export default function GlobeView({ country, profile, topic, focus, action, onSelect, onFocus, onStatus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeInstance | null>(null);
  const sceneView = useRef(homeView);
  const markers = useRef<MarkerElement[]>([]);
  const scheduleMarkerLayout = useRef<() => void>(() => {});
  const callbacks = useRef({ onSelect, onFocus, onStatus });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { callbacks.current = { onSelect, onFocus, onStatus }; }, [onSelect, onFocus, onStatus]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let canvas: HTMLCanvasElement | undefined;
    let layoutFrame = 0;
    const failed = () => {
      if (disposed) return;
      clearTimeout(readyTimer);
      setError(true);
      globe.current?.pauseAnimation();
      callbacks.current.onStatus('error');
    };
    const visibility = () => {
      if (document.hidden) globe.current?.pauseAnimation();
      else globe.current?.resumeAnimation();
    };
    const init = async () => {
      try {
        const [{ default: Globe }, geo] = await Promise.all([
          import('globe.gl'),
          fetch('/maps/countries.geojson').then(response => {
            if (!response.ok) throw new Error('Map unavailable');
            return response.json() as Promise<{ features: GeoFeature[] }>;
          }),
        ]);
        if (disposed || !host.current) return;
        const element = host.current;
        const instance = new Globe(element, { animateIn: false, rendererConfig: { antialias: true, alpha: true } })
          .width(element.clientWidth).height(element.clientHeight).backgroundColor('rgba(0,0,0,0)')
          .globeImageUrl('/maps/earth.jpg').showAtmosphere(true).atmosphereColor('#7badce').atmosphereAltitude(.14)
          .polygonsData(geo.features).polygonAltitude(.002).polygonCapColor(() => 'rgba(0,0,0,0)')
          .polygonSideColor(() => 'rgba(0,0,0,0)').polygonStrokeColor(() => 'rgba(204,219,205,0.23)')
          .polygonsTransitionDuration(duration(300))
          .polygonLabel(item => {
            const feature = item as GeoFeature;
            const label = document.createElement('div');
            label.className = 'map-tooltip';
            label.textContent = directory.find(c => c.id === feature.properties.ADM0_A3)?.name ?? feature.properties.ADMIN;
            return label;
          })
          .onPolygonClick(item => callbacks.current.onSelect((item as GeoFeature).properties.ADM0_A3));
        globe.current = instance;
        const scheduleLayout = () => {
          if (layoutFrame) return;
          layoutFrame = requestAnimationFrame(() => {
            layoutFrame = 0;
            if (!disposed) arrangeCountryNames(instance, markers.current);
          });
        };
        scheduleMarkerLayout.current = scheduleLayout;
        instance.onZoom(scheduleLayout);
        instance.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 2));
        instance.pointOfView(homeView);
        const controls = instance.controls();
        controls.enablePan = false;
        controls.minDistance = 125;
        controls.maxDistance = 600;
        controls.autoRotate = false;
        controls.rotateSpeed = .5;
        controls.zoomSpeed = .6;
        observer = new ResizeObserver(() => {
          instance.width(element.clientWidth).height(element.clientHeight);
          scheduleLayout();
        });
        observer.observe(element);
        canvas = instance.renderer().domElement;
        canvas?.addEventListener('webglcontextlost', failed);
        document.addEventListener('visibilitychange', visibility);
        readyTimer = setTimeout(failed, 18000);
        instance.onGlobeReady(() => {
          if (disposed) return;
          clearTimeout(readyTimer);
          setLoaded(true);
          setError(false);
          callbacks.current.onStatus('ready');
        });
      } catch (error) { console.error('Globe initialization failed:', error); failed(); }
    };
    void init();
    return () => {
      disposed = true;
      cancelAnimationFrame(layoutFrame);
      scheduleMarkerLayout.current = () => {};
      markers.current = [];
      clearTimeout(readyTimer);
      observer?.disconnect();
      canvas?.removeEventListener('webglcontextlost', failed);
      document.removeEventListener('visibilitychange', visibility);
      globe.current?._destructor();
      globe.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = globe.current;
    if (!instance || !loaded) return;
    const overview = topic?.view ?? (country ? { lat: country.lat, lng: country.lng, altitude: profile?.altitude ?? 1.2 } : homeView);
    const view = focus ? { lat: focus.lat, lng: focus.lng, altitude: Math.max(.32, Math.min(overview.altitude * .75, .7)) } : overview;
    sceneView.current = overview;
    instance.pointOfView(view, duration(1000));
    instance.polygonCapColor(item => (item as GeoFeature).properties.ADM0_A3 === country?.id ? 'rgba(161,204,141,0.28)' : 'rgba(0,0,0,0)')
      .polygonStrokeColor(item => (item as GeoFeature).properties.ADM0_A3 === country?.id ? '#d2e4a5' : 'rgba(204,219,205,0.2)');
    const context = topic?.places ?? profile?.neighbors ?? [];
    const labels: MapLabel[] = [...countryMarkers, ...context.filter(place => !countryMarkers.some(marker => marker.name === place.name))];
    markers.current = [];
    instance.htmlElementsData(labels).htmlLat('lat').htmlLng('lng').htmlAltitude(.006).htmlElement(item => {
      const place = item as MapLabel;
      const button = document.createElement('button');
      const active = place.id === country?.id || place.name === focus?.name;
      button.className = `globe-pin ${active ? 'active' : ''} ${place.kind === 'water' ? 'water-label' : ''} ${place.id ? 'country-marker' : 'context-label'}`;
      button.setAttribute('aria-label', `${place.id ? 'Explore' : 'Locate'} ${place.name}`);
      if (place.id) {
        button.dataset.country = place.id;
        const dot = document.createElement('span'); dot.className = 'country-dot'; dot.setAttribute('aria-hidden', 'true'); button.appendChild(dot);
        const label = document.createElement('span'); label.className = 'country-marker-name'; label.textContent = place.name; button.appendChild(label);
        markers.current.push({ place, button, label });
        scheduleMarkerLayout.current();
      } else button.appendChild(document.createTextNode(place.name));
      button.onclick = event => {
        event.stopPropagation();
        if (place.id) callbacks.current.onSelect(place.id);
        else callbacks.current.onFocus(place);
      };
      return button;
    });
    scheduleMarkerLayout.current();
    instance.pathsData(topic?.route ? [topic.route] : [])
      .pathPoints(item => item as number[][]).pathPointLat(point => (point as number[])[0])
      .pathPointLng(point => (point as number[])[1]).pathPointAlt(.012)
      .pathColor(() => '#e6dba1').pathStroke(2).pathDashLength(.07).pathDashGap(.018)
      .pathDashAnimateTime(duration(22000)).pathTransitionDuration(duration(600));
  }, [country, profile, topic, focus, loaded]);

  useEffect(() => {
    const instance = globe.current;
    if (!instance || !action.seq) return;
    const view = instance.pointOfView();
    if (action.type === 'in') instance.pointOfView({ ...view, altitude: Math.max(.25, view.altitude * .78) }, duration(350));
    if (action.type === 'out') instance.pointOfView({ ...view, altitude: Math.min(4.5, view.altitude * 1.22) }, duration(350));
    if (action.type === 'reset') instance.pointOfView(sceneView.current, duration(800));
  }, [action]);

  return <div className="globe-render" ref={host} aria-label="Interactive 3D world globe">
    {error && <div className="globe-error" role="status"><strong>The globe couldn’t load.</strong><p>All stories, search, and your saved places are still available.</p><button onClick={() => location.reload()}>Try again</button></div>}
  </div>;
}
