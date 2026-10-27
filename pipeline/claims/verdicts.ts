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

/**
 * Quotation marks and apostrophes in every style, full-width ones included. They are folded before
 * NFKC, which would turn the acute accent into a space and a combining mark.
 */
const QUOTE_MARKS = /["'`´‘’‚‛“”„‟′″‴‵‶‷«»‹›＂＇]/g;
/** Hyphens, dashes and minus signs. */
const DASHES = /[\u2010-\u2015\u2212\u2e3a\u2e3b\ufe58\ufe63]/g;
/**
 * Characters that take no space: zero-width spaces and joiners, the word joiner, the byte order
 * mark, soft hyphens, and private-use characters, which PDFs use for symbol glyphs that have no
 * Unicode meaning and which a terminal shows as nothing.
 */
const INVISIBLE =
  /[\u00ad\u200b-\u200d\u2060\ufeff\ue000-\uf8ff\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}]/gu;

/**
 * What some PDFs give for the "fi" and "fl" ligatures: their fonts map those glyphs to U+0000 (a
 * NUL), so "official" comes out as "of", NUL, "cial" and the two letters are lost. In page text it
 * stands for "fi" or "fl" and nothing else (see partPattern).
 */
const LOST_LIGATURE = '\u0000';
/**
 * Marks a hyphen at the end of a line between two letters ("subduc-" then "tion"), which may be a
 * typesetter's break inside one word or the hyphen of a compound; a quote may give the word
 * joined or with the hyphen. It is a noncharacter, and any in the input is dropped, so only a
 * line break can make one.
 */
const LINE_END_HYPHEN = '﷐';
/** The line pdfToText puts before each page of a PDF; it is not the page's text. */
const PAGE_MARKER = /^\[Page \d+\]$/gm;

/**
 * Text as quotes are compared: what changes between a page and a faithful copy of its words is
 * folded away, and the words themselves are kept.
 *
 * - The "[Page n]" lines of a PDF's text go, so a quote can run on across a page break.
 * - A soft hyphen at the end of a line joins the word; a hyphen between letters at the end of a
 *   line becomes LINE_END_HYPHEN, which matches a hyphen or nothing.
 * - Escapes a model sometimes writes in place of a character (`\u2212`, `\"`) are decoded.
 * - Unicode compatibility forms are folded (NFKC): non-breaking and other Unicode spaces, the
 *   ellipsis character as "...", ligatures, full-width forms.
 * - Markdown, which web_fetch serves pages as, is reduced to its words: link targets, emphasis
 *   and table borders go.
 * - Every quotation mark and apostrophe is one mark, kept only between letters or digits, where it
 *   is part of a word ("world’s"); elsewhere it only marks a quotation, which a quote may add or drop.
 * - Hyphens, dashes and minus signs are one dash, without spaces around it.
 * - Case does not matter, any run of whitespace is one space, and there is no space before a
 *   closing punctuation mark or after an opening bracket, so "projection , named" (as some
 *   pages set it) reads "projection, named".
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(["'\\/])/g, '$1')
    .replaceAll(LINE_END_HYPHEN, '')
    .replace(PAGE_MARKER, '')
    .replace(/­[^\S\n]*\n\s*/g, '')
    .replace(/(?<=\p{L})[-‐][^\S\n]*\n\s*(?=\p{L})/gu, LINE_END_HYPHEN)
    .replace(QUOTE_MARKS, "'")
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]/g, '')
    .replace(/\|/g, ' ')
    .replace(/(?<![\p{L}\p{N}])'|'(?![\p{L}\p{N}])/gu, '')
    .replace(DASHES, '-')
    .replace(/\s*-[\s-]*/g, '-')
    .replace(/\.\s*\.\s*\./g, '...')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/ (?=[,.;:!?%)\]}])|(?<=[([{]) /g, '')
    .trim();
}

/**
 * The parts of a quote that must appear in order: "..." (or "[...]") stands for a gap, and
 * punctuation at the edges of a part does not count. A hyphen the quote copied from the end of a
 * line is an ordinary hyphen.
 */
function quoteParts(quote: string): string[] {
  return normalizeForMatch(quote)
    .replaceAll(LINE_END_HYPHEN, '-')
    .split(/\s*[[(]?\.\.\.[\])]?\s*/)
    .map((part) => part.replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, ''))
    .filter(Boolean);
}

/**
 * Most normalized characters a "..." may skip between two parts of a quote: about 50 words, two or
 * three sentences, so a gap can drop a clause, a parenthesis or a few table cells, but cannot
 * stitch together words from different passages of a page. On the recorded runs of nine
 * countries, 33 distinct quotes with a gap matched a fetched page, and the widest gap was 30
 * characters (a list of towns); most skip one word or an apostrophe the model garbled. The bound
 * is ten times that, so a faithful quote is not sent back, and still small enough to keep both
 * parts in one passage.
 */
