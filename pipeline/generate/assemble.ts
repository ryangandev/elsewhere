// Turn what the model submitted into content-schema shapes: fill in the IDs the pipeline already
// knows, give each entry the sources it cites, stamp accessedAt and provenance, and drop nulls.
import type {
  Country,
  CountryFile,
  Provenance,
  SceneSpec,
  Source,
  Story,
} from '../../src/content/schema';
import type { CountryDraft, DraftSource, DraftStory } from './draft-schema';

export type AssembleContext = {
  countryId: string;
  /** The map identity's slug; country files are named after it. */
  slug: string;
  /** The model that produced the accepted submission. */
  model: string;
  /** When the sources were read: the day of the run. */
  date: string;
  promptVersion: string;
};

const provenance = (context: AssembleContext): Provenance => ({
  generatedBy: context.model,
  generatedAt: context.date,
  promptVersion: context.promptVersion,
  status: 'draft',
});

/** The declared sources an entry cites, in order of first citation, with accessedAt set. */
function citedSources(declared: DraftSource[], cited: string[], date: string): Source[] {
  const byId = new Map(declared.map((source) => [source.id, source]));
  const result: Source[] = [];
  for (const id of new Set(cited)) {
    const source = byId.get(id);
    if (source) result.push({ ...source, accessedAt: date });
  }
  return result;
}

function scene(
  countryId: string,
  draft: Omit<SceneSpec, 'focusCountryId' | 'camera' | 'mapNote'> & { mapNote: string | null },
): SceneSpec {
  return {
    focusCountryId: countryId,
    highlights: draft.highlights,
    placeIds: draft.placeIds,
    routes: draft.routes,
    ...(draft.mapNote ? { mapNote: draft.mapNote } : {}),
  };
}

export function assembleStory(
  draft: DraftStory,
  sources: DraftSource[],
  context: AssembleContext,
): Story {
  const storyScene = scene(context.countryId, draft.scene);
  return {
    id: draft.id,
    countryId: context.countryId,
    slug: draft.slug,
    question: draft.question,
    category: draft.category,
    summary: draft.summary,
    sections: draft.sections,
    takeaway: draft.takeaway,
    scene: { ...storyScene, mapNote: draft.scene.mapNote },
    next: draft.next.map(({ countryId, storyId, reason }) => ({
      countryId,
      storyId,
      ...(reason ? { reason } : {}),
    })),
    sources: citedSources(
      sources,
      draft.sections.flatMap((section) => section.sourceIds),
      context.date,
    ),
    provenance: provenance(context),
  };
}

export function assembleCountry(draft: CountryDraft, context: AssembleContext): CountryFile {
  const { country: entry } = draft;
  const country: Country = {
    id: context.countryId,
    slug: context.slug,
    name: entry.name,
    ...(entry.nativeName && entry.nativeName !== entry.name
      ? { nativeName: entry.nativeName }
      : {}),
    region: entry.region,
    kicker: entry.kicker,
    overview: entry.overview,
    quickFacts: entry.quickFacts.map(({ asOf, ...fact }) => ({
      ...fact,
      ...(asOf ? { asOf } : {}),
    })),
    starterStoryIds: entry.starterStoryIds,
    scene: scene(context.countryId, entry.scene),
    sources: citedSources(
      draft.sources,
      [
        ...entry.overview.sourceIds,
        ...entry.overview.whyItMatters.flatMap((item) => item.sourceIds),
        ...entry.quickFacts.flatMap((fact) => fact.sourceIds),
      ],
      context.date,
    ),
    provenance: provenance(context),
  };
  return {
    country,
    stories: draft.stories.map((story) => assembleStory(story, draft.sources, context)),
  };
}

/** Replace one story in a country file, keeping its position. */
export function replaceStory(file: CountryFile, story: Story): CountryFile {
  return {
    country: file.country,
    stories: file.stories.map((existing) => (existing.id === story.id ? story : existing)),
  };
}
