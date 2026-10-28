// The central content contract: what the pipeline produces, the site renders, and a future
// live-answer service will produce. See docs/architecture.md#content-model.
//
// The zod shapes check each file on its own. Cross-references (story IDs, source IDs,
// gazetteer place IDs, map country IDs) are checked by validateContent in ./validate.ts.
import { z } from 'zod';

/** Natural Earth ADM0_A3 code, e.g. "SGP". Covers all 258 map identities, not only ISO countries. */
export const CountryId = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Country IDs are Natural Earth ADM0_A3 codes');

/** Lowercase, hyphenated, URL-safe identifier, e.g. "malacca-strait". */
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, digits and single hyphens');

/** Permanent story ID. Unique within its country; never derived from the title or position. */
export const StoryId = Slug;

/** Gazetteer feature ID from data/geo/gazetteer.json. */
export const PlaceId = Slug;

/** Source ID, unique within the file that declares it. */
export const SourceId = Slug;

/** Calendar date, YYYY-MM-DD. */
export const IsoDate = z.iso.date();

const Text = z.string().trim().min(1);

export const Source = z.strictObject({
  id: SourceId,
  title: Text,
  publisher: Text,
  url: z.url({ protocol: /^https$/ }),
  /** When the source was read. Required for generated content; unknown for the legacy edition. */
  accessedAt: IsoDate.optional(),
});
export type Source = z.infer<typeof Source>;

/**
 * A reviewer's request to redraft a draft; the next regeneration consumes it. On a country,
 * `scope: "overview"` sends back only the country part of the file (kicker, overview, quick facts,
 * starter questions, scene and their sources) and keeps every story; without it the whole
 * country is redrafted. A story's request has no scope. A request that reopened reviewed content
 * records the review it undid in `reopened`, since the part is a draft again and its provenance
 * no longer names a reviewer.
 */
export const RevisionRequest = z.strictObject({
  notes: Text,
  requestedBy: Text,
  requestedAt: IsoDate,
  scope: z.literal('overview').optional(),
  reopened: z.strictObject({ reviewedBy: Text, reviewedAt: IsoDate }).optional(),
});
export type RevisionRequest = z.infer<typeof RevisionRequest>;

export const Provenance = z
  .strictObject({
    /** "human", or the model ID that drafted the content. */
    generatedBy: Text,
    generatedAt: IsoDate,
    /** Version of the pipeline prompts that drafted it, e.g. "v1" for pipeline/prompts/v1/. */
    promptVersion: Text.optional(),
    reviewedBy: Text.optional(),
    reviewedAt: IsoDate.optional(),
    status: z.enum(['draft', 'reviewed']),
    /** Set on a draft that review sent back for regeneration. */
    revision: RevisionRequest.optional(),
  })
  .refine((value) => value.status !== 'reviewed' || (value.reviewedBy && value.reviewedAt), {
    message: 'Reviewed content records who reviewed it and when',
  })
  .refine((value) => value.status !== 'reviewed' || !value.revision, {
    message: 'Reviewed content cannot be waiting for a revision',
  })
  .refine((value) => value.status === 'reviewed' || (!value.reviewedBy && !value.reviewedAt), {
    message: 'Only reviewed content records a reviewer; a reopened draft keeps it in revision.reopened',
  });
export type Provenance = z.infer<typeof Provenance>;

export const CameraView = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Globe camera altitude in globe radii. */
  altitude: z.number().positive().max(10),
});
export type CameraView = z.infer<typeof CameraView>;

export const RouteKind = z.enum(['sea', 'land', 'river', 'flow']);
export type RouteKind = z.infer<typeof RouteKind>;

export const SceneRouteSpec = z.strictObject({
  /** Unique within the scene. */
  id: Slug,
  /**
   * - sea: a shipping path; checked so it never crosses land (ports at either end are allowed)
   * - land, river: a path over land or along a river
   * - flow: an illustrative connection (money, moisture, history), drawn as an arc and not checked
   */
  kind: RouteKind,
  /**
   * Gazetteer places the route passes, in order. Consecutive places are joined by great circles;
   * a strait or channel with a passage path is followed along its length.
   */
  via: z.array(PlaceId).min(2),
});
export type SceneRouteSpec = z.infer<typeof SceneRouteSpec>;

