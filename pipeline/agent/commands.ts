// The commands a drafting subagent runs through `npm run content:agent`. The subagent researches
// and writes; these commands own every guarantee: what counts as evidence, every content check,
// and the only write into the content tree. Each command prints for the subagent to read and
// returns an exit code. A session drafts a whole country, or in a revision session redrafts what
// review sent back (the overview, stories or both); fetch, places, submit and status work the same
// way in both.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { CountryFile } from '../../src/content/schema';
import { findPendingReferences } from '../../src/content/validate';
import {
  CURRENT_AGENT_PROMPT_VERSION,
  MIN_AGENT_REVISION_PROMPT_VERSION,
  promptVersionNumber,
  loadAgentPrompts,
  loadAgentRevisionPrompts,
} from '../prompts';
import { defaultClaimsDir } from '../claims/store';
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
import { normalizeUrl } from '../generate/evidence';
import { allPlans } from '../generate/plan';
import { overviewRevision, replaceConflict, wholeCountryRevision } from '../generate/replace';
import { CountryRevisionsDraft, StoryRevisionsDraft } from '../generate/draft-schema';
import {
  checkRevisions,
  renderLinkTargets,
  submitCountryDraft,
  zodIssues,
  type DraftingContext,
  type RevisionCheckOptions,
  type SentBack,
} from '../generate/tasks';
import {
  AGENT_EVIDENCE_RULE,
  initialRevisionDraft,
  renderBrief,
  renderRepair,
  renderRevisionBrief,
  type AgentContext,
} from './brief';
import { notTheRequestedPage, redirectKind } from './page-check';
import {
  describeRecord,
  fetchFailure,
  fetchForReading,
  findMatches,
  printPart,
  shellQuote,
  unreadableWarning,
} from './reading';
import {
  DEFAULT_SESSIONS_DIR,
  archiveSession,
  briefFile,
  describeFailedFetch,
  draftFile,
  evidenceIntact,
  findEvidence,
  hasSession,
  loadEvidence,
  readSession,
  recordFailedFetch,
  saveEvidence,
  sessionDir,
  submissionsDir,
  writeSession,
  type AgentSession,
  type EvidenceRecord,
} from './session';

export { CHUNK_CHARACTERS } from './reading';

export type AgentDeps = {
  /** Where sessions live (default pipeline/.cache/agent). */
  root?: string;
  /** Planned stories (default every plan in pipeline/batches). */
  plan?: Plan;
  /** Page fetches; tests pass a stub. */
  fetch?: typeof fetch;
  /** Waits between fetch attempts after a server error; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  out: (line: string) => void;
};

const number = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, noun: string) => `${number(count)} ${noun}${count === 1 ? '' : 's'}`;
const command = (args: string) => `npm run content:agent -- ${args}`;

/** What continuing an unfinished session kept, for the start command's first line. */
function keptText(dir: string, previous: AgentSession | undefined): string {
  if (!previous) return '';
  const pages = loadEvidence(dir).records.length;
  const submissions = previous.submissions.length;
  return pages || submissions
    ? ` Kept ${plural(pages, 'fetched page')} and ${plural(submissions, 'submission')} from the unfinished session.`
    : ' Continued the unfinished session, which had not fetched or submitted anything yet.';
}

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
  existing: CountryFile | undefined,
): string {
  const file = countryFilePath(contentDir, country.slug);
  // Review may have sent back the overview or stories, which a revision session redrafts in place.
  const sentBack: SentBack = {
    overview: existing !== undefined && overviewRevision(existing) !== undefined,
    storyIds: (existing?.stories ?? []).flatMap((story) =>
      story.provenance.revision ? [story.id] : [],
    ),
  };
  const { storyIds } = sentBack;
  const stories = storyIds.length
    ? `the ${storyIds.length === 1 ? 'story' : 'stories'} ${quoted(storyIds)}`
    : '';
  const parts = sentBack.overview
    ? stories
      ? `the overview and ${stories}`
      : 'the overview'
    : stories;
  const count = storyIds.length + (sentBack.overview ? 1 : 0);
  const revise = parts
    ? `Review sent back ${parts}, not the whole country; redraft ${count === 1 ? 'it' : 'them'} in place with: ${command(`start ${country.id} --revisions`)}`
    : undefined;
  if (conflict === 'reviewed') {
    return `${file} contains reviewed content, or content reopened after review, which agent drafting never replaces. ${revise ?? `To redraft a reviewed part, reopen it first with npm run content:review -- reopen ${country.id} <story> --notes "..." (or --overview, or --all for the overview and every story), then redraft it in place with: ${command(`start ${country.id} --revisions`)}`}`;
  }
  return revise
    ? `${file} is a draft. ${revise}`
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
  /** Redraft what review sent back (the overview, stories) instead of the whole country. */
  revisions?: boolean;
};

