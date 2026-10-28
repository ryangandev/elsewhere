// What the model submits. These shapes are the model-facing view of the content schema in
// src/content/schema.ts: they leave out what the pipeline fills in (IDs it already knows,
// provenance, accessedAt, per-entry source lists) and spell optional fields as nullable, so
// every property is stated and strict structured outputs can use them. assemble.ts turns a
// draft into content.
import { z } from 'zod';
import {
  HighlightRole,
  PlaceId,
  RouteKind,
  Slug,
  SourceId,
  StoryId,
} from '../../src/content/schema';
import { mapCountryList } from '../content-tree';

const Text = z.string().trim().min(1);

const countryIds = mapCountryList().map((country) => country.id) as [string, ...string[]];
/** Every map identity, as an enum so the model sees the valid country codes. */
const MapCountryId = z.enum(countryIds);

const SourceIds = z
  .array(SourceId)
  .min(1)
  .describe('IDs of declared sources that state this text. At least one.');

export const DraftSource = z.strictObject({
  id: SourceId.describe('Short lowercase slug, unique in this submission, e.g. "worldbank-chile".'),
  title: Text.describe('Title of the page as published.'),
  publisher: Text.describe('Organization that published the page.'),
  url: z
    .string()
    .describe('The https URL of a page you retrieved with web_search or web_fetch in this task.'),
});
export type DraftSource = z.infer<typeof DraftSource>;

const DraftRoute = z.strictObject({
  id: Slug.describe('Unique within the scene, e.g. "suez-passage".'),
  kind: RouteKind.describe(
    'sea: a shipping path that must stay at sea; land or river: follows its named places; flow: an illustrative arc for a relationship, never checked against land.',
  ),
  via: z
    .array(PlaceId)
    .min(2)
    .describe('Gazetteer place IDs in travel order, two or more. Pass through straits by name.'),
});

const sceneFields = {
  highlights: z
    .array(z.strictObject({ countryId: MapCountryId, role: HighlightRole }))
    .describe('Other countries to light up: related (part of the answer) or contrast.'),
  placeIds: z.array(PlaceId).describe('Gazetteer place IDs to label. Never the focus country.'),
  routes: z.array(DraftRoute),
};

export const DraftStory = z.strictObject({
  id: StoryId.describe(
    'Permanent ID. Use the planned ID when one is given. "overview" is reserved and cannot be used.',
  ),
  slug: Slug.describe('Readable URL segment, usually the same as the ID.'),
  question: Text.describe('The question as a curious adult would ask it.'),
  category: Text.describe('One word or two, e.g. "Economy", "Geography", "History".'),
  summary: Text.describe('The short answer in one or two sentences.'),
  sections: z
    .array(z.strictObject({ title: Text, text: Text, sourceIds: SourceIds }))
    .min(1)
    .describe('Two to four short sections, each two or three sentences.'),
  takeaway: Text.describe('One sentence the reader should remember.'),
  scene: z.strictObject({
    ...sceneFields,
    mapNote: Text.describe('One sentence telling the reader what to look at on the map.'),
  }),
  next: z
    .array(
      z.strictObject({
        countryId: MapCountryId,
        storyId: StoryId,
        reason: Text.nullable().describe(
          'Why to go there next. Required for another country, null for the same country.',
        ),
      }),
    )
    .describe('Up to three next questions: at least one here and one in another country.'),
});
export type DraftStory = z.infer<typeof DraftStory>;

export const DraftCountry = z.strictObject({
  name: Text.describe('Common English name, e.g. "South Korea".'),
  nativeName: Text.nullable().describe('Endonym when it differs from the English name.'),
  region: Text.describe('Editorial region label, e.g. "Southeast Asia".'),
  kicker: Text.describe('One-line hook, under ten words.'),
  overview: z.strictObject({
    summary: Text.describe('Two sentences: what this place is and why it is interesting.'),
    geography: Text.describe('Two sentences locating it on the map.'),
    sourceIds: SourceIds,
    whyItMatters: z
      .array(z.strictObject({ title: Text, text: Text, sourceIds: SourceIds }))
      .min(1)
      .describe('Two or three short points.'),
  }),
  quickFacts: z
    .array(
      z.strictObject({
        label: Text,
        value: Text,
        asOf: Text.nullable().describe('Period a changing value describes, e.g. "2024".'),
        sourceIds: SourceIds,
      }),
    )
    .describe('Four facts: population, capital, languages, currency, unless better ones exist.'),
  starterStoryIds: z
    .array(StoryId)
    .min(3)
    .describe('Three to five story IDs from this submission that the overview leads with.'),
  scene: z.strictObject({
    ...sceneFields,
    mapNote: Text.nullable(),
  }),
});
export type DraftCountry = z.infer<typeof DraftCountry>;

