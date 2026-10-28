// How a subagent reads a page through a pipeline command: one fetch from this computer with PDFs
// on, then the text printed in chunks that fit Claude Code's output, or the places where some
// words appear. Agent drafting (content:agent fetch) and the agent claim check
// (content:claims-agent fetch) share it, and the claim check's live verification fetches with the
// same limits.
import { fetchPage, NetworkCutError, type FetchedPage } from '../claims/local-fetch';
import { unreadableText } from './page-check';
import type { EvidenceRecord } from './session';

/**
 * Characters printed per fetch: about 5k tokens, under the 30,000 characters Claude Code shows
 * of a command's output, with room for the header.
 */
export const CHUNK_CHARACTERS = 20_000;
/** Pages are kept up to this length and read in chunks; a long statistics PDF fits. */
export const MAX_PAGE_CHARACTERS = 2_000_000;
const MAX_FETCH_BYTES = 40_000_000;
const FETCH_TIMEOUT_MS = 60_000;
/**
 * Waits before trying again after a server error (5xx). The 504s seen from usgs.gov lasted longer
 * than a subagent's own retries within a minute, so the attempts span about a minute and a half;
 * a page that answers at once never waits.
 */
export const SERVER_ERROR_RETRIES_MS = [5_000, 20_000, 60_000];
/**
 * Waits before downloading a page again after the connection was cut in the middle of its body.
 * A 328k-character PDF was cut twice in a row and then downloaded whole, so there are three more
 * attempts, a few seconds apart; a page that downloads whole never waits.
 */
export const BODY_CUT_RETRIES_MS = [2_000, 8_000, 20_000];
/** Places listed per search term unless --matches asks for more; repetitive pages have hundreds. */
export const DEFAULT_FIND_MATCHES = 5;
/** The most places --matches may list per term in one call. */
export const MAX_FIND_MATCHES = 50;

const number = (value: number) => value.toLocaleString('en-US');

export type ReadingFetchOptions = {
  /** The fetch implementation; tests pass a stub. */
  fetch?: typeof fetch;
  /** Waits between attempts after a server error or a cut body; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
};

/** Fetch a page on this computer with PDFs on, or throw with the reason it could not be read. */
export const fetchForReading = (
  url: string,
  options: ReadingFetchOptions = {},
): Promise<FetchedPage> =>
  fetchPage(url, {
    pdf: true,
    maxCharacters: MAX_PAGE_CHARACTERS,
    maxBytes: MAX_FETCH_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    serverErrorRetriesMs: SERVER_ERROR_RETRIES_MS,
    bodyCutRetriesMs: BODY_CUT_RETRIES_MS,
    sleep: options.sleep,
    fetch: options.fetch,
  });

/** Why a fetch failed, for a person or a subagent. */
export function fetchFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no answer within ${FETCH_TIMEOUT_MS / 1000} seconds`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Whether a fetch failed because the connection was cut, on every attempt, not because of the page. */
export const isNetworkCut = (error: unknown) => error instanceof NetworkCutError;

export function describeRecord(record: EvidenceRecord): string {
  return [
    `HTTP ${record.status}`,
    record.contentType || 'unknown type',
    `${number(record.characters)} characters${record.truncated ? ` (cut off at ${number(MAX_PAGE_CHARACTERS)})` : ''}`,
    `fetched ${record.fetchedAt}`,
  ].join(', ');
}

/** The warning printed with a page whose text is probably not its words, or undefined. */
export function unreadableWarning(record: Pick<EvidenceRecord, 'text'>): string | undefined {
  const reason = unreadableText(record.text);
  return reason
    ? `WARNING: the text could not be extracted from this page: ${reason}. Searches and quotes will not find what the page says; choose another source or another copy of the document.`
    : undefined;
}

/**
 * Print the chunk that starts at `offset`, or without one at the page's main text when the page
 * marks where it starts after its navigation; `next` is the command that prints the chunk at an
 * offset. Offsets always count from the start of the stored text.
 */
export function printChunk(
  record: EvidenceRecord,
  requested: number | undefined,
  next: (offset: number) => string,
  out: (line: string) => void,
): number {
  const { text } = record;
  const offset = requested ?? record.mainOffset ?? 0;
  if (offset < 0 || (offset > 0 && offset >= text.length)) {
    out(`--offset must be between 0 and ${number(Math.max(0, text.length - 1))}.`);
    return 1;
  }
  if (requested === undefined && record.mainOffset) {
    out(
      `The page's main text starts at character ${number(record.mainOffset)}; the ${number(record.mainOffset)} characters before it are mostly navigation. Print them with ${next(0)}`,
    );
  }
  const end = Math.min(text.length, offset + CHUNK_CHARACTERS);
  const after = end < text.length ? ` Next part: ${next(end)}` : ' This is the end of the text.';
  out(`Characters ${number(offset)} to ${number(end)} of ${number(text.length)}.${after}`);
  out('-----');
  out(text.slice(offset, end));
  out('-----');
  return 0;
}

const formatLink = ({ url, text }: { url: string; text: string }) =>
  `${text || '(no text)'} | ${url}`;

/**
 * Print links from the `offset`-th on, as many as fit in one chunk of output; `next` is the
 * command that prints the ones after them.
 */
