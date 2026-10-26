'use client';

import type { ReactNode } from 'react';
import { messages } from '@/i18n';
import { AtlasProvider, useAtlas } from '../atlas/AtlasProvider';
import { AboutSheet } from '../dialogs/AboutSheet';
import { LibraryDrawer } from '../dialogs/LibraryDrawer';
import { SearchDialog } from '../dialogs/SearchDialog';
import { ShareDialog } from '../dialogs/ShareDialog';
import { TrailDrawer } from '../dialogs/TrailDrawer';
import { Footer } from './Footer';
import { GlobeStage } from './GlobeStage';
import { MapControls } from './MapControls';
import { Notice } from './Notice';
import { Topbar } from './Topbar';

/**
 * The persistent frame of the app: header, globe, map controls, footer, and dialogs.
 * It is rendered by the root layout, so navigating between pages only swaps `children`
 * (the home view, or the reading panel with its breadcrumb and map caption) and the globe is
 * never recreated. It does not load content; pages publish what it needs through ShellBridge.
 */
export function AtlasShell({ children }: { children: ReactNode }) {
  return (
    <AtlasProvider>
      <Frame>{children}</Frame>
    </AtlasProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { destination, compact } = useAtlas();
  // Whether a reading panel is open is styled with :has(#country-reading), so the prerendered
  // page is laid out correctly before the page publishes to the shell.
  const classes = ['world-app', compact && 'map-expanded'];

  return (
    <main className={classes.filter(Boolean).join(' ')}>
      <a className="skip-link" href={destination ? '#country-reading' : '#discovery-start'}>
        {messages.topbar.skip}
      </a>
      <Topbar />
      <GlobeStage />
      {children}
      <MapControls />
      <Footer />
      <Notice />
      <SearchDialog />
      <TrailDrawer />
      <LibraryDrawer />
      <AboutSheet />
      <ShareDialog />
    </main>
  );
}
