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
  findMatches,
  isNetworkCut,
  printPart,
  shellQuote,
  menuOnlyWarning,
  unreadableWarning,
} from '../agent/reading';
import { notTheRequestedPage } from '../agent/page-check';
import {
  describeFailedFetch,
  evidenceIntact,
  findPageRecord,
  recordFailedFetch,
  savePageRecord,
} from '../agent/session';
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
import {
  checkVerdicts,
  QUOTE_MAX_WORDS,
  quoteWords,
  SubmitVerdicts,
  type VerdictResult,
} from '../claims/verdicts';
import { normalizeUrl } from '../generate/evidence';
import {
  CURRENT_CLAIMS_AGENT_PROMPT_VERSION,
  MIN_CLAIMS_AGENT_PROMPT_VERSION,
  promptVersionNumber,
  loadClaimsAgentPrompts,
} from '../prompts';
import { loadCountry } from '../review/actions';
import { renderBrief, renderRepair } from './brief';
import {
  DEFAULT_CLAIMS_AGENT_DIR,
  archiveSession,
  briefFile,
  dueUnits,
  hasSession,
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
  /** Waits between fetch attempts after a server error; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  out: (line: string) => void;
};

/** Live fetches at once during a submission. */
const LIVE_FETCH_CONCURRENCY = 4;

const command = (args: string) => `npm run content:claims-agent -- ${args}`;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** "1 unit", "2 units"; words that do not take a plain "s" give their plural ("live fetches"). */
const plural = (count: number, word: string, many = `${word}s`) =>
  `${count} ${count === 1 ? word : many}`;

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
  /** Only the overview units (summary, geography, why it matters, quick facts). */
  overviewOnly: boolean;
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
  /** Set the existing sessions of the country that overlap the requested scope aside (into finished/) first, even when nothing is due. */
  fresh: boolean;
};

/**
 * Create one session per part of the due units and write each brief. Every part is planned at
 * once from one reading of the claims file, so parts never overlap however their subagents
 * finish; a unit an unfinished session still holds is never handed to another one.
 */
/**
 * Why a session may not be continued, or undefined: it started on prompts older than
 * MIN_CLAIMS_AGENT_PROMPT_VERSION, whose brief describes the fetch command as it no longer works.
 */
function outdatedSession(session: ClaimsAgentSession): string | undefined {
  if (
    promptVersionNumber(session.promptVersion) >=
    promptVersionNumber(MIN_CLAIMS_AGENT_PROMPT_VERSION)
  ) {
    return undefined;
  }
  return `Session ${session.sessionId} started on the ${session.promptVersion} prompts, whose brief describes the fetch command as it no longer works. Set it aside and plan again with: ${command(`start ${session.countryId} --fresh`)}`;
}