export const QUOTE_MAX_GAP = 300;

/**
 * Most words a quote may have. The prompts and the schema ask for quotes of "under 30 words":
 * evidence is a pointer to where a page states a claim, not a copy of the page.
 */
export const QUOTE_MAX_WORDS = 29;

/** The words of a quote: runs without spaces that hold a letter or digit, so "..." and "-" do not count. */
export const quoteWords = (quote: string) =>
  quote.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

/**
 * found: the parts appear in order with every gap within the bound. too_far_apart: they appear in
 * order, but only with a gap wider than the bound. missing: they do not appear in order.
 */
export type QuoteMatch = 'found' | 'too_far_apart' | 'missing';

/** Where a part of a quote appears in a page: from `start` up to `end`. */
type Span = { start: number; end: number };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLetter = (char: string | undefined) => char !== undefined && /\p{L}/u.test(char);

/**
 * A pattern for a part of a quote on a page with lost ligatures or line-end hyphens: the page's
 * LOST_LIGATURE matches "fi" or "fl" in the quote, and its LINE_END_HYPHEN matches a hyphen or
 * nothing between two letters. Everything else must be exactly as in the quote.
 */
function partPattern(part: string, ligatures: boolean, hyphens: boolean): RegExp {
  const chars = [...part];
  let source = '';
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const next = chars[index + 1];
    if (ligatures && char === 'f' && (next === 'i' || next === 'l')) {
      source += `(?:f${hyphens ? `${LINE_END_HYPHEN}?` : ''}${next}|${LOST_LIGATURE})`;
      index += 1;
    } else if (hyphens && char === '-') {
      source += `[-${LINE_END_HYPHEN}]`;
    } else {
      source += escapeRegExp(char);
    }
    if (hyphens && isLetter(chars[index]) && isLetter(chars[index + 1])) {
      source += `${LINE_END_HYPHEN}?`;
    }
  }
  return new RegExp(source, 'gu');
}

/** Every place where `part` appears in `page`, in order, overlapping ones included. */
function occurrences(page: string, part: string): Span[] {
  const spans: Span[] = [];
  const ligatures = page.includes(LOST_LIGATURE);
  const hyphens = page.includes(LINE_END_HYPHEN);
  if (!ligatures && !hyphens) {
    for (let at = page.indexOf(part); at >= 0; at = page.indexOf(part, at + 1)) {
      spans.push({ start: at, end: at + part.length });
    }
    return spans;
  }
  const pattern = partPattern(part, ligatures, hyphens);
  for (let match = pattern.exec(page); match; match = pattern.exec(page)) {
    spans.push({ start: match.index, end: match.index + match[0].length });
    pattern.lastIndex = match.index + 1;
  }
  return spans;
}

/**
 * Match a quote against text that went through normalizeForMatch. A part can appear several times,
 * and its first appearance is not always the one that keeps the next gap within the bound, so
 * every placement is followed: `ends` holds where the parts so far can end with every gap within
 * the bound, both lists in ascending order.
 */
function matchNormalized(quote: string, page: string, maxGap: number): QuoteMatch {
  const parts = quoteParts(quote);
  if (!parts.length) return 'missing';
  let ends = occurrences(page, parts[0]).map((span) => span.end);
  if (!ends.length) return 'missing';
  // The earliest end of the parts in order with any gaps, which tells too far apart from missing.
  let anyGap = ends[0];
  for (const part of parts.slice(1)) {
    const spans = occurrences(page, part);
    const next: number[] = [];
    let index = 0;
    for (const { start, end } of spans) {
      while (index < ends.length && ends[index] < start - maxGap) index += 1;
      if (index < ends.length && ends[index] <= start) next.push(end);
    }
    ends = next;
    const loose = spans.find((span) => span.start >= anyGap);
    if (loose === undefined) return 'missing';
    anyGap = loose.end;
  }
  return ends.length ? 'found' : 'too_far_apart';
}

/** How much of the page around a mismatch a problem shows, in normalized characters. */
const MISMATCH_CONTEXT = 60;

/**
 * Where a quote that is missing from a page parts from it, for the problem sent back: the first
 * part of the quote that does not appear, the longest beginning of it that does, and what the
 * page has after that beginning. Shown as normalized text, the form quotes are compared in.
 */
