// The commands a claim checking subagent runs through `npm run content:claims-agent`. The subagent
// reads the cited pages and judges each unit; these commands own every guarantee:
//
// - Which units are due, and how a country is split into sessions, come from the API claim check's
//   plan (pipeline/claims/plan.ts), so both paths check the same units.
// - Verdicts are validated by the API path's checkVerdicts, unit by unit, with the same rules.
// - Every quote is verified against a live fetch that submit makes itself, from the web, at
//   submission. Nothing the subagent could have touched (the reading copies in pages/, the fetch
//   log, the verdict file) is ever used as the text a quote is matched against, and a quote from a
//   page the live fetch cannot read fails its unit.
// - Passing verdicts go into the same claims file, in the same format, through the same writer
//   (recordChecks), with the agent method recorded: the claims-agent prompt version and the pages
//   fetched to verify the quotes, so content:review gates approval identically.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CountryFile, Source } from '../../src/content/schema';
import {
  describeRecord,
  fetchFailure,
  fetchForReading,
  printChunk,
  printMatches,
} from '../agent/reading';
import { evidenceIntact, findPageRecord, savePageRecord } from '../agent/session';
import type { FetchedPage } from '../claims/local-fetch';
import { claimsJobs, jobUnits } from '../claims/plan';
import {
  countVerdicts,
  defaultClaimsDir,
  formatCounts,
  recordChecks,
  type ClaimCheck,
} from '../claims/store';
import {
  allScopes,
  citedSources,
  scopeUnits,
  type ClaimScope,
  type ClaimUnit,
} from '../claims/units';
import { checkVerdicts, SubmitVerdicts, type VerdictResult } from '../claims/verdicts';
import { normalizeUrl } from '../generate/evidence';
import { CURRENT_CLAIMS_AGENT_PROMPT_VERSION, loadClaimsAgentPrompts } from '../prompts';
import { loadCountry } from '../review/actions';
import { renderBrief, renderRepair } from './brief';
import {
  DEFAULT_CLAIMS_AGENT_DIR,
  briefFile,
  dueUnits,
  listSessions,
  pagesDir,
  readSession,
  sessionDir,
  submissionsDir,
  verdictFile,
  writeSession,
  type ClaimsAgentSession,
  type LiveFetch,
} from './session';

export type ClaimsAgentDeps = {
  /** Where sessions live (default pipeline/.cache/claims-agent). */
  root?: string;
  /** Page fetches, for the fetch command and for live verification; tests pass a stub. */
  fetch?: typeof fetch;
  now?: () => Date;
  out: (line: string) => void;
};

/** Live fetches at once during a submission. */
const LIVE_FETCH_CONCURRENCY = 4;

const command = (args: string) => `npm run content:claims-agent -- ${args}`;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function context(deps: ClaimsAgentDeps) {
  return {
    root: deps.root ?? DEFAULT_CLAIMS_AGENT_DIR,
    now: () => (deps.now ?? (() => new Date()))().toISOString(),
  };
}

export type StartOptions = {
  /** A country ID (CHL) or slug (chile). */
  country: string;
  /** Only this story. */
  storyId?: string;
  contentDir: string;
  /** Where results are saved (default: claims/ in the content directory). */
  claimsDir?: string;
  model: string;
  effort: string;
  /** Check units that already have a result for their current text, too. */
  recheck: boolean;
  /** Only the overview and stories that are still drafts. */
  draftsOnly: boolean;
  /** Most cited sources in one session; a country citing more is split into several sessions. */
  maxSources: number;
  /** Discard every existing session of the country first. */
  fresh: boolean;
};

/**
 * Create one session per part of the due units and write each brief. Every part is planned at
 * once from one reading of the claims file, so parts never overlap however their subagents
 * finish; a unit an unfinished session still holds is never handed to another one.
 */
