// What the model submits after reading the cited pages: how each source read, and a verdict per
// unit. The schema is small and fixed (unit and source IDs are plain strings), so it compiles as a
// strict tool for every scope; everything that depends on the scope is checked here, and problems
// go back to the model through the session's repair loop.
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import type { Source } from '../../src/content/schema';
import { normalizeUrl } from '../generate/evidence';
import { ClaimVerdict, SourceStatus, type ClaimCheck } from './store';
import type { ClaimUnit } from './units';

export const SubmitVerdicts = z.strictObject({
  sources: z
    .array(
      z.strictObject({
        id: z.string().describe('A source ID from the task.'),
        status: SourceStatus.describe(
          'read: you fetched the page and read its text. unreachable: the fetch failed, or returned an error page, a bot challenge, a paywall or no article text.',
        ),
        note: z
          .string()
          .nullable()
          .describe(
            'Why it was unreachable, or that the document was cut off and where. Null otherwise.',
          ),
      }),
    )
    .describe('Every source the task lists, once.'),
  verdicts: z
    .array(
      z.strictObject({
        unitId: z.string().describe('A unit ID from the task.'),
        verdict: ClaimVerdict,
        unsupported: z
          .array(z.string())
          .describe(
            'Each phrase or sentence of the unit text that its read sources do not state, copied exactly. Empty when supported.',
          ),
        evidence: z
          .array(
            z.strictObject({
              sourceId: z.string(),
              quote: z
                .string()
                .describe(
                  'Under 30 words copied exactly from the page text, with "..." for a gap. For a table, copy the words of the row as they appear. It is checked against the fetched text.',
                ),
            }),
          )
          .describe('Where the read sources state the supported part of the text.'),
        note: z
          .string()
          .nullable()
          .describe('One or two sentences for the editor when a verdict needs explaining.'),
      }),
    )
    .describe('One verdict for every unit in the task.'),
});
export type SubmitVerdicts = z.infer<typeof SubmitVerdicts>;

/**
 * Pages the model fetched and read itself in one response. A fetch made from inside code
 * execution goes to the code rather than the model, so only direct calls count.
 */
export function fetchedUrls(content: BetaContentBlock[]): Set<string> {
  const direct = new Map<string, string>();
  for (const block of content) {
    if (block.type !== 'server_tool_use' || block.name !== 'web_fetch') continue;
    const caller = (block as { caller?: { type?: string } | null }).caller;
    if (caller && caller.type !== 'direct') continue;
    direct.set(block.id, String((block.input as { url?: unknown }).url ?? ''));
  }
  const urls = new Set<string>();
  for (const block of content) {
    if (block.type !== 'web_fetch_tool_result' || !direct.has(block.tool_use_id)) continue;
    if (block.content.type !== 'web_fetch_result') continue;
    urls.add(normalizeUrl(block.content.url));
    urls.add(normalizeUrl(direct.get(block.tool_use_id)!));
  }
  return urls;
}

/**
 * The text of each page fetched directly in one response, by normalized URL (requested and final).
 * Only documents the server returns as text are here: a PDF arrives as base64 and the pipeline
 * does not extract its text, so quotes from a PDF cannot be checked and are taken as given.
 */
export function fetchedTexts(content: BetaContentBlock[]): Map<string, string> {
  const direct = new Map<string, string>();
  for (const block of content) {
    if (block.type !== 'server_tool_use' || block.name !== 'web_fetch') continue;
    const caller = (block as { caller?: { type?: string } | null }).caller;
    if (caller && caller.type !== 'direct') continue;
    direct.set(block.id, String((block.input as { url?: unknown }).url ?? ''));
  }
  const texts = new Map<string, string>();
  for (const block of content) {
    if (block.type !== 'web_fetch_tool_result' || !direct.has(block.tool_use_id)) continue;
    if (block.content.type !== 'web_fetch_result') continue;
    const source = block.content.content?.source;
    if (source?.type !== 'text') continue;
    texts.set(normalizeUrl(block.content.url), source.data);
    texts.set(normalizeUrl(direct.get(block.tool_use_id)!), source.data);
  }
  return texts;
}

/** Text compared loosely: case, spacing, quote, apostrophe, dash and ellipsis styles do not matter. */
const loose = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’‚′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Whether a quote appears in a page's text: compared loosely, without quotation marks around it,
 * and with "..." standing for a gap, so each part must appear, in order.
 */
