// An agent drafting session on disk, one directory per country in pipeline/.cache/agent/:
//
//   session.json    what is drafted, with which model, prompts and date, every submission and
//                   every fetch that failed
//   brief.md        the complete instructions the subagent follows
//   evidence/       one record per page read through the fetch command, with its text
//   submissions/    every draft submitted, numbered, for audit
//   draft.json      where the subagent writes its draft
//
// Evidence is the only proof that a cited page was read, so each record keeps the SHA-256 of
// its text and a submission uses only records whose text still matches.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CountryId, IsoDate } from '../../src/content/schema';
import type { FetchedPage } from '../claims/local-fetch';
import { CACHE_DIR } from '../config';
import { readJson, writeJson } from '../content-tree';
import { normalizeUrl } from '../generate/evidence';

export const DEFAULT_SESSIONS_DIR = join(CACHE_DIR, 'agent');

export const AgentSession = z.strictObject({
  countryId: CountryId,
  contentDir: z.string().min(1),
  /** Recorded as the draft's generatedBy. */
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  /** generatedAt and every source's accessedAt. */
  date: IsoDate,
  /** An existing draft nobody sent back may be replaced. */
  regenerate: z.boolean(),
  startedAt: z.string(),
  submissions: z.array(
    z.strictObject({ file: z.string(), submittedAt: z.string(), issues: z.array(z.string()) }),
  ),
  /** Pages the fetch command could not read. Never evidence: only a stored record is. */
  failedFetches: z
    .array(z.strictObject({ url: z.string(), attemptedAt: z.string(), reason: z.string() }))
    .default([]),
  written: z.strictObject({ file: z.string(), writtenAt: z.string() }).optional(),
});
export type AgentSession = z.infer<typeof AgentSession>;

export const sessionDir = (root: string, countryId: string) => join(root, countryId);
export const briefFile = (dir: string) => join(dir, 'brief.md');
export const draftFile = (dir: string) => join(dir, 'draft.json');
const sessionFile = (dir: string) => join(dir, 'session.json');
const evidenceDir = (dir: string) => join(dir, 'evidence');
export const submissionsDir = (dir: string) => join(dir, 'submissions');

export const hasSession = (dir: string) => existsSync(sessionFile(dir));

export function readSession(dir: string, countryId: string): AgentSession {
  if (!hasSession(dir)) {
    throw new Error(
      `No agent session for ${countryId}. Start one with: npm run content:agent -- start ${countryId}`,
    );
  }
  return AgentSession.parse(readJson(sessionFile(dir)));
}

export function writeSession(dir: string, session: AgentSession): void {
  mkdirSync(dir, { recursive: true });
  writeJson(sessionFile(dir), AgentSession.parse(session));
}

/** A page read through the fetch command. The text comes last so the metadata reads first. */
export const EvidenceRecord = z.strictObject({
  requestedUrl: z.string(),
  /** Where redirects ended. */
  finalUrl: z.string(),
  /** normalizeUrl of both URLs: a source whose URL normalizes to one of them may cite this page. */
  normalizedUrls: z.array(z.string()),
  status: z.number().int(),
  contentType: z.string(),
  fetchedAt: z.string(),
  characters: z.number().int(),
  /** The text was cut off at the fetch command's character limit. */
  truncated: z.boolean(),
  sha256: z.string(),
  text: z.string(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const recordUrls = (record: Pick<EvidenceRecord, 'requestedUrl' | 'finalUrl'>) => [
  ...new Set([normalizeUrl(record.requestedUrl), normalizeUrl(record.finalUrl)]),
];

/** One file per requested URL, so fetching a page again replaces its record. */
const evidencePath = (dir: string, url: string) =>
  join(evidenceDir(dir), `${sha256(normalizeUrl(url)).slice(0, 16)}.json`);

export function saveEvidence(
  dir: string,
  page: FetchedPage,
  fetchedAt: string,
): { file: string; record: EvidenceRecord } {
  const record: EvidenceRecord = {
    requestedUrl: page.url,
    finalUrl: page.finalUrl,
    normalizedUrls: recordUrls({ requestedUrl: page.url, finalUrl: page.finalUrl }),
    status: page.status,
    contentType: page.contentType,
    fetchedAt,
    characters: page.text.length,
    truncated: page.truncated,
    sha256: sha256(page.text),
    text: page.text,
  };
  const file = evidencePath(dir, page.url);
  mkdirSync(evidenceDir(dir), { recursive: true });
  writeJson(file, record);
  return { file, record };
}

export type StoredEvidence = { file: string; record: EvidenceRecord };

/** Why a record cannot count as evidence, or undefined when it can. */
function recordProblem(record: EvidenceRecord): string | undefined {
  if (sha256(record.text) !== record.sha256 || record.characters !== record.text.length) {
    return 'its text no longer matches the hash taken when it was fetched';
  }
  const urls = recordUrls(record);
  if (
    urls.length !== record.normalizedUrls.length ||
    urls.some((url) => !record.normalizedUrls.includes(url))
  ) {
    return 'its URLs do not match the ones it was fetched with';
  }
  if (record.status < 200 || record.status > 299) return `its HTTP status is ${record.status}`;
  return undefined;
}

/**
 * Every evidence record of a session, split into usable records and problems with the rest. A
 * record that fails to parse or whose text, URLs or status do not check out is never used.
 */
export function loadEvidence(dir: string): { records: StoredEvidence[]; problems: string[] } {
  const records: StoredEvidence[] = [];
  const problems: string[] = [];
  const folder = evidenceDir(dir);
  if (!existsSync(folder)) return { records, problems };
  for (const name of readdirSync(folder)
    .filter((entry) => entry.endsWith('.json'))
    .sort()) {
    const file = join(folder, name);
    const hint =
      'Evidence is written only by the fetch command; fetch the page again with --refresh.';
    let parsed: ReturnType<typeof EvidenceRecord.safeParse>;
    try {
      parsed = EvidenceRecord.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      problems.push(`evidence/${name} is not valid JSON. ${hint}`);
      continue;
    }
    if (!parsed.success) {
      problems.push(`evidence/${name} is not an evidence record. ${hint}`);
      continue;
    }
    const problem = recordProblem(parsed.data);
    if (problem) {
      problems.push(`evidence/${name} (${parsed.data.requestedUrl}): ${problem}. ${hint}`);
      continue;
    }
    records.push({ file, record: parsed.data });
  }
  return { records, problems };
}

/** The stored record that a URL normalizes to, if any, whether or not it still checks out. */
export function findEvidence(dir: string, url: string): StoredEvidence | undefined {
  const folder = evidenceDir(dir);
  if (!existsSync(folder)) return undefined;
  const wanted = normalizeUrl(url);
  for (const name of readdirSync(folder).filter((entry) => entry.endsWith('.json'))) {
    const file = join(folder, name);
    let parsed: ReturnType<typeof EvidenceRecord.safeParse>;
    try {
      parsed = EvidenceRecord.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
      continue;
    }
    if (parsed.success && recordUrls(parsed.data).includes(wanted)) {
      return { file, record: parsed.data };
    }
  }
  return undefined;
}

/** Whether a stored record still checks out. */
export const evidenceIntact = (record: EvidenceRecord) => recordProblem(record) === undefined;
