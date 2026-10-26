'use client';

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  DEFAULT_GLOBE_ASSETS,
  createAtlasGlobe,
  type AtlasGlobe,
  type AtlasGlobeAssets,
  type CountryLabelData,
  type GlobeLabelMessages,
  type GlobeStatus,
} from './controller';
import type { MapScene } from './scene';
import './globe.css';

/** Interface text the globe shows, supplied by the app's message catalog. */
export type GlobeMessages = GlobeLabelMessages & {
  /** Accessible name of the globe region. */
  region: string;
  errorTitle: string;
  errorDetail: string;
  retry: string;
};

export type GlobeViewHandle = {
  zoom(direction: 'in' | 'out' | 'reset'): void;
};

type GlobeViewProps = {
  scene: MapScene;
  // Read when the globe mounts; changing them later has no effect.
  labels: readonly CountryLabelData[];
  messages: GlobeMessages;
  assets?: AtlasGlobeAssets;
  // Elements the globe's labels must not cover.
  occluders?: () => Iterable<Element>;
  onSelect?: (countryId: string) => void;
  onFocusPlace?: (placeId: string) => void;
  onStatus?: (status: GlobeStatus) => void;
  ref?: Ref<GlobeViewHandle>;
};

// A thin React wrapper: mounts the controller once, forwards scene changes, disposes on unmount.
// The controller loads globe.gl on demand in the browser, so this is safe to server-render.
export default function GlobeView({
  scene,
  labels,
  messages,
  assets = DEFAULT_GLOBE_ASSETS,
  occluders,
  onSelect,
  onFocusPlace,
  onStatus,
  ref,
}: GlobeViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<AtlasGlobe | null>(null);
  const [status, setStatus] = useState<GlobeStatus>('loading');
  // Each retry mounts a fresh controller.
  const [attempt, setAttempt] = useState(0);

  const mountOptions = useEffectEvent(() => ({ labels, messages, assets, scene }));
  const findOccluders = useEffectEvent(() => occluders?.() ?? []);
  const select = useEffectEvent((id: string) => onSelect?.(id));
  const focusPlace = useEffectEvent((id: string) => onFocusPlace?.(id));
  const report = useEffectEvent((next: GlobeStatus) => {
    setStatus(next);
    onStatus?.(next);
  });

  useEffect(() => {
    const { labels, messages, assets, scene } = mountOptions();
    const instance = createAtlasGlobe(host.current!, {
      labels,
      messages,
      assets,
      occluders: () => findOccluders(),
    });
    globe.current = instance;
    const unsubscribe = [
      instance.on('select', select),
      instance.on('focusPlace', focusPlace),
      instance.on('status', report),
    ];
    report(instance.status);
    instance.setScene(scene);
    return () => {
      for (const off of unsubscribe) off();
      instance.dispose();
      globe.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    globe.current?.setScene(scene);
  }, [scene]);

  useImperativeHandle(ref, () => ({ zoom: (direction) => globe.current?.zoom(direction) }), []);

  return (
    <div className="globe-render" role="region" aria-label={messages.region}>
      {/* A failed globe hides entirely, so stale labels and tooltips never sit over the message. */}
      <div ref={host} className="globe-host" hidden={status === 'error'} />
      {status === 'error' && (
        <div className="globe-error" role="status">
          <strong>{messages.errorTitle}</strong>
          <p>{messages.errorDetail}</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            {messages.retry}
          </button>
        </div>
      )}
    </div>
  );
}
