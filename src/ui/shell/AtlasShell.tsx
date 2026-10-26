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
import { MapBreadcrumb } from './MapBreadcrumb';
import { MapCaption } from './MapCaption';
import { MapControls } from './MapControls';
import { Notice } from './Notice';
import { Topbar } from './Topbar';

/**
 * The persistent frame of the app: header, globe, map controls, footer, and dialogs.
 * It is rendered by the root layout, so navigating between pages only swaps `children`
 * (the home view or the reading panel) and the globe is never recreated.
 */
export function AtlasShell({ children }: { children: ReactNode }) {
  return (
    <AtlasProvider>
      <Frame>{children}</Frame>
    </AtlasProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { country, compact } = useAtlas();
  const classes = ['world-app', country && 'has-selection', compact && 'map-expanded'];

  return (
    <main className={classes.filter(Boolean).join(' ')}>
      <a className="skip-link" href={country ? '#country-reading' : '#discovery-start'}>
        {messages.topbar.skip}
      </a>
      <Topbar />
      <GlobeStage />
      <MapBreadcrumb />
      {children}
      <MapCaption />
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
