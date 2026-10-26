'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Destination } from '@/domain/destination';
import { useLibrary, type LibraryState } from '@/domain/use-library';
import type { ShellDestination, ShellPage } from '@/domain/view-models';
import type { ScenePlace } from '@/globe/scene';
import { messages } from '@/i18n';
import { browserShareEnvironment, shareLink } from './share-link';
import { useNotice } from './use-notice';

export type DialogName = 'search' | 'trails' | 'library' | 'about';
export type GlobeStatus = 'loading' | 'ready' | 'error';
export type GlobeCommand = { type: 'in' | 'out' | 'reset'; seq: number };

export type AtlasState = LibraryState & {
  /** What the current page published: where the reader is and the globe scene. Null at home. */
  page: ShellPage | null;
  destination: ShellDestination | null;
  /** Called by ShellBridge; returns a function that withdraws this page again. */
  publish: (page: ShellPage | null) => () => void;
  /** Navigates to a path built on the server (from a view model or an index), or home. */
  go: (href: string | null) => void;

  /** The scene place the reader asked to look at more closely, if any. */
  focus: ScenePlace | null;
  focusPlace: (placeId: string | null) => void;
  globeStatus: GlobeStatus;
  setGlobeStatus: (status: GlobeStatus) => void;
  globeCommand: GlobeCommand;
  commandGlobe: (type: GlobeCommand['type']) => void;

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
 * Holds everything that must outlive a navigation: the published page, the globe's controls,
 * dialogs, the notice, and which place is in focus. It lives in the root layout, so route
 * changes never reset it. It never loads content: each page publishes its destination and
 * scene through ShellBridge.
 */
export function AtlasProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const library = useLibrary();
  const { notice, announce } = useNotice();

  const [page, setPage] = useState<ShellPage | null>(null);
  const destination = page?.destination ?? null;
  const key = destination?.key ?? '';

  // Focus belongs to one destination; it is ignored once the destination changes.
  const [focusState, setFocusState] = useState<{ key: string; placeId: string } | null>(null);
  const focus =
    (focusState?.key === key &&
      page?.scene.places.find((place) => place.id === focusState.placeId)) ||
    null;

  const [globeStatus, setGlobeStatus] = useState<GlobeStatus>('loading');
  const [globeCommand, setGlobeCommand] = useState<GlobeCommand>({ type: 'reset', seq: 0 });
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [shareUrl, setShareUrl] = useState('');

  const publish = useCallback((next: ShellPage | null) => {
    setPage(next);
    // Withdraw only if no other page has published since, so the order of effects between
    // the outgoing and incoming page does not matter.
    return () => setPage((current) => (current === next ? null : current));
  }, []);

  const go = useCallback(
    (href: string | null) => {
      setFocusState(null);
      setDialog(null);
      const path = href ?? '/';
      if (path !== window.location.pathname + window.location.search) {
        router.push(path, { scroll: false });
      }
    },
    [router],
  );

  const focusPlace = useCallback(
    (placeId: string | null) => setFocusState(placeId ? { key, placeId } : null),
    [key],
  );

  const commandGlobe = useCallback((type: GlobeCommand['type']) => {
    if (type === 'reset') setFocusState(null);
    setGlobeCommand((current) => ({ type, seq: current.seq + 1 }));
  }, []);

  const share = useCallback(async () => {
    const url = window.location.href;
    const outcome = await shareLink({ title: document.title, url }, browserShareEnvironment());
    if (outcome === 'copied') announce(messages.notice.linkCopied);
    else if (outcome === 'manual') setShareUrl(url);
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
      else if (destination?.storyId) go(destination.countryHref);
      else if (destination) go(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, destination, focus, go]);

  const state: AtlasState = {
    ...library,
    page,
    destination,
    publish,
    go,
    focus,
    focusPlace,
    globeStatus,
    setGlobeStatus,
    globeCommand,
    commandGlobe,
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
