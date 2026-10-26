'use client';

import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { useAtlas } from './atlas/AtlasProvider';

type Props = {
  /** A path built on the server, from a view model or an index. */
  href: string;
  className?: string;
  children: ReactNode;
};

/**
 * A real link, so the destination can be opened in a new tab, shared, and crawled.
 * A plain click goes through the atlas so that dialogs close and per-page state resets.
 */
export function DestinationLink({ href, className, children }: Props) {
  const { go } = useAtlas();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modified || event.button !== 0) return;
    event.preventDefault();
    go(href);
  };
  return (
    <Link href={href} className={className} onClick={onClick} scroll={false}>
      {children}
    </Link>
  );
}
