// Build drafting sessions: the shared (cached) system prompt and tools, and the per-task
// first turn for drafting a whole country, revising one story or revising the country part. The prompt texts and the
// submission check are also used by agent drafting (pipeline/agent), which hands the same
// instructions to a Claude Code subagent and checks its submission the same way.
import type {
  BetaTextBlockParam,
  BetaTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import type { LandIndex } from '../../src/content/geometry';
import type { Country, CountryFile, Source, Story } from '../../src/content/schema';
import type { Effort, GenerationLimits } from '../config';
import { parsedCountryFiles, requireMapCountry } from '../content-tree';
import { render, type PromptSet } from '../prompts';
import {
  assembleCountry,
  assembleCountryPart,
  assembleStory,
  keepCamera,
  replaceCountryPart,
  replaceStory,
  toDraftCountry,
  toDraftSources,
  toDraftStory,
} from './assemble';
import { checkCandidate, type Plan } from './check';
import {
  CountryDraft,
  OverviewDraft,
  StoryDraft,
  toStrictJsonSchema,
  toToolJsonSchema,
  type DraftCountry,
  type DraftSource,
  type DraftStory,
} from './draft-schema';
import { cleanUrl } from './evidence';
import { candidateListing, findPlaces, sharedListing } from './gazetteer-context';
import type { SessionSetup, Submission } from './session';

/** What a country draft's prompts and checks need, whoever drafts it. */
export type DraftingContext = {
  contentDir: string;
  prompts: Pick<PromptSet, 'version' | 'system' | 'link-targets' | 'draft-country'>;
  /** The day of the run: generatedAt and every source's accessedAt. */
  date: string;
  plan: Plan;
  /** Link targets as of the start of the run, identical for every task so it can be cached. */
  linkTargets: string;
  storyCount: { min: number; max: number };
  land?: LandIndex;
};

/** A drafting run through the Claude API. */
export type RunContext = DraftingContext & {
  prompts: PromptSet;
  model: string;
  effort: Effort;
  limits: GenerationLimits;
  cacheTtl: '5m' | '1h';
};

const FindPlacesInput = z.strictObject({
  query: z
    .string()
    .nullable()
    .describe(
      'Part of a place name, e.g. "suez" or "rio de la". Null to list by country or distance.',
    ),
  countryId: z.string().nullable().describe('Only places in this map country, e.g. "EGY".'),
  near: z
    .string()
    .nullable()
    .describe('A gazetteer place ID; results are sorted by distance from it.'),
});

function tools(
  limits: GenerationLimits,
  submit: { name: string; description: string; schema: z.ZodType },
): BetaToolUnion[] {
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: limits.webSearchesPerRequest },
    {
      type: 'web_fetch_20260209',
      name: 'web_fetch',
      max_uses: limits.webFetchesPerRequest,
      // Statistical PDFs can be enormous; the claims we need are near the top.
      max_content_tokens: 30000,
    },
    {
      name: 'find_places',
      description:
        'Search the gazetteer of map places (seas, straits, rivers, regions, cities, countries) by name, within a country, or near a known place. Returns up to 25 places as "id | name | kind | lat, lng". Only IDs from the gazetteer can appear on the map.',
      strict: true,
      input_schema: toStrictJsonSchema(FindPlacesInput) as BetaTool.InputSchema,
    },
    // Not strict: the API refuses to compile a whole country draft (overview and stories) into
    // a strict grammar as too large. The submission is parsed with zod instead, and anything
    // that does not match goes back to the model through the repair loop.
    {
      name: submit.name,
      description: submit.description,
      input_schema: toToolJsonSchema(submit.schema) as BetaTool.InputSchema,
    },
  ];
}

/**
 * A country file as drafting prompts show it: without paraphrases, which the paraphrase step
 * writes later and a draft never carries. The JSON is formatted as content files are, so a
 * file without paraphrases reads exactly as it is on disk.
 */
export function withoutParaphrases<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, item) => (key === 'paraphrases' ? undefined : item)),
  );
}

/**
 * The instructions every drafting task shares: the system prompt, the reference example, and the
 * shared gazetteer. `schemaName` says where the submission's shape is given.
 */
