// Claim check results, committed next to the content they check: content/<locale>/claims/<country
// slug>.json, keyed by each unit's key (a hash of its exact text and cited sources). A result
// applies only to the text it was made for: when a unit changes, its key changes and it reads as
// not checked again. A reviewer's acceptance of a flag is a review decision, so it is kept here too.
//
// Writes keep only the results of the file's current units, in the order the units appear, with
// fields in schema order and writeJson's formatting, so a recheck or an approval makes a small,
// readable diff. The site never reads these files: content discovery reads only the top-level
// files and countries/ (src/content/files.ts).
//
// Review reads these results: content:review show prints them, and approve refuses while a unit
// in what it approves is not checked, or is flagged (partly supported, not supported, or a cited
// page could not be read) and a reviewer has not accepted the flag.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CountryFile } from '../../src/content/schema';
import { readJson, writeJson } from '../content-tree';
import { allScopes, scopeUnits, type ClaimUnit } from './units';

export const ClaimVerdict = z.enum([
  'supported',
  'partly_supported',
  'not_supported',
  'source_unreachable',
]);
export type ClaimVerdict = z.infer<typeof ClaimVerdict>;

export const SourceStatus = z.enum(['read', 'unreachable']);

const ClaimCheck = z.strictObject({
  /** The unit as it was checked, so the file reads on its own. */
  label: z.string(),
  text: z.string(),
  verdict: ClaimVerdict,
  /** Exact phrases of the text that the sources do not state. */
  unsupported: z.array(z.string()),
  /** Short quotes or pointers from the sources that state the text. */
  evidence: z.array(z.strictObject({ sourceId: z.string(), quote: z.string() })),
  note: z.string().nullable(),
  /** Each cited source and whether its page could be read. */
  sources: z.array(
    z.strictObject({
      id: z.string(),
      url: z.string(),
      status: SourceStatus,
      note: z.string().nullable(),
    }),
  ),
  checkedAt: z.string(),
  model: z.string(),
  effort: z.string(),
  promptVersion: z.string(),
  /**
   * Agent claim checks only (pipeline/claims-agent): the pages the pipeline fetched live from the
   * web at submission, itself, to verify the unit's quotes, each with the SHA-256 of the text the
   * quotes were matched against. Empty when the verdict quotes nothing. API results have none,
   * since their quotes are checked against what the API fetched in the conversation.
   */
  verification: z
    .strictObject({
      pages: z.array(
        z.strictObject({
          sourceId: z.string(),
          url: z.string(),
          /** Where redirects ended. */
          finalUrl: z.string(),
          fetchedAt: z.string(),
          characters: z.number().int(),
          sha256: z.string(),
        }),
      ),
    })
    .optional(),
  /** A reviewer read the flag and approved anyway, saying why. */
  accepted: z.strictObject({ by: z.string(), on: z.string(), reason: z.string() }).optional(),
});
export type ClaimCheck = z.infer<typeof ClaimCheck>;

const ClaimsFile = z.strictObject({
  countryId: z.string(),
  checks: z.record(z.string(), ClaimCheck),
});
export type ClaimsFile = z.infer<typeof ClaimsFile>;

/** Where a content tree keeps its claim check results unless --claims-dir says otherwise. */
export const defaultClaimsDir = (contentDir: string) => join(contentDir, 'claims');

export const claimsFilePath = (dir: string, slug: string) => join(dir, `${slug}.json`);

type CountryRef = { id: string; slug: string };

export function readClaims(dir: string, country: CountryRef): ClaimsFile {
  const file = claimsFilePath(dir, country.slug);
  return existsSync(file)
    ? ClaimsFile.parse(readJson(file))
    : { countryId: country.id, checks: {} };
}

/**
 * Add or replace results by unit key, then keep only the results of the file's current units:
 * results for text that has since changed or gone no longer apply to anything.
 */
export function recordChecks(
  dir: string,
  file: CountryFile,
  checks: Record<string, ClaimCheck>,
): void {
  const merged = { ...readClaims(dir, file.country).checks, ...checks };
  const kept: Record<string, ClaimCheck> = {};
  for (const unit of allScopes(file).flatMap((scope) => scopeUnits(file, scope))) {
    const check = merged[unit.key];
    // Parsing puts the fields in schema order, whatever order they were built in.
    if (check && !kept[unit.key]) kept[unit.key] = ClaimCheck.parse(check);
  }
  mkdirSync(dir, { recursive: true });
  writeJson(claimsFilePath(dir, file.country.slug), { countryId: file.country.id, checks: kept });
}

