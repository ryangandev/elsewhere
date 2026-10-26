// Run claim check sessions, one per country, a few at a time or in rounds through the Message
// Batches API, and save each session's verdicts as soon as it finishes. An overview or story is
// checked only while one of its units has no result for its current text, so an interrupted run
// picks up where it stopped (a batch round in flight is lost, not resumed).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CountryFile } from '../../src/content/schema';
import { CLAIMS_CONCURRENCY } from '../config';
import { writeJson } from '../content-tree';
import type { ModelClient } from '../generate/model-client';
import { describeError, isFatal } from '../generate/run';
import { DraftSession } from '../generate/session';
import { emptyUsage, formatUsage, sumUsage, type Usage } from '../generate/usage';
import { claimSession, type ClaimChecks, type ClaimsContext } from './session';
import {
  countVerdicts,
  describeCheck,
  formatCounts,
  isFlagged,
  readClaims,
  recordChecks,
  type UnitStatus,
} from './store';
import { allScopes, scopesLabel, scopeUnits, type ClaimScope, type ClaimUnit } from './units';

/** One country's overview and stories to check in one conversation. */
export type ClaimsJob = { file: CountryFile; scopes: ClaimScope[] };

export type ClaimsJobResult = {
  tag: string;
  label: string;
  outcome: 'checked' | 'failed';
  detail: string;
  /** The job's units with their new results (empty when the session failed). */
  statuses: UnitStatus[];
  usage: Usage;
};

export type ClaimsOptions = {
  client: ModelClient;
  context: ClaimsContext;
  jobs: ClaimsJob[];
  /** One request at a time per session, or rounds through the Batches API at half price. */
  mode: 'sync' | 'batch';
  /** Where results are saved (pipeline/.cache/claims by default). */
  claimsDir: string;
  log: (line: string) => void;
  /** Sessions run at once in sync mode. */
  concurrency?: number;
};

export type JobSelection = {
  /** Only this story; without it, the overview and every story. */
  storyId?: string;
  /** Only the overview and stories that are still drafts. */
  draftsOnly?: boolean;
  /** Check again even when every unit has a result for its current text. */
  recheck?: boolean;
};

/**
 * The check a file needs, as at most one job: its overview and stories with a unit that has no
 * result for its current text.
 */
export function claimsJobs(
  file: CountryFile,
  selection: JobSelection,
  claimsDir: string,
): ClaimsJob[] {
  const claims = readClaims(claimsDir, file.country.id);
  const scopes = selection.storyId
    ? [{ kind: 'story' as const, storyId: selection.storyId }]
    : allScopes(file);
  const due = scopes
    .filter((scope) => {
      if (!selection.draftsOnly) return true;
      const provenance =
        scope.kind === 'overview'
          ? file.country.provenance
          : file.stories.find((story) => story.id === scope.storyId)?.provenance;
      return provenance?.status === 'draft';
    })
    .filter(
      (scope) =>
        selection.recheck || scopeUnits(file, scope).some((unit) => !claims.checks[unit.key]),
    );
  return due.length ? [{ file, scopes: due }] : [];
}

type Entry = {
  job: ClaimsJob;
  units: ClaimUnit[];
  session: DraftSession<ClaimChecks>;
  label: string;
};

function start(job: ClaimsJob, context: ClaimsContext): Entry {
  const setup = claimSession(context, job.file, job.scopes);
  return {
    job,
    units: setup.units,
    session: new DraftSession(setup),
    label: scopesLabel(job.file.country.id, job.scopes),
  };
}

/** Save a finished session's verdicts, or its log when it failed. */
function finish(entry: Entry, options: ClaimsOptions): ClaimsJobResult {
  const { session, units, job, label } = entry;
  const base = { tag: session.tag, label, usage: session.usage };
  const state = session.state;
  if (state.status === 'done') {
    recordChecks(options.claimsDir, job.file.country.id, state.file);
    const statuses = units.map((unit) => ({ unit, check: state.file[unit.key] }));
    return {
      ...base,
      outcome: 'checked',
      detail: `${units.length} units: ${formatCounts(countVerdicts(statuses))} (${state.model})`,
      statuses,
    };
  }
  const reason = state.status === 'failed' ? state.reason : 'did not finish';
  const dir = join(options.claimsDir, 'failed');
  mkdirSync(dir, { recursive: true });
  const failedFile = join(dir, `${session.tag}.json`);
  writeJson(failedFile, {
    reason,
    log: session.log,
    lastSubmission: state.status === 'failed' ? state.lastDraft : undefined,
  });
  return {
    ...base,
    outcome: 'failed',
    detail: `${reason} (log in ${failedFile})`,
    statuses: [],
  };
}

function report(result: ClaimsJobResult, options: ClaimsOptions): void {
  const lines = [`${result.label}: ${result.outcome}: ${result.detail}`];
  for (const { unit, check } of result.statuses) {
    if (!check || !isFlagged(check)) continue;
    lines.push(`  ${unit.label}`, `    ${unit.text.replace(/\n/g, '\n    ')}`);
    lines.push(...describeCheck(check).map((line) => `    ${line}`));
  }
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
      session.fail(describeError(error));
    }
  }
}

async function runSync(entries: Entry[], options: ClaimsOptions): Promise<ClaimsJobResult[]> {
  const results: ClaimsJobResult[] = [];
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      options.log(`${entry.label}: checking with ${options.client.description}`);
      await drive(entry, options);
      const result = finish(entry, options);
      report(result, options);
      results.push(result);
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency ?? CLAIMS_CONCURRENCY, entries.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

async function runBatch(entries: Entry[], options: ClaimsOptions): Promise<ClaimsJobResult[]> {
  const results: ClaimsJobResult[] = [];
  const reported = new Set<Entry>();
  for (let round = 1; ; round += 1) {
    const running = entries.filter((entry) => entry.session.running);
    if (!running.length) break;
    options.log(`Round ${round}: ${running.length} request${running.length === 1 ? '' : 's'}.`);
    const outcomes = await options.client.runBatch(
      running.map(({ session }) => ({ tag: session.tag, request: session.request() })),
      { onProgress: options.log },
    );
    for (const { session } of running) {
      const outcome = outcomes.get(session.tag);
      if (!outcome) session.fail('missing from batch results');
      else if (outcome.type === 'succeeded') await session.handle(outcome.message, true);
      else session.fail(`batch request ${outcome.type}: ${outcome.error}`);
    }
    for (const entry of running.filter((item) => !item.session.running)) {
      if (reported.has(entry)) continue;
      reported.add(entry);
      const result = finish(entry, options);
      report(result, options);
      results.push(result);
    }
  }
  return results;
}

export type ClaimsSummary = { results: ClaimsJobResult[]; usage: Usage };

export async function checkClaims(options: ClaimsOptions): Promise<ClaimsSummary> {
  const entries = options.jobs.map((job) => start(job, options.context));
  if (!entries.length) return { results: [], usage: emptyUsage() };
  const results =
    options.mode === 'batch' ? await runBatch(entries, options) : await runSync(entries, options);
  // Report in the order the jobs were given, whatever order they finished in.
  const order = new Map(entries.map((entry, index) => [entry.session.tag, index]));
  results.sort((a, b) => order.get(a.tag)! - order.get(b.tag)!);
  return { results, usage: sumUsage(results.map((result) => result.usage)) };
}
