'use client';

import { ArrowRight, Compass } from 'lucide-react';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { useAtlasIndex } from '../atlas/use-indexes';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../primitives/sheet';

export function TrailDrawer() {
  const { dialog, openDialog, go } = useAtlas();
  const open = dialog === 'trails';
  const index = useAtlasIndex(open);
  const text = messages.trails;

  return (
    <Sheet open={open} onOpenChange={(next) => openDialog(next ? 'trails' : null)}>
      <SheetContent className="atlas-drawer trail-drawer">
        <Compass size={30} />
        <SheetTitle>
          {text.titleStart}
          <br />
          <em>{text.titleEmphasis}</em>
        </SheetTitle>
        <SheetDescription>{text.description}</SheetDescription>
        <div className="trail-list">
          {index.data?.index.trails.map((trail, trailIndex) => (
            <article className="trail-card" key={trail.id}>
              <div className="section-label">
                <span>0{trailIndex + 1}</span>
                {trail.label}
              </div>
              <h3>{trail.title}</h3>
              <p>{trail.description}</p>
              <div className="trail-countries">
                {trail.stops.map((stop, stopIndex) => (
                  <span key={stop.key}>
                    {stopIndex > 0 && <span className="trail-dash" />}
                    <span title={stop.countryName}>{stop.flag}</span>
                  </span>
                ))}
              </div>
              <button onClick={() => go(trail.stops[0].href)}>
                {text.follow}
                <span>
                  {trail.stops.length} {text.stops}
                  <ArrowRight size={15} />
                </span>
              </button>
            </article>
          ))}
          {index.failed && <p role="status">{messages.search.unavailable}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
