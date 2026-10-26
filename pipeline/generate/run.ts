// Run drafting jobs, either one request at a time or in rounds through the Message Batches API,
// and write accepted drafts into the content tree. A batch run can resume in sync mode: it
// collects the round in flight, then finishes each conversation one request at a time.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { CountryFile } from '../../src/content/schema';
import { CACHE_DIR, type Effort } from '../config';
import {
  readCountryFile,
  readJson,
  requireMapCountry,
  writeCountryFile,
  writeJson,
} from '../content-tree';
import { replaceStory } from './assemble';
import { MissingApiKeyError, type ModelClient } from './model-client';
import { DraftSession, type SessionSetup, type SessionSnapshot } from './session';
import { countrySession, storySession, type RunContext } from './tasks';
import { emptyUsage, formatUsage, sumUsage, type Usage } from './usage';

export type Job =
  { kind: 'country'; countryId: string } | { kind: 'story'; countryId: string; storyId: string };

export const jobTag = (job: Job) =>
  job.kind === 'country' ? job.countryId : `${job.countryId}-${job.storyId}`;

export type JobResult = {
  tag: string;
  outcome: 'written' | 'skipped' | 'failed';
  detail: string;
  usage: Usage;
};

export type GenerateOptions = {
  client: ModelClient;
  context: RunContext;
  jobs: Job[];
  /** How requests are sent; with resume, how the saved batch run continues. */
  mode: 'sync' | 'batch';
  /** Replace existing drafts that have no revision request. */
  regenerate: boolean;
  /** Replace files that contain reviewed content. */
  force: boolean;
  /** Continue an interrupted batch run (in either mode) instead of refusing to start. */
  resume: boolean;
  log: (line: string) => void;
  /** Run state and failed drafts go here (default pipeline/.cache). */
  cacheDir?: string;
};

/** Where an unfinished batch run is saved so it can resume after the process stops. */
export const batchRunFile = (cacheDir: string) => join(cacheDir, 'batch-run.json');
const failedDir = (cacheDir: string) => join(cacheDir, 'failed');

type BatchRunState = {
  startedAt: string;
  model: string;
  promptVersion: string;
  /** Missing in runs saved before it was recorded. */
  effort?: Effort;
  date: string;
  jobs: Job[];
  round: number;
  pendingBatchId?: string;
  sessions: SessionSnapshot[];
  results: JobResult[];
};

const hasReviewed = (file: CountryFile) =>
  file.country.provenance.status === 'reviewed' ||
  file.stories.some((story) => story.provenance.status === 'reviewed');

/** Why a job should not run, or undefined when it should. */
function skipReason(job: Job, options: GenerateOptions): string | undefined {
  const slug = requireMapCountry(job.countryId).slug;
  const existing = readCountryFile(options.context.contentDir, slug);
  if (job.kind === 'story') {
    const story = existing?.stories.find((entry) => entry.id === job.storyId);
    if (!story) return 'no such story';
    return story.provenance.revision ? undefined : 'no revision requested';
  }
  if (!existing) return undefined;
  if (hasReviewed(existing) && !options.force) {
    return 'contains reviewed content; pass --force to replace it';
  }
  if (existing.country.provenance.revision || options.regenerate || options.force) return undefined;
  return 'a draft exists; pass --regenerate to replace it';
}

function setupFor(job: Job, context: RunContext): SessionSetup {
  const slug = requireMapCountry(job.countryId).slug;
  const existing = readCountryFile(context.contentDir, slug);
  if (job.kind === 'country') return countrySession(context, job.countryId, existing);
  if (!existing) throw new Error(`No content file for ${job.countryId}`);
  return storySession(context, existing, job.storyId);
}

/** Errors that would fail every job the same way: stop the run instead of trying the rest. */
export function isFatal(error: unknown): boolean {
  return (
    error instanceof MissingApiKeyError ||
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError
  );
}

export const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Write a finished session's draft, or record why it failed. */
function finish(session: DraftSession, job: Job, options: GenerateOptions): JobResult {
  const { contentDir } = options.context;
  const base = { tag: session.tag, usage: session.usage };
  const state = session.state;
  if (state.status === 'done') {
    let file = state.file;
    if (job.kind === 'story') {
      // Re-read the file: another revision in the same run may have changed it since.
      const current = readCountryFile(contentDir, file.country.slug)!;
      file = replaceStory(
        current,
        file.stories.find((story) => story.id === job.storyId)!,
      );
    }
    const path = writeCountryFile(contentDir, file);
    return { ...base, outcome: 'written', detail: `${path} (${state.model})` };
  }
  const reason = state.status === 'failed' ? state.reason : 'did not finish';
  const dir = failedDir(options.cacheDir ?? CACHE_DIR);
  mkdirSync(dir, { recursive: true });
  const failedFile = join(dir, `${session.tag}.json`);
  writeJson(failedFile, {
    reason,
    log: session.log,
    lastDraft: state.status === 'failed' ? state.lastDraft : undefined,
  });
  return { ...base, outcome: 'failed', detail: `${reason} (last draft in ${failedFile})` };
}

function report(result: JobResult, options: GenerateOptions): void {
  options.log(`${result.tag}: ${result.outcome}: ${result.detail}`);
  if (result.usage.requests) {
    options.log(`${result.tag}: ${formatUsage(result.usage, options.context.model)}`);
  }
}

