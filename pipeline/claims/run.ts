// Run claim check sessions (plan.ts decides which units and how they are split), a few at a time
// or in rounds through the Message Batches API. Paid work is never thrown away:
//
// - Every passing verdict is saved as soon as its submission is checked, so a session that fails
//   later keeps what it got right.
// - A session that ends without a verdict for every unit (repairs exhausted, an API error, the
//   request limit) leaves those units not checked, says why for each, and the next run checks
//   only them.
// - A session whose conversation outgrows the context window hands its unchecked units to smaller
//   sessions in the same run (plan.ts splitJob), until they fit or cannot be split further.
//
// A batch round in flight is lost when the run stops; results already saved stay.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CLAIMS_CONCURRENCY, CLAIMS_FAILED_DIR } from '../config';
import { writeJson } from '../content-tree';
import type { ModelClient } from '../generate/model-client';
import { describeError, isContextOverflow, isFatal } from '../generate/run';
import { DraftSession } from '../generate/session';
import { emptyUsage, formatUsage, sumUsage, type Usage } from '../generate/usage';
import { splitJob, type ClaimsJob } from './plan';
import { claimSession, type ClaimChecks, type ClaimsContext, type ClaimSession } from './session';
import {
  countVerdicts,
  describeCheck,
  formatCounts,
  isFlagged,
  recordChecks,
  type UnitStatus,
} from './store';
import type { ClaimUnit } from './units';

/** A unit a session left without a verdict, and why. */
export type UncheckedUnit = { unit: ClaimUnit; reason: string };

export type ClaimsJobResult = {
  tag: string;
  label: string;
  /**
   * checked: every unit has a verdict. partial: some units do and the rest are not checked.
   * failed: no unit has one. split: the conversation outgrew the context window and its
   * unchecked units went to the smaller sessions in `splitInto`, which report them.
   */
  outcome: 'checked' | 'partial' | 'failed' | 'split';
  detail: string;
  /**
   * The session's units with their results, so each unit of a run is counted once: a unit
   * without a check is not checked. Units handed to smaller sessions are left out.
   */
  statuses: UnitStatus[];
  unchecked: UncheckedUnit[];
  splitInto: string[];
  usage: Usage;
};

export type ClaimsOptions = {
  client: ModelClient;
  context: ClaimsContext;
  jobs: ClaimsJob[];
  /** One request at a time per session, or rounds through the Batches API at half price. */
  mode: 'sync' | 'batch';
  /** Where results are saved: content/<locale>/claims, or a scratch directory. */
  claimsDir: string;
  /** Where a session that did not check every unit leaves its log (default pipeline/.cache/claims-failed). */
  failedDir?: string;
  log: (line: string) => void;
  /** Sessions run at once in sync mode. */
  concurrency?: number;
};

type Entry = {
  job: ClaimsJob;
  setup: ClaimSession;
  session: DraftSession<ClaimChecks>;
  /** Position among the run's sessions: a split session's parts follow it. */
  order: number[];
  /** The last request was refused because the conversation outgrew the context window. */
  overflow: boolean;
};

function start(job: ClaimsJob, order: number[], options: ClaimsOptions): Entry {
  const setup = claimSession(options.context, job, (checks) =>
    recordChecks(options.claimsDir, job.file, checks),
  );
  return { job, setup, session: new DraftSession(setup), order, overflow: false };
}

/** A request failed outright (API error, expired batch entry). */
function requestFailed(entry: Entry, error: unknown): void {
  entry.overflow = isContextOverflow(error);
  entry.session.fail(
    entry.overflow
      ? `the conversation outgrew the model's context window (${describeError(error)})`
      : describeError(error),
  );
}

const firstLine = (text: string) => text.split('\n')[0];

/**
 * Save a finished session's verdicts and account for every unit: checked, not checked with its
 * reason, or handed to smaller sessions after a context overflow. Returns those sessions.
 */
function finish(entry: Entry, options: ClaimsOptions): { result: ClaimsJobResult; split: Entry[] } {
  const { session, setup, job } = entry;
  const state = session.state;
  const { checks, failures } = setup.progress();
  const saved = state.status === 'done' ? state.file : checks;
  // Passing verdicts were saved as they came; saving the final set again is harmless.
  if (Object.keys(saved).length) recordChecks(options.claimsDir, job.file, saved);

  const units = setup.units;
  const missing = units.filter((unit) => !saved[unit.key]);
  const reason = state.status === 'failed' ? state.reason : 'did not finish';
  const smaller = missing.length && entry.overflow ? splitJob(job, missing) : [];
  const split = smaller.map((child, index) => start(child, [...entry.order, index], options));
  const handedOver = new Set(smaller.flatMap((child) => child.parts.flatMap((part) => part.units)));
  const unchecked = missing
    .filter((unit) => !handedOver.has(unit))
    .map((unit) => ({
      unit,
      reason: failures.get(unit.id)?.join('; ') ?? firstLine(reason),
    }));
  const statuses = units
    .filter((unit) => !handedOver.has(unit))
    .map((unit) => ({ unit, check: saved[unit.key] }));
  const counts = countVerdicts(statuses);
  const checked = units.length - missing.length;

  let failedFile: string | undefined;
  if (state.status === 'failed') {
    const dir = options.failedDir ?? CLAIMS_FAILED_DIR;
    mkdirSync(dir, { recursive: true });
    failedFile = join(dir, `${session.tag}.json`);
    writeJson(failedFile, {
      reason,
      unchecked: unchecked.map(({ unit, reason }) => ({
        unit: unit.id,
        label: unit.label,
        reason,
      })),
      splitInto: split.map((child) => child.session.tag),
      log: session.log,
      lastSubmission: state.lastDraft,
    });
  }
  const log = failedFile ? ` (log in ${failedFile})` : '';
  const outcome: ClaimsJobResult['outcome'] = split.length
    ? 'split'
    : !missing.length
      ? 'checked'
      : checked
        ? 'partial'
        : 'failed';
  const detail = {
    checked: `${units.length} units: ${formatCounts(counts)} (${state.status === 'done' ? state.model : ''})`,
    partial: `${checked} of ${units.length} units have verdicts and are saved: ${formatCounts(counts)}; ${firstLine(reason)}${log}`,
    failed: `${firstLine(reason)}${log}`,
    split: `${firstLine(reason)}; ${checked} of ${units.length} units saved, the other ${handedOver.size} go to ${split.length} smaller sessions${log}`,
  }[outcome];
  return {
    result: {
      tag: session.tag,
      label: job.label,
      outcome,
      detail,
      statuses,
      unchecked,
      splitInto: split.map((child) => child.session.tag),
      usage: session.usage,
    },
    split,
  };
}

