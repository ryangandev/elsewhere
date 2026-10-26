'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Country, Place, Topic } from '@/content/legacy/data';
import { getCountry, getMapCountry, type MapCountry } from '@/domain/catalog';
import { destinationKey, getTopic, type Destination } from '@/domain/destination';
import { destinationFromPath, destinationPath } from '@/domain/paths';
import { useLibrary, type LibraryState } from '@/domain/use-library';
import { messages } from '@/i18n';
import { useNotice } from './use-notice';

export type DialogName = 'search' | 'trails' | 'library' | 'about';
export type GlobeStatus = 'loading' | 'ready' | 'error';
export type GlobeCommand = { type: 'in' | 'out' | 'reset'; seq: number };

export type AtlasState = LibraryState & {
  /** Where the reader is, derived from the pathname. Null on the home view. */
  destination: Destination | null;
  country: MapCountry | null;
  profile: Country | null;
  topic: Topic | null;
  go: (destination: Destination | null) => void;

  /** The place the reader asked to look at more closely on the globe, if any. */
  focus: Place | null;
  focusPlace: (place: Place | null) => void;
  /** On small screens the reading panel can shrink to give the map room. */
  compact: boolean;
  toggleCompact: () => void;

  globeStatus: GlobeStatus;
  setGlobeStatus: (status: GlobeStatus) => void;
  globeCommand: GlobeCommand;
  commandGlobe: (type: GlobeCommand['type']) => void;
  performanceVisible: boolean;
  togglePerformance: () => void;
  closePerformance: () => void;

  dialog: DialogName | null;
  openDialog: (dialog: DialogName | null) => void;
  shareUrl: string;
  closeShare: () => void;
  share: () => Promise<void>;
  save: (destination: Destination) => void;

  notice: string;
};

const AtlasContext = createContext<AtlasState | null>(null);

export function useAtlas(): AtlasState {
  const state = useContext(AtlasContext);
  if (!state) throw new Error('useAtlas must be used inside AtlasProvider');
  return state;
}

/**
 * Holds everything that must outlive a navigation: the globe's controls, dialogs, the notice,
 * and which place is in focus. It lives in the root layout, so route changes never reset it.
 * The current destination is not stored here; it is read from the pathname.
 */
export function AtlasProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const library = useLibrary();
  const { notice, announce } = useNotice();

  const destination = useMemo(() => destinationFromPath(pathname), [pathname]);
  const key = destination ? destinationKey(destination) : '';
  const country = getMapCountry(destination?.countryId) ?? null;
  const profile = getCountry(destination?.countryId) ?? null;
  const topic = getTopic(destination) ?? null;

  // Focus and compact mode belong to one destination; they are ignored once the path changes.
  const [focusState, setFocusState] = useState<{ key: string; place: Place } | null>(null);
  const [compactKey, setCompactKey] = useState<string | null>(null);
  const focus = focusState?.key === key ? focusState.place : null;
  const compact = !!key && compactKey === key;

  const [globeStatus, setGlobeStatus] = useState<GlobeStatus>('loading');
  const [globeCommand, setGlobeCommand] = useState<GlobeCommand>({ type: 'reset', seq: 0 });
  const [performanceVisible, setPerformanceVisible] = useState(false);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [shareUrl, setShareUrl] = useState('');

  const go = useCallback(
    (next: Destination | null) => {
      setFocusState(null);
      setCompactKey(null);
      setDialog(null);
      const path = destinationPath(next);
      if (path !== window.location.pathname + window.location.search) {
        router.push(path, { scroll: false });
      }
    },
    [router],
  );

  const focusPlace = useCallback(
    (place: Place | null) => setFocusState(place ? { key, place } : null),
    [key],
  );
  const toggleCompact = useCallback(
    () => setCompactKey((current) => (current === key ? null : key)),
    [key],
  );

  const commandGlobe = useCallback((type: GlobeCommand['type']) => {
    if (type === 'reset') setFocusState(null);
    setGlobeCommand((current) => ({ type, seq: current.seq + 1 }));
  }, []);
  const togglePerformance = useCallback(() => setPerformanceVisible((visible) => !visible), []);
  const closePerformance = useCallback(() => setPerformanceVisible(false), []);

  const share = useCallback(async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      announce(messages.notice.linkCopied);
    } catch {
      setShareUrl(url);
    }
  }, [announce]);

  const { toggleSave, isSaved, persistenceFailed } = library;
  const save = useCallback(
    (item: Destination) => {
      const wasSaved = isSaved(item);
      toggleSave(item);
      announce(
        wasSaved
          ? messages.notice.removed
          : persistenceFailed
            ? messages.notice.savedForSession
            : messages.notice.saved,
      );
    },
    [announce, isSaved, persistenceFailed, toggleSave],
  );

  const modalOpen = dialog !== null || shareUrl !== '';
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setDialog((current) => (current === 'search' ? null : 'search'));
        return;
      }
      if (event.key !== 'Escape' || modalOpen || event.defaultPrevented) return;
      if (focus) setFocusState(null);
      else if (topic && country) go({ countryId: country.id });
      else if (country) go(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, topic, country, focus, go]);

  const state: AtlasState = {
    ...library,
    destination,
    country,
    profile,
    topic,
    go,
    focus,
    focusPlace,
    compact,
    toggleCompact,
    globeStatus,
    setGlobeStatus,
    globeCommand,
    commandGlobe,
    performanceVisible,
    togglePerformance,
    closePerformance,
    dialog,
    openDialog: setDialog,
    shareUrl,
    closeShare: () => setShareUrl(''),
    share,
    save,
    notice,
  };

  return <AtlasContext.Provider value={state}>{children}</AtlasContext.Provider>;
}
