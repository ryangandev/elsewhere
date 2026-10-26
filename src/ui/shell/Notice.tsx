'use client';

import { Check } from 'lucide-react';
import { useAtlas } from '../atlas/AtlasProvider';

export function Notice() {
  const { notice } = useAtlas();
  return (
    <div className={`atlas-notice ${notice ? 'visible' : ''}`} role="status" aria-live="polite">
      {notice && (
        <>
          <Check size={15} />
          {notice}
        </>
      )}
    </div>
  );
}
