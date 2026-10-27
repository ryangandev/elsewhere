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
const MAX_FIND_MATCHES = 20;

const number = (value: number) => value.toLocaleString('en-US');

/** Fetch a page on this computer with PDFs on, or throw with the reason it could not be read. */
export const fetchForReading = (url: string, fetchImpl?: typeof fetch): Promise<FetchedPage> =>
  fetchPage(url, {
    pdf: true,
    maxCharacters: MAX_PAGE_CHARACTERS,
    maxBytes: MAX_FETCH_BYTES,
    timeoutMs: FETCH_TIMEOUT_MS,
    fetch: fetchImpl,
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

/** List where `find` appears, with some text around each place; `around` reads from an offset. */
export function printMatches(
  record: EvidenceRecord,
  find: string,
  around: string,
  out: (line: string) => void,
): number {
  const needle = find.toLowerCase();
  const haystack = record.text.toLowerCase();
  const offsets: number[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1 && offsets.length <= MAX_FIND_MATCHES) {
    offsets.push(index);
    index = haystack.indexOf(needle, index + needle.length);
  }
  if (!offsets.length) {
    out(`"${find}" does not appear in the text. Try another word or spelling.`);
    return 0;
  }
  const shown = offsets.slice(0, MAX_FIND_MATCHES);
  out(
    offsets.length > shown.length
      ? `"${find}" appears more than ${shown.length} times; the first ${shown.length}:`
      : `"${find}" appears ${shown.length} ${shown.length === 1 ? 'time' : 'times'}:`,
  );
  for (const offset of shown) {
    const text = record.text
      .slice(Math.max(0, offset - 150), offset + needle.length + 150)
      .replace(/\s+/g, ' ');
    out(`- offset ${offset}: ...${text}...`);
  }
  out(`Read around a match with ${around}`);
  return 0;
}