export function start(options: StartOptions, deps: ClaimsAgentDeps): number {
  const { root, now } = context(deps);
  const file = loadCountry(options.contentDir, options.country);
  const countryId = file.country.id;
  if (options.overviewOnly && options.storyId) {
    deps.out(
      '--overview checks the overview alone and [story] checks one story, so use one of them.',
    );
    return 1;
  }
  if (options.storyId && !file.stories.some((story) => story.id === options.storyId)) {
    deps.out(`${countryId} has no story "${options.storyId}".`);
    return 1;
  }
  const claimsDir = options.claimsDir ?? defaultClaimsDir(options.contentDir);
  const existing = listSessions(root).filter(({ session }) => session.countryId === countryId);
  const scopes: ClaimScope[] | undefined = options.storyId
    ? [{ kind: 'story', storyId: options.storyId }]
    : options.overviewOnly
      ? [{ kind: 'overview' }]
      : undefined;
  const archived: string[] = [];
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
  if (options.fresh) {
    // Set aside what overlaps the requested scope before anything else, so --fresh does its job
    // even when nothing is due, and leaves a session of another part of the country alone.
    const inScope = new Set(
      (scopes ?? allScopes(file))
        .flatMap((scope) => scopeUnits(file, scope))
        .map((unit) => unit.id),
    );
    for (const { session } of existing) {
      if (session.units.some((unit) => inScope.has(unit.id))) {
        archived.push(archiveSession(root, session));
      }
    }
  }
  if (!jobs.length) {
    for (const target of archived) deps.out(`Moved the earlier session to ${target}.`);
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
      const outdated = holding.filter(({ session }) => outdatedSession(session));
      deps.out(
        [
          `Unfinished sessions already hold some of these units: ${holding.map(({ id }) => id).join(', ')}.`,
          outdated.length
            ? `${outdated.map(({ id }) => id).join(', ')} started on older prompts, whose brief describes the fetch command as it no longer works, so pass --fresh to set the sessions of this country that overlap this scope aside and plan again.`
            : 'Continue them (a new subagent can pick up a session where the last one stopped), or pass --fresh to set the sessions of this country that overlap this scope aside (into finished/) and plan again.',
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
    // A session left under this name holds no unit handed out now (unfinished ones that do were
    // refused above), or is finished; keep its fetch records and submissions.
    if (hasSession(dir)) archived.push(archiveSession(root, readSession(dir, id)));
    else rmSync(dir, { recursive: true, force: true });
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

  for (const target of archived) deps.out(`Moved the earlier session to ${target}.`);
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
  /**
   * First character to print, or with `find` to look from. Without it the print starts at the
   * page's main text when the page marks one, and a search looks from the start.
   */
  offset?: number;
  /** Instead of a chunk, list where each of these words appears. */
  find?: string[];
  /** With `find`, places listed per term (default 5). */
  matches?: number;
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
  const outdated = outdatedSession(session);
  if (outdated) {
    deps.out(outdated);
    return 1;
  }
  const matches = findMatches(options.matches);
  if (typeof matches === 'string') {
    deps.out(matches);
    return 1;
  }
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
      stored = savePageRecord(pagesDir(dir), await fetchForReading(source.url, deps), now());
    } catch (error) {
      const reason = fetchFailure(error);
      session.failedFetches = recordFailedFetch(session.failedFetches, {
        url: source.url,
        attemptedAt: now(),
        reason,
      });
      writeSession(dir, session);
      deps.out(
        isNetworkCut(error)
          ? `Could not read ${source.url}: ${reason}. Run the same command again in a minute. Do not mark ${source.id} unreachable for a network cut: the page itself is not the problem.`
          : `Could not read ${source.url}: ${reason}. If it cannot be read at all, mark ${source.id} unreachable with this reason.`,
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
    // Said once, when the page is fetched, not again for every part read from the copy.
    if (stored.record.finalUrl !== stored.record.requestedUrl) {
      deps.out(`Redirected to ${stored.record.finalUrl}.`);
    }
  }
  const { record } = stored;
  deps.out(describeRecord(record));
  const notCited = notTheRequestedPage(record);
  if (notCited) {
    deps.out(
      `WARNING: this is probably not the cited page: ${notCited}. A quote from it fails at submit. Try --refresh once; if the cited page still cannot be read, mark ${source.id} unreachable with this reason.`,
    );
  }
  const unreadable = unreadableWarning(record);
  if (unreadable) {
    deps.out(
      `${unreadable.replace(/; choose another source or another copy of the document\.$/, '.')} If no other copy is cited, mark ${source.id} unreachable with this reason.`,
    );
  }
  const menuOnly = menuOnlyWarning(record);
  if (menuOnly) deps.out(menuOnly);
  return printPart(
    record,
    { offset: options.offset, find: options.find, matches },
    (args) => command(`fetch ${options.sessionId} ${shellQuote(options.url)}${args}`),
    deps.out,
  );
}

type LivePage = {
  fetchedAt: string;
  page?: FetchedPage;
  error?: string;
  /** The connection was cut while the page downloaded, on every attempt; the page is not at fault. */
  cut?: boolean;
};

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
        const page = await fetchForReading(url, deps);
        // A login page, a redirect to the home page or a stub is not the cited page, so nothing
        // on it can verify a quote, even text that happens to match.
        const notCited = notTheRequestedPage({ requestedUrl: url, ...page });
        pages.set(
          normalizeUrl(url),
          notCited
            ? { fetchedAt, error: `it is probably not the cited page: ${notCited}` }
            : { fetchedAt, page },
        );
      } catch (error) {
        pages.set(normalizeUrl(url), {
          fetchedAt,
          error: fetchFailure(error),
          ...(isNetworkCut(error) ? { cut: true } : {}),
        });
      }
    }
  };
  await Promise.all(Array.from({ length: LIVE_FETCH_CONCURRENCY }, worker));
  return pages;
}