const quoted = (ids: string[]) => ids.map((id) => `"${id}"`).join(', ');

/**
 * Create or continue a session and write its brief. Continuing keeps the evidence, submissions
 * and prompt version of an unfinished session and rewrites the brief with the current tree and
 * plan. With `revisions`, the session redrafts the stories review sent back.
 */
export function start(options: StartOptions, deps: AgentDeps): number {
  if (options.revisions) return startRevisions(options, deps);
  const { root, now, plan: loadPlan } = context(deps);
  const country = requireMapCountry(options.countryId);
  const dir = sessionDir(root, country.id);
  const existing = readCountryFile(options.contentDir, country.slug);
  const conflict = replaceConflict(existing, { regenerate: options.regenerate, force: false });
  if (conflict) {
    deps.out(conflictMessage(conflict, options.contentDir, country, existing));
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
  if (previous?.revisions) {
    deps.out(
      `An unfinished revision session for ${country.name} is in ${dir}. Finish it with ${command(`submit ${country.id}`)}, or pass --fresh to discard it.`,
    );
    return 1;
  }

  const plan = loadPlan();
  const promptVersion = previous?.promptVersion ?? CURRENT_AGENT_PROMPT_VERSION;
  const agentContext: AgentContext = {
    contentDir: options.contentDir,
    prompts: loadAgentPrompts(promptVersion),
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
    promptVersion,
    date: options.date,
    regenerate: options.regenerate,
    startedAt: previous?.startedAt ?? now(),
    submissions: previous?.submissions ?? [],
    failedFetches: previous?.failedFetches ?? [],
  });
  writeFileSync(briefFile(dir), brief);

  deps.out(
    `Agent session for ${country.name} (${country.id}) in ${dir}.${keptText(dir, previous)}`,
  );
  deps.out(
    `Read the whole brief before you research: ${briefFile(dir)} (${number(brief.trimEnd().split('\n').length)} lines; read all of it, in parts).`,
  );
  deps.out(`Write the draft to ${draftFile(dir)}, then run: ${command(`submit ${country.id}`)}`);
  return 0;
}

/**
 * Why a country file cannot be revised in an agent session, or undefined. The overview and single
 * stories are revised this way; a whole country sent back is drafted again with `start`.
 */
function revisionRefusal(
  existing: CountryFile,
  country: { id: string; name: string },
): string | undefined {
  if (wholeCountryRevision(existing)) {
    return `The whole of ${country.name} was sent back. Draft it again with: ${command(`start ${country.id}`)}`;
  }
  if (!overviewRevision(existing) && !existing.stories.some((story) => story.provenance.revision)) {
    return `Nothing in ${country.name} is sent back for revision. Send the overview back with npm run content:review -- revise ${country.id} --overview --notes "...", or a story with npm run content:review -- revise ${country.id} <story> --notes "..."; reviewed content is reopened with npm run content:review -- reopen ${country.id} <story> --notes "..." (or --overview, or --all).`;
  }
  return undefined;
}

/** What a revision session revises, from what it recorded when it started. */
const sessionSentBack = (session: AgentSession): SentBack => ({
  overview: session.overviewRevision !== undefined,
  storyIds: (session.revisions ?? []).map((revision) => revision.storyId),
});

/** "the overview and "a", "b"" for a session's messages. */
function revisedText({ overview, storyIds }: SentBack): string {
  const stories = storyIds.length ? quoted(storyIds) : '';
  if (!overview) return stories;
  return stories ? `the overview and ${stories}` : 'the overview';
}

/**
 * Create or continue a revision session for everything in a country that review sent back: the
 * overview (the country part) and every story, all redrafted and written together. A finished
 * session in the country's directory moves to finished/ first; an unfinished drafting session
 * stays, and the revision waits until it is finished or discarded with --fresh. A new session
 * starts draft.json with the parts as drafted, in the submission's shape; an existing draft.json is
 * the subagent's work and is kept.
 */