export function start(options: StartOptions, deps: ClaimsAgentDeps): number {
  const { root, now } = context(deps);
  const file = loadCountry(options.contentDir, options.country);
  const countryId = file.country.id;
  if (options.storyId && !file.stories.some((story) => story.id === options.storyId)) {
    deps.out(`${countryId} has no story "${options.storyId}".`);
    return 1;
  }
  const claimsDir = options.claimsDir ?? defaultClaimsDir(options.contentDir);
  const existing = listSessions(root).filter(({ session }) => session.countryId === countryId);
  if (options.fresh) {
    for (const { dir } of existing) rmSync(dir, { recursive: true, force: true });
  }
  const scopes: ClaimScope[] | undefined = options.storyId
    ? [{ kind: 'story', storyId: options.storyId }]
    : undefined;
  const jobs = claimsJobs(
    file,
    {
      scopes,
      draftsOnly: options.draftsOnly,
      recheck: options.recheck,
      maxSources: options.maxSources,
    },
    claimsDir,
  );
  if (!jobs.length) {
    deps.out(
      'Nothing to check: every unit has a result for its current text. Pass --recheck to check again.',
    );
    return 0;
  }
  if (!options.fresh) {
    const wanted = new Set(jobs.flatMap(jobUnits).map((unit) => unit.key));
    const holding = existing.filter(({ session }) =>
      dueUnits(session).some((unit) => wanted.has(unit.key)),
    );
    if (holding.length) {
      deps.out(
        [
          `Unfinished sessions already hold some of these units: ${holding.map(({ id }) => id).join(', ')}.`,
          'Continue them (a new subagent can pick up a session where the last one stopped), or pass --fresh to discard every session of this country and plan again.',
        ].join('\n'),
      );
      return 1;
    }
  }

  const prompts = loadClaimsAgentPrompts();
  const created: { id: string; units: number; sources: number }[] = [];
  for (const job of jobs) {
    const id = job.tag.replace(/^claims-/, '');
    const dir = sessionDir(root, id);
    rmSync(dir, { recursive: true, force: true });
    const units = jobUnits(job);
    const sources = citedSources(units);
    writeSession(dir, {
      sessionId: id,
      countryId,
      label: job.label,
      contentDir: options.contentDir,
      claimsDir,
      model: options.model,
      effort: options.effort,
      promptVersion: CURRENT_CLAIMS_AGENT_PROMPT_VERSION,
      recheck: options.recheck,
      startedAt: now(),
      units: units.map(({ id: unitId, key, label }) => ({ id: unitId, key, label })),
      sources: sources.map(({ id: sourceId, url }) => ({ id: sourceId, url })),
      passed: [],
      fetches: [],
      failedFetches: [],
      submissions: [],
    });
    writeFileSync(briefFile(dir), renderBrief(prompts, job, id, verdictFile(dir)));
    created.push({ id, units: units.length, sources: sources.length });
  }

  deps.out(
    `${plural(created.length, 'claims agent session')} for ${file.country.name} (${countryId}) in ${root}:`,
  );
  for (const { id, units, sources } of created) {
    deps.out(
      `  ${id}: ${plural(units, 'unit')}, ${plural(sources, 'source')}; brief ${briefFile(sessionDir(root, id))}`,
    );
  }
  deps.out(
    created.length > 1
      ? 'The sessions share no units, so a claim-checker subagent can work on each one at the same time.'
      : `Read the whole brief, write the verdicts to ${verdictFile(sessionDir(root, created[0].id))}, then run: ${command(`submit ${created[0].id}`)}`,
  );
  return 0;
}

export type FetchOptions = {
  sessionId: string;
  url: string;
  /** First character to print. */
  offset: number;
  /** Instead of a chunk, list where these words appear. */
  find?: string;
  /** Fetch again even when a reading copy is stored. */
  refresh: boolean;
};

/**
 * Read one of the session's cited pages on this computer and print part of it. The copy kept in
 * pages/ saves fetching a page again for every part; it is only for reading and never verifies
 * a quote. Fetches and failures are logged in the session for status.
 */