/**
 * How a live page compares with the reading copy of the same URL, for a person or a subagent.
 * `same` is whether their main text is the same, so a failed quote is not blamed on the live fetch.
 */
type LiveComparison = { same: boolean; description: string };

/** A line counts as main text from this many words; menus, dates and link lists are shorter. */
const MAIN_TEXT_WORDS = 10;

/**
 * The lines of a page's main text, sorted: lines of at least ten words, with runs of spaces as one.
 * Navigation, sidebars, timestamps, counters and link lists are short lines and change from fetch
 * to fetch, so two fetches of an unchanged page have the same main text even when their whole
 * text differs.
 */
export function mainTextLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.split(' ').length >= MAIN_TEXT_WORDS)
    .sort();
}

/** Compare a live page with the reading copy: identical, the same main text, or different. */
export function compareTexts(
  live: string,
  copy: { text: string; sha256: string; fetchedAt: string; characters: number },
): LiveComparison {
  const characters = `${live.length.toLocaleString('en-US')} characters`;
  if (copy.sha256 === sha256(live)) {
    return { same: true, description: `${characters}, the same text as the reading copy` };
  }
  const liveLines = mainTextLines(live);
  const copyLines = mainTextLines(copy.text);
  if (
    liveLines.length &&
    liveLines.length === copyLines.length &&
    liveLines.every((line, index) => line === copyLines[index])
  ) {
    return {
      same: true,
      description: `${characters}, the same main text as the reading copy (only short lines such as navigation, sidebars, dates or links differ)`,
    };
  }
  return {
    same: false,
    description: `${characters}, not the text of the reading copy fetched ${copy.fetchedAt} (${copy.characters.toLocaleString('en-US')} characters): its main text differs`,
  };
}