function startRevisions(options: StartOptions, deps: AgentDeps): number {
  const { root, now, plan: loadPlan } = context(deps);
  const country = requireMapCountry(options.countryId);
  const dir = sessionDir(root, country.id);
  if (options.regenerate) {
    deps.out(
      '--regenerate is for drafting a whole country again; a revision keeps the rest of the file, so leave it out.',
    );
    return 1;
  }
  const existing = readCountryFile(options.contentDir, country.slug);
  if (!existing) {
    deps.out(
      `${countryFilePath(options.contentDir, country.slug)} does not exist, so nothing in ${country.name} is sent back.`,
    );
    return 1;
  }
  const refusal = revisionRefusal(existing, country);
  if (refusal) {
    deps.out(refusal);
    return 1;
  }
  if (options.fresh) rmSync(dir, { recursive: true, force: true });
  let previous = hasSession(dir) ? readSession(dir, country.id) : undefined;
  if (previous && !previous.written && !previous.revisions) {
    deps.out(
      `An unfinished drafting session for ${country.name} is in ${dir}. Finish it, or pass --fresh to discard it and start the revision.`,
    );
    return 1;
  }
  if (previous?.written) {
    deps.out(`Moved the finished session to ${archiveSession(root, previous)}.`);
    previous = undefined;
  }
  if (
    previous &&
    promptVersionNumber(previous.promptVersion) <
      promptVersionNumber(MIN_AGENT_REVISION_PROMPT_VERSION)
  ) {
    deps.out(
      `The unfinished revision session for ${country.name} in ${dir} started on the ${previous.promptVersion} prompts, and its brief can no longer be rebuilt as that version wrote it: it would show the parts and describe the fetch command as ${MIN_AGENT_REVISION_PROMPT_VERSION} does. Discard it and start again with: ${command(`start ${country.id} --revisions --fresh`)}`,
    );
    return 1;
  }

  const revisions = existing.stories.flatMap((story) =>
    story.provenance.revision ? [{ storyId: story.id, request: story.provenance.revision }] : [],
  );
  const overviewRequest = overviewRevision(existing);
  const sentBack: SentBack = {
    overview: overviewRequest !== undefined,
    storyIds: revisions.map((revision) => revision.storyId),
  };
  const plan = loadPlan();
  const promptVersion = previous?.promptVersion ?? CURRENT_AGENT_PROMPT_VERSION;
  const brief = renderRevisionBrief(
    {
      contentDir: options.contentDir,
      prompts: loadAgentRevisionPrompts(promptVersion, { overview: sentBack.overview }),
      date: options.date,
      plan,
      linkTargets: renderLinkTargets(options.contentDir, plan),
      storyCount: STORIES_PER_COUNTRY,
    },
    existing,
    sentBack,
    draftFile(dir),
    defaultClaimsDir(options.contentDir),
  );
  writeSession(dir, {
    countryId: country.id,
    contentDir: options.contentDir,
    model: options.model,
    promptVersion,
    date: options.date,
    regenerate: false,
    startedAt: previous?.startedAt ?? now(),
    submissions: previous?.submissions ?? [],
    failedFetches: previous?.failedFetches ?? [],
    revisions,
    ...(overviewRequest ? { overviewRevision: overviewRequest } : {}),
  });
  writeFileSync(briefFile(dir), brief);
  const draft = draftFile(dir);
  const startedDraft = !existsSync(draft);
  if (startedDraft) {
    writeFileSync(draft, `${JSON.stringify(initialRevisionDraft(existing, sentBack), null, 2)}\n`);
  }

  deps.out(
    `Agent revision session for ${country.name} (${country.id}) in ${dir}, revising ${revisedText(sentBack)}.${keptText(dir, previous)}`,
  );
  deps.out(
    `Read the whole brief before you research: ${briefFile(dir)} (${number(brief.trimEnd().split('\n').length)} lines; read all of it, in parts).`,
  );
  deps.out(
    startedDraft
      ? `${draft} holds the parts sent back as drafted, in the submission's shape. Revise them there, then run: ${command(`submit ${country.id}`)}`
      : `${draft} already exists and is kept as it is. Revise it there, then run: ${command(`submit ${country.id}`)}`,
  );
  return 0;
}

