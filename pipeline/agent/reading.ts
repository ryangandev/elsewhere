// How a subagent reads a page through a pipeline command: one fetch from this computer with PDFs
// on, then the text printed in chunks that fit Claude Code's output, or the places where some
// words appear. Agent drafting (content:agent fetch) and the agent claim check
// (content:claims-agent fetch) share it, and the claim check's live verification fetches with the
// same limits.
import { fetchPage, type FetchedPage } from '../claims/local-fetch';
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
const MAX_FIND_MATCHES = 20;

const number = (value: number) => value.toLocaleString('en-US');

export type ReadingFetchOptions = {
  /** The fetch implementation; tests pass a stub. */
  fetch?: typeof fetch;
  /** Waits between attempts after a server error; tests pass one that returns at once. */
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

export function describeRecord(record: EvidenceRecord): string {
  return [
    `HTTP ${record.status}`,
    record.contentType || 'unknown type',
    `${number(record.characters)} characters${record.truncated ? ` (cut off at ${number(MAX_PAGE_CHARACTERS)})` : ''}`,
    `fetched ${record.fetchedAt}`,
  ].join(', ');
}

/** Print the chunk that starts at `offset`; `next` is the command that prints the one after it. */
export function printChunk(
  record: EvidenceRecord,
  offset: number,
  next: (offset: number) => string,
  out: (line: string) => void,
): number {
  const { text } = record;
  if (offset < 0 || (offset > 0 && offset >= text.length)) {
    out(`--offset must be between 0 and ${number(Math.max(0, text.length - 1))}.`);
    return 1;
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
 * List where `find` appears (ignoring case), at most MAX_FIND_MATCHES at a time from character
 * `from` on, with some text around each place and how many there are in all. `around` reads from
 * an offset; `more` lists the matches from an offset on.
 */
export function printMatches(
  record: EvidenceRecord,
  find: string,
  from: number,
  around: string,
  more: (from: number) => string,
  out: (line: string) => void,
): number {
  const { text } = record;
  if (from < 0 || (from > 0 && from >= text.length)) {
    out(`--offset must be between 0 and ${number(Math.max(0, text.length - 1))}.`);
    return 1;
  }
  const needle = find.toLowerCase();
  const haystack = text.toLowerCase();
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
    out(
      offsets.length
        ? `"${find}" appears ${offsets.length === 1 ? 'once' : `${number(offsets.length)} times`} in the text, but not from character ${number(from)} on. List them all by leaving out --offset.`
        : `"${find}" does not appear in the text. Try another word or spelling, or a shorter part of a word.`,
    );
    return 0;
  }
  const shown = offsets.slice(first, first + MAX_FIND_MATCHES);
  const last = first + shown.length;
  out(
    `"${find}" appears ${offsets.length === 1 ? 'once' : `${number(offsets.length)} times`} in the text${offsets.length > 1 ? `; matches ${first + 1} to ${last}` : ''}${from > 0 ? `, from character ${number(from)} on` : ''}. Each excerpt shows line breaks and runs of spaces as one space.`,
  );
  for (const offset of shown) {
    const excerpt = text
      .slice(Math.max(0, offset - 150), offset + needle.length + 150)
      .replace(/\s+/g, ' ');
    out(`- offset ${offset}: ...${excerpt}...`);
  }
  if (last < offsets.length) out(`Next matches: ${more(shown.at(-1)! + 1)}`);
  out(`Read around a match with ${around}`);
  return 0;
}