export const HighlightRole = z.enum(['related', 'contrast']);

/**
 * A map scene as content describes it: IDs only, no coordinates.
 * resolveScene() turns it into the globe-level MapScene using the gazetteer.
 */
export const SceneSpec = z.strictObject({
  /** Omit to let the globe frame the focus country. */
  camera: CameraView.optional(),
  focusCountryId: CountryId,
  highlights: z.array(z.strictObject({ countryId: CountryId, role: HighlightRole })),
  /** Labelled places. Their descriptions live in content/<locale>/places.json. */
  placeIds: z.array(PlaceId),
  routes: z.array(SceneRouteSpec),
  /** One sentence telling the reader what to look at on the map. */
  mapNote: Text.optional(),
});
export type SceneSpec = z.infer<typeof SceneSpec>;

const SourceIds = z.array(SourceId).min(1, 'Cite at least one source');

export const Section = z.strictObject({
  title: Text,
  text: Text,
  sourceIds: SourceIds,
});
export type Section = z.infer<typeof Section>;

/**
 * A next question. A draft story may point at a story in a country that has no content file
 * yet (a pending reference, see findPendingReferences in ./validate.ts); reviewed stories may not.
 */
export const StoryRef = z.strictObject({
  countryId: CountryId,
  storyId: StoryId,
  /** Why to go there next. Required for a story in another country. */
  reason: Text.optional(),
});
export type StoryRef = z.infer<typeof StoryRef>;

/** How many alternative phrasings a story keeps, and how long each may be. */
export const PARAPHRASES = { min: 3, max: 8, maxLength: 120 };

/**
 * Other ways a reader might type a story's question, for search only; they are never shown to
 * readers. They restate the question and make no claims, so they cite no sources, and changing
 * them does not reset the story's review. `question` is the question they were written for:
 * when the story's question changes they are stale, and validation asks for new ones
 * (npm run content:paraphrase). The pipeline writes them; see docs/architecture.md#content-model.
 */
export const Paraphrases = z.strictObject({
  question: Text,
  phrasings: z
    .array(Text.max(PARAPHRASES.maxLength))
    .min(PARAPHRASES.min)
    .max(PARAPHRASES.max),
  /** The model that wrote them, or "human". */
  generatedBy: Text,
  generatedAt: IsoDate,
  /** Version of the paraphrase prompt, e.g. "paraphrase/v1" for pipeline/prompts/paraphrase/v1/. */
  promptVersion: Text.optional(),
});
export type Paraphrases = z.infer<typeof Paraphrases>;

export const Story = z.strictObject({
  id: StoryId,
  countryId: CountryId,
  /** Readable URL segment, unique within the country. Can change; the ID cannot. */
  slug: Slug,
  question: Text,
  /** Alternative phrasings of the question for search. Optional: search works without them. */
  paraphrases: Paraphrases.optional(),
  category: Text,
  /** Short answer shown before the sections. */
  summary: Text,
  sections: z.array(Section).min(1),
  takeaway: Text,
  scene: SceneSpec.extend({ mapNote: Text }),
  /** Next questions: at most three, at least one in the same country and one elsewhere. */
  next: z.array(StoryRef).max(3),
  sources: z.array(Source).min(1),
  provenance: Provenance.refine((value) => !value.revision?.scope, {
    message: 'Only a country sends back its overview alone; a story revision has no scope',
    path: ['revision', 'scope'],
  }),
});
export type Story = z.infer<typeof Story>;

export const QuickFact = z.strictObject({
  label: Text,
  value: Text,
  /** Period the value describes, e.g. "2024". */
  asOf: Text.optional(),
  sourceIds: SourceIds,
});
export type QuickFact = z.infer<typeof QuickFact>;

export const Overview = z.strictObject({
  summary: Text,
  geography: Text,
  /** Sources for the summary and geography paragraphs. */
  sourceIds: SourceIds,
  whyItMatters: z.array(z.strictObject({ title: Text, text: Text, sourceIds: SourceIds })).min(1),
});
export type Overview = z.infer<typeof Overview>;

