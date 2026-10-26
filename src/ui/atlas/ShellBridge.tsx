'use client';

import { useEffect } from 'react';
import type { ShellPage } from '@/domain/view-models';
import { useAtlas } from './AtlasProvider';

/**
 * The bridge between a page and the persistent shell. The shell lives in the root layout and
 * never loads content, so each page renders this with its destination and resolved scene
 * (or null for the world view), and the shell's globe renders whatever was published.
 */
export function ShellBridge({ page }: { page: ShellPage | null }) {
  const { publish } = useAtlas();
  useEffect(() => publish(page), [publish, page]);
  return null;
}
