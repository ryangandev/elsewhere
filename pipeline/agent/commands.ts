// The commands a drafting subagent runs through `npm run content:agent`. The subagent researches
// and writes; these commands own every guarantee: what counts as evidence, every content check,
// and the only write into the content tree. Each command prints for the subagent to read and
// returns an exit code.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPendingReferences } from '../../src/content/validate';
import { CURRENT_AGENT_PROMPT_VERSION, loadAgentPrompts } from '../prompts';
import { STORIES_PER_COUNTRY } from '../config';
import {
  countryFilePath,
  landIndex,
  parsedCountryFiles,
  readCountryFile,
  requireMapCountry,
  writeCountryFile,
} from '../content-tree';
import type { Plan } from '../generate/check';
import { findPlaces } from '../generate/gazetteer-context';
import { allPlans } from '../generate/plan';
import { replaceConflict } from '../generate/replace';
import { renderLinkTargets, submitCountryDraft } from '../generate/tasks';
import { AGENT_EVIDENCE_RULE, renderBrief, renderRepair, type AgentContext } from './brief';
import { notTheRequestedPage } from './page-check';
import {
  describeRecord,
  fetchFailure,
  fetchForReading,
  printChunk,
  printLinks,
  printMatches,
} from './reading';
import {
  DEFAULT_SESSIONS_DIR,
  briefFile,
  draftFile,
  evidenceIntact,
  findEvidence,
  hasSession,
  loadEvidence,
  readSession,
  saveEvidence,
  sessionDir,
  submissionsDir,
  writeSession,
} from './session';

export { CHUNK_CHARACTERS } from './reading';

export type AgentDeps = {
  /** Where sessions live (default pipeline/.cache/agent). */
  root?: string;
  /** Planned stories (default every plan in pipeline/batches). */
  plan?: Plan;
  /** Page fetches; tests pass a stub. */
  fetch?: typeof fetch;
  now?: () => Date;
  out: (line: string) => void;
};

const number = (value: number) => value.toLocaleString('en-US');
const command = (args: string) => `npm run content:agent -- ${args}`;

function context(deps: AgentDeps) {
  return {
    root: deps.root ?? DEFAULT_SESSIONS_DIR,
    now: () => (deps.now ?? (() => new Date()))().toISOString(),
    plan: () => deps.plan ?? allPlans(),
  };
}

function conflictMessage(
  conflict: 'reviewed' | 'draft',
  contentDir: string,
  country: { id: string; slug: string },
): string {
  const file = countryFilePath(contentDir, country.slug);
  return conflict === 'reviewed'
    ? `${file} contains reviewed content, which agent drafting never replaces; send it back with content:review revise first.`
    : `${file} is a draft nobody sent back. To replace it, start again with: ${command(`start ${country.id} --fresh --regenerate`)}`;
}

export type StartOptions = {
  countryId: string;
  contentDir: string;
  model: string;
  date: string;
  regenerate: boolean;
  /** Discard an existing session instead of continuing it. */
  fresh: boolean;
};

/**
 * Create or continue a session and write its brief. Continuing keeps the evidence and
 * submissions of an unfinished session and rewrites the brief with the current tree and plan.
 */
export function start(options: StartOptions, deps: AgentDeps): number {
  const { root, now, plan: loadPlan } = context(deps);
  const country = requireMapCountry(options.countryId);
  const dir = sessionDir(root, country.id);
  const existing = readCountryFile(options.contentDir, country.slug);
  const conflict = replaceConflict(existing, { regenerate: options.regenerate, force: false });
  if (conflict) {
    deps.out(conflictMessage(conflict, options.contentDir, country));
    return 1;
  }
  if (options.fresh) rmSync(dir, { recursive: true, force: true });
  const previous = hasSession(dir) ? readSession(dir, country.id) : undefined;
  if (previous?.written) {
    deps.out(
      `${country.name} was already written to ${previous.written.file} by this session. Pass --fresh to discard the session and draft again.`,
    );
    return 1;
  }

  const plan = loadPlan();
  const agentContext: AgentContext = {
    contentDir: options.contentDir,
    prompts: loadAgentPrompts(),
    date: options.date,
    plan,
    linkTargets: renderLinkTargets(options.contentDir, plan),
    storyCount: STORIES_PER_COUNTRY,
  };
  const brief = renderBrief(agentContext, country.id, existing, draftFile(dir));
  writeSession(dir, {
    countryId: country.id,
    contentDir: options.contentDir,
    model: options.model,
    promptVersion: CURRENT_AGENT_PROMPT_VERSION,
    date: options.date,
    regenerate: options.regenerate,
    startedAt: previous?.startedAt ?? now(),
    submissions: previous?.submissions ?? [],
    failedFetches: previous?.failedFetches ?? [],
  });
  writeFileSync(briefFile(dir), brief);

  const kept = previous
    ? ` Kept ${loadEvidence(dir).records.length} fetched pages and ${previous.submissions.length} submissions from the unfinished session.`
    : '';
  deps.out(`Agent session for ${country.name} (${country.id}) in ${dir}.${kept}`);
  deps.out(
    `Read the whole brief before you research: ${briefFile(dir)} (${number(brief.trimEnd().split('\n').length)} lines; read all of it, in parts).`,
  );
  deps.out(`Write the draft to ${draftFile(dir)}, then run: ${command(`submit ${country.id}`)}`);
  return 0;
}