/** Input of the submit_draft tool. */
export const CountryDraft = z.strictObject({
  country: DraftCountry,
  stories: z.array(DraftStory).min(1),
  sources: z.array(DraftSource).min(1).describe('Every source cited above, declared once.'),
});
export type CountryDraft = z.infer<typeof CountryDraft>;

/** Input of the submit_story tool. */
export const StoryDraft = z.strictObject({
  story: DraftStory,
  sources: z.array(DraftSource).min(1).describe('Every source the story cites, declared once.'),
});
export type StoryDraft = z.infer<typeof StoryDraft>;

/**
 * Several revised stories of one country with the sources they cite, as agent drafting submits
 * the stories review sent back. Each story is checked as StoryDraft's story is.
 */
export const StoryRevisionsDraft = z.strictObject({
  stories: z
    .array(DraftStory)
    .min(1)
    .describe('Every story sent back, revised, each keeping its ID.'),
  sources: z.array(DraftSource).min(1).describe('Every source the stories cite, declared once.'),
});
export type StoryRevisionsDraft = z.infer<typeof StoryRevisionsDraft>;

/**
 * Input of the submit_overview tool: the country part of a country that review sent back alone
 * (its overview, quick facts, starter questions and scene), with the sources it cites. Every
 * story is kept as it is.
 */
export const OverviewDraft = z.strictObject({
  country: DraftCountry,
  sources: z
    .array(DraftSource)
    .min(1)
    .describe('Every source the country part cites, declared once.'),
});
export type OverviewDraft = z.infer<typeof OverviewDraft>;

/**
 * The country part and the stories review sent back of one country, revised together, with the
 * sources they cite, as agent drafting submits them when the overview is sent back. The country
 * part is checked as OverviewDraft's is, and each story as StoryDraft's story is; `stories` is
 * empty when only the overview is sent back.
 */
export const CountryRevisionsDraft = z.strictObject({
  country: DraftCountry,
  stories: z.array(DraftStory).describe('Every story sent back, revised, each keeping its ID.'),
  sources: z
    .array(DraftSource)
    .min(1)
    .describe('Every source the country part and the stories cite, declared once.'),
});
export type CountryRevisionsDraft = z.infer<typeof CountryRevisionsDraft>;

/** Output of the planning request: the questions each country will answer. */
export const BatchPlan = z.strictObject({
  countries: z.array(
    z.strictObject({
      countryId: MapCountryId,
      stories: z.array(
        z.strictObject({
          id: StoryId.describe(
            'Permanent lowercase slug, short and topical, e.g. "canal". "overview" is reserved and cannot be used.',
          ),
          question: Text,
          angle: z
            .enum(['common', 'unexpected'])
            .describe('common: people already ask it; unexpected: they would not think to.'),
        }),
      ),
    }),
  ),
});
export type BatchPlan = z.infer<typeof BatchPlan>;

/** JSON Schema keywords that strict tool use and structured outputs do not accept. */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'maxItems',
  'uniqueItems',
]);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== 'object') return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    // Only minItems of 0 or 1 is supported; larger minimums are checked by zod afterwards.
    if (key === 'minItems' && typeof value === 'number' && value > 1) continue;
    result[key] = sanitize(value);
  }
  return result;
}

/**
 * The complete JSON Schema of a submission tool, constraints included, so the model sees every
 * rule zod will check.
 */
export function toToolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json: Record<string, unknown> = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
  });
  delete json.$schema;
  return json;
}

/**
 * A JSON Schema for strict tool use or structured outputs. Constraints the API does not accept
 * (patterns, lengths, counts) are removed here and enforced by zod when the result is parsed,
 * so a violation comes back to the model as a validation error instead of a 400.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return sanitize(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })) as Record<
    string,
    unknown
  >;
}
