// One claim check conversation: Claude fetches the pages cited by the units of one job (a country,
// or part of one; see plan.ts), each once, with the server-side web fetch tool (or, for a page that
// refuses it, fetch_page from this computer), then submits a verdict per unit through a strict
// tool. One conversation reads a source shared by several stories once, which matters when it is a
// long PDF. It runs on the drafting session loop (pipeline/generate/session.ts), so pause_turn,
// reminders and repairs work the same way, and it records and replays through the same ModelClient.
//
// Verdicts are judged unit by unit: the latest verdict of a unit that passes every check is kept
// while other units go back for repair, and handed to `onChecks` at once so it can be saved. The
// session is done when every unit has one.
import type { BetaTool, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import type { CountryFile } from '../../src/content/schema';
import {
  CLAIM_FETCH_MAX_CONTENT_TOKENS,
  CLAIM_FETCH_RETRIES,
  type Effort,
  type GenerationLimits,
} from '../config';
import { toStrictJsonSchema } from '../generate/draft-schema';
import { normalizeUrl } from '../generate/evidence';
import type { SessionSetup } from '../generate/session';
import { render, type ClaimsPromptSet } from '../prompts';
import type { PageFetcher } from './local-fetch';
import type { ClaimCheck } from './store';
import { jobScopes, jobUnits, type ClaimsJob } from './plan';
import { checkVerdicts, fetchedTexts, fetchedUrls, SubmitVerdicts } from './verdicts';
import { citedSources, type ClaimScope, type ClaimUnit } from './units';

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

/** Where a session stands: the passing verdicts so far, and why the other units have none yet. */
export type ClaimProgress = {
  /** The latest passing verdict of each unit that has one, by unit key. */
  checks: ClaimChecks;
  /** The problems of the latest verdict of each unit without a passing one, by unit ID. */
  failures: Map<string, string[]>;
};

export type ClaimSession = SessionSetup<ClaimChecks> & {
  units: ClaimUnit[];
  progress: () => ClaimProgress;
};

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
    // Strict: the verdict schema is small and fixed, so it compiles for any number of units.
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

const joinNames = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

function scopeText(file: CountryFile, scopes: ClaimScope[]): { scope: string; context: string } {
  const names: string[] = [];
  const context: string[] = [];
  for (const scope of scopes) {
    if (scope.kind === 'overview') {
      names.push('the overview');
      context.push(
        '- The country overview: its summary and geography, the points on why the country matters, and its quick facts.',
      );
      continue;
    }
    const story = file.stories.find((entry) => entry.id === scope.storyId)!;
    names.push(`the story "${story.id}"`);
    context.push(
      `- The story "${story.id}" answers the question "${story.question}" Its short answer, for context only: ${story.summary}`,
    );
  }
  return { scope: joinNames(names), context: context.join('\n') };
}

/**
 * The values of a claim check task template: what is checked, for context, and the sources and
 * units. The API task and the agent brief render the same values.
 */
export function claimsTaskValues(
  file: CountryFile,
  scopes: ClaimScope[],
  units: ClaimUnit[],
): Record<string, string> {
  return {
    ...scopeText(file, scopes),
    countryName: file.country.name,
    countryId: file.country.id,
    sources: citedSources(units)
      .map((source) => `- ${source.id}: "${source.title}", ${source.publisher}. ${source.url}`)
      .join('\n'),
    units: units.map(renderUnit).join('\n\n'),
  };
}

export function claimSession(
  context: ClaimsContext,
  job: ClaimsJob,
  /** Called with the passing verdicts of every submission as soon as it is checked. */
  onChecks?: (checks: ClaimChecks) => void,
): ClaimSession {
  const { file } = job;
  const scopes = jobScopes(job);
  const units = jobUnits(job);
  const unitKeys = new Map(units.map((unit) => [unit.id, unit.key]));
  const sources = citedSources(units);
  const checks: ClaimChecks = {};
  let failures = new Map<string, string[]>();
  const sourceUrls = new Map(sources.map((source) => [normalizeUrl(source.url), source.url]));
  const limits: GenerationLimits = {
    ...context.limits,
    webFetchesPerRequest: Math.max(
      context.limits.webFetchesPerRequest,
      sources.length + CLAIM_FETCH_RETRIES,
    ),
  };
  /** Source pages fetch_page read, which count as fetched like web_fetch results. */
  const fetchedLocally = new Set<string>();
  /**
   * The text of every page read in the conversation, to check quotes against. It lives only in
   * this session: claim checks are not resumed from a snapshot.
   */
  const texts = new Map<string, string[]>();
  const addText = (url: string, text: string) => texts.set(url, [...(texts.get(url) ?? []), text]);
  const ttl = context.cacheTtl === '1h' ? { ttl: '1h' as const } : {};
  const task = render(context.prompts.task, claimsTaskValues(file, scopes, units));
  return {
    units,
    progress: () => ({ checks: { ...checks }, failures: new Map(failures) }),
    tag: job.tag,
    model: context.model,
    effort: context.effort,
    limits,
    cacheTtl: context.cacheTtl,
    system: [
      {
        type: 'text',
        text: render(context.prompts.system, {}),
        cache_control: { type: 'ephemeral', ...ttl },
      },
    ],
    tools: tools(limits),
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
        addText(normalizeUrl(url), text);
        return `Text of ${url}, fetched from the editor's computer:\n\n${text}`;
      } catch (error) {
        throw new Error(
          `Could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    evidence: (content) => {
      for (const [url, text] of fetchedTexts(content)) addText(url, text);
      return fetchedUrls(content);
    },
    submit: (input, { model, evidence }) => {
      const result = checkVerdicts(input, {
        units,
        sources,
        fetched: new Set([...evidence, ...fetchedLocally]),
        texts,
        stamp: {
          checkedAt: context.date,
          model,
          effort: context.effort,
          promptVersion: context.prompts.version,
        },
      });
      Object.assign(checks, result.checks);
      failures = new Map([...result.failures].filter(([id]) => !checks[unitKeys.get(id)!]));
      if (Object.keys(result.checks).length) onChecks?.(result.checks);
      // Done once every unit has a passing verdict, from this submission or an earlier one.
      if (units.every((unit) => checks[unit.key])) {
        return {
          ok: true,
          file: Object.fromEntries(units.map((unit) => [unit.key, checks[unit.key]])),
        };
      }
      return { ok: false, issues: result.issues, draft: input };
    },
  };
}
