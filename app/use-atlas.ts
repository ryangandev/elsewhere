'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { destinationKey, destinationUrl, directory, getCountry, getTopic, readDestination, validDestination, type Destination } from './exploration';

const STORAGE_KEY = 'elsewhere.library.v1';
const CHANGE = 'elsewhere:library';
const NAVIGATE = 'elsewhere:navigate';
let sessionLibrary = '';
let persistenceFailed = false;
export type Library = { saved: Destination[]; recent: Destination[] };
export function parseLibrary(value: string): Library {
  try {
    const parsed = JSON.parse(value);
    const clean = (items: unknown, limit: number) => Array.isArray(items)
      ? items.map(validDestination).filter((item): item is Destination => item !== null)
        .filter((item, index, all) => all.findIndex(other => destinationKey(item) === destinationKey(other)) === index).slice(0, limit)
      : [];
    return { saved: clean(parsed?.saved, 100), recent: clean(parsed?.recent, 20) };
  } catch { return { saved: [], recent: [] }; }
}
function snapshot() {
  try { return persistenceFailed ? sessionLibrary : localStorage.getItem(STORAGE_KEY) ?? ''; }
  catch { persistenceFailed = true; return sessionLibrary; }
}
function updateLibrary(change: (library: Library) => Library) {
  const value = JSON.stringify(change(parseLibrary(snapshot())));
  sessionLibrary = value;
  try { localStorage.setItem(STORAGE_KEY, value); persistenceFailed = false; }
  catch { persistenceFailed = true; }
  window.dispatchEvent(new Event(CHANGE));
}
function subscribeLibrary(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(CHANGE, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(CHANGE, listener); };
}
function subscribeLocation(listener: () => void) {
  window.addEventListener('popstate', listener);
  window.addEventListener(NAVIGATE, listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener(NAVIGATE, listener); };
}
const emptySnapshot = () => '';
const locationSnapshot = () => window.location.search;

export function useAtlas() {
  const search = useSyncExternalStore(subscribeLocation, locationSnapshot, emptySnapshot);
  const saved = useSyncExternalStore(subscribeLibrary, snapshot, emptySnapshot);
  const destination = readDestination(search);
  const library = parseLibrary(saved);
  const key = destination ? destinationKey(destination) : '';
  const navigate = useCallback((next: Destination | null) => {
    const url = destinationUrl(next);
    if (window.location.pathname + window.location.search !== url) {
      window.history.pushState(null, '', url);
      window.dispatchEvent(new Event(NAVIGATE));
    }
  }, []);
  useEffect(() => {
    const current = readDestination(search);
    if (current) updateLibrary(library => ({ ...library, recent: [current, ...library.recent.filter(item => destinationKey(item) !== destinationKey(current))].slice(0, 20) }));
    const country = getCountry(current?.countryId);
    const topic = getTopic(current);
    document.title = topic ? `${topic.title} | Elsewhere` : current ? `${country?.name ?? directory.find(item => item.id === current.countryId)?.name} | Elsewhere` : 'Elsewhere | A wider world';
  }, [search]);
  const toggleSave = useCallback((item: Destination) => {
    updateLibrary(library => {
      const exists = library.saved.some(saved => destinationKey(saved) === destinationKey(item));
      return { ...library, saved: exists ? library.saved.filter(saved => destinationKey(saved) !== destinationKey(item)) : [item, ...library.saved].slice(0, 100) };
    });
  }, []);
  return { destination, navigate, library, toggleSave,
    isSaved: !!key && library.saved.some(item => destinationKey(item) === key), persistenceFailed };
}
