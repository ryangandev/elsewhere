'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { legacyQueryToPath } from '@/domain/atlas-index';
import { useAtlasIndex } from '../atlas/use-indexes';

/**
 * Early versions addressed destinations as `/?country=sgp&topic=shipping&trail=...`.
 * Those links may still be shared, so the home page forwards them to the path URL.
 * Query strings are not available when pages are prerendered, so this runs in the browser,
 * with the atlas index to turn IDs into paths.
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
  const index = useAtlasIndex(new URLSearchParams(search).has('country'));

  useEffect(() => {
    if (!index.data) return;
    const path = legacyQueryToPath(search, index.data);
    if (path) router.replace(path, { scroll: false });
  }, [router, search, index.data]);

  return null;
}
