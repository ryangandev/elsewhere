'use client';

import { getCountry, getMapCountry } from '@/domain/catalog';
import { destinationKey, getTopic, type Destination } from '@/domain/destination';
import { getTrail } from '@/domain/trails';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { BasicCountryView } from './BasicCountryView';
import { CountryView } from './CountryView';
import { PanelFooter } from './PanelFooter';
import { PanelHeader } from './PanelHeader';
import { SourcesDetails } from './SourcesDetails';
import { StoryView } from './StoryView';
import { TrailProgress } from './TrailProgress';

/**
 * The reading panel for a destination. It picks the view that matches what exists for it:
 * an answered question, an edited country story, or sourced basics for any other place.
 */
export function ExplorerPanel({ destination }: { destination: Destination }) {
  const { compact } = useAtlas();
  const country = getMapCountry(destination.countryId);
  const profile = getCountry(destination.countryId) ?? null;
  const topic = getTopic(destination) ?? null;
  if (!country) return null;

  const key = destinationKey(destination);
  const trail = getTrail(destination.trailId);
  const stopIndex = trail?.stops.findIndex((stop) => destinationKey(stop) === key) ?? -1;
  const nextStop = trail?.stops[stopIndex + 1];

  return (
    <div id="country-reading">
      <aside
        className={`country-panel ${compact ? 'panel-compact' : ''}`}
        aria-label={format(messages.panel.label, { name: country.name })}
      >
        <PanelHeader destination={destination} country={country} profile={profile} topic={topic} />
        <div className="panel-scroll" key={key}>
          {trail && <TrailProgress trail={trail} destination={destination} />}
          {topic && profile ? (
            <StoryView profile={profile} topic={topic} trail={trail} nextStop={nextStop} />
          ) : profile ? (
            <CountryView profile={profile} />
          ) : (
            <BasicCountryView country={country} />
          )}
          {profile && <SourcesDetails profile={profile} topic={topic} />}
        </div>
        <PanelFooter profile={profile} topic={topic} />
      </aside>
    </div>
  );
}
