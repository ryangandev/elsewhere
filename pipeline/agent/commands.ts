// The commands a drafting subagent runs through `npm run content:agent`. The subagent researches
// and writes; these commands own every guarantee: what counts as evidence, every content check,
// and the only write into the content tree. Each command prints for the subagent to read and
// returns an exit code.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPendingReferences } from '../../src/content/validate';
import { fetchPage } from '../claims/local-fetch';
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
import { replaceConflict } from '../generate/run';
import { renderLinkTargets, submitCountryDraft } from '../generate/tasks';
import { AGENT_EVIDENCE_RULE, renderBrief, renderRepair, type AgentContext } from './brief';
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
  type EvidenceRecord,
} from './session';

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

/**
 * Characters printed per fetch: about 5k tokens, under the 30,000 characters Claude Code shows
 * of a command's output, with room for the header.
 */
export const CHUNK_CHARACTERS = 20_000;
/** Pages are stored up to this length and read in chunks; a long statistics PDF fits. */
const MAX_EVIDENCE_CHARACTERS = 2_000_000;
const MAX_FETCH_BYTES = 40_000_000;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_FIND_MATCHES = 20;

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
  /** Fetch again even when the page is stored. */
  refresh: boolean;
};

function describeRecord(record: EvidenceRecord): string {
  return [
    `HTTP ${record.status}`,
    record.contentType || 'unknown type',
    `${number(record.characters)} characters${record.truncated ? ` (cut off at ${number(MAX_EVIDENCE_CHARACTERS)})` : ''}`,
    `fetched ${record.fetchedAt}`,
  ].join(', ');
}

function printChunk(record: EvidenceRecord, options: FetchOptions, deps: AgentDeps): number {
  const { text } = record;
  if (options.offset < 0 || (options.offset > 0 && options.offset >= text.length)) {
    deps.out(`--offset must be between 0 and ${number(Math.max(0, text.length - 1))}.`);
    return 1;
  }
  const end = Math.min(text.length, options.offset + CHUNK_CHARACTERS);
  const next =
    end < text.length
      ? ` Next part: ${command(`fetch ${options.countryId} "${options.url}" --offset ${end}`)}`
      : ' This is the end of the text.';
  deps.out(
    `Characters ${number(options.offset)} to ${number(end)} of ${number(text.length)}.${next}`,
  );
  deps.out('-----');
  deps.out(text.slice(options.offset, end));
  deps.out('-----');
  return 0;
}

function printMatches(record: EvidenceRecord, options: FetchOptions, deps: AgentDeps): number {
  const needle = options.find!.toLowerCase();
  const haystack = record.text.toLowerCase();
  const offsets: number[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1 && offsets.length <= MAX_FIND_MATCHES) {
    offsets.push(index);
    index = haystack.indexOf(needle, index + needle.length);
  }
  if (!offsets.length) {
    deps.out(`"${options.find}" does not appear in the text. Try another word or spelling.`);
    return 0;
  }
  const shown = offsets.slice(0, MAX_FIND_MATCHES);
  deps.out(
    offsets.length > shown.length
      ? `"${options.find}" appears more than ${shown.length} times; the first ${shown.length}:`
      : `"${options.find}" appears ${shown.length} ${shown.length === 1 ? 'time' : 'times'}:`,
  );
  for (const offset of shown) {
    const around = record.text
      .slice(Math.max(0, offset - 150), offset + needle.length + 150)
      .replace(/\s+/g, ' ');
    deps.out(`- offset ${offset}: ...${around}...`);
  }
  deps.out(
    `Read around a match with ${command(`fetch ${options.countryId} "${options.url}" --offset <n>`)}`,
  );
  return 0;
}

/**
 * Fetch a page on this computer, store it as evidence and print part of it, or read the stored
 * copy. A page that cannot be read stores nothing.
 */
