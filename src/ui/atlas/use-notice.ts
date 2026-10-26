'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const NOTICE_MS = 3500;

/** A short status message that clears itself, announced to screen readers by the notice region. */
export function useNotice() {
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announce = useCallback((message: string) => {
    clearTimeout(timer.current);
    setNotice(message);
    timer.current = setTimeout(() => setNotice(''), NOTICE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { notice, announce };
}
