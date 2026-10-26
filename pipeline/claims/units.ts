// The claim-bearing text units of a country file: the overview's summary and geography, each
// "why it matters" point, each quick fact and each story section, with the sources it cites.
// These are exactly the entries that list source IDs, so each one is checked against its own
// sources. A unit's key hashes its text and cited sources, so a stored verdict stops applying
// the moment either changes.
import { createHash } from 'node:crypto';
import type { Country, CountryFile, Source, Story } from '../../src/content/schema';

/** A part of a country file whose units are checked together: the overview (with quick facts) or one story. */
export type ClaimScope = { kind: 'overview' } | { kind: 'story'; storyId: string };

export type ClaimUnit = {
  /** Readable ID within one check, e.g. "quick-fact-2" or "length-section-1"; only the model and logs see it. */
  id: string;
  /** Where the text is, for people, e.g. 'Quick fact "Capital"'. */
  label: string;
  /** The exact text checked. */
  text: string;
  /** The cited sources, in the order the entry lists them. */
  sources: Source[];
  /** Hash of the text and the cited sources; a stored verdict applies only while it matches. */
  key: string;
};

export const scopeLabel = (countryId: string, scope: ClaimScope) =>
  scope.kind === 'overview' ? countryId : `${countryId}/${scope.storyId}`;

/** A check of one story is named after it; any other set of scopes after the country. */
export const scopesLabel = (countryId: string, scopes: ClaimScope[]) =>
  scopes.length === 1 ? scopeLabel(countryId, scopes[0]) : countryId;

function unit(
  id: string,
  label: string,
  text: string,
  sourceIds: string[],
  declared: Source[],
): ClaimUnit {
  const sources = sourceIds.map((sourceId) => {
    const source = declared.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`${label} cites undeclared source "${sourceId}"; run npm run content:check`);
    }
    return source;
  });
  const key = createHash('sha256')
    .update(JSON.stringify({ text, sources: sources.map(({ id, url }) => ({ id, url })) }))
    .digest('hex')
    .slice(0, 16);
  return { id, label, text, sources, key };
}

export const overviewUnit = (country: Country) =>
  unit(
    'overview',
    'Overview summary and geography',
    `${country.overview.summary}\n${country.overview.geography}`,
    country.overview.sourceIds,
    country.sources,
  );

export const whyItMattersUnit = (
  country: Country,
  item: Country['overview']['whyItMatters'][number],
  position: number,
) =>
  unit(
    `why-it-matters-${position}`,
    `Why it matters "${item.title}"`,
    `${item.title}: ${item.text}`,
    item.sourceIds,
    country.sources,
  );

export const quickFactUnit = (
  country: Country,
  fact: Country['quickFacts'][number],
  position: number,
) =>
  unit(
    `quick-fact-${position}`,
    `Quick fact "${fact.label}"`,
    `${fact.label}: ${fact.value}${fact.asOf ? ` (as of ${fact.asOf})` : ''}`,
    fact.sourceIds,
    country.sources,
  );

export const sectionUnit = (story: Story, section: Story['sections'][number], position: number) =>
  unit(
    `${story.id}-section-${position}`,
    `Section "${section.title}"`,
    `${section.title}: ${section.text}`,
    section.sourceIds,
    story.sources,
  );

export function overviewUnits(country: Country): ClaimUnit[] {
  return [
    overviewUnit(country),
    ...country.overview.whyItMatters.map((item, index) =>
      whyItMattersUnit(country, item, index + 1),
    ),
    ...country.quickFacts.map((fact, index) => quickFactUnit(country, fact, index + 1)),
  ];
}

export const storyUnits = (story: Story): ClaimUnit[] =>
  story.sections.map((section, index) => sectionUnit(story, section, index + 1));

export function scopeUnits(file: CountryFile, scope: ClaimScope): ClaimUnit[] {
  if (scope.kind === 'overview') return overviewUnits(file.country);
  const story = file.stories.find((entry) => entry.id === scope.storyId);
  if (!story) throw new Error(`${file.country.id} has no story "${scope.storyId}"`);
  return storyUnits(story);
}

/** The overview and every story, in file order. */
export const allScopes = (file: CountryFile): ClaimScope[] => [
  { kind: 'overview' },
  ...file.stories.map((story) => ({ kind: 'story' as const, storyId: story.id })),
];

/** Sources cited by any of the units, each once, in first-cited order. */
export function citedSources(units: ClaimUnit[]): Source[] {
  const sources = new Map<string, Source>();
  for (const entry of units) {
    for (const source of entry.sources) if (!sources.has(source.id)) sources.set(source.id, source);
  }
  return [...sources.values()];
}