export type FetchOptions = {
  countryId: string;
  url: string;
  /** First character to print. */
  offset: number;
  /** Instead of a chunk, list where these words appear. */
  find?: string;
  /** Instead of the text, list the page's links; `offset` then counts links. */
  links?: boolean;
  /** Fetch again even when the page is stored. */
  refresh: boolean;
};

function notRequestedWarning(reason: string): string {
  return `WARNING: this is probably not the page you asked for: ${reason}. A source that cites it is rejected at submit. Look for the real page (--links on a page that links to it may find it) or choose another source.`;
}

/**
 * Fetch a page on this computer, store it as evidence and print part of it, or read the stored
 * copy. A page that cannot be read stores nothing.
 */
export async function fetchCommand(options: FetchOptions, deps: AgentDeps): Promise<number> {
  const { root, now } = context(deps);
  const countryId = requireMapCountry(options.countryId).id;
  const dir = sessionDir(root, countryId);
  const session = readSession(dir, countryId);
  if (options.links && options.find) {
    deps.out('--links and --find cannot be combined; use one at a time.');
    return 1;
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(options.url);
  } catch {
    deps.out(`"${options.url}" is not a URL.`);
    return 1;
  }
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    deps.out(`Only http and https pages can be fetched, not ${parsedUrl.protocol}`);
    return 1;
  }

  let stored = options.refresh ? undefined : findEvidence(dir, options.url);
  if (stored && !evidenceIntact(stored.record)) {
    deps.out(
      `The stored copy in ${stored.file} no longer matches what was fetched. Fetch it again with --refresh.`,
    );
    return 1;
  }
  if (stored) {
    deps.out(`${options.url} (stored copy in ${stored.file})`);
  } else {
    try {
      stored = saveEvidence(dir, await fetchForReading(options.url, deps.fetch), now());
    } catch (error) {
      const reason = fetchFailure(error);
      session.failedFetches.push({ url: options.url, attemptedAt: now(), reason });
      writeSession(dir, session);
      deps.out(
        `Could not read ${options.url}: ${reason}. Nothing was stored, so it cannot be cited; choose another source.`,
      );
      return 1;
    }
    deps.out(`${options.url} (stored in ${stored.file})`);
  }
  const { record } = stored;
  deps.out(describeRecord(record));
  const notRequested = notTheRequestedPage(record);
  if (record.finalUrl !== record.requestedUrl) {
    deps.out(
      notRequested
        ? `Redirected to ${record.finalUrl}.`
        : `Redirected to ${record.finalUrl}; either URL may be cited.`,
    );
  }
  if (notRequested) deps.out(notRequestedWarning(notRequested));
  const read = (offset: number | string, links = false) =>
    command(
      `fetch ${options.countryId} "${options.url}"${links ? ' --links' : ''} --offset ${offset}`,
    );
  if (options.links) {
    return printLinks(record, options.offset, (offset) => read(offset, true), deps.out);
  }
  return options.find
    ? printMatches(record, options.find, read('<n>'), deps.out)
    : printChunk(record, options.offset, read, deps.out);
}

export type PlacesOptions = {
  countryId: string;
  /** Names to search for; with several, each result is headed by its query. */
  queries: string[];
  country?: string;
  near?: string;
};

export function places(options: PlacesOptions, deps: AgentDeps): number {
  requireMapCountry(options.countryId);
  for (const query of options.queries.length ? options.queries : [null]) {
    if (options.queries.length > 1) deps.out(`## ${query}`);
    deps.out(findPlaces({ query, countryId: options.country ?? null, near: options.near ?? null }));
  }
  return 0;
}

export type SubmitOptions = {
  countryId: string;
  /** Default: draft.json in the session directory. */
  file?: string;
  /** Run every check and print the result, but record and write nothing. */
  dryRun?: boolean;
};

/**
 * Check a draft with every rule the API path applies, with only fetched pages as evidence, and
 * write the country file when it passes. Every submission is kept in the session. A dry run
 * does the same checks and changes nothing, so it never finishes the session.
 */