export function printLinks(
  record: EvidenceRecord,
  offset: number,
  next: (offset: number) => string,
  out: (line: string) => void,
): number {
  const { links } = record;
  if (!links) {
    out('This stored copy was fetched before links were kept. Fetch it again with --refresh.');
    return 1;
  }
  if (!links.length) {
    out('The page has no links.');
    return 0;
  }
  if (offset < 0 || offset >= links.length) {
    out(`With --links, --offset counts links: between 0 and ${links.length - 1}.`);
    return 1;
  }
  let end = offset;
  let size = 0;
  while (end < links.length && (end === offset || size < CHUNK_CHARACTERS)) {
    size += formatLink(links[end]).length + 1;
    end += 1;
  }
  const after = end < links.length ? ` Next part: ${next(end)}` : ' This is the end of the links.';
  out(`Links ${offset + 1} to ${end} of ${links.length}, as "text | URL".${after}`);
  out('-----');
  for (const link of links.slice(offset, end)) out(formatLink(link));
  out('-----');
  return 0;
}

/**
 * List where each search term appears (ignoring case), at most `perTerm` places per term from
 * character `from` on, with some text around each place and how many there are in all. `around`
 * reads from an offset; `more` lists a term's places from an offset on. When a term is missing
 * and the text was probably not extracted, the miss says so.
 */
export function printMatches(
  record: EvidenceRecord,
  terms: string[],
  from: number,
  perTerm: number,
  around: string,
  more: (term: string, from: number) => string,
  out: (line: string) => void,
): number {
  const { text } = record;
  if (from < 0 || (from > 0 && from >= text.length)) {
    out(`--offset must be between 0 and ${number(Math.max(0, text.length - 1))}.`);
    return 1;
  }
  const haystack = text.toLowerCase();
  let unreadable: string | undefined | null = null;
  const times = (count: number) => (count === 1 ? 'once' : `${number(count)} times`);
  for (const term of terms) {
    if (terms.length > 1) out(`## ${term}`);
    const needle = term.toLowerCase();
    const offsets: number[] = [];
    for (
      let at = haystack.indexOf(needle);
      at !== -1;
      at = haystack.indexOf(needle, at + needle.length)
    ) {
      offsets.push(at);
    }
    const first = offsets.findIndex((offset) => offset >= from);
    if (first === -1) {
      if (offsets.length) {
        out(
          `"${term}" appears ${times(offsets.length)} in the text, but not from character ${number(from)} on. List them all by leaving out --offset.`,
        );
        continue;
      }
      unreadable ??= unreadableText(text);
      out(
        unreadable
          ? `"${term}" does not appear in the text, but the text could not be extracted from this page (${unreadable}), so the page may still say it. Choose another source or another copy of the document.`
          : `"${term}" does not appear in the text. Try another word or spelling, or a shorter part of a word.`,
      );
      continue;
    }
    const shown = offsets.slice(first, first + perTerm);
    const last = first + shown.length;
    out(
      `"${term}" appears ${times(offsets.length)} in the text${offsets.length > 1 ? `; matches ${first + 1} to ${last}` : ''}${from > 0 ? `, from character ${number(from)} on` : ''}. Each excerpt shows line breaks and runs of spaces as one space.`,
    );
    for (const offset of shown) {
      const excerpt = text
        .slice(Math.max(0, offset - 150), offset + needle.length + 150)
        .replace(/\s+/g, ' ');
      out(`- offset ${offset}: ...${excerpt}...`);
    }
    if (last < offsets.length) {
      out(`${number(offsets.length - last)} more: ${more(term, shown.at(-1)! + 1)}`);
    }
  }
  out(`Read around a match with ${around}`);
  return 0;
}

/** The value of --matches, or a message saying why it is not one. */
export function findMatches(value: number | undefined): number | string {
  const matches = value ?? DEFAULT_FIND_MATCHES;
  return Number.isInteger(matches) && matches >= 1 && matches <= MAX_FIND_MATCHES
    ? matches
    : `--matches is a whole number from 1 to ${MAX_FIND_MATCHES}.`;
}

/** A shell argument in double quotes, for the commands printed to run next. */
export const shellQuote = (value: string) => `"${value.replace(/(["\\$`])/g, '\\$1')}"`;

/**
 * Print what a fetch asked for from a stored page: a chunk of its text, its links, or where some
 * words appear. `fetch` turns options into the command that prints another part. Agent drafting
 * and the agent claim check print the same way.
 */
export function printPart(
  record: EvidenceRecord,
  options: { offset?: number; find?: string[]; matches: number; links?: boolean },
  fetch: (args: string) => string,
  out: (line: string) => void,
): number {
  const read = (offset: number | string) => fetch(` --offset ${offset}`);
  if (options.links) {
    return printLinks(
      record,
      options.offset ?? 0,
      (offset) => fetch(` --links --offset ${offset}`),
      out,
    );
  }
  if (options.find?.length) {
    const matchesFlag =
      options.matches === DEFAULT_FIND_MATCHES ? '' : ` --matches ${options.matches}`;
    const more = (term: string, from: number) =>
      fetch(` --find ${shellQuote(term)}${matchesFlag} --offset ${from}`);
    return printMatches(
      record,
      options.find,
      options.offset ?? 0,
      options.matches,
      read('<n>'),
      more,
      out,
    );
  }
  return printChunk(record, options.offset, read, out);
}
