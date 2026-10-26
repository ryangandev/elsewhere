'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import type { Destination } from '@/domain/destination';
import { pageDestination, type PageView } from '@/domain/view-models';
import { useAtlas } from '../atlas/AtlasProvider';
import { ExplorerPanel } from './ExplorerPanel';
import { MapBreadcrumb } from './MapBreadcrumb';
import { MapCaption } from './MapCaption';

type Props = { view: PageView };

/**
 * The page content for a country or question: the reading panel with its breadcrumb and map
 * caption. The trail the reader arrived on is a search parameter, which is only known in the
 * browser, so the panel is prerendered without a trail and shows trail progress once it hydrates.
 */
export function DestinationPanel({ view }: Props) {
  return (
    <Suspense fallback={<Panel view={view} />}>
      <PanelWithTrail view={view} />
    </Suspense>
  );
}

function PanelWithTrail({ view }: Props) {
  const trailId = useSearchParams().get('trail');
  return <Panel view={view} trailId={trailId} />;
}

function Panel({ view, trailId }: Props & { trailId?: string | null }) {
  const { visit } = useAtlas();
  // A trail that does not include this question is ignored.
  const trail = view.kind === 'story' ? view.trails.find((item) => item.id === trailId) : undefined;
  const destination: Destination = {
    ...pageDestination(view),
    ...(trail ? { trailId: trail.id } : {}),
  };
  const { countryId, storyId, trailId: visitedTrail } = destination;

  useEffect(() => {
    visit({
      countryId,
      ...(storyId ? { storyId } : {}),
      ...(visitedTrail ? { trailId: visitedTrail } : {}),
    });
  }, [countryId, storyId, visitedTrail, visit]);

  return (
    <>
      <MapBreadcrumb
        country={view.country}
        category={view.kind === 'story' ? view.category : undefined}
      />
      <ExplorerPanel view={view} destination={destination} trail={trail} />
      <MapCaption view={view} />
    </>
  );
}
