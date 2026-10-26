// One claim check conversation: Claude fetches the cited pages of an overview or a story with the
// server-side web fetch tool (or, for a page that refuses it, fetch_page from this computer), then
// submits a verdict per unit through a strict tool. It runs on
// the drafting session loop (pipeline/generate/session.ts), so pause_turn, reminders and repairs
// work the same way, and it records and replays through the same ModelClient.
import type { BetaTool, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import type { CountryFile } from '../../src/content/schema';
import { CLAIM_FETCH_MAX_CONTENT_TOKENS, type Effort, type GenerationLimits } from '../config';
import { toStrictJsonSchema } from '../generate/draft-schema';
import { normalizeUrl } from '../generate/evidence';
import type { SessionSetup } from '../generate/session';
import { render, type ClaimsPromptSet } from '../prompts';
import type { PageFetcher } from './local-fetch';
import type { ClaimCheck } from './store';
import { checkVerdicts, fetchedUrls, SubmitVerdicts } from './verdicts';
import { citedSources, scopeUnits, type ClaimScope, type ClaimUnit } from './units';

export type ClaimsContext = {
  prompts: ClaimsPromptSet;
  model: string;
  effort: Effort;
  limits: GenerationLimits;
  /** Prompt cache lifetime; batch runs use 1h because queued requests may wait longer than 5m. */
  cacheTtl: '5m' | '1h';
  /** The day of the run, recorded on every result. */
  date: string;
  /** Answers fetch_page: a local fetch in real runs, a stub in replays and tests. */
  fetchPage: PageFetcher;
};

/** Results by unit key. */
export type ClaimChecks = Record<string, ClaimCheck>;

export const claimsTag = (countryId: string, scope: ClaimScope) =>
  scope.kind === 'overview' ? `claims-${countryId}` : `claims-${countryId}-${scope.storyId}`;

const SUBMIT_TOOL = 'submit_verdicts';

const FetchPageInput = z.strictObject({
  url: z.string().describe('A source URL from the task, exactly as listed.'),
});

function tools(limits: GenerationLimits): BetaToolUnion[] {
  return [
    // The basic web fetch, not web_fetch_20260209: with dynamic filtering the model fetches from
    // inside code execution and sees only what its code prints, while a claim check needs the
    // page text itself in context.
    {
      type: 'web_fetch_20250910',
      name: 'web_fetch',
      max_uses: limits.webFetchesPerRequest,
      max_content_tokens: CLAIM_FETCH_MAX_CONTENT_TOKENS,
    },
    {
      name: 'fetch_page',
      description:
        "Fetch one of the task's source URLs from the editor's computer and return its text. Use it only when web_fetch could not read that page (an error, a bot challenge, or no article text). It reads HTML and plain text, not PDFs, and runs no scripts.",
      strict: true,
      input_schema: toStrictJsonSchema(FetchPageInput) as BetaTool.InputSchema,
    },
    // Strict: the verdict schema is small and fixed, so it compiles for every scope.
    {
      name: SUBMIT_TOOL,
      description:
        'Submit how each source read and a verdict for every unit. Validation problems come back as an error to fix and resubmit.',
      strict: true,
      input_schema: toStrictJsonSchema(SubmitVerdicts) as BetaTool.InputSchema,
    },
  ];
}

function renderUnit(unit: ClaimUnit): string {
  return [
    `### ${unit.id}: ${unit.label}`,
    `Cites: ${unit.sources.map((source) => source.id).join(', ')}`,
    '',
    unit.text,
  ].join('\n');
}

function scopeText(file: CountryFile, scope: ClaimScope): { scope: string; context: string } {
  if (scope.kind === 'overview') {
    return {
      scope: 'the overview',
      context:
        'The country overview: its summary and geography, the points on why the country matters, and its quick facts.',
    };
  }
  const story = file.stories.find((entry) => entry.id === scope.storyId)!;
  return {
    scope: `the story "${story.id}"`,
    context: `The story answers the question "${story.question}" Its short answer, for context only: ${story.summary}`,
  };
}

export function claimSession(
  context: ClaimsContext,
  file: CountryFile,
  scope: ClaimScope,
): SessionSetup<ClaimChecks> & { units: ClaimUnit[] } {
  const units = scopeUnits(file, scope);
  const sources = citedSources(units);
  const sourceUrls = new Map(sources.map((source) => [normalizeUrl(source.url), source.url]));
  /** Source pages fetch_page read, which count as fetched like web_fetch results. */
  const fetchedLocally = new Set<string>();
  const ttl = context.cacheTtl === '1h' ? { ttl: '1h' as const } : {};
  const task = render(context.prompts.task, {
    ...scopeText(file, scope),
    countryName: file.country.name,
    countryId: file.country.id,
    sources: sources
      .map((source) => `- ${source.id}: "${source.title}", ${source.publisher}. ${source.url}`)
      .join('\n'),
    units: units.map(renderUnit).join('\n\n'),
  });
  return {
    units,
    tag: claimsTag(file.country.id, scope),
    model: context.model,
    effort: context.effort,
    limits: context.limits,
    cacheTtl: context.cacheTtl,
    system: [
      {
        type: 'text',
        text: render(context.prompts.system, {}),
        cache_control: { type: 'ephemeral', ...ttl },
      },
    ],
    tools: tools(context.limits),
    task: [{ type: 'text', text: task }],
    submitTool: SUBMIT_TOOL,
    repairMessage: (issues) =>
      render(context.prompts.repair, {
        issues: issues.map((issue) => `- ${issue}`).join('\n'),
      }),
    nudgeMessage: render(context.prompts.nudge, {}),
    runTool: async (name, input) => {
      if (name !== 'fetch_page') throw new Error(`Unknown tool "${name}"`);
      const requested = FetchPageInput.parse(input).url;
      const url = sourceUrls.get(normalizeUrl(requested));
      if (!url) throw new Error(`${requested} is not a source URL in this task`);
      try {
        const text = await context.fetchPage(url);
        fetchedLocally.add(normalizeUrl(url));
        return `Text of ${url}, fetched from the editor's computer:\n\n${text}`;
      } catch (error) {
        throw new Error(
          `Could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    evidence: fetchedUrls,
    submit: (input, { model, evidence }) => {
      const result = checkVerdicts(input, {
        units,
        sources,
        fetched: new Set([...evidence, ...fetchedLocally]),
        stamp: {
          checkedAt: context.date,
          model,
          effort: context.effort,
          promptVersion: context.prompts.version,
        },
      });
      return result.ok
        ? { ok: true, file: result.checks }
        : { ok: false, issues: result.issues, draft: input };
    },
  };
}
