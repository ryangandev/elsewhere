'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { legacyQueryToPath } from '@/domain/paths';

/**
 * Early versions addressed destinations as `/?country=sgp&topic=shipping&trail=...`.
 * Those links may still be shared, so the home page forwards them to the path URL.
 * Query strings are not available when pages are prerendered, so this runs in the browser.
 */
export function LegacyUrlRedirect() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  );
}

function Redirect() {
  const router = useRouter();
  const search = useSearchParams().toString();

  useEffect(() => {
    const path = legacyQueryToPath(search);
    if (path) router.replace(path, { scroll: false });
  }, [router, search]);

  return null;
}