export function sharedSystemText(
  prompts: Pick<PromptSet, 'system' | 'reference'>,
  schemaName = 'the tool schema',
): string {
  const { reference } = prompts;
  return [
    render(prompts.system, {}),
    '# Reference example',
    `A reviewed country file in the content format. It shows the quality bar, length, and tone. Your submission uses ${schemaName}, which leaves out the fields the pipeline fills in.`,
    '```json',
    reference.trimEnd(),
    '```',
    '# Shared gazetteer',
    sharedListing(),
  ].join('\n\n');
}

/** The system prompt every drafting request shares, as one cached block. */
export function sharedSystem(context: RunContext): BetaTextBlockParam[] {
  const ttl = context.cacheTtl === '1h' ? { ttl: '1h' as const } : {};
  return [
    {
      type: 'text',
      text: sharedSystemText(context.prompts),
      cache_control: { type: 'ephemeral', ...ttl },
    },
  ];
}

/** Every story a next question may point to: existing files plus the run's plan. */
export function renderLinkTargets(contentDir: string, plan: Plan): string {
  const files = parsedCountryFiles(contentDir);
  const lines: string[] = [];
  const countries = new Set([...files.keys(), ...plan.keys()]);
  for (const countryId of [...countries].sort()) {
    const file = files.get(countryId);
    const name = file?.country.name ?? requireMapCountry(countryId).name;
    lines.push(`## ${name} (${countryId})`);
    const existing = new Set<string>();
    for (const story of file?.stories ?? []) {
      existing.add(story.id);
      lines.push(`${countryId}/${story.id}: ${story.question}`);
    }
    for (const planned of plan.get(countryId) ?? []) {
      if (!existing.has(planned.id)) {
        lines.push(`${countryId}/${planned.id}: ${planned.question} (planned)`);
      }
    }
  }
  return lines.join('\n');
}

export function inboundReferences(contentDir: string, countryId: string): string {
  const lines: string[] = [];
  for (const file of parsedCountryFiles(contentDir).values()) {
    if (file.country.id === countryId) continue;
    for (const story of file.stories) {
      for (const ref of story.next) {
        if (ref.countryId !== countryId) continue;
        lines.push(
          `- ${story.countryId}/${story.id} ("${story.question}") links to story "${ref.storyId}"${ref.reason ? `: ${ref.reason}` : ''}`,
        );
      }
    }
  }
  return lines.length
    ? `${lines.join('\n')}\n\nKeep a story with each linked ID. The link reason says what the reader expects to find.`
    : 'None yet.';
}

export function zodIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
}

export function linkTargetsText(context: DraftingContext): string {
  return render(context.prompts['link-targets'], { linkTargets: context.linkTargets });
}

function linkTargetsBlock(context: RunContext): BetaTextBlockParam {
  const ttl = context.cacheTtl === '1h' ? { ttl: '1h' as const } : {};
  return {
    type: 'text',
    text: linkTargetsText(context),
    cache_control: { type: 'ephemeral', ...ttl },
  };
}

function baseSetup(context: RunContext, tag: string, submitTool: string) {
  return {
    tag,
    model: context.model,
    effort: context.effort,
    limits: context.limits,
    cacheTtl: context.cacheTtl,
    system: sharedSystem(context),
    submitTool,
    repairMessage: (issues: string[]) =>
      render(context.prompts.repair, {
        tool: submitTool,
        issues: issues.map((issue) => `- ${issue}`).join('\n'),
      }),
    nudgeMessage: render(context.prompts.nudge, { tool: submitTool }),
    runTool: (name: string, input: unknown) => {
      if (name !== 'find_places') throw new Error(`Unknown tool "${name}"`);
      return findPlaces(FindPlacesInput.parse(input));
    },
  };
}

/**
 * The values of a country task template: the country, the plan, links from elsewhere, the
 * editor's notes on a previous draft, and the places around it.
 */
export function countryTaskValues(
  context: DraftingContext,
  countryId: string,
  existing?: CountryFile,
): Record<string, string | number> {
  const mapCountry = requireMapCountry(countryId);
  const planned = context.plan.get(countryId);
  const { min, max } = context.storyCount;
  return {
    countryName: existing?.country.name ?? mapCountry.name,
    countryId,
    mapName: mapCountry.name,
    region: mapCountry.region,
    continent: mapCountry.continent,
    storiesMin: min,
    storiesMax: max,
    today: context.date,
    editorNotes: existing?.country.provenance.revision?.notes ?? 'None. This is a first draft.',
    plannedStories: planned?.length
      ? `${planned.map((story) => `- ${story.id}: ${story.question}`).join('\n')}\n\nKeep these story IDs. Add stories only if the plan has fewer than ${min}.`
      : `No plan for this country. Choose ${min} to ${max} questions yourself.`,
    inboundReferences: inboundReferences(context.contentDir, countryId),
    candidatePlaces: candidateListing(countryId),
  };
}