/**
 * Lines for units left without a verdict, one group per reason, so a session that failed before
 * any verdict gives its reason once rather than once per unit.
 */
export function describeUnchecked(unchecked: UncheckedUnit[], indent = '  '): string[] {
  const byReason = new Map<string, ClaimUnit[]>();
  for (const { unit, reason } of unchecked)
    byReason.set(reason, [...(byReason.get(reason) ?? []), unit]);
  return [...byReason].flatMap(([reason, units]) =>
    units.length === 1
      ? [`${indent}${units[0].label}: not checked: ${reason}`]
      : [
          `${indent}${units.length} units not checked: ${reason}`,
          ...units.map((unit) => `${indent}  ${unit.label}`),
        ],
  );
}

function report(result: ClaimsJobResult, options: ClaimsOptions): void {
  const lines = [`${result.label}: ${result.outcome}: ${result.detail}`];
  for (const { unit, check } of result.statuses) {
    if (!check || !isFlagged(check)) continue;
    lines.push(`  ${unit.label}`, `    ${unit.text.replace(/\n/g, '\n    ')}`);
    lines.push(...describeCheck(check).map((line) => `    ${line}`));
  }
  lines.push(...describeUnchecked(result.unchecked));
  if (result.splitInto.length) lines.push(`  continues in ${result.splitInto.join(', ')}`);
  if (result.usage.requests) {
    lines.push(`${result.label}: ${formatUsage(result.usage, options.context.model)}`);
  }
  options.log(lines.join('\n'));
}

async function drive(entry: Entry, options: ClaimsOptions): Promise<void> {
  const { session } = entry;
  while (session.running) {
    try {
      const message = await options.client.create({
        tag: session.tag,
        request: session.request(),
      });
      await session.handle(message, false);
    } catch (error) {
      if (isFatal(error)) throw error;
      requestFailed(entry, error);
    }
  }
}

type Finished = { entry: Entry; result: ClaimsJobResult };

/** Finish, report and queue the smaller sessions of a split. */
function settle(entry: Entry, options: ClaimsOptions, finished: Finished[]): Entry[] {
  const { result, split } = finish(entry, options);
  report(result, options);
  finished.push({ entry, result });
  return split;
}

async function runSync(entries: Entry[], options: ClaimsOptions): Promise<Finished[]> {
  const finished: Finished[] = [];
  const queue = [...entries];
  const limit = Math.max(1, options.concurrency ?? CLAIMS_CONCURRENCY);
  let active = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = () => {
      if (!queue.length && !active) return resolve();
      while (active < limit && queue.length) {
        const entry = queue.shift()!;
        active += 1;
        options.log(`${entry.job.label}: checking with ${options.client.description}`);
        drive(entry, options)
          .then(() => {
            active -= 1;
            queue.push(...settle(entry, options, finished));
            pump();
          })
          .catch(reject);
      }
    };
    pump();
  });
  return finished;
}

async function runBatch(entries: Entry[], options: ClaimsOptions): Promise<Finished[]> {
  const finished: Finished[] = [];
  let pending = [...entries];
  for (let round = 1; pending.length; round += 1) {
    options.log(`Round ${round}: ${pending.length} request${pending.length === 1 ? '' : 's'}.`);
    const outcomes = await options.client.runBatch(
      pending.map(({ session }) => ({ tag: session.tag, request: session.request() })),
      { onProgress: options.log },
    );
    const next: Entry[] = [];
    for (const entry of pending) {
      const outcome = outcomes.get(entry.session.tag);
      if (!outcome) entry.session.fail('missing from batch results');
      else if (outcome.type === 'succeeded') await entry.session.handle(outcome.message, true);
      else requestFailed(entry, `batch request ${outcome.type}: ${outcome.error}`);
      if (entry.session.running) next.push(entry);
      else next.push(...settle(entry, options, finished));
    }
    pending = next;
  }
  return finished;
}

export type ClaimsSummary = { results: ClaimsJobResult[]; usage: Usage };

const byOrder = (a: number[], b: number[]): number => {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
};

export async function checkClaims(options: ClaimsOptions): Promise<ClaimsSummary> {
  const entries = options.jobs.map((job, index) => start(job, [index], options));
  if (!entries.length) return { results: [], usage: emptyUsage() };
  const finished =
    options.mode === 'batch' ? await runBatch(entries, options) : await runSync(entries, options);
  // Report in the order the jobs were given, whatever order they finished in, with the smaller
  // sessions of a split after it.
  finished.sort((a, b) => byOrder(a.entry.order, b.entry.order));
  const results = finished.map(({ result }) => result);
  return { results, usage: sumUsage(results.map((result) => result.usage)) };
}
