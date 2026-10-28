// Content validation: zod shapes plus everything a shape cannot check on its own.
// Used by `npm run content:check` and the content tests. Pure: callers pass the raw data in.
import type { z } from 'zod';
import type { ContentFile, ContentTree } from './files';
import type { LandIndex } from './geometry';
import { findRouteLandCrossings } from './geo';
import {
  CountryFile,
  GazetteerPlace,
  HomeFile,
  MapCountry,
  PlaceNotesFile,
  TrailsFile,
  type Country,
  type SceneSpec,
  type Source,
  type Story,
} from './schema';

export type ContentIssue = {
  /** File the issue is in, as given by the caller. */
  file: string;
  /** Location inside the file, e.g. "stories[1].sections[0].sourceIds[0]". */
  path: string;
  message: string;
};

export type ContentInput = ContentTree & {
  gazetteer: ContentFile;
  mapCountries: ContentFile;
  /** Land geometry for checking that sea routes stay at sea. Skipped when omitted. */
  land?: LandIndex;
};

const EM_DASH = '\u2014';
const HAN = /\p{Script=Han}/u;
/** A key like "titleZh", from when content held both languages in one file. */
const CHINESE_KEY = /^[A-Za-z]*Zh$/;
/** A key like "storyIndex" or "topicIdx": a reference by array position instead of by ID. */
const INDEX_KEY = /^[A-Za-z]*(?:Index|Idx)$/;

function formatPath(path: PropertyKey[]): string {
  return path
    .map((part, index) =>
      typeof part === 'number' ? `[${part}]` : `${index === 0 ? '' : '.'}${String(part)}`,
    )
    .join('');
}

function parse<T>(
  schema: z.ZodType<T>,
  file: string,
  data: unknown,
  issues: ContentIssue[],
): T | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    issues.push({ file, path: formatPath(issue.path), message: issue.message });
  }
  return undefined;
}

/** Every string in a value, with its path, for text-wide rules. */
function* strings(value: unknown, path: PropertyKey[] = []): Generator<[string, PropertyKey[]]> {
  if (typeof value === 'string') yield [value, path];
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, [...path, index]);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) yield* strings(item, [...path, key]);
  }
}

/** Every object key in a value, with the path to it. */
function* keys(value: unknown, path: PropertyKey[] = []): Generator<[string, PropertyKey[]]> {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* keys(item, [...path, index]);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      yield [key, [...path, key]];
      yield* keys(item, [...path, key]);
    }
  }
}

function duplicates<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export type PendingReference = {
  /** The draft story that holds the reference. */
  from: { countryId: string; storyId: string };
  to: { countryId: string; storyId: string };
  reason?: string;
};

/**
 * Next questions that point at a story in a country with no content file yet.
 * validateContent allows them in drafts so a batch can link countries before all are drafted;
 * they resolve when the target country is drafted with that story ID. Reviewed stories may not
 * hold them, and the review workflow refuses to approve a story that still does.
 */
export function findPendingReferences(files: CountryFile[]): PendingReference[] {
  const stories = new Set(
    files.flatMap(({ stories }) => stories.map((story) => `${story.countryId}/${story.id}`)),
  );
  const countries = new Set(files.map(({ country }) => country.id));
  return files.flatMap(({ stories: list }) =>
    list.flatMap((story) =>
      story.next
        .filter(
          (ref) => !countries.has(ref.countryId) && !stories.has(`${ref.countryId}/${ref.storyId}`),
        )
        .map((ref) => ({
          from: { countryId: story.countryId, storyId: story.id },
          to: { countryId: ref.countryId, storyId: ref.storyId },
          ...(ref.reason ? { reason: ref.reason } : {}),
        })),
    ),
  );
}

/** A phrasing reduced to its words, so "Why is X rich?" and "why is x rich" compare equal. */
export function normalizePhrasing(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKC')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).join(' ');
}

/**
 * Problems with a story's phrasings that make them useless or misleading for search: a repeat
 * of the question or of another phrasing, or another story's question in the same country.
 * Shared by content validation and the paraphrase step, which checks a response before writing it.
 */
