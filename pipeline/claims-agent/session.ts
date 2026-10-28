// An agent claim check session on disk, one directory per session in pipeline/.cache/claims-agent/,
// named after what it checks: "CHL", "CHL-length", or "CHL-part2" when a country is split.
//
//   session.json    what is checked (the units by ID and key, and their sources), with which
//                   model and prompts, every fetch, every failed fetch (one entry per URL), and
//                   every submission with its live fetches
//   brief.md        the complete instructions the subagent follows
//   pages/          reading copies of the pages the fetch command read; never used to verify
//   submissions/    every verdict file submitted, numbered, for audit
//   verdicts.json   where the subagent writes its verdicts
//
// Nothing here is trusted to verify a quote: submit fetches every quoted page live from the web.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { CountryId } from '../../src/content/schema';
import { FailedFetch } from '../agent/session';
import { CACHE_DIR } from '../config';
import { readJson, writeJson } from '../content-tree';

export const DEFAULT_CLAIMS_AGENT_DIR = join(CACHE_DIR, 'claims-agent');

const FetchLog = z.strictObject({
  url: z.string(),
  finalUrl: z.string(),
  fetchedAt: z.string(),
  characters: z.number().int(),
  sha256: z.string(),
});

const LiveFetch = z.strictObject({
  url: z.string(),
  fetchedAt: z.string(),
  /**
   * The length of the text quotes were matched against; null when the fetch failed, and absent
   * from submissions logged before it was recorded.
   */
  characters: z.number().int().nullable().optional(),
  /** The SHA-256 of the text quotes were matched against; null when the fetch failed. */
  sha256: z.string().nullable(),
  error: z.string().nullable(),
});

export const ClaimsAgentSession = z.strictObject({
  sessionId: z.string().min(1),
  countryId: CountryId,
  /** For people: "CHL", "CHL/length", "CHL, part 2 of 3". */
  label: z.string(),
  contentDir: z.string().min(1),
  claimsDir: z.string().min(1),
  /** Recorded on every result as the model that judged it. */
  model: z.string().min(1),
  /** Recorded on every result; "default" when the subagent ran at its default effort. */
  effort: z.string().min(1),
  /** Always on the claims-agent line, so an agent result can never pass for an API result. */
  promptVersion: z.string().regex(/^claims-agent-v\d+$/),
  /** The units were due even with a current result. */
  recheck: z.boolean(),
  startedAt: z.string(),
  /** The units this session checks, as they were at start; a changed text has another key. */
  units: z.array(z.strictObject({ id: z.string(), key: z.string(), label: z.string() })),
  sources: z.array(z.strictObject({ id: z.string(), url: z.string() })),
  /** Units whose verdict passed and was saved. */
  passed: z.array(z.string()),
  /** Pages the fetch command read, latest first per URL. A reading log, not evidence. */
  fetches: z.array(FetchLog),
  /** Pages the fetch command could not read, one entry per URL with its latest attempt. */
  failedFetches: z.array(FailedFetch),
  submissions: z.array(
    z.strictObject({
      file: z.string(),
      submittedAt: z.string(),
      /** Units saved by this submission. */
      saved: z.array(z.string()),
      /** The problems of each unit that did not pass, by unit ID. */
      failures: z.record(z.string(), z.array(z.string())),
      /** Everything sent back, including problems that belong to no unit. */
      issues: z.array(z.string()),
      /** The pages fetched live to verify this submission's quotes. */
      liveFetches: z.array(LiveFetch),
    }),
  ),
});
export type ClaimsAgentSession = z.infer<typeof ClaimsAgentSession>;
export type LiveFetch = z.infer<typeof LiveFetch>;

/** Session IDs are made by start from a country ID and story slugs; nothing else is a path. */
const SESSION_ID = /^[A-Z]{3}(-[a-z0-9-]+)?$/;

export function sessionDir(root: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) {
    throw new Error(
      `"${sessionId}" is not a session ID; start prints them, for example CHL or CHL-part2`,
    );
  }
  return join(root, sessionId);
}

export const briefFile = (dir: string) => join(dir, 'brief.md');
export const verdictFile = (dir: string) => join(dir, 'verdicts.json');
export const pagesDir = (dir: string) => join(dir, 'pages');
export const submissionsDir = (dir: string) => join(dir, 'submissions');
const sessionFile = (dir: string) => join(dir, 'session.json');

export const hasSession = (dir: string) => existsSync(sessionFile(dir));

export function readSession(dir: string, sessionId: string): ClaimsAgentSession {
  if (!hasSession(dir)) {
    throw new Error(
      `No claims agent session "${sessionId}". Start one with: npm run content:claims-agent -- start <country> [story]`,
    );
  }
  return ClaimsAgentSession.parse(readJson(sessionFile(dir)));
}

export function writeSession(dir: string, session: ClaimsAgentSession): void {
  mkdirSync(dir, { recursive: true });
  writeJson(sessionFile(dir), ClaimsAgentSession.parse(session));
}

/** Units of a session without a passing verdict from it. */
export const dueUnits = (session: ClaimsAgentSession) =>
  session.units.filter((unit) => !session.passed.includes(unit.id));

/** Every session in `root`, by ID, in name order. */
export function listSessions(
  root: string,
): { id: string; dir: string; session: ClaimsAgentSession }[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => SESSION_ID.test(name) && hasSession(join(root, name)))
    .sort()
    .map((id) => ({ id, dir: join(root, id), session: readSession(join(root, id), id) }));
}
