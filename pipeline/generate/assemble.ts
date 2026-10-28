// Turn what the model submitted into content-schema shapes: fill in the IDs the pipeline already
// knows, give each entry the sources it cites, stamp accessedAt and provenance, and drop nulls.
// The reverse turns content back into the submission's shape, so a revision brief can show a part
// as drafted in the shape the drafter submits it in.
import type {
  Country,
  CountryFile,
  Provenance,
  SceneSpec,
  Source,
  Story,
} from '../../src/content/schema';
import type { CountryDraft, DraftCountry, DraftSource, DraftStory } from './draft-schema';
import { cleanUrl } from './evidence';

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
    if (source) result.push({ ...source, url: cleanUrl(source.url), accessedAt: date });
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

/** The country part of a file: everything but the stories. */
export function assembleCountryPart(
  entry: DraftCountry,
  sources: DraftSource[],
  context: AssembleContext,
): Country {
  return {
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
      sources,
      [
        ...entry.overview.sourceIds,
        ...entry.overview.whyItMatters.flatMap((item) => item.sourceIds),
        ...entry.quickFacts.flatMap((fact) => fact.sourceIds),
      ],
      context.date,
    ),
    provenance: provenance(context),
  };
}

export function assembleCountry(draft: CountryDraft, context: AssembleContext): CountryFile {
  return {
    country: assembleCountryPart(draft.country, draft.sources, context),
    stories: draft.stories.map((story) => assembleStory(story, draft.sources, context)),
  };
}

/** Whether two scenes show the same thing: the same highlights, places and routes, in order. */
export const sameSceneContent = (a: SceneSpec, b: SceneSpec): boolean =>
  JSON.stringify([a.highlights, a.placeIds, a.routes]) ===
  JSON.stringify([b.highlights, b.placeIds, b.routes]);

/**
 * Whether a revised part keeps the camera of the part it replaces. The model never sets a camera,
 * so only content converted by hand has one. A country camera frames the country itself, and a
 * story scene without a camera borrows it (Singapore's stories need it, since framing from its
 * tiny area is too close), so a revised country part always keeps it. A story camera frames that
 * story's own places and routes, so it is kept only while the revised scene shows the same
 * highlights, places and routes; otherwise the globe frames the new scene itself.
 */
export function keepsCamera(kind: 'country' | 'story', revised: SceneSpec, replaced: SceneSpec) {
  return !!replaced.camera && (kind === 'country' || sameSceneContent(revised, replaced));
}

/** A revised part with the camera of the part it replaces, when it keeps it (`keepsCamera`). */
export function keepCamera<Part extends { scene: SceneSpec }>(
  kind: 'country' | 'story',
  part: Part,
  replaced: SceneSpec,
): Part {
  return keepsCamera(kind, part.scene, replaced)
    ? { ...part, scene: { camera: replaced.camera, ...part.scene } }
    : part;
}

/** Replace the country part of a file, keeping every story as it is. */
export function replaceCountryPart(file: CountryFile, country: Country): CountryFile {
  return { country, stories: file.stories };
}

/** Replace one story in a country file, keeping its position. */
export function replaceStory(file: CountryFile, story: Story): CountryFile {
  return {
    country: file.country,
    stories: file.stories.map((existing) => (existing.id === story.id ? story : existing)),
  };
}

/** A story in the submission's shape: what assembleStory would turn back into it. */
export function toDraftStory(story: Story): DraftStory {
  return {
    id: story.id,
    slug: story.slug,
    question: story.question,
    category: story.category,
    summary: story.summary,
    sections: story.sections,
    takeaway: story.takeaway,
    scene: {
      highlights: story.scene.highlights,
      placeIds: story.scene.placeIds,
      routes: story.scene.routes,
      mapNote: story.scene.mapNote,
    },
    next: story.next.map(({ countryId, storyId, reason }) => ({
      countryId,
      storyId,
      reason: reason ?? null,
    })),
  };
}

/** The country part in the submission's shape: what assembleCountryPart would turn back into it. */
export function toDraftCountry(country: Country): DraftCountry {
  return {
    name: country.name,
    nativeName: country.nativeName ?? null,
    region: country.region,
    kicker: country.kicker,
    overview: country.overview,
    quickFacts: country.quickFacts.map(({ label, value, asOf, sourceIds }) => ({
      label,
      value,
      asOf: asOf ?? null,
      sourceIds,
    })),
    starterStoryIds: country.starterStoryIds,
    scene: {
      highlights: country.scene.highlights,
      placeIds: country.scene.placeIds,
      routes: country.scene.routes,
      mapNote: country.scene.mapNote ?? null,
    },
  };
}

/** Sources in the submission's shape, without the access date the pipeline sets. */
export const toDraftSources = (sources: Source[]): DraftSource[] =>
  sources.map(({ id, title, publisher, url }) => ({ id, title, publisher, url }));