/** Send a session's requests one at a time until it finishes. */
async function drive(
  session: DraftSession,
  options: GenerateOptions,
  afterRequest: () => void = () => {},
): Promise<void> {
  while (session.running) {
    try {
      const message = await options.client.create({
        tag: session.tag,
        request: session.request(),
      });
      session.handle(message, false);
    } catch (error) {
      if (isFatal(error)) throw error;
      session.fail(describeError(error));
    }
    afterRequest();
  }
}

async function runSync(jobs: Job[], options: GenerateOptions): Promise<JobResult[]> {
  const results: JobResult[] = [];
  for (const job of jobs) {
    // Sessions are created just before they run, so each sees the drafts written before it.
    const session = new DraftSession(setupFor(job, options.context));
    options.log(`${session.tag}: drafting with ${options.client.description}`);
    await drive(session, options);
    const result = finish(session, job, options);
    report(result, options);
    results.push(result);
  }
  return results;
}

function saveRun(file: string, state: BatchRunState): void {
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, state);
}

async function runBatch(jobs: Job[], options: GenerateOptions): Promise<JobResult[]> {
  const { context } = options;
  const runFile = batchRunFile(options.cacheDir ?? CACHE_DIR);
  let state: BatchRunState;
  if (existsSync(runFile)) {
    const saved = readJson(runFile) as BatchRunState;
    if (!options.resume) {
      throw new Error(
        `An unfinished batch run from ${saved.startedAt} exists (${runFile}). Pass --resume to continue it, or delete the file to start over.`,
      );
    }
    if (
      saved.model !== context.model ||
      saved.promptVersion !== context.prompts.version ||
      (saved.effort && saved.effort !== context.effort)
    ) {
      throw new Error(
        `The unfinished run used ${saved.model} at ${saved.effort ?? 'an unrecorded'} effort with prompts ${saved.promptVersion}; resume with the same settings.`,
      );
    }
    state = saved;
    options.log(
      `Resuming the batch run from ${saved.startedAt}, round ${saved.round}, in ${options.mode} mode.`,
    );
  } else {
    state = {
      startedAt: new Date().toISOString(),
      model: context.model,
      promptVersion: context.prompts.version,
      effort: context.effort,
      date: context.date,
      jobs,
      round: 0,
      sessions: [],
      results: [],
    };
  }
  // Sources keep the day they were first read, even when a run resumes on a later day.
  const runContext: RunContext = { ...context, date: state.date };
  const snapshots = new Map(state.sessions.map((snapshot) => [snapshot.tag, snapshot]));
  const sessions = state.jobs
    .filter((job) => !state.results.some((result) => result.tag === jobTag(job)))
    .map((job) => ({
      job,
      session: new DraftSession(setupFor(job, runContext), snapshots.get(jobTag(job))),
    }));

  const persist = () => {
    state.sessions = sessions.map(({ session }) => session.snapshot());
    saveRun(runFile, state);
  };
  persist();

  const record = (entry: (typeof sessions)[number]) => {
    if (state.results.some((result) => result.tag === entry.session.tag)) return;
    const result = finish(entry.session, entry.job, { ...options, context: runContext });
    report(result, options);
    state.results.push(result);
  };

  for (;;) {
    sessions.filter(({ session }) => !session.running).forEach(record);
    const running = sessions.filter(({ session }) => session.running);
    if (!running.length) break;

    if (options.mode === 'sync' && !state.pendingBatchId) {
      // Resumed in sync mode with no round in flight: finish each conversation directly.
      for (const entry of running) {
        options.log(`${entry.session.tag}: continuing with ${options.client.description}`);
        await drive(entry.session, options, persist);
        record(entry);
        persist();
      }
      continue;
    }

    // A resumed run waits for its saved batch, which is the round it already counted.
    if (!state.pendingBatchId) state.round += 1;
    options.log(
      `Round ${state.round}: ${running.length} request${running.length === 1 ? '' : 's'}.`,
    );
    const outcomes = await options.client.runBatch(
      running.map(({ session }) => ({ tag: session.tag, request: session.request() })),
      {
        resumeBatchId: state.pendingBatchId,
        onSubmitted: (batchId) => {
          state.pendingBatchId = batchId;
          persist();
        },
        onProgress: options.log,
      },
    );
    state.pendingBatchId = undefined;
    for (const { session } of running) {
      const outcome = outcomes.get(session.tag);
      if (!outcome) session.fail('missing from batch results');
      else if (outcome.type === 'succeeded') session.handle(outcome.message, true);
      else session.fail(`batch request ${outcome.type}: ${outcome.error}`);
    }
    persist();
  }
  rmSync(runFile);
  return state.results;
}

export type RunSummary = { results: JobResult[]; usage: Usage };

export async function generate(options: GenerateOptions): Promise<RunSummary> {
  const runnable: Job[] = [];
  const results: JobResult[] = [];
  const resuming = options.resume && existsSync(batchRunFile(options.cacheDir ?? CACHE_DIR));
  for (const job of resuming ? [] : options.jobs) {
    const reason = skipReason(job, options);
    if (reason) {
      const result: JobResult = {
        tag: jobTag(job),
        outcome: 'skipped',
        detail: reason,
        usage: emptyUsage(),
      };
      report(result, options);
      results.push(result);
    } else {
      runnable.push(job);
    }
  }
  if (runnable.length || resuming) {
    results.push(
      ...(options.mode === 'batch' || resuming
        ? await runBatch(runnable, options)
        : await runSync(runnable, options)),
    );
  }
  return { results, usage: sumUsage(results.map((result) => result.usage)) };
}
