'use client';

import { useSyncExternalStore } from 'react';

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

function isApplePlatform(): boolean {
  const { userAgentData, platform, userAgent } = navigator as NavigatorWithUAData;
  return /mac|iphone|ipad|ipod/i.test(userAgentData?.platform || platform || userAgent);
}

const subscribe = () => () => {};

/**
 * Whether the reader is on a Mac, iPhone or iPad, where shortcuts use Command instead of Control.
 * Pages are prerendered without knowing the platform, so this is `undefined` on the server and
 * during hydration, and settles right after, without a hydration mismatch.
 */
export function useApplePlatform(): boolean | undefined {
  return useSyncExternalStore(subscribe, isApplePlatform, () => undefined);
}
