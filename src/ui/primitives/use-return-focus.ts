'use client';

import { useRef } from 'react';

type AutoFocusHandler = (event: Event) => void;

/**
 * Returns focus to whatever opened a dialog when it closes. Radix does this only for its own
 * `Trigger`, and the atlas opens its dialogs from shell state instead, so without this focus
 * falls to the page body. If something else took focus while the dialog closed, such as the
 * heading of a page the dialog navigated to, it is left there.
 */
export function useReturnFocus(
  onOpenAutoFocus?: AutoFocusHandler,
  onCloseAutoFocus?: AutoFocusHandler,
) {
  const opener = useRef<HTMLElement | null>(null);

  return {
    onOpenAutoFocus(event: Event) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: Event) {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const target = opener.current;
      opener.current = null;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (target?.isConnected && target !== document.body) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      }
    },
  };
}