export function paraphraseProblems(story: Story, stories: Story[]): string[] {
  const phrasings = story.paraphrases?.phrasings ?? [];
  const problems: string[] = [];
  const question = normalizePhrasing(story.question);
  const others = new Map(
    stories
      .filter((other) => other.id !== story.id)
      .map((other) => [normalizePhrasing(other.question), other.id]),
  );
  const seen = new Set<string>();
  for (const phrasing of phrasings) {
    const normalized = normalizePhrasing(phrasing);
    if (normalized === question) problems.push(`"${phrasing}" repeats the question`);
    else if (seen.has(normalized)) problems.push(`"${phrasing}" is listed twice`);
    else if (others.has(normalized)) {
      problems.push(`"${phrasing}" is the question of story "${others.get(normalized)}"`);
    }
    seen.add(normalized);
  }
  return problems;
}

export function validateContent(input: ContentInput): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const report = (file: string, path: string, message: string) =>
    issues.push({ file, path, message });

  // Generated geo data.
  const gazetteer =
    parse(GazetteerPlace.array(), input.gazetteer.file, input.gazetteer.data, issues) ?? [];
  const places = new Map(gazetteer.map((place) => [place.id, place]));
  for (const id of duplicates(gazetteer.map((place) => place.id))) {
    report(input.gazetteer.file, id, 'Duplicate gazetteer ID');
  }
  if (input.land) {
    for (const place of gazetteer) {
      const points = [[place.lat, place.lng] as [number, number], ...(place.path ?? [])];
      if (place.surface === 'sea' && points.some((point) => input.land!.isLand(point))) {
        report(input.gazetteer.file, place.id, 'Sea place has a point on land');
      }
    }
  }
  const mapCountryList =
    parse(MapCountry.array(), input.mapCountries.file, input.mapCountries.data, issues) ?? [];
  const mapCountries = new Map(mapCountryList.map((country) => [country.id, country]));

  // Parse every content file first, so cross-file references can be resolved.
  const files: { file: string; data: CountryFile }[] = [];
  for (const { file, data } of input.countryFiles) {
    const parsed = parse(CountryFile, file, data, issues);
    if (parsed) files.push({ file, data: parsed });
  }
  const trails = parse(TrailsFile, input.trails.file, input.trails.data, issues) ?? [];
  const placeNotes =
    parse(PlaceNotesFile, input.placeNotes.file, input.placeNotes.data, issues) ?? {};
  const home = parse(HomeFile, input.home.file, input.home.data, issues);

  const storiesByCountry = new Map<string, Map<string, Story>>();
  for (const { data } of files) {
    storiesByCountry.set(data.country.id, new Map(data.stories.map((story) => [story.id, story])));
  }
  const storyExists = (countryId: string, storyId: string) =>
    storiesByCountry.get(countryId)?.has(storyId) ?? false;

  for (const { file, data } of [...input.countryFiles, input.trails, input.placeNotes]) {
    for (const [text, path] of strings(data)) {
      if (text.includes(EM_DASH)) report(file, formatPath(path), 'Use "-" instead of the em dash');
    }
  }

  // English only for now (docs/product.md#language): no Han characters, apart from a country's own
  // name for itself (nativeName), and no Chinese-language fields. Drafts are checked too, so a
  // Japanese or Korean gloss is sent back as well; the wording says non-English, not Chinese.
  for (const { file, data } of [...input.countryFiles, input.trails, input.placeNotes]) {
    for (const [text, path] of strings(data)) {
      if (HAN.test(text) && path.at(-1) !== 'nativeName') {
        report(
          file,
          formatPath(path),
          "Content is English only, but this contains non-English (Han) text outside a country's native name",
        );
      }
    }
    for (const [key, path] of keys(data)) {
      if (HAN.test(key)) {
        report(
          file,
          formatPath(path),
          `Content is English only, but the key "${key}" contains non-English (Han) text`,
        );
      }
      if (CHINESE_KEY.test(key)) {
        report(file, formatPath(path), `Content is English only, but "${key}" is a Chinese field`);
      }
    }
  }
  // Content refers to stories and countries by permanent ID, never by array position.
  for (const { file, data } of [...input.countryFiles, input.trails]) {
    for (const [key, path] of keys(data)) {
      if (INDEX_KEY.test(key)) {
        report(
          file,
          formatPath(path),
          `"${key}" is an index; refer to stories and countries by ID`,
        );
      }
    }
  }

  const countryIds = files.map(({ data }) => data.country.id);
  for (const id of duplicates(countryIds))
    report('content', id, 'Country appears in more than one file');

  function checkScene(file: string, path: string, scene: SceneSpec) {
    if (!mapCountries.has(scene.focusCountryId)) {
      report(file, `${path}.focusCountryId`, `Unknown map country "${scene.focusCountryId}"`);
    }
    scene.highlights.forEach((highlight, index) => {
      if (!mapCountries.has(highlight.countryId)) {
        report(
          file,
          `${path}.highlights[${index}]`,
          `Unknown map country "${highlight.countryId}"`,
        );
      }
    });
    for (const id of duplicates(scene.highlights.map((highlight) => highlight.countryId))) {
      report(file, `${path}.highlights`, `Country "${id}" is highlighted twice`);
    }
    scene.placeIds.forEach((id, index) => {
      if (!places.has(id))
        report(file, `${path}.placeIds[${index}]`, `Unknown gazetteer place "${id}"`);
    });
    for (const id of duplicates(scene.placeIds))
      report(file, `${path}.placeIds`, `Place "${id}" is listed twice`);
    for (const id of duplicates(scene.routes.map((route) => route.id))) {
      report(file, `${path}.routes`, `Route ID "${id}" is used twice`);
    }
    scene.routes.forEach((route, routeIndex) => {
      const routePath = `${path}.routes[${routeIndex}]`;
      const unknown = route.via.filter((id) => !places.has(id));
      unknown.forEach((id) => report(file, `${routePath}.via`, `Unknown gazetteer place "${id}"`));
      route.via.forEach((id, index) => {
        if (index > 0 && route.via[index - 1] === id) {
          report(file, `${routePath}.via[${index}]`, `"${id}" follows itself`);
        }
      });
      if (unknown.length || !input.land) return;
      for (const crossing of findRouteLandCrossings(route, input.land)) {
        const [lat, lng] = crossing.point.map((value) => value.toFixed(2));
        report(
          file,
          routePath,
          `Sea route crosses land for about ${crossing.lengthKm} km between "${crossing.from}" and "${crossing.to}", near ${lat}, ${lng}`,
        );
      }
    });
  }

  /** Source IDs must be declared, declared once, and each declared source must be cited. */
  function checkSources(
    file: string,
    path: string,
    sources: Source[],
    citations: [string, string[]][],
  ) {
    const declared = new Set(sources.map((source) => source.id));
    for (const id of duplicates(sources.map((source) => source.id))) {
      report(file, `${path}.sources`, `Source "${id}" is declared twice`);
    }
    const cited = new Set<string>();
    for (const [citationPath, ids] of citations) {
      ids.forEach((id, index) => {
        cited.add(id);
        if (!declared.has(id)) report(file, `${citationPath}[${index}]`, `Unknown source "${id}"`);
      });
    }
    sources.forEach((source, index) => {
      if (!cited.has(source.id))
        report(file, `${path}.sources[${index}]`, `Source "${source.id}" is never cited`);
    });
  }

  function checkProvenance(file: string, path: string, entry: Country | Story, sources: Source[]) {
    if (entry.provenance.generatedBy === 'human') return;
    sources.forEach((source, index) => {
      if (!source.accessedAt) {
        report(
          file,
          `${path}.sources[${index}].accessedAt`,
          'Generated content records when each source was read',
        );
      }
    });
  }

  /**
   * Paraphrases restate their own story's question: they were written for its current wording,
   * and none repeats the question, another phrasing, or another question in the same file.
   * They make no claims, so no source rules apply.
   */
  function checkParaphrases(file: string, path: string, story: Story, stories: Story[]) {
    const paraphrases = story.paraphrases;
    if (!paraphrases) return;
    if (paraphrases.question !== story.question) {
      report(
        file,
        `${path}.paraphrases.question`,
        `Paraphrases were written for "${paraphrases.question}", not the current question; run npm run content:paraphrase -- ${story.countryId}`,
      );
    }
    for (const problem of paraphraseProblems(story, stories)) {
      report(file, `${path}.paraphrases.phrasings`, problem);
    }
  }

  for (const { file, data } of files) {
    const { country, stories } = data;
    const mapCountry = mapCountries.get(country.id);
    if (!mapCountry) {
      report(file, 'country.id', `Unknown map country "${country.id}"`);
    } else if (mapCountry.slug !== country.slug) {
      report(file, 'country.slug', `Slug must match the map identity's slug "${mapCountry.slug}"`);
    }
    const fileName = file.split('/').at(-1);
    if (fileName !== `${country.slug}.json`) {
      report(file, 'country.slug', `File must be named "${country.slug}.json"`);
    }

    checkSources(file, 'country', country.sources, [
      ['country.overview.sourceIds', country.overview.sourceIds],
      ...country.overview.whyItMatters.map((item, index): [string, string[]] => [
        `country.overview.whyItMatters[${index}].sourceIds`,
        item.sourceIds,
      ]),
      ...country.quickFacts.map((fact, index): [string, string[]] => [
        `country.quickFacts[${index}].sourceIds`,
        fact.sourceIds,
      ]),
    ]);
    checkProvenance(file, 'country', country, country.sources);
    checkScene(file, 'country.scene', country.scene);

    for (const id of duplicates(country.starterStoryIds)) {
      report(file, 'country.starterStoryIds', `Story "${id}" is listed twice`);
    }
    country.starterStoryIds.forEach((id, index) => {
      if (!storyExists(country.id, id))
        report(file, `country.starterStoryIds[${index}]`, `Unknown story "${id}"`);
    });
    for (const id of duplicates(stories.map((story) => story.id)))
      report(file, 'stories', `Story ID "${id}" is used twice`);
    for (const slug of duplicates(stories.map((story) => story.slug)))
      report(file, 'stories', `Story slug "${slug}" is used twice`);

    // A source ID means the same document everywhere in a file. The problem names where each
    // URL is declared, so a revision that changed one of them can tell which part keeps the other.
    const declared = new Map<string, { url: string; where: string }>();
    const declarations = [
      ...country.sources.map((source) => ({ source, where: 'the overview' })),
      ...stories.flatMap((story) =>
        story.sources.map((source) => ({ source, where: `story "${story.id}"` })),
      ),
    ];
    for (const { source, where } of declarations) {
      const known = declared.get(source.id);
      if (known && known.url !== source.url) {
        report(
          file,
          'sources',
          `Source "${source.id}" points to two different URLs: ${known.where} declares ${known.url} and ${where} declares ${source.url}. One source ID names one document in a file, so use the same URL in both or give the other document its own ID`,
        );
      }
      if (!known) declared.set(source.id, { url: source.url, where });
    }

    stories.forEach((story, storyIndex) => {
      const path = `stories[${storyIndex}]`;
      if (story.countryId !== country.id) {
        report(
          file,
          `${path}.countryId`,
          `Story belongs to "${story.countryId}" but is in ${country.id}'s file`,
        );
      }
      checkSources(
        file,
        path,
        story.sources,
        story.sections.map((section, index) => [
          `${path}.sections[${index}].sourceIds`,
          section.sourceIds,
        ]),
      );
      checkProvenance(file, path, story, story.sources);
      checkScene(file, `${path}.scene`, story.scene);
      checkParaphrases(file, path, story, stories);

      story.next.forEach((ref, index) => {
        const refPath = `${path}.next[${index}]`;
        if (ref.countryId === country.id && ref.storyId === story.id) {
          report(file, refPath, 'A story cannot lead to itself');
        } else if (!mapCountries.has(ref.countryId)) {
          report(file, `${refPath}.countryId`, `Unknown map country "${ref.countryId}"`);
        } else if (!storyExists(ref.countryId, ref.storyId)) {
          // A draft may point at a country that has no file yet; see findPendingReferences.
          const pending =
            !storiesByCountry.has(ref.countryId) && story.provenance.status === 'draft';
          if (!pending) report(file, refPath, `Unknown story "${ref.countryId}/${ref.storyId}"`);
        }
        if (ref.countryId !== country.id && !ref.reason) {
          report(file, `${refPath}.reason`, 'A next question in another country needs a reason');
        }
      });
      const refKeys = story.next.map((ref) => `${ref.countryId}/${ref.storyId}`);
      for (const key of duplicates(refKeys))
        report(file, `${path}.next`, `"${key}" is listed twice`);
      if (stories.length > 1 && !story.next.some((ref) => ref.countryId === country.id)) {
        report(file, `${path}.next`, 'Include at least one next question about the same country');
      }
      if (!story.next.some((ref) => ref.countryId !== country.id)) {
        report(file, `${path}.next`, 'Include at least one next question elsewhere');
      }
    });
  }

  for (const id of duplicates(trails.map((trail) => trail.id)))
    report(input.trails.file, id, 'Duplicate trail ID');
  trails.forEach((trail, trailIndex) => {
    trail.stops.forEach((stop, index) => {
      if (!storyExists(stop.countryId, stop.storyId)) {
        report(
          input.trails.file,
          `[${trailIndex}].stops[${index}]`,
          `Unknown story "${stop.countryId}/${stop.storyId}"`,
        );
      }
    });
    for (const key of duplicates(trail.stops.map((stop) => `${stop.countryId}/${stop.storyId}`))) {
      report(input.trails.file, `[${trailIndex}].stops`, `"${key}" is a stop twice`);
    }
  });

  for (const id of Object.keys(placeNotes)) {
    if (!places.has(id)) report(input.placeNotes.file, id, `Unknown gazetteer place "${id}"`);
  }

  const suggestions = home?.suggestedQuestions ?? [];
  suggestions.forEach((ref, index) => {
    if (!storyExists(ref.countryId, ref.storyId)) {
      report(
        input.home.file,
        `suggestedQuestions[${index}]`,
        `Unknown story "${ref.countryId}/${ref.storyId}"`,
      );
    }
  });
  for (const key of duplicates(suggestions.map((ref) => `${ref.countryId}/${ref.storyId}`))) {
    report(input.home.file, 'suggestedQuestions', `"${key}" is suggested twice`);
  }
  // Production shows only reviewed stories in reviewed countries (src/content/store.ts), so a
  // suggestion drops off the home screen while its story or country is a draft, reopened after
  // review for example. The home screen must still publish three.
  const publishes = (countryId: string, storyId: string) =>
    files.some(
      ({ data }) => data.country.id === countryId && data.country.provenance.status === 'reviewed',
    ) && storiesByCountry.get(countryId)?.get(storyId)?.provenance.status === 'reviewed';
  const drafts = suggestions.filter(
    (ref) => storyExists(ref.countryId, ref.storyId) && !publishes(ref.countryId, ref.storyId),
  );
  const published = new Set(
    suggestions
      .filter((ref) => publishes(ref.countryId, ref.storyId))
      .map((ref) => `${ref.countryId}/${ref.storyId}`),
  );
  if (drafts.length && published.size < 3) {
    report(
      input.home.file,
      'suggestedQuestions',
      `Production shows only ${published.size} of these questions, fewer than 3, while ${drafts.map((ref) => `"${ref.countryId}/${ref.storyId}"`).join(', ')} ${drafts.length === 1 ? 'is a draft' : 'are drafts'}; approve ${drafts.length === 1 ? 'it' : 'them'} again or suggest reviewed questions instead`,
    );
  }

  return issues;
}