function compareWithReadingCopy(page: FetchedPage, dir: string, url: string): LiveComparison {
  const copy = findPageRecord(pagesDir(dir), url)?.record;
  if (!copy) {
    return {
      same: false,
      description: `${page.text.length.toLocaleString('en-US')} characters; there is no reading copy`,
    };
  }
  return compareTexts(page.text, copy);
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

/** Quotes this many words under the limit or more are listed with their word count by a dry run. */
const QUOTE_LENGTH_MARGIN = 3;

/**
 * The lines a dry run prints for quotes that are over the word limit or within three words of it,
 * counted by the function the check uses, so nobody counts by hand. Empty when no quote is near.
 */
export function quoteLengthLines(
  verdicts: { unitId: string; evidence: { sourceId: string; quote: string }[] }[],
  unitIds: Set<string>,
): string[] {
  const lines: string[] = [];
  for (const { unitId, evidence } of verdicts) {
    if (!unitIds.has(unitId)) continue;
    for (const { sourceId, quote } of evidence) {
      const words = quoteWords(quote);
      if (words < QUOTE_MAX_WORDS - QUOTE_LENGTH_MARGIN) continue;
      const shown = quote.length > 60 ? `${quote.slice(0, 57)}...` : quote;
      lines.push(
        `  ${unitId} (${sourceId}): ${plural(words, 'word')}, ${
          words > QUOTE_MAX_WORDS
            ? `${plural(words - QUOTE_MAX_WORDS, 'word')} over the limit`
            : words === QUOTE_MAX_WORDS
              ? 'at the limit'
              : `${plural(QUOTE_MAX_WORDS - words, 'word')} under the limit`
        }: "${shown}"`,
      );
    }
  }
  return lines.length
    ? [
        `Quote lengths (a quote may have at most ${QUOTE_MAX_WORDS} words), the long ones:`,
        ...lines,
      ]
    : [];
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
  const outdated = outdatedSession(session);
  if (outdated) {
    deps.out(outdated);
    return 1;
  }
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
  // How each live page compares with the reading copy the subagent quoted from, so a quote that
  // fails because the live fetch returned something else is told apart from a miscopied quote.
  // The reading copy only explains a failure; it never verifies a quote.
  const comparisons = new Map<string, LiveComparison>();
  for (const [key, url] of quoted) {
    const page = live.get(key)?.page;
    if (page) comparisons.set(key, compareWithReadingCopy(page, dir, url));
  }

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
          const { error: failed, cut } = live.get(normalizeUrl(url)) ?? {};
          if (cut) {
            return `the live fetch of ${url} at submission failed (${failed}). A network cut says nothing about the quote or the page: submit again in a minute, and do not mark the source unreachable for it.`;
          }
          return `the live fetch of ${url} at submission failed (${failed ?? 'not fetched'}), and a quote counts only when it is on the live page. Fetch the page again to see whether it loads; if it cannot be read, mark the source unreachable with the reason and judge the unit without it.`;
        },
        textNote: (url) => {
          const comparison = comparisons.get(normalizeUrl(url));
          return comparison && !comparison.same
            ? `The live page is not the text you read: ${comparison.description}. If the quote is in your reading copy, the live fetch returned something else; submit again, or fetch with --refresh to see what the page returns now.`
            : undefined;
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
    return {
      url,
      fetchedAt,
      characters: page ? page.text.length : null,
      sha256: page ? sha256(page.text) : null,
      error: error ?? null,
    };
  });
  const passed = [...new Set([...session.passed, ...savedIds])];
  const due = session.units.filter((unit) => !passed.includes(unit.id));

  if (options.dryRun) {
    deps.out('Dry run: nothing is saved or recorded.');
    if (parsed.success) {
      const checkedIds = new Set(checked.map((unit) => unit.id));
      for (const line of quoteLengthLines(parsed.data.verdicts, checkedIds)) deps.out(line);
    }
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
        : `  Fetched live to verify quotes: ${entry.url} (${comparisons.get(normalizeUrl(entry.url))!.description})`,
    );
  }
  const statuses = checked
    .filter((unit) => checks[unit.key])
    .map((unit) => ({ unit, check: checks[unit.key] }));
  // One line that says how many units passed and how many failed, so a count of saved verdicts
  // is never read as the whole submission.
  const failing = checked.length - savedIds.length;
  const passing = options.dryRun
    ? `${savedIds.length} would pass and be saved`
    : `${savedIds.length} passed and ${savedIds.length === 1 ? 'is' : 'are'} saved`;
  const counts = savedIds.length
    ? ` to ${session.claimsDir} (${formatCounts(countVerdicts(statuses)).replace(/, 0 not checked$/, '')})`
    : '';
  deps.out(
    `Units checked: ${checked.length}. ${passing}${counts}; ${failing} ${options.dryRun ? (failing === 1 ? 'fails' : 'fail') : 'failed'}${failing ? ' and ' + (failing === 1 ? 'is' : 'are') + ' listed below' : ''}.`,
  );
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
  for (const failure of session.failedFetches) deps.out(`  ${describeFailedFetch(failure)}`);
  if (!last) {
    deps.out('Submissions: none yet.');
    return;
  }
  const failedLive = last.liveFetches.filter((entry) => entry.error);
  deps.out(
    `Submissions: ${session.submissions.length}; the last saved ${plural(last.saved.length, 'unit')} and had ${plural(last.issues.length, 'problem')}, with ${plural(last.liveFetches.length, 'live fetch', 'live fetches')}${failedLive.length ? ` (${failedLive.length} failed)` : ''}.`,
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
