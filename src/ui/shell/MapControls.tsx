'use client';

import { Minus, Plus, RotateCcw } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';

export function MapControls() {
  const { globeStatus, commandGlobe } = useAtlas();
  const text = messages.controls;
  const ready = globeStatus === 'ready';
  // Without a globe there is nothing to steer.
  if (globeStatus === 'error') return null;

  return (
    <div className="map-controls" aria-label={text.label}>
      <button onClick={() => commandGlobe('reset')} aria-label={text.reset} title={text.resetHint}>
        <RotateCcw size={17} />
      </button>
      <span />
      <button onClick={() => commandGlobe('in')} aria-label={text.zoomIn} disabled={!ready}>
        <Plus size={18} />
      </button>
      <button onClick={() => commandGlobe('out')} aria-label={text.zoomOut} disabled={!ready}>
        <Minus size={18} />
      </button>
    </div>
  );
}