export async function fetchCommand(options: FetchOptions, deps: ClaimsAgentDeps): Promise<number> {
  const { root, now } = context(deps);
  const dir = sessionDir(root, options.sessionId);
  const session = readSession(dir, options.sessionId);
  const source = session.sources.find(
    (entry) => normalizeUrl(entry.url) === normalizeUrl(options.url),
  );
  if (!source) {
    deps.out(
      [
        `${options.url} is not a source of this session; only its cited URLs can be fetched:`,
        ...session.sources.map((entry) => `  ${entry.id}: ${entry.url}`),
      ].join('\n'),
    );
    return 1;
  }

  let stored = options.refresh ? undefined : findPageRecord(pagesDir(dir), source.url);
  if (stored && !evidenceIntact(stored.record)) {
    deps.out(`The reading copy in ${stored.file} no longer matches its hash; fetching again.`);
    stored = undefined;
  }
  if (stored) {
    deps.out(`${source.url} (reading copy in ${stored.file})`);
  } else {
    try {
      stored = savePageRecord(pagesDir(dir), await fetchForReading(source.url, deps.fetch), now());
    } catch (error) {
      const reason = fetchFailure(error);
      session.failedFetches.push({ url: source.url, attemptedAt: now(), reason });
      writeSession(dir, session);
      deps.out(
        `Could not read ${source.url}: ${reason}. If it cannot be read at all, mark ${source.id} unreachable with this reason.`,
      );
      return 1;
    }
    const { record } = stored;
    session.fetches = [
      {
        url: source.url,
        finalUrl: record.finalUrl,
        fetchedAt: record.fetchedAt,
        characters: record.characters,
        sha256: record.sha256,
      },
      ...session.fetches.filter((entry) => entry.url !== source.url),
    ];
    writeSession(dir, session);
    deps.out(`${source.url} (fetched; reading copy in ${stored.file})`);
  }
  const { record } = stored;
  deps.out(describeRecord(record));
  if (record.finalUrl !== record.requestedUrl) deps.out(`Redirected to ${record.finalUrl}.`);
  const read = (offset: number | string) =>
    command(`fetch ${options.sessionId} "${options.url}" --offset ${offset}`);
  return options.find
    ? printMatches(record, options.find, read('<n>'), deps.out)
    : printChunk(record, options.offset, read, deps.out);
}

type LivePage = { fetchedAt: string; page?: FetchedPage; error?: string };