export function quoteInText(quote: string, text: string): boolean {
  const page = loose(text);
  const parts = loose(quote)
    .replace(/^["']+|["']+$/g, '')
    .split(/\s*\.\.\.\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  let from = 0;
  for (const part of parts) {
    const at = page.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

export type VerdictContext = {
  units: ClaimUnit[];
  sources: Source[];
  /** Normalized URLs fetched directly in this conversation. */
  fetched: Set<string>;
  /**
   * The text the model was given for each fetched page, by normalized URL. Quotes from a page
   * with text here must appear in it; a page without (a PDF) is not checked.
   */
  texts: Map<string, string[]>;
  /** Recorded on every result. */
  stamp: Pick<ClaimCheck, 'checkedAt' | 'model' | 'effort' | 'promptVersion'>;
};

export type VerdictResult =
  { ok: true; checks: Record<string, ClaimCheck> } | { ok: false; issues: string[] };

/** Validate a submission against the scope it was asked about and turn it into results by unit key. */
export function checkVerdicts(input: unknown, context: VerdictContext): VerdictResult {
  const parsed = SubmitVerdicts.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  const { sources, verdicts } = parsed.data;
  const issues: string[] = [];

  const declared = new Map(context.sources.map((source) => [source.id, source]));
  const readings = new Map<string, SubmitVerdicts['sources'][number]>();
  for (const reading of sources) {
    const source = declared.get(reading.id);
    if (!source) issues.push(`sources: "${reading.id}" is not a source in this task`);
    else if (readings.has(reading.id)) issues.push(`sources: "${reading.id}" is listed twice`);
    else readings.set(reading.id, reading);
    if (!source) continue;
    if (reading.status === 'read' && !context.fetched.has(normalizeUrl(source.url))) {
      issues.push(
        `sources.${reading.id}: marked read, but ${source.url} was not fetched with web_fetch or fetch_page in this conversation. Fetch it, or mark it unreachable and say why.`,
      );
    }
    if (reading.status === 'unreachable' && !reading.note?.trim()) {
      issues.push(`sources.${reading.id}: say why the page could not be read`);
    }
  }
  for (const id of declared.keys()) {
    if (!readings.has(id)) issues.push(`sources: report whether "${id}" could be read`);
  }

  const units = new Map(context.units.map((unit) => [unit.id, unit]));
  const seen = new Set<string>();
  const checks: Record<string, ClaimCheck> = {};
  for (const entry of verdicts) {
    const unit = units.get(entry.unitId);
    const at = `verdicts.${entry.unitId}`;
    if (!unit) {
      issues.push(`verdicts: "${entry.unitId}" is not a unit in this task`);
      continue;
    }
    if (seen.has(unit.id)) {
      issues.push(`${at}: give one verdict per unit`);
      continue;
    }
    seen.add(unit.id);
    const unitSources = unit.sources.map((source) => source.id);
    const read = unitSources.filter((id) => readings.get(id)?.status === 'read');
    const unreachable = unitSources.filter((id) => readings.get(id)?.status === 'unreachable');
    const { verdict } = entry;

    if ((verdict === 'supported') !== (entry.unsupported.length === 0)) {
      issues.push(
        verdict === 'supported'
          ? `${at}: a supported unit has no unsupported phrases; use partly_supported if some text is not stated`
          : `${at}: list the phrases the sources do not state in unsupported`,
      );
    }
    for (const phrase of entry.unsupported) {
      if (!loose(unit.text).includes(loose(phrase))) {
        issues.push(`${at}: "${phrase}" is not in the unit text; copy the phrase exactly`);
      }
    }
    if ((verdict === 'supported' || verdict === 'partly_supported') && !entry.evidence.length) {
      issues.push(`${at}: give a short quote from a source for what is supported`);
    }
    for (const item of entry.evidence) {
      if (!read.includes(item.sourceId)) {
        issues.push(
          `${at}: evidence from "${item.sourceId}" must come from a source this unit cites and you read (${read.join(', ') || 'none read'})`,
        );
        continue;
      }
      const url = declared.get(item.sourceId)!.url;
      const pages = context.texts.get(normalizeUrl(url));
      if (pages && !pages.some((page) => quoteInText(item.quote, page))) {
        issues.push(
          `${at}: the quote "${item.quote}" is not in the text fetched from ${url}; copy the words exactly (use "..." for a gap) or leave the quote out`,
        );
      }
    }
    if (verdict === 'source_unreachable' && !unreachable.length) {
      issues.push(
        `${at}: source_unreachable needs one of its sources (${unitSources.join(', ')}) marked unreachable`,
      );
    }
    if (verdict !== 'source_unreachable' && !read.length) {
      issues.push(`${at}: none of its sources could be read, so the verdict is source_unreachable`);
    }

    checks[unit.key] = {
      label: unit.label,
      text: unit.text,
      verdict,
      unsupported: entry.unsupported,
      evidence: entry.evidence,
      note: entry.note,
      sources: unit.sources.map((source) => ({
        id: source.id,
        url: source.url,
        status: readings.get(source.id)?.status ?? 'unreachable',
        note: readings.get(source.id)?.note ?? null,
      })),
      ...context.stamp,
    };
  }
  for (const unit of context.units) {
    if (!seen.has(unit.id)) issues.push(`verdicts: give a verdict for "${unit.id}"`);
  }
  return issues.length ? { ok: false, issues } : { ok: true, checks };
}
