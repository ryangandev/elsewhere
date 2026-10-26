'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import GlobeView, { type GlobeViewHandle } from '../src/globe/GlobeView';
import type { CountryLabelData, GlobeStatus } from '../src/globe/controller';
import type { MapScene, ScenePlace } from '../src/globe/scene';
import type { Country, Place, Topic } from './data';
import { directory, type MapCountry } from './exploration';
import mapIndex from './country-index.json';

// Transitional adapter from the prototype page's props to the MapScene-driven globe in src/globe.
// It goes away when the page moves to Next.js and builds scenes from content.

export type GlobeAction = { type: 'in' | 'out' | 'reset'; seq: number };
export type { GlobeStatus };

const labels: CountryLabelData[] = mapIndex.map((item) => ({
  id: item.id,
  name: directory.find((country) => country.id === item.id)?.name ?? item.name,
  lat: item.lat,
  lng: item.lng,
  area: item.area,
  rank: item.rank,
}));

// Page chrome that country and place labels must not cover.
const OCCLUDERS =
  '.country-panel, .topbar, .map-controls, .map-caption, .map-breadcrumb, .discovery';
const occluders = () => document.querySelectorAll(OCCLUDERS);

const toScenePlace = (place: Place): ScenePlace => ({
  id: place.name,
  name: place.name,
  lat: place.lat,
  lng: place.lng,
  kind: place.kind ?? 'place',
});

type Props = {
  country: MapCountry | null;
  profile: Country | null;
  topic: Topic | null;
  focus: Place | null;
  action: GlobeAction;
  onSelect: (id: string) => void;
  onFocus: (place: Place) => void;
  onStatus: (status: GlobeStatus) => void;
  // The frame-rate checker was removed; the prototype page still passes these.
  performanceEnabled?: boolean;
  onClosePerformance?: () => void;
};

export default function Globe({
  country,
  profile,
  topic,
  focus,
  action,
  onSelect,
  onFocus,
  onStatus,
}: Props) {
  const globe = useRef<GlobeViewHandle>(null);

  const context = useMemo(
    () =>
      (topic?.places ?? profile?.neighbors ?? []).filter((place) => place.name !== country?.name),
    [country, profile, topic],
  );

  const scene = useMemo<MapScene>(() => {
    const places = context.map(toScenePlace);
    if (focus && !places.some((place) => place.id === focus.name)) places.push(toScenePlace(focus));
    const camera =
      topic?.view ??
      (country && profile
        ? { lat: country.lat, lng: country.lng, altitude: profile.altitude }
        : undefined);
    const route = topic?.route?.map(([lat, lng]): [number, number] => [lat, lng]);
    return {
      camera,
      focusCountryId: country?.id,
      highlights: [],
      places,
      routes: topic && route ? [{ id: topic.id, kind: 'sea', points: route }] : [],
      focusPlaceId: focus?.name,
    };
  }, [context, country, profile, topic, focus]);

  const focusPlace = useCallback(
    (id: string) => {
      const place =
        context.find((item) => item.name === id) ?? (focus?.name === id ? focus : undefined);
      if (place) onFocus(place);
    },
    [context, focus, onFocus],
  );

  useEffect(() => {
    if (action.seq) globe.current?.zoom(action.type);
  }, [action]);

  return (
    <GlobeView
      ref={globe}
      scene={scene}
      labels={labels}
      occluders={occluders}
      onSelect={onSelect}
      onFocusPlace={focusPlace}
      onStatus={onStatus}
    />
  );
}
