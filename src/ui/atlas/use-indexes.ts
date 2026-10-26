'use client';

import { useEffect, useState } from 'react';
import {
  ATLAS_INDEX_URL,
  LABELS_INDEX_URL,
  createAtlasLookup,
  type AtlasIndex,
  type AtlasLookup,
  type CountryLabel,
} from '@/domain/atlas-index';

type Loader<T> = { current(): T | undefined; load(): Promise<T> };

/** Fetches one generated index once per visit. A failed request can be retried later. */
function cachedLoader<T>(url: string, prepare: (data: unknown) => T): Loader<T> {
  let loaded: T | undefined;
  let pending: Promise<T> | undefined;
  return {
    current: () => loaded,
    load(): Promise<T> {
      pending ??= fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`${url}: ${response.status}`);
          return response.json();
        })
        .then((data) => (loaded = prepare(data)))
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
      return pending;
    },
  };
}

const atlasIndex = cachedLoader(ATLAS_INDEX_URL, (data) => createAtlasLookup(data as AtlasIndex));
const countryLabels = cachedLoader(LABELS_INDEX_URL, (data) => data as CountryLabel[]);

export type IndexState<T> = { data: T | undefined; failed: boolean };

function useIndex<T>(loader: Loader<T>, enabled: boolean): IndexState<T> {
  const [state, setState] = useState<IndexState<T>>(() => ({
    data: loader.current(),
    failed: false,
  }));
  const ready = state.data !== undefined;

  useEffect(() => {
    if (!enabled || ready) return;
    let live = true;
    loader.load().then(
      (data) => live && setState({ data, failed: false }),
      () => live && setState({ data: undefined, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [loader, enabled, ready]);

  return state;
}

/**
 * The search and title index, loaded the first time a component needs it (search, the
 * library, trails, the last story on the home view) and shared afterwards.
 */
export function useAtlasIndex(enabled = true): IndexState<AtlasLookup> {
  return useIndex(atlasIndex, enabled);
}

/** Country labels for the globe; the globe mounts once they arrive. */
export function useCountryLabels(): IndexState<CountryLabel[]> {
  return useIndex(countryLabels, true);
}