export async function fetchCommand(options: FetchOptions, deps: AgentDeps): Promise<number> {
  const { root, now } = context(deps);
  const countryId = requireMapCountry(options.countryId).id;
  const dir = sessionDir(root, countryId);
  readSession(dir, countryId);
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
      const page = await fetchPage(options.url, {
        pdf: true,
        maxCharacters: MAX_EVIDENCE_CHARACTERS,
        maxBytes: MAX_FETCH_BYTES,
        timeoutMs: FETCH_TIMEOUT_MS,
        fetch: deps.fetch,
      });
      stored = saveEvidence(dir, page, now());
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `no answer within ${FETCH_TIMEOUT_MS / 1000} seconds`
          : error instanceof Error
            ? error.message
            : String(error);
      deps.out(
        `Could not read ${options.url}: ${reason}. Nothing was stored, so it cannot be cited; choose another source.`,
      );
      return 1;
    }
    deps.out(`${options.url} (stored in ${stored.file})`);
  }
  const { record } = stored;
  deps.out(describeRecord(record));
  if (record.finalUrl !== record.requestedUrl) {
    deps.out(`Redirected to ${record.finalUrl}; either URL may be cited.`);
  }
  return options.find ? printMatches(record, options, deps) : printChunk(record, options, deps);
}

export type PlacesOptions = {
  countryId: string;
  query?: string;
  country?: string;
  near?: string;
};

export function places(options: PlacesOptions, deps: AgentDeps): number {
  requireMapCountry(options.countryId);
  deps.out(
    findPlaces({
      query: options.query ?? null,
      countryId: options.country ?? null,
      near: options.near ?? null,
    }),
  );
  return 0;
}

export type SubmitOptions = {
  countryId: string;
  /** Default: draft.json in the session directory. */
  file?: string;
};

/**
 * Check a draft with every rule the API path applies, with only fetched pages as evidence, and
 * write the country file when it passes. Every submission is kept in the session.
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
  mkdirSync(submissionsDir(dir), { recursive: true });
  writeFileSync(kept, raw);

  const { records, problems } = loadEvidence(dir);
  const evidence = new Set(records.flatMap(({ record }) => record.normalizedUrls));
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
          { model: session.model, evidence, evidenceRule: AGENT_EVIDENCE_RULE },
        );
  if (submission && !submission.ok) issues.push(...submission.issues);

  session.submissions.push({ file: kept, submittedAt: now(), issues });
  if (issues.length || !submission?.ok) {
    writeSession(dir, session);
    deps.out(`Submission ${ordinal} (kept in ${kept}) has ${issues.length} problems.`);
    deps.out(renderRepair(prompts, issues, file));
    return 1;
  }

  const written = writeCountryFile(session.contentDir, submission.file);
  session.written = { file: written, writtenAt: now() };
  writeSession(dir, session);
  const { stories } = submission.file;
  const sources = new Set(
    [submission.file.country, ...stories].flatMap((entry) =>
      entry.sources.map((source) => source.url),
    ),
  );
  const pending = findPendingReferences([
    ...parsedCountryFiles(session.contentDir).values(),
  ]).filter((ref) => ref.from.countryId === country.id);
  deps.out(
    `Submission ${ordinal} passed. Wrote ${written} (draft, ${session.promptVersion}, ${session.model}).`,
  );
  deps.out(
    `${stories.length} stories, ${sources.size} sources, ${pending.length} pending references${pending.length ? ':' : '.'}`,
  );
  for (const ref of pending) {
    deps.out(
      `  ${ref.from.countryId}/${ref.from.storyId} -> ${ref.to.countryId}/${ref.to.storyId}`,
    );
  }
  deps.out(
    `Next, for the editor: npm run content:verify, npm run content:claims -- ${country.id}, then npm run content:review -- show ${country.id}.`,
  );
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
    deps.out(`  ${record.requestedUrl} (${describeRecord(record)})`);
  }
  for (const problem of problems) deps.out(`  Unusable: ${problem}`);
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
