'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { destinationKey, type Destination } from './destination';
import { libraryStore, parseLibrary, recordVisit, toggleSaved, type Library } from './library';

export type LibraryState = {
  library: Library;
  persistenceFailed: boolean;
  isSaved: (destination: Destination) => boolean;
  toggleSave: (destination: Destination) => void;
  visit: (destination: Destination) => void;
};

export function useLibrary(): LibraryState {
  const raw = useSyncExternalStore(
    libraryStore.subscribe,
    libraryStore.getSnapshot,
    libraryStore.getServerSnapshot,
  );
  const library = useMemo(() => parseLibrary(raw), [raw]);

  const isSaved = useCallback(
    (destination: Destination) =>
      library.saved.some((item) => destinationKey(item) === destinationKey(destination)),
    [library],
  );
  const toggleSave = useCallback(
    (destination: Destination) =>
      libraryStore.update((current) => toggleSaved(current, destination)),
    [],
  );
  const visit = useCallback(
    (destination: Destination) =>
      libraryStore.update((current) => recordVisit(current, destination)),
    [],
  );

  return {
    library,
    persistenceFailed: libraryStore.persistenceFailed(),
    isSaved,
    toggleSave,
    visit,
  };
}