/** Verdicts that need a reviewer's eyes before approval. */
export const isFlagged = (check: ClaimCheck) => check.verdict !== 'supported';

export type UnitStatus = { unit: ClaimUnit; check?: ClaimCheck };

export const unitStatuses = (units: ClaimUnit[], claims: ClaimsFile): UnitStatus[] =>
  units.map((unit) => ({ unit, check: claims.checks[unit.key] }));

const VERDICT_LABELS: Record<ClaimVerdict, string> = {
  supported: 'supported',
  partly_supported: 'PARTLY SUPPORTED',
  not_supported: 'NOT SUPPORTED',
  source_unreachable: 'SOURCE UNREACHABLE',
};

const quoted = (list: string[]) => list.map((text) => `"${text}"`).join(', ');

/** Lines describing one unit's claim check, for the terminal. */
export function describeCheck(check: ClaimCheck | undefined): string[] {
  if (!check) return ['claim check: not checked (or the text changed since)'];
  const method = check.verification ? `, ${check.promptVersion}` : '';
  const head = `claim check: ${VERDICT_LABELS[check.verdict]} (${check.checkedAt}, ${check.model}${method})`;
  const lines = [head];
  if (check.unsupported.length)
    lines.push(`  not stated by the sources: ${quoted(check.unsupported)}`);
  if (check.note) lines.push(`  ${check.note}`);
  for (const source of check.sources.filter((entry) => entry.status === 'unreachable')) {
    lines.push(`  [${source.id}] could not be read${source.note ? `: ${source.note}` : ''}`);
  }
  for (const item of check.evidence) lines.push(`  [${item.sourceId}] "${item.quote}"`);
  if (check.verification?.pages.length) {
    const pages = check.verification.pages.map((page) => `[${page.sourceId}] ${page.fetchedAt}`);
    lines.push(`  quotes verified against a live fetch: ${pages.join(', ')}`);
  }
  if (check.accepted) {
    lines.push(
      `  accepted by ${check.accepted.by} on ${check.accepted.on}: ${check.accepted.reason}`,
    );
  }
  return lines;
}

export type ClaimCounts = Record<ClaimVerdict | 'unchecked', number>;

export function countVerdicts(statuses: UnitStatus[]): ClaimCounts {
  const counts: ClaimCounts = {
    supported: 0,
    partly_supported: 0,
    not_supported: 0,
    source_unreachable: 0,
    unchecked: 0,
  };
  for (const { check } of statuses) counts[check?.verdict ?? 'unchecked'] += 1;
  return counts;
}

export const formatCounts = (counts: ClaimCounts) =>
  [
    `${counts.supported} supported`,
    `${counts.partly_supported} partly supported`,
    `${counts.not_supported} not supported`,
    `${counts.source_unreachable} source unreachable`,
    `${counts.unchecked} not checked`,
  ].join(', ');

/** One line per unit that would stop approval: not checked, or flagged and not accepted. */
export function claimProblems(statuses: UnitStatus[], where: string): string[] {
  return statuses.flatMap(({ unit, check }) => {
    if (!check) return [`${where} ${unit.label}: not claim-checked`];
    if (!isFlagged(check) || check.accepted) return [];
    const detail = check.unsupported.length
      ? `: ${quoted(check.unsupported)}`
      : check.note
        ? `: ${check.note}`
        : '';
    return [`${where} ${unit.label}: ${VERDICT_LABELS[check.verdict].toLowerCase()}${detail}`];
  });
}

/** Record a reviewer's acceptance on every flagged, unaccepted unit among these. */
export function acceptFlagged(
  dir: string,
  file: CountryFile,
  statuses: UnitStatus[],
  accepted: NonNullable<ClaimCheck['accepted']>,
): number {
  const checks: Record<string, ClaimCheck> = {};
  for (const { unit, check } of statuses) {
    if (check && isFlagged(check) && !check.accepted) checks[unit.key] = { ...check, accepted };
  }
  if (Object.keys(checks).length) recordChecks(dir, file, checks);
  return Object.keys(checks).length;
}
