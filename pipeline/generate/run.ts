// Run drafting jobs, either one request at a time or in rounds through the Message Batches API,
// and write accepted drafts into the content tree. A batch run can resume in sync mode: it
// collects the round in flight, then finishes each conversation one request at a time.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import type { CountryFile, RevisionRequest } from '../../src/content/schema';
import { CACHE_DIR, type Effort } from '../config';
import {
  readCountryFile,
  readJson,
  requireMapCountry,
  writeCountryFile,
  writeJson,
} from '../content-tree';
import { replaceCountryPart, replaceStory } from './assemble';
import { MissingApiKeyError, type ModelClient } from './model-client';
import { overviewRevision, replaceConflict } from './replace';
import { DraftSession, type SessionSetup, type SessionSnapshot } from './session';
import {
  countrySession,
  overviewJobTag,
  overviewSession,
  storySession,
  type RunContext,
} from './tasks';
import { emptyUsage, formatUsage, sumUsage, type Usage } from './usage';

/**
 * A country drafted whole, one story review sent back, or the country part of a country whose
 * overview review sent back alone. A revision job records the request it started from when it
 * starts (`request`), so a request the editor changes or widens during the run is caught before
 * the redraft is written; a batch run saves it with the job.
 */
export type Job =
  | { kind: 'country'; countryId: string }
  | { kind: 'overview'; countryId: string; request?: RevisionRequest }
  | { kind: 'story'; countryId: string; storyId: string; request?: RevisionRequest };

export const jobTag = (job: Job) =>
  job.kind === 'country'
    ? job.countryId
    : job.kind === 'overview'
      ? overviewJobTag(job.countryId)
      : `${job.countryId}-${job.storyId}`;

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

/** Why a job should not run, or undefined when it should. */
function skipReason(job: Job, options: GenerateOptions): string | undefined {
  const slug = requireMapCountry(job.countryId).slug;
  const existing = readCountryFile(options.context.contentDir, slug);
  if (job.kind === 'story') {
    const story = existing?.stories.find((entry) => entry.id === job.storyId);
    if (!story) return 'no such story';
    return story.provenance.revision ? undefined : 'no revision requested';
  }
  if (job.kind === 'overview') {
    if (!existing) return 'no content file';
    return overviewRevision(existing) ? undefined : 'no overview revision requested';
  }
  switch (replaceConflict(existing, options)) {
    case 'reviewed':
      return 'contains reviewed content, or content reopened after review, which is redrafted in place (--revisions); pass --force to replace the file';
    case 'draft':
      return 'a draft exists; pass --regenerate to replace it';
    default:
      return undefined;
  }
}

/** The revision request a revision job answers, as the content file has it now. */
function currentRequest(job: Job, file: CountryFile | undefined): RevisionRequest | undefined {
  if (!file || job.kind === 'country') return undefined;
  if (job.kind === 'overview') return file.country.provenance.revision;
  return file.stories.find((story) => story.id === job.storyId)?.provenance.revision;
}

/**
 * Why a finished revision may not be written: the request it answered is no longer the one in
 * the file. The editor may have sent the part back again with other notes, sent back the whole
 * country instead of the overview, or withdrawn the request by redrafting it another way.
 */
function requestChanged(job: Job, file: CountryFile): string | undefined {
  if (job.kind === 'country' || !job.request) return undefined;
  const now = currentRequest(job, file);
  if (isDeepStrictEqual(now, job.request)) return undefined;
  const part =
    job.kind === 'overview'
      ? `the overview of ${job.countryId}`
      : `${job.countryId}/${job.storyId}`;
  const what = !now
    ? `${part} is no longer sent back`
    : job.kind === 'overview' && !now.scope
      ? `the whole of ${job.countryId} is sent back now, not only its overview`
      : `${part} was sent back again with other notes`;
  return `${what} since this job started, so the redraft was not written; run npm run content:generate -- --revisions again for the current request`;
}

function setupFor(job: Job, context: RunContext): SessionSetup {
  const slug = requireMapCountry(job.countryId).slug;
  const existing = readCountryFile(context.contentDir, slug);
  if (job.kind === 'country') return countrySession(context, job.countryId, existing);
  if (!existing) throw new Error(`No content file for ${job.countryId}`);
  if (job.kind === 'overview') return overviewSession(context, existing);
  return storySession(context, existing, job.storyId);
}

export const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The request was refused because its conversation is longer than the model's context window.
 * A synchronous call throws it as a 400; a batch entry reports it as an errored result, whose text
 * is the same error.
 */
export const isContextOverflow = (error: unknown) =>
  /prompt is too long/i.test(describeError(error));

/**
 * Errors that would fail every job the same way: stop the run instead of trying the rest. A
 * conversation that outgrew the context window is a 400 too, but it fails only its own job.
 */
export function isFatal(error: unknown): boolean {
  if (isContextOverflow(error)) return false;
  return (
    error instanceof MissingApiKeyError ||
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError
  );
}

/** Write a finished session's draft, or record why it failed. */
function finish(session: DraftSession, job: Job, options: GenerateOptions): JobResult {
  const { contentDir } = options.context;
  const base = { tag: session.tag, usage: session.usage };
  const state = session.state;
  if (state.status === 'done') {
    let file = state.file;
    // Re-read the file for a revision: another revision in the same run may have changed it since,
    // and only the revised part is replaced, and only while the request it answered still stands.
    const current =
      job.kind === 'country' ? undefined : readCountryFile(contentDir, file.country.slug)!;
    const changed = current && requestChanged(job, current);
    if (changed) return failed(session, options, changed, state.file);
    if (current && job.kind === 'story') {
      file = replaceStory(
        current,
        file.stories.find((story) => story.id === job.storyId)!,
      );
    } else if (current && job.kind === 'overview') {
      file = replaceCountryPart(current, file.country);
    }
    const path = writeCountryFile(contentDir, file);
    return { ...base, outcome: 'written', detail: `${path} (${state.model})` };
  }
  return failed(
    session,
    options,
    state.status === 'failed' ? state.reason : 'did not finish',
    state.status === 'failed' ? state.lastDraft : undefined,
  );
}

/** Record why a session's draft was not written, with its log and last draft for inspection. */
function failed(
  session: DraftSession,
  options: GenerateOptions,
  reason: string,
  lastDraft: unknown,
): JobResult {
  const dir = failedDir(options.cacheDir ?? CACHE_DIR);
  mkdirSync(dir, { recursive: true });
  const failedFile = join(dir, `${session.tag}.json`);
  writeJson(failedFile, { reason, log: session.log, lastDraft });
  return {
    tag: session.tag,
    usage: session.usage,
    outcome: 'failed',
    detail: `${reason} (last draft in ${failedFile})`,
  };
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
      await session.handle(message, false);
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
      else if (outcome.type === 'succeeded') await session.handle(outcome.message, true);
      else session.fail(`batch request ${outcome.type}: ${outcome.error}`);
    }
    persist();
  }
  rmSync(runFile);
  return state.results;
}

/** A revision job with the request it starts from, read from the content file now. */
function withRequest(job: Job, options: GenerateOptions): Job {
  if (job.kind === 'country') return job;
  const slug = requireMapCountry(job.countryId).slug;
  const request = currentRequest(job, readCountryFile(options.context.contentDir, slug));
  return { ...job, request };
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
      runnable.push(withRequest(job, options));
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
