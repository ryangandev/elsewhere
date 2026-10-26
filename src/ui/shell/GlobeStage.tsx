'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import GlobeView, { type GlobeViewHandle } from '@/globe/GlobeView';
import { EMPTY_SCENE, type MapScene } from '@/globe/scene';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useCountryLabels } from '../atlas/use-indexes';

// Page chrome that country and place labels must not cover.
const OCCLUDERS =
  '.country-panel, .topbar, .map-controls, .map-caption, .map-breadcrumb, .home > *, .question-results';
const occluders = () => document.querySelectorAll(OCCLUDERS);

/**
 * Lives in the root layout, so the globe controller is created once per visit.
 * It renders the scene the current page published, plus the place in focus.
 * GlobeView loads globe.gl only in the browser; it mounts once the country labels arrive.
 */
export function GlobeStage() {
  const { page, focus, focusPlace, go, globeCommand, globeStatus, setGlobeStatus } = useAtlas();
  const globe = useRef<GlobeViewHandle>(null);
  const labels = useCountryLabels();

  const scene = useMemo<MapScene>(() => {
    const published = page?.scene ?? EMPTY_SCENE;
    return focus ? { ...published, focusPlaceId: focus.id } : published;
  }, [page, focus]);

  const paths = useMemo(
    () => new Map((labels.data ?? []).map((label) => [label.id, label.path])),
    [labels.data],
  );
  const select = useCallback(
    (id: string) => {
      const path = paths.get(id);
      if (path) go(path);
    },
    [paths, go],
  );

  useEffect(() => {
    if (globeCommand.seq) globe.current?.zoom(globeCommand.type);
  }, [globeCommand]);

  // Without labels the globe still works; it only lacks country names.
  const ready = labels.data !== undefined || labels.failed;

  return (
    <>
      <div className="globe-area">
        {ready && (
          <GlobeView
            ref={globe}
            scene={scene}
            labels={labels.data ?? []}
            occluders={occluders}
            onSelect={select}
            onFocusPlace={focusPlace}
            onStatus={setGlobeStatus}
          />
        )}
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
