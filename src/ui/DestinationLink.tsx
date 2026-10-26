'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import type { Destination } from '@/domain/destination';
import { destinationPath } from '@/domain/paths';
import { useAtlas } from './atlas/AtlasProvider';

type Props = {
  destination: Destination;
  className?: string;
  children: ReactNode;
};

/**
 * A real link, so the destination can be opened in a new tab, shared, and crawled.
 * A plain click goes through the atlas so that dialogs close and per-page state resets.
 */
export function DestinationLink({ destination, className, children }: Props) {
  const { go } = useAtlas();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modified || event.button !== 0) return;
    event.preventDefault();
    go(destination);
  };
  return (
    <Link
      href={destinationPath(destination)}
      className={className}
      onClick={onClick}
      scroll={false}
    >
      {children}
    </Link>
  );
}
