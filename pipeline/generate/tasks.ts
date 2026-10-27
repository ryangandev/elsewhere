// Build drafting sessions: the shared (cached) system prompt and tools, and the per-task
// first turn for drafting a whole country or revising one story. The prompt texts and the
// submission check are also used by agent drafting (pipeline/agent), which hands the same
// instructions to a Claude Code subagent and checks its submission the same way.
import { readFileSync } from 'node:fs';
import type {
  BetaTextBlockParam,
  BetaTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import type { LandIndex } from '../../src/content/geometry';
import type { CountryFile } from '../../src/content/schema';
import { REFERENCE_COUNTRY_FILE, type Effort, type GenerationLimits } from '../config';
import { parsedCountryFiles, requireMapCountry } from '../content-tree';
import { render, type PromptSet } from '../prompts';
import { assembleCountry, assembleStory, replaceStory } from './assemble';
import { checkCandidate, type Plan } from './check';
import { CountryDraft, StoryDraft, toStrictJsonSchema, toToolJsonSchema } from './draft-schema';
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
  prompts: Pick<PromptSet, 'system'>,
  schemaName = 'the tool schema',
): string {
  const reference = `${JSON.stringify(
    withoutParaphrases(JSON.parse(readFileSync(REFERENCE_COUNTRY_FILE, 'utf8'))),
    null,
    2,
  )}\n`;
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

function inboundReferences(contentDir: string, countryId: string): string {
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

function zodIssues(error: z.ZodError): string[] {
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
 * retrieved; `evidenceRule` tells it, in a problem, which pages it may cite.
 */
export function submitCountryDraft(
  context: DraftingContext,
  countryId: string,
  input: unknown,
  options: { model: string; evidence: Set<string>; evidenceRule?: string },
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

/** Redraft one story that review sent back, following the reviewer's notes. */
export function storySession(
  context: RunContext,
  existing: CountryFile,
  storyId: string,
): SessionSetup {
  const story = existing.stories.find((entry) => entry.id === storyId);
  if (!story?.provenance.revision) {
    throw new Error(`${existing.country.id}/${storyId} has no revision request`);
  }
  const countryId = existing.country.id;
  const task = render(context.prompts['revise-story'], {
    countryName: existing.country.name,
    countryId,
    storyId,
    today: context.date,
    notes: story.provenance.revision.notes,
    story: JSON.stringify(
      withoutParaphrases({ ...story, provenance: { ...story.provenance, revision: undefined } }),
      null,
      2,
    ),
    otherStories:
      existing.stories
        .filter((entry) => entry.id !== storyId)
        .map((entry) => `"${entry.id}" (${entry.question})`)
        .join(', ') || 'none',
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
      if (parsed.data.story.id !== storyId) {
        return { ok: false, issues: [`story.id: keep the story ID "${storyId}"`], draft: input };
      }
      const revised = assembleStory(parsed.data.story, parsed.data.sources, {
        countryId,
        slug: existing.country.slug,
        model,
        date: context.date,
        promptVersion: context.prompts.version,
      });
      const file = replaceStory(existing, revised);
      const issues = checkCandidate({
        contentDir: context.contentDir,
        candidate: file,
        scope: { storyId },
        plan: context.plan,
        submittedSources: parsed.data.sources,
        evidence,
        storyCount: context.storyCount,
        land: context.land,
      });
      return issues.length ? { ok: false, issues, draft: input } : { ok: true, file };
    },
  };
}