/** Fetch every URL live, a few at a time, by normalized URL. Never reads a stored copy. */
async function fetchLive(
  urls: string[],
  deps: ClaimsAgentDeps,
  now: () => string,
): Promise<Map<string, LivePage>> {
  const pages = new Map<string, LivePage>();
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const fetchedAt = now();
      try {
        pages.set(normalizeUrl(url), { fetchedAt, page: await fetchForReading(url, deps.fetch) });
      } catch (error) {
        pages.set(normalizeUrl(url), { fetchedAt, error: fetchFailure(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: LIVE_FETCH_CONCURRENCY }, worker));
  return pages;
}

export type SubmitOptions = {
  sessionId: string;
  /** Default: verdicts.json in the session directory. */
  file?: string;
  /** Run every check, the live fetch included, but save and record nothing. */
  dryRun?: boolean;
};

/** The session's units as they are in the content now, or the labels of those that changed. */
function currentUnits(
  session: ClaimsAgentSession,
  file: CountryFile,
): { units: ClaimUnit[] } | { changed: string[] } {
  const byKey = new Map(
    allScopes(file)
      .flatMap((scope) => scopeUnits(file, scope))
      .map((unit) => [unit.key, unit]),
  );
  const changed = session.units.filter((unit) => !byKey.has(unit.key));
  if (changed.length) return { changed: changed.map((unit) => unit.label) };
  return { units: session.units.map((unit) => ({ ...byKey.get(unit.key)!, id: unit.id })) };
}

/**
 * Check a verdict file with the API path's rules, verify every quote against a live fetch, and
 * save the verdict of every unit that passes. Units that do not pass are listed with their
 * problems, for the subagent to fix and submit again. A dry run does the same, the live fetch
 * included, and saves and records nothing.
 */
export async function submit(options: SubmitOptions, deps: ClaimsAgentDeps): Promise<number> {
  const { root, now } = context(deps);
  const dir = sessionDir(root, options.sessionId);
  const session = readSession(dir, options.sessionId);
  if (!dueUnits(session).length) {
    deps.out('Every unit of this session has a saved verdict; there is nothing to submit.');
    return 0;
  }
  const country = loadCountry(session.contentDir, session.countryId);
  const current = currentUnits(session, country);
  if ('changed' in current) {
    deps.out(
      `The text or sources of ${current.changed.join(', ')} changed since this session started, so its verdicts would not apply. Plan again with: ${command(`start ${session.countryId} --fresh`)}`,
    );
    return 1;
  }
  const path = options.file ?? verdictFile(dir);
  if (!existsSync(path)) {
    deps.out(`No verdict file at ${path}. Write it there first.`);
    return 1;
  }
  const raw = readFileSync(path, 'utf8');
  const ordinal = session.submissions.length + 1;
  const kept = join(submissionsDir(dir), `${ordinal}.json`);
  if (!options.dryRun) {
    mkdirSync(submissionsDir(dir), { recursive: true });
    writeFileSync(kept, raw);
  }
  const prompts = loadClaimsAgentPrompts(session.promptVersion);

  let input: unknown;
  let invalid: string | undefined;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    invalid = `The verdict file is not valid JSON: ${error instanceof Error ? error.message : error}`;
  }
  const parsed = SubmitVerdicts.safeParse(input);
  const listedUnits = new Set(parsed.success ? parsed.data.verdicts.map((v) => v.unitId) : []);
  const listedSources = new Set(parsed.success ? parsed.data.sources.map((s) => s.id) : []);
  // The units still due, and any that passed before and are in the file again.
  const checked = current.units.filter(
    (unit) => !session.passed.includes(unit.id) || listedUnits.has(unit.id),
  );
  const needed = new Set(citedSources(checked).map((source) => source.id));
  const sources: Source[] = citedSources(current.units).filter(
    (source) => needed.has(source.id) || listedSources.has(source.id),
  );

  // Every page quoted from a source reported read, fetched live now.
  const quoted = new Map<string, string>();
  if (parsed.success) {
    const read = new Set(parsed.data.sources.filter((s) => s.status === 'read').map((s) => s.id));
    const checkedIds = new Set(checked.map((unit) => unit.id));
    for (const verdict of parsed.data.verdicts) {
      if (!checkedIds.has(verdict.unitId)) continue;
      for (const { sourceId } of verdict.evidence) {
        const source = sources.find((entry) => entry.id === sourceId);
        if (source && read.has(sourceId)) quoted.set(normalizeUrl(source.url), source.url);
      }
    }
  }
  const live = await fetchLive([...quoted.values()], deps, now);
  const texts = new Map<string, string[]>();
  for (const [url, { page }] of live) if (page) texts.set(url, [page.text]);

  const result: VerdictResult = invalid
    ? { ok: false, checks: {}, failures: new Map(), issues: [invalid] }
    : checkVerdicts(input, {
        units: checked,
        sources,
        fetched: new Set(
          session.fetches.flatMap((entry) => [
            normalizeUrl(entry.url),
            normalizeUrl(entry.finalUrl),
          ]),
        ),
        texts,
        stamp: {
          checkedAt: now().slice(0, 10),
          model: session.model,
          effort: session.effort,
          promptVersion: session.promptVersion,
        },
        fetchedWith: 'with the fetch command in this session',
        textFrom: 'the page as fetched live at submission from',
        missingText: (url) => {
          const failed = live.get(normalizeUrl(url))?.error;
          return `the live fetch of ${url} at submission failed (${failed ?? 'not fetched'}), and a quote counts only when it is on the live page. Fetch the page again to see whether it loads; if it cannot be read, mark the source unreachable with the reason and judge the unit without it.`;
        },
      });

  // Every quote of a passing verdict matched live text, so each of its sources has a live page.
  const checks: Record<string, ClaimCheck> = {};
  for (const [key, check] of Object.entries(result.checks)) {
    const ids = [...new Set(check.evidence.map((item) => item.sourceId))];
    const pages = ids.map((sourceId) => {
      const url = sources.find((source) => source.id === sourceId)!.url;
      const { page, fetchedAt } = live.get(normalizeUrl(url)) ?? {};
      if (!page || !fetchedAt) throw new Error(`No live page for ${url}; this is a pipeline bug`);
      return {
        sourceId,
        url,
        finalUrl: page.finalUrl,
        fetchedAt,
        characters: page.text.length,
        sha256: sha256(page.text),
      };
    });
    checks[key] = { ...check, verification: { pages } };
  }
  const savedIds = checked.filter((unit) => checks[unit.key]).map((unit) => unit.id);
  const liveFetches: LiveFetch[] = [...quoted].map(([key, url]) => {
    const { fetchedAt, page, error } = live.get(key)!;
    return { url, fetchedAt, sha256: page ? sha256(page.text) : null, error: error ?? null };
  });
  const passed = [...new Set([...session.passed, ...savedIds])];
  const due = session.units.filter((unit) => !passed.includes(unit.id));

  if (options.dryRun) {
    deps.out('Dry run: nothing is saved or recorded.');
  } else {
    if (savedIds.length) recordChecks(session.claimsDir, country, checks);
    session.passed = passed;
    session.submissions.push({
      file: kept,
      submittedAt: now(),
      saved: savedIds,
      failures: Object.fromEntries(result.failures),
      issues: result.issues,
      liveFetches,
    });
    writeSession(dir, session);
    deps.out(`Submission ${ordinal} (kept in ${kept}).`);
  }
  for (const entry of liveFetches) {
    deps.out(
      entry.error
        ? `  Live fetch failed: ${entry.url}: ${entry.error}`
        : `  Fetched live to verify quotes: ${entry.url}`,
    );
  }
  const statuses = checked
    .filter((unit) => checks[unit.key])
    .map((unit) => ({ unit, check: checks[unit.key] }));
  if (savedIds.length) {
    deps.out(
      `${options.dryRun ? 'Would save' : 'Saved'} ${plural(savedIds.length, 'verdict')} to ${session.claimsDir}: ${formatCounts(countVerdicts(statuses)).replace(/, 0 not checked$/, '')}.`,
    );
  }
  if (result.issues.length) deps.out(renderRepair(prompts, result.issues, path));
  if (!due.length) {
    deps.out(
      options.dryRun
        ? `Every unit would pass. Run ${command(`submit ${session.sessionId}`)} to save the verdicts.`
        : 'Every unit of this session now has a saved verdict. The session is done.',
    );
    return 0;
  }
  deps.out(
    [
      `${plural(due.length, 'unit')} still to check${options.dryRun ? ' (nothing was saved)' : ''}:`,
      ...due.map((unit) => `  ${unit.id}: ${unit.label}`),
      'Fix them and submit again, or stop and report them as not checked.',
    ].join('\n'),
  );
  return 1;
}