export function submit(options: SubmitOptions, deps: AgentDeps): number {
  const { root, now, plan } = context(deps);
  const country = requireMapCountry(options.countryId);
  const dir = sessionDir(root, country.id);
  const session = readSession(dir, country.id);
  if (session.written) {
    deps.out(`This session already wrote ${session.written.file}.`);
    return 1;
  }
  const existing = readCountryFile(session.contentDir, country.slug);
  const conflict = replaceConflict(existing, { regenerate: session.regenerate, force: false });
  if (conflict) {
    deps.out(conflictMessage(conflict, session.contentDir, country));
    return 1;
  }

  const file = options.file ?? draftFile(dir);
  if (!existsSync(file)) {
    deps.out(`No draft at ${file}. Write it there first.`);
    return 1;
  }
  const raw = readFileSync(file, 'utf8');
  const ordinal = session.submissions.length + 1;
  const kept = join(submissionsDir(dir), `${ordinal}.json`);
  if (!options.dryRun) {
    mkdirSync(submissionsDir(dir), { recursive: true });
    writeFileSync(kept, raw);
  }

  const { records, problems } = loadEvidence(dir);
  const evidence = new Set<string>();
  const unusableEvidence = new Map<string, string>();
  for (const { record } of records) {
    const notRequested = notTheRequestedPage(record);
    for (const url of record.normalizedUrls) {
      if (notRequested) unusableEvidence.set(url, notRequested);
      else evidence.add(url);
    }
  }
  const prompts = loadAgentPrompts(session.promptVersion);
  const issues = [...problems];
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    issues.push(`The draft is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  const submission =
    input === undefined
      ? undefined
      : submitCountryDraft(
          {
            contentDir: session.contentDir,
            prompts,
            date: session.date,
            plan: plan(),
            linkTargets: '',
            storyCount: STORIES_PER_COUNTRY,
            land: landIndex(),
          },
          country.id,
          input,
          { model: session.model, evidence, evidenceRule: AGENT_EVIDENCE_RULE, unusableEvidence },
        );
  if (submission && !submission.ok) issues.push(...submission.issues);

  if (!options.dryRun) {
    session.submissions.push({ file: kept, submittedAt: now(), issues });
  }
  if (issues.length || !submission?.ok) {
    if (options.dryRun) {
      deps.out(`Dry run: the draft has ${issues.length} problems. Nothing was recorded.`);
    } else {
      writeSession(dir, session);
      deps.out(`Submission ${ordinal} (kept in ${kept}) has ${issues.length} problems.`);
    }
    deps.out(renderRepair(prompts, issues, file));
    return 1;
  }

  const { stories } = submission.file;
  const sources = new Set(
    [submission.file.country, ...stories].flatMap((entry) =>
      entry.sources.map((source) => source.url),
    ),
  );
  // The tree as it is or would be after the write, so a dry run reports the same references.
  const files = parsedCountryFiles(session.contentDir);
  files.set(country.id, submission.file);
  const pending = findPendingReferences([...files.values()]).filter(
    (ref) => ref.from.countryId === country.id,
  );
  if (options.dryRun) {
    deps.out(
      `Dry run: the draft would pass. Nothing was written; run ${command(`submit ${country.id}`)} to submit it.`,
    );
  } else {
    const written = writeCountryFile(session.contentDir, submission.file);
    session.written = { file: written, writtenAt: now() };
    writeSession(dir, session);
    deps.out(
      `Submission ${ordinal} passed. Wrote ${written} (draft, ${session.promptVersion}, ${session.model}).`,
    );
  }
  deps.out(
    `${stories.length} stories, ${sources.size} sources, ${pending.length} pending references${pending.length ? ':' : '.'}`,
  );
  for (const ref of pending) {
    deps.out(
      `  ${ref.from.countryId}/${ref.from.storyId} -> ${ref.to.countryId}/${ref.to.storyId}`,
    );
  }
  if (!options.dryRun) {
    deps.out(
      `Next, for the editor: npm run content:verify, npm run content:claims -- ${country.id}, then npm run content:review -- show ${country.id}.`,
    );
  }
  return 0;
}

export function status(options: { countryId: string }, deps: AgentDeps): number {
  const { root } = context(deps);
  const country = requireMapCountry(options.countryId);
  const dir = sessionDir(root, country.id);
  const session = readSession(dir, country.id);
  const { records, problems } = loadEvidence(dir);
  deps.out(`Agent session for ${country.name} (${country.id}) in ${dir}`);
  deps.out(
    `Content ${session.contentDir}, model ${session.model}, prompts ${session.promptVersion}, date ${session.date}${session.regenerate ? ', replaces the existing draft' : ''}.`,
  );
  deps.out(`Brief: ${briefFile(dir)}`);
  deps.out(`Fetched pages: ${records.length}`);
  for (const { record } of records) {
    const notRequested = notTheRequestedPage(record);
    deps.out(
      `  ${record.requestedUrl} (${describeRecord(record)})${notRequested ? ` - NOT CITABLE, probably not the page asked for: ${notRequested}` : ''}`,
    );
  }
  for (const problem of problems) deps.out(`  Unusable: ${problem}`);
  deps.out(`Failed fetches: ${session.failedFetches.length || 'none'}`);
  for (const { url, attemptedAt, reason } of session.failedFetches) {
    deps.out(`  ${url} (${attemptedAt}): ${reason}`);
  }
  const last = session.submissions.at(-1);
  deps.out(
    last
      ? `Submissions: ${session.submissions.length}; the last had ${last.issues.length} problems.`
      : 'Submissions: none yet.',
  );
  deps.out(
    session.written
      ? `Written to ${session.written.file} at ${session.written.writtenAt}.`
      : 'Not written yet.',
  );
  return 0;
}
