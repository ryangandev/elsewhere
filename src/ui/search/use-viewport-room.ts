'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Measures the viewport space above and below an element while `active`, and exposes it as the
 * CSS custom properties `--room-above` and `--room-below` on the element. A popover anchored to
 * the element can then size itself in CSS to the space it really has, wherever the element sits.
 */
export function useViewportRoom<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      element.style.setProperty('--room-above', `${Math.round(rect.top)}px`);
      element.style.setProperty(
        '--room-below',
        `${Math.round(window.innerHeight - rect.bottom)}px`,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active]);

  return ref;
}