/**
 * Parse, assemble and check a country draft. `evidence` holds the normalized URLs the drafter
 * retrieved; `evidenceRule` tells it, in a problem, which pages it may cite; `unusableEvidence`
 * explains the retrieved pages it may not.
 */
export function submitCountryDraft(
  context: DraftingContext,
  countryId: string,
  input: unknown,
  options: {
    model: string;
    evidence: Set<string>;
    evidenceRule?: string;
    unusableEvidence?: Map<string, string>;
  },
): Submission {
  const parsed = CountryDraft.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error), draft: input };
  const file = assembleCountry(parsed.data, {
    countryId,
    slug: requireMapCountry(countryId).slug,
    model: options.model,
    date: context.date,
    promptVersion: context.prompts.version,
  });
  const issues = checkCandidate({
    contentDir: context.contentDir,
    candidate: file,
    scope: 'country',
    plan: context.plan,
    submittedSources: parsed.data.sources,
    evidence: options.evidence,
    evidenceRule: options.evidenceRule,
    unusableEvidence: options.unusableEvidence,
    storyCount: context.storyCount,
    land: context.land,
  });
  return issues.length ? { ok: false, issues, draft: input } : { ok: true, file };
}

/** Draft (or redraft) a whole country. */
export function countrySession(
  context: RunContext,
  countryId: string,
  existing?: CountryFile,
): SessionSetup {
  const task = render(
    context.prompts['draft-country'],
    countryTaskValues(context, countryId, existing),
  );
  return {
    ...baseSetup(context, countryId, 'submit_draft'),
    tools: tools(context.limits, {
      name: 'submit_draft',
      description:
        'Submit the complete country draft: overview, quick facts, starter questions, stories, and every source cited. Validation problems come back as an error to fix and resubmit.',
      schema: CountryDraft,
    }),
    task: [linkTargetsBlock(context), { type: 'text', text: task }],
    submit: (input, { model, evidence }) =>
      submitCountryDraft(context, countryId, input, { model, evidence }),
  };
}

/**
 * A story that review sent back, as a revision task shows it: its notes, and the story as drafted
 * without its paraphrases and the revision request.
 */
export function storyUnderRevision(
  existing: CountryFile,
  storyId: string,
): { story: Story; notes: string; asDrafted: string } {
  const story = existing.stories.find((entry) => entry.id === storyId);
  if (!story?.provenance.revision) {
    throw new Error(`${existing.country.id}/${storyId} has no revision request`);
  }
  return {
    story,
    notes: story.provenance.revision.notes,
    asDrafted: JSON.stringify(
      withoutParaphrases({ ...story, provenance: { ...story.provenance, revision: undefined } }),
      null,
      2,
    ),
  };
}

/** The country's stories other than `storyIds`, as a revision task lists them for context. */
export function otherStoriesText(existing: CountryFile, storyIds: string[]): string {
  return (
    existing.stories
      .filter((entry) => !storyIds.includes(entry.id))
      .map((entry) => `"${entry.id}" (${entry.question})`)
      .join(', ') || 'none'
  );
}

/**
 * The country part of a country whose overview review sent back alone, as a revision task shows
 * it: the notes, and the country part as drafted (everything but the stories) in the shape of a
 * submission, `{ country, sources }`, so it can be copied as the starting draft.
 */
export function countryPartUnderRevision(existing: CountryFile): {
  country: Country;
  notes: string;
  asDrafted: string;
} {
  const { country } = existing;
  if (country.provenance.revision?.scope !== 'overview') {
    throw new Error(`${country.id} has no revision request for its overview`);
  }
  return {
    country,
    notes: country.provenance.revision.notes,
    asDrafted: JSON.stringify(
      { country: toDraftCountry(country), sources: toDraftSources(country.sources) },
      null,
      2,
    ),
  };
}