export const Country = z.strictObject({
  id: CountryId,
  /** Must equal the map identity's slug in data/geo/countries.json, so each country has one URL. */
  slug: Slug,
  name: Text,
  /** Endonym in the national language, when it differs from the English name. */
  nativeName: Text.optional(),
  /** Editorial region label, e.g. "Southeast Asia". */
  region: Text,
  /** One-line hook. */
  kicker: Text,
  overview: Overview,
  quickFacts: z.array(QuickFact),
  /** The questions the overview leads with. */
  starterStoryIds: z.array(StoryId).min(3).max(5),
  /** Country-level map scene: neighbours and surrounding seas. */
  scene: SceneSpec,
  sources: z.array(Source).min(1),
  provenance: Provenance,
});
export type Country = z.infer<typeof Country>;

/** One file per country: content/<locale>/countries/<slug>.json. */
export const CountryFile = z.strictObject({
  country: Country,
  stories: z.array(Story).min(1),
});
export type CountryFile = z.infer<typeof CountryFile>;

export const TrailStop = z.strictObject({
  countryId: CountryId,
  storyId: StoryId,
  /** Why this stop follows the previous one. */
  connection: Text,
});

export const Trail = z.strictObject({
  id: Slug,
  title: Text,
  /** Short uppercase eyebrow, e.g. "SEAS & CONNECTIONS". */
  label: Text,
  description: Text,
  stops: z.array(TrailStop).min(2),
});
export type Trail = z.infer<typeof Trail>;

/** content/<locale>/trails.json */
export const TrailsFile = z.array(Trail);

/** A question the home screen suggests: a story by its permanent IDs. */
export const SuggestedQuestion = z.strictObject({
  countryId: CountryId,
  storyId: StoryId,
});
export type SuggestedQuestion = z.infer<typeof SuggestedQuestion>;

/**
 * content/<locale>/home.json: what the home screen offers a reader who arrives without a
 * question. A few starting questions, never a catalog (docs/product.md#core-loop).
 */
export const HomeFile = z.strictObject({
  /** Shown next to the question input, in this order. */
  suggestedQuestions: z.array(SuggestedQuestion).min(3).max(4),
});
export type Home = z.infer<typeof HomeFile>;

/**
 * content/<locale>/places.json: short editorial descriptions of gazetteer places, keyed by
 * place ID. One note per place, shown wherever the place is labelled. Kept in the content tree
 * (not the gazetteer) because notes are editorial and localized; the gazetteer is generated data.
 */
export const PlaceNotesFile = z.record(PlaceId, Text);
export type PlaceNotes = z.infer<typeof PlaceNotesFile>;

/** data/geo/gazetteer.json entry. Generated by scripts/build-gazetteer.mjs. */
export const GazetteerPlace = z.strictObject({
  id: PlaceId,
  name: Text,
  kind: z.enum(['water', 'region', 'place', 'country']),
  /** Whether the label point lies at sea or on land in the globe's country geometry. */
  surface: z.enum(['sea', 'land']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Passage along a strait or channel, as [lat, lng] points. */
  path: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .optional(),
  /** Map identity for country entries; containing country for populated places. */
  countryId: CountryId.optional(),
  source: z.enum(['countries', 'marine', 'rivers', 'regions', 'admin1', 'places', 'override']),
  /** Natural Earth feature ID, where the dataset has one. */
  neId: z.number().int().optional(),
});
export type GazetteerPlace = z.infer<typeof GazetteerPlace>;

/** data/geo/countries.json entry: basics for every map identity, edited or not. */
export const MapCountry = z.strictObject({
  id: CountryId,
  slug: Slug,
  name: Text,
  /** Natural Earth's short map name ("Russia"), only when it is shorter than `name`. */
  shortName: Text.optional(),
  isoA2: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  /** UN subregion, e.g. "South-Eastern Asia". */
  region: Text,
  continent: Text,
  type: Text,
  population: z.number().int().nonnegative().nullable(),
  populationYear: z.number().int().nullable(),
  /** Label anchor on the bundled geometry. */
  lat: z.number(),
  lng: z.number(),
  /** Area of the largest polygon, in steradians; used to fit labels. */
  area: z.number().nonnegative(),
  /** Natural Earth LABELRANK: lower shows earlier. */
  labelRank: z.number().int(),
});
export type MapCountry = z.infer<typeof MapCountry>;