export type FetchOptions = {
  countryId: string;
  url: string;
  /**
   * First character to print, or with `find` to look from. Without it the print starts at the
   * page's main text when the page marks one, and a search looks from the start.
   */
  offset?: number;
  /** Instead of a chunk, list where each of these words appears. */
  find?: string[];
  /** With `find`, places listed per term (default DEFAULT_FIND_MATCHES). */
  matches?: number;
  /** Instead of the text, list the page's links; `offset` then counts links. */
  links?: boolean;
  /** Fetch again even when the page is stored. */
  refresh: boolean;
};

function notRequestedWarning(reason: string): string {
  return `WARNING: this is probably not the page you asked for: ${reason}. A source that cites it is rejected at submit. Look for the real page (--links on a page that links to it may find it) or choose another source.`;
}

/**
 * What a redirect means for the URL to cite, printed when the page is fetched (not again for each
 * read of the stored copy), or undefined without a redirect. A page that is not the one requested
 * gets its warning instead, every time.
 */
export function redirectNote(record: EvidenceRecord): string | undefined {
  if (record.finalUrl === record.requestedUrl) return undefined;
  if (notTheRequestedPage(record)) return `Redirected to ${record.finalUrl}.`;
  switch (redirectKind(record)) {
    case 'file':
      return `Redirected to ${record.finalUrl}, the file the link downloads. Cite the file's URL, ${record.finalUrl}: a download link may change or lead somewhere else later.`;
    case 'unrelated':
      return `WARNING: redirected to ${record.finalUrl}, whose address shares no word with the one asked for, so it may be an error, search or index page. Read it before you cite it; if it is the page you wanted, cite ${record.finalUrl}.`;
    default:
      return `Redirected to ${record.finalUrl}; either URL may be cited.`;
  }
}

/** The note for a page asked for over http, since sources are cited by their https URL. */
export function httpNote(url: URL): string | undefined {
  if (url.protocol !== 'http:') return undefined;
  const https = new URL(url.href);
  https.protocol = 'https:';
  return `Sources are cited by https URL only, and http and https count as the same page. Before you cite ${https.href}, fetch it with --refresh to check that it loads over https.`;
}

/**
 * Fetch a page on this computer, store it as evidence and print part of it, or read the stored
 * copy. A page that cannot be read stores nothing; a URL that keeps failing has one entry in the
 * session's log of failed fetches, with the number of attempts.
 */