/**
 * A story review sent back, as an agent revision brief shows it: in the shape of a submission,
 * `{ story, sources }`, so it can be copied as the starting draft. The API path's revise-story
 * task keeps showing the content shape (storyUnderRevision), the text its recorded runs sent.
 */
export function storyDraftUnderRevision(existing: CountryFile, storyId: string): string {
  const { story } = storyUnderRevision(existing, storyId);
  return JSON.stringify(
    { story: toDraftStory(story), sources: toDraftSources(story.sources) },
    null,
    2,
  );
}

/** The country's stories as an overview revision task lists them: the IDs its starters may use. */
export function storiesText(existing: CountryFile): string {
  return existing.stories.map((story) => `- ${story.id}: ${story.question}`).join('\n');
}

/** A revised story as submitted, with where it sits in the submission for problem messages. */
export type SubmittedRevision = { path: string; story: DraftStory };

/** What review sent back of one country, short of the whole country. */
export type SentBack = { overview: boolean; storyIds: string[] };

export type RevisionCheckOptions = {
  model: string;
  evidence: Set<string>;
  evidenceRule?: string;
  unusableEvidence?: Map<string, string>;
  /**
   * Whether two URLs were read as one page in this session (one redirected to the other). A
   * revised source that reuses an ID the kept parts of the file declare with the other URL, on the
   * same host, then keeps the file's URL, since both name the same page.
   */
  samePage?: (a: string, b: string) => boolean;
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
};

/**
 * Where the parts of a file that a revision keeps declare each source ID, with the URL: the
 * overview when it is not revised, and every story not revised.
 */
function keptDeclarations(
  existing: CountryFile,
  sentBack: SentBack,
): Map<string, { url: string; where: string }> {
  const kept = new Map<string, { url: string; where: string }>();
  const add = (sources: { id: string; url: string }[], where: string) => {
    for (const source of sources) {
      if (!kept.has(source.id)) kept.set(source.id, { url: source.url, where });
    }
  };
  if (!sentBack.overview) add(existing.country.sources, 'the overview');
  for (const story of existing.stories) {
    if (!sentBack.storyIds.includes(story.id)) add(story.sources, `story "${story.id}"`);
  }
  return kept;
}

/**
 * Assemble and check a revision of what review sent back in one country: the country part, when
 * the overview is sent back, and the stories sent back. Each story must keep the ID of one of the
 * stories sent back, every one of them must be there once, and the country part must be there
 * exactly when the overview is sent back. Each replaces its part in place, so the rest of the file
 * stays byte for byte as it is, and the candidate file passes every check the revision path
 * applies to each revised part. The pipeline's provenance replaces the old one, which clears the
 * revision request. The API path checks one part at a time (one story, or the country part);
 * agent drafting checks everything a country has sent back in one submission.
 */
