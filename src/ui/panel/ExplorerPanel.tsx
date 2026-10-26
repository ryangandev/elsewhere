'use client';

import { useId, useState } from 'react';
import { destinationKey, type Destination } from '@/domain/destination';
import type { PageView, TrailView } from '@/domain/view-models';
import { format, messages } from '@/i18n';
import { BasicCountryView } from './BasicCountryView';
import { CountryView } from './CountryView';
import { PanelFooter } from './PanelFooter';
import { PanelHeader } from './PanelHeader';
import { StoryView } from './StoryView';
import { TrailProgress } from './TrailProgress';
import './panel.css';
import './reading.css';

type Props = {
  view: PageView;
  /** The page's destination, with the trail it was reached on. */
  destination: Destination;
  trail?: TrailView;
};

/**
 * The reading panel. It picks the view that matches the page: an answered question, an edited
 * country overview, or map basics for any other place.
 * On a phone it can collapse to a strip that gives the globe the room (see panel.css). That
 * belongs to one destination, so every destination starts with the panel open.
 */
export function ExplorerPanel(props: Props) {
  return <Panel key={destinationKey(props.destination)} {...props} />;
}

function Panel({ view, destination, trail }: Props) {
  const [compact, setCompact] = useState(false);
  const bodyId = useId();
  const key = destinationKey(destination);

  return (
    <div id="country-reading">
      <aside
        className={compact ? 'country-panel panel-compact' : 'country-panel'}
        aria-label={format(messages.panel.label, { name: view.country.name })}
      >
        <PanelHeader
          view={view}
          destination={destination}
          compact={compact}
          bodyId={bodyId}
          onToggleCompact={() => setCompact((current) => !current)}
        />
        <div className="panel-scroll" id={bodyId} key={key}>
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
        </div>
        <PanelFooter />
      </aside>
    </div>
  );
}
