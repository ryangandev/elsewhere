'use client';

import { useEffect, useRef } from 'react';

/**
 * Moves keyboard and screen reader focus to a heading when it appears, so a navigation
 * announces the new content. The heading needs `tabIndex={-1}`.
 */
export function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}