export function checkRevisions(
  context: DraftingContext,
  existing: CountryFile,
  sentBack: SentBack,
  submission: {
    country?: { path: string; country: DraftCountry };
    stories: SubmittedRevision[];
    sources: DraftSource[];
  },
  options: RevisionCheckOptions,
): { ok: true; file: CountryFile; notices: string[] } | { ok: false; issues: string[] } {
  const { storyIds } = sentBack;
  const idIssues: string[] = [];
  if (submission.country && !sentBack.overview) {
    idIssues.push(
      `${submission.country.path}: the overview is not sent back, so leave the country part out`,
    );
  }
  if (!submission.country && sentBack.overview) {
    idIssues.push('country: the overview is sent back; revise it and submit the country part');
  }
  const seen = new Set<string>();
  for (const { path, story } of submission.stories) {
    if (!storyIds.includes(story.id)) {
      idIssues.push(
        storyIds.length === 0
          ? `${path}: no story is sent back, so leave the stories out`
          : storyIds.length === 1
            ? `${path}.id: keep the story ID "${storyIds[0]}"`
            : `${path}.id: "${story.id}" is not a story sent back; keep the ID of the story it revises, one of ${storyIds.map((id) => `"${id}"`).join(', ')}`,
      );
    } else if (seen.has(story.id)) {
      idIssues.push(`${path}.id: "${story.id}" appears more than once; submit each story once`);
    } else {
      // The slug is the story's URL, which links, redirects and readers already use.
      const { slug } = existing.stories.find((entry) => entry.id === story.id)!;
      if (story.slug !== slug) {
        idIssues.push(`${path}.slug: keep the slug "${slug}"; it is the story's URL`);
      }
    }
    seen.add(story.id);
  }
  for (const storyId of storyIds) {
    if (!seen.has(storyId)) {
      idIssues.push(`stories: revise every story sent back; "${storyId}" is missing`);
    }
  }
  if (idIssues.length) return { ok: false, issues: idIssues };

  // A source that the kept parts of the file declare under the same ID, with a URL this session
  // read as the same page (a redirect on the same host), keeps the file's URL, so the ID still
  // names one URL in the file.
  const kept = keptDeclarations(existing, sentBack);
  const notices: string[] = [];
  const sources = submission.sources.map((source) => {
    const other = kept.get(source.id);
    if (
      other &&
      other.url !== source.url &&
      hostOf(other.url) === hostOf(source.url) &&
      options.samePage?.(other.url, source.url)
    ) {
      notices.push(
        `Source "${source.id}" is declared by ${other.where}, which this revision does not change, with ${other.url}; this submission declares it with ${source.url}, the same page after a redirect. The file keeps ${other.url} (the URL of ${other.where} wins), so your change to ${source.url} did not land. To change the URL everywhere, say so in your report, so the editor sends ${other.where} back too.`,
      );
      return { ...source, url: other.url };
    }
    return source;
  });

  const assembleContext = {
    countryId: existing.country.id,
    slug: existing.country.slug,
    model: options.model,
    date: context.date,
    promptVersion: context.prompts.version,
  };
  let file = existing;
  if (submission.country) {
    file = replaceCountryPart(
      file,
      keepCamera(
        'country',
        assembleCountryPart(submission.country.country, sources, assembleContext),
        existing.country.scene,
      ),
    );
  }
  for (const { story } of submission.stories) {
    // The ID checks above make sure every submitted story replaces one in the file.
    const replaced = existing.stories.find((entry) => entry.id === story.id)!;
    file = replaceStory(
      file,
      keepCamera('story', assembleStory(story, sources, assembleContext), replaced.scene),
    );
  }
  const scopes = [
    ...(sentBack.overview ? ['overview' as const] : []),
    ...storyIds.map((storyId) => ({ storyId })),
  ];
  const issues = scopes.flatMap((scope) =>
    checkCandidate({
      contentDir: context.contentDir,
      candidate: file,
      scope,
      plan: context.plan,
      submittedSources: sources,
      evidence: options.evidence,
      evidenceRule: options.evidenceRule,
      unusableEvidence: options.unusableEvidence,
      storyCount: context.storyCount,
      land: context.land,
    }),
  );
  // A source ID that a kept part declares with another URL cannot change in this revision. This
  // problem replaces the content rule's, which names both places but cannot say which one stays.
  const clashes = sources.flatMap((source) => {
    const other = kept.get(source.id);
    return other && other.url !== cleanUrl(source.url) ? [{ source, other }] : [];
  });
  const clashing = new Set(clashes.map(({ source }) => `Source "${source.id}" points to`));
  const problems = issues.filter(
    (issue) => ![...clashing].some((start) => issue.startsWith(`sources: ${start}`)),
  );
  // A part that comes back as it was drafted answers none of the editor's notes. Provenance,
  // paraphrases and when each source was read are not part of what the notes are about.
  if (
    submission.country &&
    sameAsDrafted(
      { country: toDraftCountry(file.country), sources: file.country.sources },
      { country: toDraftCountry(existing.country), sources: existing.country.sources },
    )
  ) {
    problems.push(
      `${submission.country.path}: the country part is the same as drafted, so the editor's notes on the overview are not addressed; revise it as the notes ask`,
    );
  }
  for (const { path, story } of submission.stories) {
    const revised = file.stories.find((entry) => entry.id === story.id)!;
    const drafted = existing.stories.find((entry) => entry.id === story.id)!;
    if (
      sameAsDrafted(
        { story: toDraftStory(revised), sources: revised.sources },
        { story: toDraftStory(drafted), sources: drafted.sources },
      )
    ) {
      problems.push(
        `${path}: "${story.id}" is the same as drafted, so the editor's notes on it are not addressed; revise it as the notes ask`,
      );
    }
  }
  for (const { source, other } of clashes) {
    problems.push(
      `sources: "${source.id}" is declared by ${other.where} with ${other.url}, which this revision does not change, and this submission declares it with ${source.url}. Cite ${other.url} here (read it in this task first), or give the other URL its own source ID; to correct the URL everywhere, say so in your report, so the editor sends ${other.where} back too and both are revised together.`,
    );
  }
  return problems.length
    ? { ok: false, issues: [...new Set(problems)] }
    : { ok: true, file, notices };
}

