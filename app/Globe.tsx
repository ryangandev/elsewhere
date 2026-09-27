'use client';

import { useEffect, useRef, useState } from 'react';
import type { GlobeInstance } from 'globe.gl';
import { countries, type Country, type Place, type Topic } from './data';
import { directory, type MapCountry } from './exploration';

export type GlobeAction = { type: 'in' | 'out' | 'reset'; seq: number };
export type GlobeStatus = 'loading' | 'ready' | 'error';
type GeoFeature = { properties: { ADM0_A3: string; ADMIN: string }; geometry: object };
type MapLabel = Place & { id?: string };
const homeView = { lat: 18, lng: 87, altitude: 2.05 };
const duration = (ms: number) => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;

type Props = {
  country: MapCountry | null; profile: Country | null; topic: Topic | null; focus: Place | null;
  action: GlobeAction; onSelect: (id: string) => void; onFocus: (place: Place) => void;
  onStatus: (status: GlobeStatus) => void;
};
export default function GlobeView({ country, profile, topic, focus, action, onSelect, onFocus, onStatus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeInstance | null>(null);
  const sceneView = useRef(homeView);
  const callbacks = useRef({ onSelect, onFocus, onStatus });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { callbacks.current = { onSelect, onFocus, onStatus }; }, [onSelect, onFocus, onStatus]);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    let canvas: HTMLCanvasElement | undefined;
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
        instance.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 2));
        instance.pointOfView(homeView);
        const controls = instance.controls();
        controls.enablePan = false;
        controls.minDistance = 125;
        controls.maxDistance = 600;
        controls.autoRotate = false;
        controls.rotateSpeed = .5;
        controls.zoomSpeed = .6;
        observer = new ResizeObserver(() => instance.width(element.clientWidth).height(element.clientHeight));
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
    const labels: MapLabel[] = country ? [country, ...context] : countries.slice(0, 8);
    instance.htmlElementsData(labels).htmlLat('lat').htmlLng('lng').htmlAltitude(.02).htmlElement(item => {
      const place = item as MapLabel;
      const button = document.createElement('button');
      const active = place.id === country?.id || place.name === focus?.name;
      button.className = `globe-pin ${active ? 'active' : ''} ${place.kind === 'water' ? 'water-label' : ''} ${!place.id ? 'context-label' : ''}`;
      button.setAttribute('aria-label', `${place.id ? 'Explore' : 'Locate'} ${place.name}`);
      if (place.id) {
        const dot = document.createElement('span'); dot.className = 'pin-dot'; button.appendChild(dot);
      }
      button.appendChild(document.createTextNode(place.name));
      button.onclick = event => {
        event.stopPropagation();
        if (place.id) callbacks.current.onSelect(place.id);
        else callbacks.current.onFocus(place);
      };
      return button;
    });
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