function describeMismatch(quote: string, page: string): string {
  const parts = quoteParts(quote);
  const missing = parts.find((part) => !occurrences(page, part).length);
  if (!missing) return 'each of its parts is on the page, but not in this order';
  // Whether a beginning appears only grows shorter with it, so the longest one is a binary search.
  let low = 0;
  let high = missing.length;
  while (low < high) {
    const length = Math.ceil((low + high) / 2);
    if (occurrences(page, missing.slice(0, length)).length) low = length;
    else high = length - 1;
  }
  const prefix = missing.slice(0, low);
  if (prefix.trim().length < 3) return `nothing on the page starts like "${missing.slice(0, 40)}"`;
  const span = occurrences(page, prefix)[0];
  const shown = (text: string) =>
    text.replaceAll(LINE_END_HYPHEN, '-').replaceAll(LOST_LIGATURE, '?');
  const before =
    prefix.length > MISMATCH_CONTEXT ? `...${prefix.slice(-MISMATCH_CONTEXT)}` : prefix;
  const after = page.slice(span.end, span.end + MISMATCH_CONTEXT);
  return `the page matches it as far as "${shown(before)}", then has "${shown(after)}" where the quote has "${missing.slice(low, low + 30)}" (shown as compared: lowercase, with spacing, quotation marks and dashes folded)`;
}

/** Match a quote against a page's text, compared as normalizeForMatch describes. */
export const matchQuote = (quote: string, text: string, maxGap = QUOTE_MAX_GAP): QuoteMatch =>
  matchNormalized(quote, normalizeForMatch(text), maxGap);

/** Whether a quote appears in a page's text, compared as normalizeForMatch describes. */
export const quoteInText = (quote: string, text: string): boolean =>
  matchQuote(quote, text) === 'found';

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
  /**
   * How pages are read in this check, for problems: "with web_fetch or fetch_page in this
   * conversation" unless given.
   */
  fetchedWith?: string;
  /** What `texts` holds, for problems: "the text fetched from" unless given. */
  textFrom?: string;
  /**
   * When given, every quote must be checked: a quote from a page without text in `texts` fails,
   * with this explanation. Without it, such a quote (a PDF the API served as a document) is taken
   * as given.
   */
  missingText?: (url: string) => string;
  /**
   * When given, added to the problem of a quote missing from a page's text, for example how that
   * text compares with the copy the quote was read from.
   */
  textNote?: (url: string) => string | undefined;
};

/**
 * A submission judged unit by unit, so one bad verdict does not discard the good ones.
 * `checks` holds every unit whose verdict passed every check, and `failures` the problems of every
 * unit that did not (a problem with a source counts against each unit that cites it). `issues` is
 * everything to send back, including problems that belong to no unit; it is empty only when every
 * unit passed.
 */
export type VerdictResult = {
  ok: boolean;
  checks: Record<string, ClaimCheck>;
  failures: Map<string, string[]>;
  issues: string[];
};

