'use client';

import { ArrowUpRight } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

export function Footer() {
  const { globeStatus, openDialog } = useAtlas();
  const text = messages.footer;
  const status =
    globeStatus === 'ready' ? text.ready : globeStatus === 'error' ? text.error : text.loading;

  return (
    <footer className="world-footer">
      <div>
        <span className={`connection-dot ${globeStatus === 'ready' ? 'ready' : ''}`} />
        {status}
      </div>
      {/* Gestures mean nothing without a globe. */}
      {globeStatus !== 'error' && (
        <span className="gesture-hint">
          {text.drag}
          <span>·</span> {text.scroll}
          <span>·</span> {text.followQuestion}
        </span>
      )}
      <button onClick={() => openDialog('about')}>
        {text.about}
        <ArrowUpRight size={12} />
      </button>
    </footer>
  );
}