/**
 * Whether a revised part says the same as the part as drafted: the same text and scene in the
 * draft shape, and the same sources in any order, whenever each was read.
 */
function sameAsDrafted<Part extends object>(
  revised: Part & { sources: Source[] },
  drafted: Part & { sources: Source[] },
): boolean {
  const shape = ({ sources, ...part }: Part & { sources: Source[] }) =>
    JSON.stringify({
      ...part,
      sources: toDraftSources(sources).sort((a, b) => a.id.localeCompare(b.id)),
    });
  return shape(revised) === shape(drafted);
}

/** Redraft one story that review sent back, following the reviewer's notes. */
export function storySession(
  context: RunContext,
  existing: CountryFile,
  storyId: string,
): SessionSetup {
  const { notes, asDrafted } = storyUnderRevision(existing, storyId);
  const countryId = existing.country.id;
  const task = render(context.prompts['revise-story'], {
    countryName: existing.country.name,
    countryId,
    storyId,
    today: context.date,
    notes,
    story: asDrafted,
    otherStories: otherStoriesText(existing, [storyId]),
    inboundReferences: inboundReferences(context.contentDir, countryId),
    candidatePlaces: candidateListing(countryId),
  });
  return {
    ...baseSetup(context, `${countryId}-${storyId}`, 'submit_story'),
    tools: tools(context.limits, {
      name: 'submit_story',
      description:
        'Submit the complete revised story and every source it cites. Validation problems come back as an error to fix and resubmit.',
      schema: StoryDraft,
    }),
    task: [linkTargetsBlock(context), { type: 'text', text: task }],
    submit: (input, { model, evidence }): Submission => {
      const parsed = StoryDraft.safeParse(input);
      if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error), draft: input };
      const result = checkRevisions(
        context,
        existing,
        { overview: false, storyIds: [storyId] },
        { stories: [{ path: 'story', story: parsed.data.story }], sources: parsed.data.sources },
        { model, evidence },
      );
      return result.ok ? result : { ok: false, issues: result.issues, draft: input };
    },
  };
}

/**
 * Redraft the country part of a country whose overview review sent back alone, following the
 * reviewer's notes. Every story stays as it is.
 */
export function overviewSession(context: RunContext, existing: CountryFile): SessionSetup {
  const { notes, asDrafted } = countryPartUnderRevision(existing);
  const countryId = existing.country.id;
  const template = context.prompts['revise-overview'];
  if (!template) {
    throw new Error(`The ${context.prompts.version} prompts have no revise-overview template.`);
  }
  const task = render(template, {
    countryName: existing.country.name,
    countryId,
    today: context.date,
    notes,
    country: asDrafted,
    stories: storiesText(existing),
    candidatePlaces: candidateListing(countryId),
  });
  return {
    ...baseSetup(context, overviewJobTag(countryId), 'submit_overview'),
    tools: tools(context.limits, {
      name: 'submit_overview',
      description:
        'Submit the complete revised country part (overview, quick facts, starter questions and map scene) and every source it cites. Validation problems come back as an error to fix and resubmit.',
      schema: OverviewDraft,
    }),
    task: [linkTargetsBlock(context), { type: 'text', text: task }],
    submit: (input, { model, evidence }): Submission => {
      const parsed = OverviewDraft.safeParse(input);
      if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error), draft: input };
      const result = checkRevisions(
        context,
        existing,
        { overview: true, storyIds: [] },
        {
          country: { path: 'country', country: parsed.data.country },
          stories: [],
          sources: parsed.data.sources,
        },
        { model, evidence },
      );
      return result.ok ? result : { ok: false, issues: result.issues, draft: input };
    },
  };
}

/**
 * The tag of an overview revision job: its recording directory and batch custom ID, which the
 * Batches API limits to letters, digits, "_" and "-" (BATCH_CUSTOM_ID in pipeline/config.ts). A
 * story revision's tag is the country ID, "-" and the story ID, and neither ID has an underscore,
 * so the two never meet.
 */
export const overviewJobTag = (countryId: string) => `${countryId}_overview`;