/** Validate a submission against the scope it was asked about and turn it into results by unit key. */
export function checkVerdicts(input: unknown, context: VerdictContext): VerdictResult {
  const parsed = SubmitVerdicts.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
    const failure = ['the submission did not match the submit_verdicts schema'];
    return {
      ok: false,
      checks: {},
      failures: new Map(context.units.map((unit) => [unit.id, failure])),
      issues,
    };
  }
  const { sources, verdicts } = parsed.data;
  const issues: string[] = [];
  const failures = new Map<string, string[]>();
  const fail = (unitId: string, issue: string) => {
    failures.set(unitId, [...(failures.get(unitId) ?? []), issue]);
  };

  const declared = new Map(context.sources.map((source) => [source.id, source]));
  /** Problems with how a source was reported, which hold back every unit citing it. */
  const sourceIssues = new Map<string, string[]>();
  const sourceIssue = (id: string, issue: string) => {
    issues.push(issue);
    sourceIssues.set(id, [...(sourceIssues.get(id) ?? []), issue]);
  };
  const readings = new Map<string, SubmitVerdicts['sources'][number]>();
  for (const reading of sources) {
    const source = declared.get(reading.id);
    if (!source) {
      issues.push(`sources: "${reading.id}" is not a source in this task`);
      continue;
    }
    if (readings.has(reading.id)) {
      sourceIssue(reading.id, `sources: "${reading.id}" is listed twice`);
      continue;
    }
    readings.set(reading.id, reading);
    if (reading.status === 'read' && !context.fetched.has(normalizeUrl(source.url))) {
      sourceIssue(
        reading.id,
        `sources.${reading.id}: marked read, but ${source.url} was not fetched ${context.fetchedWith ?? 'with web_fetch or fetch_page in this conversation'}. Fetch it, or mark it unreachable and say why.`,
      );
    }
    if (reading.status === 'unreachable' && !reading.note?.trim()) {
      sourceIssue(reading.id, `sources.${reading.id}: say why the page could not be read`);
    }
  }
  for (const id of declared.keys()) {
    if (!readings.has(id)) sourceIssue(id, `sources: report whether "${id}" could be read`);
  }

  // Each page's text is normalized once, however many quotes are checked against it.
  const normalizedPages = new Map<string, string[]>();
  const pagesOf = (url: string) => {
    const key = normalizeUrl(url);
    if (!normalizedPages.has(key)) {
      const pages = context.texts.get(key);
      if (!pages) return undefined;
      normalizedPages.set(key, pages.map(normalizeForMatch));
    }
    return normalizedPages.get(key);
  };

  const textFrom = context.textFrom ?? 'the text fetched from';
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
      fail(unit.id, `${at}: give one verdict per unit`);
      continue;
    }
    seen.add(unit.id);
    const unitIssues: string[] = [];
    const unitSources = unit.sources.map((source) => source.id);
    const read = unitSources.filter((id) => readings.get(id)?.status === 'read');
    const unreachable = unitSources.filter((id) => readings.get(id)?.status === 'unreachable');
    const { verdict } = entry;

    if ((verdict === 'supported') !== (entry.unsupported.length === 0)) {
      unitIssues.push(
        verdict === 'supported'
          ? `${at}: a supported unit has no unsupported phrases; use partly_supported if some text is not stated`
          : `${at}: list the phrases the sources do not state in unsupported`,
      );
    }
    for (const phrase of entry.unsupported) {
      if (!quoteInText(phrase, unit.text)) {
        unitIssues.push(`${at}: "${phrase}" is not in the unit text; copy the phrase exactly`);
      }
    }
    if ((verdict === 'supported' || verdict === 'partly_supported') && !entry.evidence.length) {
      unitIssues.push(`${at}: give a short quote from a source for what is supported`);
    }
    for (const item of entry.evidence) {
      if (!read.includes(item.sourceId)) {
        unitIssues.push(
          `${at}: evidence from "${item.sourceId}" must come from a source this unit cites and you read (${read.join(', ') || 'none read'})`,
        );
        continue;
      }
      const words = quoteWords(item.quote);
      if (words > QUOTE_MAX_WORDS) {
        unitIssues.push(
          `${at}: the quote "${item.quote}" has ${words} words; a quote must be under ${QUOTE_MAX_WORDS + 1} words, so quote only the words that state the claim, or give each part as its own quote`,
        );
        continue;
      }
      const url = declared.get(item.sourceId)!.url;
      const pages = pagesOf(url);
      if (!pages && context.missingText) {
        unitIssues.push(
          `${at}: the quote "${item.quote}" cannot be checked: ${context.missingText(url)}`,
        );
        continue;
      }
      const matches = pages?.map((page) => matchNormalized(item.quote, page, QUOTE_MAX_GAP));
      if (pages && matches && !matches.includes('found')) {
        const note = context.textNote?.(url);
        unitIssues.push(
          matches.includes('too_far_apart')
            ? `${at}: the parts of the quote "${item.quote}" are more than ${QUOTE_MAX_GAP} characters apart in ${textFrom} ${url}; a "..." may skip only a few words within one passage, so quote one passage or give each part as its own quote`
            : `${at}: the quote "${item.quote}" is not in ${textFrom} ${url}: ${describeMismatch(item.quote, pages[0])}. Copy the words exactly (use "..." for a gap) or leave the quote out.${note ? ` ${note}` : ''}`,
        );
      }
    }
    if (verdict === 'source_unreachable' && !unreachable.length) {
      unitIssues.push(
        `${at}: source_unreachable needs one of its sources (${unitSources.join(', ')}) marked unreachable`,
      );
    }
    if (verdict !== 'source_unreachable' && !read.length) {
      unitIssues.push(
        `${at}: none of its sources could be read, so the verdict is source_unreachable`,
      );
    }
    issues.push(...unitIssues);
    const blocked = [...unitIssues, ...unitSources.flatMap((id) => sourceIssues.get(id) ?? [])];
    if (blocked.length) {
      blocked.forEach((issue) => fail(unit.id, issue));
      continue;
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
        status: readings.get(source.id)!.status,
        note: readings.get(source.id)!.note,
      })),
      ...context.stamp,
    };
  }
  for (const unit of context.units) {
    if (seen.has(unit.id)) continue;
    issues.push(`verdicts: give a verdict for "${unit.id}"`);
    fail(unit.id, `verdicts: give a verdict for "${unit.id}"`);
  }
  // A unit that passed but was also answered twice is not trusted either.
  for (const unit of context.units) if (failures.has(unit.id)) delete checks[unit.key];
  return { ok: issues.length === 0, checks, failures, issues };
}
