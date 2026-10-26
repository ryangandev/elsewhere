'use client';

import { ArrowRight, Compass } from 'lucide-react';
import { getCountry } from '@/domain/catalog';
import { destinationKey } from '@/domain/destination';
import { stopDestination, trails } from '@/domain/trails';
import { messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../primitives/sheet';

export function TrailDrawer() {
  const { dialog, openDialog, go } = useAtlas();
  const text = messages.trails;

  return (
    <Sheet open={dialog === 'trails'} onOpenChange={(open) => openDialog(open ? 'trails' : null)}>
      <SheetContent className="atlas-drawer trail-drawer">
        <Compass size={30} />
        <SheetTitle>
          {text.titleStart}
          <br />
          <em>{text.titleEmphasis}</em>
        </SheetTitle>
        <SheetDescription>{text.description}</SheetDescription>
        <div className="trail-list">
          {trails.map((trail, index) => (
            <article className="trail-card" key={trail.id}>
              <div className="section-label">
                <span>0{index + 1}</span>
                {trail.label}
              </div>
              <h3>{trail.title}</h3>
              <p>{trail.description}</p>
              <div className="trail-countries">
                {trail.stops.map((stop, stopIndex) => (
                  <span key={destinationKey(stop)}>
                    {stopIndex > 0 && <span className="trail-dash" />}
                    <span title={getCountry(stop.countryId)?.name}>
                      {getCountry(stop.countryId)?.flag}
                    </span>
                  </span>
                ))}
              </div>
              <button onClick={() => go(stopDestination(trail, trail.stops[0]))}>
                {text.follow}
                <span>
                  {trail.stops.length} {text.stops}
                  <ArrowRight size={15} />
                </span>
              </button>
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
