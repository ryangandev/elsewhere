'use client';

import { destinationKey, type Destination } from '@/domain/destination';
import type { PageView, TrailView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { useAtlas } from '../atlas/AtlasProvider';
import { BasicCountryView } from './BasicCountryView';
import { CountryView } from './CountryView';
import { PanelFooter } from './PanelFooter';
import { PanelHeader } from './PanelHeader';
import { ProvenanceNote } from './ProvenanceNote';
import { SourcesDetails } from './SourcesDetails';
import { StoryView } from './StoryView';
import { TrailProgress } from './TrailProgress';

type Props = {
  view: PageView;
  /** The page's destination, with the trail it was reached on. */
  destination: Destination;
  trail?: TrailView;
};

/**
 * The reading panel. It picks the view that matches the page: an answered question, an edited
 * country overview, or map basics for any other place.
 */
export function ExplorerPanel({ view, destination, trail }: Props) {
  const { compact } = useAtlas();
  const key = destinationKey(destination);

  return (
    <div id="country-reading">
      <aside
        className={`country-panel ${compact ? 'panel-compact' : ''}`}
        aria-label={format(messages.panel.label, { name: view.country.name })}
      >
        <PanelHeader view={view} destination={destination} />
        <div className="panel-scroll" key={key}>
          {trail && (
            <TrailProgress trail={trail} currentKey={key} leaveHref={view.shell.destination.href} />
          )}
          {view.kind === 'story' ? (
            <StoryView view={view} trail={trail} />
          ) : view.kind === 'country' ? (
            <CountryView view={view} />
          ) : (
            <BasicCountryView view={view} />
          )}
          {view.kind !== 'map' && (
            <>
              <SourcesDetails sources={view.sources} question={view.kind === 'story'} />
              <ProvenanceNote provenance={view.provenance} />
            </>
          )}
        </div>
        <PanelFooter view={view} />
      </aside>
    </div>
  );
}
