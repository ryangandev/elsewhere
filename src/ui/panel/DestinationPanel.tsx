'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { destinationKey, validDestination } from '@/domain/destination';
import { ExplorerPanel } from './ExplorerPanel';
import { useAtlas } from '../atlas/AtlasProvider';

type Props = { countryId: string; topicId?: string };

/**
 * The page content for a country or question.
 * The trail the reader arrived on is a search parameter, which is only known in the browser.
 * The panel is prerendered without a trail, then shows trail progress once the page hydrates.
 */
export function DestinationPanel(props: Props) {
  return (
    <Suspense fallback={<Panel {...props} />}>
      <PanelWithTrail {...props} />
    </Suspense>
  );
}

function PanelWithTrail(props: Props) {
  const trailId = useSearchParams().get('trail') ?? undefined;
  return <Panel {...props} trailId={trailId} />;
}

function Panel({ countryId, topicId, trailId }: Props & { trailId?: string }) {
  const { visit } = useAtlas();
  // A trail that does not include this question is dropped.
  const destination = validDestination({ countryId, topicId, trailId });
  const key = destination ? destinationKey(destination) : '';
  const trail = destination?.trailId;

  useEffect(() => {
    if (key) visit({ countryId, topicId, ...(trail ? { trailId: trail } : {}) });
  }, [key, trail, countryId, topicId, visit]);

  return destination ? <ExplorerPanel destination={destination} /> : null;
}