function describeSession(
  id: string,
  dir: string,
  session: ClaimsAgentSession,
  deps: ClaimsAgentDeps,
) {
  const due = dueUnits(session);
  const last = session.submissions.at(-1);
  deps.out(`Claims agent session ${id} (${session.label}) in ${dir}`);
  deps.out(
    `Content ${session.contentDir}, results ${session.claimsDir}, model ${session.model} at ${session.effort} effort, prompts ${session.promptVersion}${session.recheck ? ', recheck' : ''}, started ${session.startedAt}.`,
  );
  deps.out(`Brief: ${briefFile(dir)}`);
  deps.out(
    `Units: ${session.units.length}, ${session.passed.length} checked and saved, ${due.length} still to check${due.length ? ':' : '.'}`,
  );
  for (const unit of due) {
    const problems = last?.failures[unit.id];
    deps.out(
      `  ${unit.id}: ${unit.label}${problems ? ` (last submission: ${problems.join('; ')})` : ''}`,
    );
  }
  deps.out(`Fetched pages: ${session.fetches.length} of ${session.sources.length} sources`);
  for (const entry of session.fetches) {
    deps.out(
      `  ${entry.url} (${entry.characters.toLocaleString('en-US')} characters, ${entry.fetchedAt})`,
    );
  }
  const unread = session.sources.filter(
    (source) => !session.fetches.some((entry) => entry.url === source.url),
  );
  for (const source of unread) deps.out(`  not fetched yet: ${source.id} ${source.url}`);
  deps.out(`Failed fetches: ${session.failedFetches.length || 'none'}`);
  for (const { url, attemptedAt, reason } of session.failedFetches) {
    deps.out(`  ${url} (${attemptedAt}): ${reason}`);
  }
  if (!last) {
    deps.out('Submissions: none yet.');
    return;
  }
  const failedLive = last.liveFetches.filter((entry) => entry.error);
  deps.out(
    `Submissions: ${session.submissions.length}; the last saved ${plural(last.saved.length, 'unit')} and had ${plural(last.issues.length, 'problem')}, with ${plural(last.liveFetches.length, 'live fetch')}${failedLive.length ? ` (${failedLive.length} failed)` : ''}.`,
  );
}

/**
 * What a session has checked, fetched and submitted. Given a country instead of a session ID,
 * every session of that country.
 */
export function status(options: { target: string }, deps: ClaimsAgentDeps): number {
  const { root } = context(deps);
  const sessions = listSessions(root);
  const exact = sessions.filter(({ id }) => id === options.target);
  const matching = exact.length
    ? exact
    : sessions.filter(({ id }) => id.startsWith(`${options.target.toUpperCase()}-`));
  if (!matching.length) {
    deps.out(
      `No claims agent session "${options.target}". Start one with: ${command('start <country> [story]')}`,
    );
    return 1;
  }
  matching.forEach(({ id, dir, session }, index) => {
    if (index) deps.out('');
    describeSession(id, dir, session, deps);
  });
  return 0;
}
