// Every content file of the English edition, imported statically so the loaders work the same
// in Next.js server components, scripts and tests.
// Keep this list in sync with content/en/countries; `npm run content:check` fails when it is not.
import brazil from '../../content/en/countries/brazil.json';
import china from '../../content/en/countries/china.json';
import france from '../../content/en/countries/france.json';
import india from '../../content/en/countries/india.json';
import indonesia from '../../content/en/countries/indonesia.json';
import japan from '../../content/en/countries/japan.json';
import malaysia from '../../content/en/countries/malaysia.json';
import singapore from '../../content/en/countries/singapore.json';
import turkey from '../../content/en/countries/turkey.json';
import unitedStates from '../../content/en/countries/united-states.json';
import home from '../../content/en/home.json';
import places from '../../content/en/places.json';
import trails from '../../content/en/trails.json';
import type { ContentSources } from './store';

export const englishContent: ContentSources = {
  countryFiles: [
    brazil,
    china,
    france,
    india,
    indonesia,
    japan,
    malaysia,
    singapore,
    turkey,
    unitedStates,
  ],
  trails,
  placeNotes: places,
  home,
};
