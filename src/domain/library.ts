import { destinationKey, parseDestination, type Destination } from './destination';

/**
 * The reader's personal atlas: saved questions and recent history.
 * It lives in localStorage behind this small interface so that a later account system
 * can replace the storage without touching components.
 */
export type Library = { saved: Destination[]; recent: Destination[] };

export const SAVED_LIMIT = 100;
export const RECENT_LIMIT = 20;

const STORAGE_KEY = 'elsewhere.library.v1';
const CHANGE_EVENT = 'elsewhere:library';

export const emptyLibrary: Library = { saved: [], recent: [] };

function cleanList(items: unknown, limit: number): Destination[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(parseDestination)
    .filter((item): item is Destination => item !== null)
    .filter(
      (item, index, all) =>
        all.findIndex((other) => destinationKey(item) === destinationKey(other)) === index,
    )
    .slice(0, limit);
}

/**
 * Restores a stored library, discarding anything malformed, duplicated, or over the limit.
 * Entries for content that no longer exists are kept here and hidden where they are shown.
 */
export function parseLibrary(value: string): Library {
  try {
    const parsed = JSON.parse(value);
    return {
      saved: cleanList(parsed?.saved, SAVED_LIMIT),
      recent: cleanList(parsed?.recent, RECENT_LIMIT),
    };
  } catch {
    return emptyLibrary;
  }
}

/** Library after saving or unsaving a destination. */
export function toggleSaved(library: Library, destination: Destination): Library {
  const key = destinationKey(destination);
  const exists = library.saved.some((item) => destinationKey(item) === key);
  const saved = exists
    ? library.saved.filter((item) => destinationKey(item) !== key)
    : [destination, ...library.saved].slice(0, SAVED_LIMIT);
  return { ...library, saved };
}

/** Library after visiting a destination: it moves to the front of the recent list. */
export function recordVisit(library: Library, destination: Destination): Library {
  const key = destinationKey(destination);
  const others = library.recent.filter((item) => destinationKey(item) !== key);
  return { ...library, recent: [destination, ...others].slice(0, RECENT_LIMIT) };
}

// Browser storage can be unavailable (private windows, blocked cookies). The library then
// stays in memory for the session and the interface says so.
let sessionValue = '';
let storageFailed = false;

function readRaw(): string {
  if (storageFailed) return sessionValue;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    storageFailed = true;
    return sessionValue;
  }
}

function writeRaw(value: string) {
  sessionValue = value;
  try {
    localStorage.setItem(STORAGE_KEY, value);
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
}

export const libraryStore = {
  /** Raw snapshot for useSyncExternalStore; parse it with `parseLibrary`. */
  getSnapshot: readRaw,
  getServerSnapshot: () => '',
  persistenceFailed: () => storageFailed,
  subscribe(listener: () => void) {
    window.addEventListener('storage', listener);
    window.addEventListener(CHANGE_EVENT, listener);
    return () => {
      window.removeEventListener('storage', listener);
      window.removeEventListener(CHANGE_EVENT, listener);
    };
  },
  update(change: (library: Library) => Library) {
    writeRaw(JSON.stringify(change(parseLibrary(readRaw()))));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  },
};
