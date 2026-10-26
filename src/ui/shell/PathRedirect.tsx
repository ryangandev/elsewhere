'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Forwards an interim ID path (`/sgp/shipping`) to its readable path (`/singapore/shipping`),
 * keeping the query string, so a `?trail=` survives. A static export cannot answer with an
 * HTTP redirect, so the prerendered page redirects once it loads in the browser.
 */
export function PathRedirect({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`${href}${window.location.search}${window.location.hash}`, { scroll: false });
  }, [router, href]);

  return null;
}
