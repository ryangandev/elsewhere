'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { directory } from '@/domain/catalog';
import { contextPlaces, countryLabels, legacyScene } from '@/domain/legacy-scene';
import GlobeView, { type GlobeViewHandle } from '@/globe/GlobeView';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

// Page chrome that country and place labels must not cover.
const OCCLUDERS =
  '.country-panel, .topbar, .map-controls, .map-caption, .map-breadcrumb, .discovery';
const occluders = () => document.querySelectorAll(OCCLUDERS);

/**
 * Lives in the root layout, so the globe controller is created once per visit.
 * GlobeView loads globe.gl only in the browser.
 */
export function GlobeStage() {
  const {
    country,
    profile,
    topic,
    focus,
    focusPlace,
    go,
    globeCommand,
    globeStatus,
    setGlobeStatus,
  } = useAtlas();
  const globe = useRef<GlobeViewHandle>(null);

  const scene = useMemo(
    () => legacyScene(country, profile, topic, focus),
    [country, profile, topic, focus],
  );

  const select = useCallback(
    (id: string) => {
      if (directory.some((item) => item.id === id)) go({ countryId: id });
    },
    [go],
  );

  const focusById = useCallback(
    (id: string) => {
      const place =
        contextPlaces(country, profile, topic).find((item) => item.name === id) ??
        (focus?.name === id ? focus : undefined);
      if (place) focusPlace(place);
    },
    [country, profile, topic, focus, focusPlace],
  );

  useEffect(() => {
    if (globeCommand.seq) globe.current?.zoom(globeCommand.type);
  }, [globeCommand]);

  return (
    <>
      <div className="globe-area">
        <GlobeView
          ref={globe}
          scene={scene}
          labels={countryLabels}
          occluders={occluders}
          onSelect={select}
          onFocusPlace={focusById}
          onStatus={setGlobeStatus}
        />
      </div>
      {globeStatus === 'loading' && (
        <div className="globe-loading" role="status">
          <span />
          {messages.map.loading}
        </div>
      )}
    </>
  );
}