export async function fetchCommand(options: FetchOptions, deps: AgentDeps): Promise<number> {
  const { root, now } = context(deps);
  const countryId = requireMapCountry(options.countryId).id;
  const dir = sessionDir(root, countryId);
  const session = readSession(dir, countryId);
  if (options.links && options.find?.length) {
    deps.out('--links and --find cannot be combined; use one at a time.');
    return 1;
  }
  const matches = findMatches(options.matches);
  if (typeof matches === 'string') {
    deps.out(matches);
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
  const fresh = !stored;
  if (stored) {
    deps.out(`${options.url} (stored copy in ${stored.file})`);
  } else {
    try {
      stored = saveEvidence(dir, await fetchForReading(options.url, deps), now());
    } catch (error) {
      const reason = fetchFailure(error);
      session.failedFetches = recordFailedFetch(session.failedFetches, {
        url: options.url,
        attemptedAt: now(),
        reason,
      });
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
  if (fresh) {
    for (const note of [httpNote(parsedUrl), redirectNote(record)]) if (note) deps.out(note);
  }
  if (notRequested) deps.out(notRequestedWarning(notRequested));
  const unreadable = unreadableWarning(record);
  if (unreadable) deps.out(unreadable);
  return printPart(
    record,
    { ...options, matches },
    (args) => command(`fetch ${options.countryId} ${shellQuote(options.url)}${args}`),
    deps.out,
  );
}

export type PlacesOptions = {
  countryId: string;
  /** Names to search for; with several, each result is headed by its query. */
  queries: string[];
  /** Only places in these map countries (in any of them); none means everywhere. */
  countries: string[];
  near?: string;
};

export function places(options: PlacesOptions, deps: AgentDeps): number {
  requireMapCountry(options.countryId);
  const countries = options.countries.map((id) => requireMapCountry(id).id);
  for (const query of options.queries.length ? options.queries : [null]) {
    if (options.queries.length > 1) deps.out(`## ${query}`);
    deps.out(
      findPlaces({
        query,
        countryId: countries.length ? countries : null,
        near: options.near ?? null,
      }),
    );
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
 * Why a revision session cannot submit: the overview or a story it revises no longer has the
 * revision request the session started from (it was redrafted another way, the notes changed, or
 * the story is gone), something else is sent back now, or undefined.
 */
function revisionChanged(
  existing: CountryFile | undefined,
  session: AgentSession,
  country: { id: string; slug: string },
): string | undefined {
  const file = countryFilePath(session.contentDir, country.slug);
  if (!existing) return `${file} no longer exists.`;
  const rebuild = `Run ${command(`start ${country.id} --revisions`)} to rebuild the brief from what is sent back now.`;
  if (!isDeepStrictEqual(existing.country.provenance.revision, session.overviewRevision)) {
    if (wholeCountryRevision(existing)) {
      return `The whole of ${country.id} is sent back now, so it is drafted again with ${command(`start ${country.id} --fresh`)}.`;
    }
    return session.overviewRevision
      ? `The overview of ${country.id} no longer has the revision request this session started from. ${rebuild}`
      : `The overview of ${country.id} was sent back after this session started. ${rebuild}`;
  }
  for (const { storyId, request } of session.revisions ?? []) {
    const story = existing.stories.find((entry) => entry.id === storyId);
    if (!isDeepStrictEqual(story?.provenance.revision, request)) {
      return `${country.id}/${storyId} no longer has the revision request this session started from. ${rebuild}`;
    }
  }
  return undefined;
}

type Checked = { ok: true; file: CountryFile } | { ok: false; issues: string[] };

/**
 * Check a revision as the API revision path does, with the session's evidence: the revised
 * stories, and the country part when the overview is sent back, all in one submission.
 */
function checkRevisionSubmission(
  drafting: DraftingContext,
  existing: CountryFile,
  sentBack: SentBack,
  input: unknown,
  options: RevisionCheckOptions,
): Checked {
  const parsed = sentBack.overview
    ? CountryRevisionsDraft.safeParse(input)
    : StoryRevisionsDraft.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
  const draft: StoryRevisionsDraft & Partial<CountryRevisionsDraft> = parsed.data;
  return checkRevisions(
    drafting,
    existing,
    sentBack,
    {
      ...(draft.country ? { country: { path: 'country', country: draft.country } } : {}),
      stories: draft.stories.map((story, index) => ({ path: `stories[${index}]`, story })),
      sources: draft.sources,
    },
    options,
  );
}

/**
 * Check a draft with every rule the API path applies, with only fetched pages as evidence, and
 * write the country file when it passes. In a revision session the draft holds the revised
 * stories, checked as the API revision path checks them, and only they change in the file.
 * Every submission is kept in the session. A dry run does the same checks and changes nothing,
 * so it never finishes the session.
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
  const sentBack = session.revisions ? sessionSentBack(session) : undefined;
  const revisedIds = sentBack?.storyIds;
  if (sentBack) {
    const changed = revisionChanged(existing, session, country);
    if (changed) {
      deps.out(changed);
      return 1;
    }
  } else {
    const conflict = replaceConflict(existing, { regenerate: session.regenerate, force: false });
    if (conflict) {
      deps.out(conflictMessage(conflict, session.contentDir, country, existing));
      return 1;
    }
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
  const drafting: DraftingContext = {
    contentDir: session.contentDir,
    prompts,
    date: session.date,
    plan: plan(),
    linkTargets: '',
    storyCount: STORIES_PER_COUNTRY,
    land: landIndex(),
  };
  const evidenceOptions = {
    model: session.model,
    evidence,
    evidenceRule: AGENT_EVIDENCE_RULE,
    unusableEvidence,
  };
  // Two URLs are one page when a record read them both: one redirected to the other.
  const samePage = (a: string, b: string) => {
    const [first, second] = [normalizeUrl(a), normalizeUrl(b)];
    return records.some(
      ({ record }) =>
        record.normalizedUrls.includes(first) && record.normalizedUrls.includes(second),
    );
  };
  const submission: Checked | undefined =
    input === undefined
      ? undefined
      : sentBack
        ? // revisionChanged above refused a session whose file is gone.
          checkRevisionSubmission(drafting, existing!, sentBack, input, {
            ...evidenceOptions,
            samePage,
          })
        : submitCountryDraft(drafting, country.id, input, evidenceOptions);
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

  // What this submission drafted: the whole country, or only the parts revised.
  const stories = submission.file.stories.filter(
    (story) => !revisedIds || revisedIds.includes(story.id),
  );
  const draftedCountry = !sentBack || sentBack.overview;
  const sources = new Set(
    [...(draftedCountry ? [submission.file.country] : []), ...stories].flatMap((entry) =>
      entry.sources.map((source) => source.url),
    ),
  );
  // The tree as it is or would be after the write, so a dry run reports the same references.
  const files = parsedCountryFiles(session.contentDir);
  files.set(country.id, submission.file);
  const pending = findPendingReferences([...files.values()]).filter(
    (ref) =>
      ref.from.countryId === country.id && (!revisedIds || revisedIds.includes(ref.from.storyId)),
  );
  const drafted = sentBack ? `the revised ${revisedText(sentBack)}` : 'the draft';
  if (options.dryRun) {
    deps.out(
      `Dry run: ${drafted} would pass. Nothing was written; run ${command(`submit ${country.id}`)} to submit it.`,
    );
  } else {
    const written = writeCountryFile(session.contentDir, submission.file);
    session.written = { file: written, writtenAt: now() };
    writeSession(dir, session);
    deps.out(
      sentBack
        ? `Submission ${ordinal} passed. Wrote ${revisedText(sentBack)} into ${written} (draft, ${session.promptVersion}, ${session.model}); the revision requests are cleared and the rest of the file is unchanged.`
        : `Submission ${ordinal} passed. Wrote ${written} (draft, ${session.promptVersion}, ${session.model}).`,
    );
  }
  const storyCount = `${stories.length} ${sentBack ? 'revised ' : ''}${stories.length === 1 ? 'story' : 'stories'}`;
  deps.out(
    `${sentBack?.overview ? 'The revised overview, ' : ''}${storyCount}, ${sources.size} sources, ${pending.length} pending references${pending.length ? ':' : '.'}`,
  );
  for (const ref of pending) {
    deps.out(
      `  ${ref.from.countryId}/${ref.from.storyId} -> ${ref.to.countryId}/${ref.to.storyId}`,
    );
  }
  if (!options.dryRun) deps.out(nextSteps(country.id, sentBack));
  return 0;
}

/**
 * What the editor runs after a submission is written. The agent claim check comes first: it runs
 * on the subscription, and checks only the claims that changed (a revised overview's or story's
 * edited units are due again, the rest keep their verdicts). The API check is the alternative.
 */
function nextSteps(countryId: string, sentBack: SentBack | undefined): string {
  const steps = [
    'npm run content:verify',
    `npm run content:claims-agent -- start ${countryId} in a Claude Code claim-checker subagent (or the API check, npm run content:claims -- ${countryId})`,
    ...(!sentBack || sentBack.storyIds.length
      ? [
          `npm run content:paraphrase -- ${countryId} for the ${sentBack ? "revised stories'" : "stories'"} search phrasings`,
        ]
      : []),
  ];
  return `Next, for the editor: ${steps.join(', ')}, then npm run content:review -- show ${countryId}.`;
}

export function status(options: { countryId: string }, deps: AgentDeps): number {
  const { root } = context(deps);
  const country = requireMapCountry(options.countryId);
  const dir = sessionDir(root, country.id);
  const session = readSession(dir, country.id);
  const { records, problems } = loadEvidence(dir);
  deps.out(
    `Agent ${session.revisions ? 'revision ' : ''}session for ${country.name} (${country.id}) in ${dir}`,
  );
  deps.out(
    `Content ${session.contentDir}, model ${session.model}, prompts ${session.promptVersion}, date ${session.date}${session.regenerate ? ', replaces the existing draft' : ''}.`,
  );
  if (session.overviewRevision) {
    const request = session.overviewRevision;
    deps.out(
      `Revising the overview sent back (${request.requestedBy}, ${request.requestedAt}): ${request.notes}`,
    );
  }
  if (session.revisions?.length) {
    deps.out(
      `Revising ${session.revisions.length} ${session.revisions.length === 1 ? 'story' : 'stories'} sent back:`,
    );
    for (const { storyId, request } of session.revisions) {
      deps.out(`  ${storyId} (${request.requestedBy}, ${request.requestedAt}): ${request.notes}`);
    }
  }
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
  for (const failure of session.failedFetches) deps.out(`  ${describeFailedFetch(failure)}`);
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
