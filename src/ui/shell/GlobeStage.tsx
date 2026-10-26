'use client';

import dynamic from 'next/dynamic';
import { directory } from '@/domain/catalog';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

// The globe touches `window` and WebGL, so it is only ever created in the browser.
// This component lives in the root layout, so the globe is created once per visit.
// TODO(globe controller): the globe moves to src/globe and drops the frame-rate monitor props.
const GlobeView = dynamic(() => import('../../../app/Globe'), { ssr: false });

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
    performanceVisible,
    closePerformance,
  } = useAtlas();

  const select = (id: string) => {
    if (directory.some((item) => item.id === id)) go({ countryId: id });
  };

  return (
    <>
      <div className="globe-area">
        <GlobeView
          country={country}
          profile={profile}
          topic={topic}
          focus={focus}
          onSelect={select}
          onFocus={focusPlace}
          action={globeCommand}
          onStatus={setGlobeStatus}
          performanceEnabled={performanceVisible}
          onClosePerformance={closePerformance}
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
