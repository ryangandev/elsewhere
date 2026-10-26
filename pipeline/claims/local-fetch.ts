// A fallback for pages the server-side web fetch cannot read: some sites refuse Anthropic's
// fetcher but answer a request from the editor's computer. The claim check offers it as the
// fetch_page tool, limited to the cited URLs of its task. It reads HTML and plain text as the
// server returns them; it runs no scripts and does not read PDFs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../content-tree';
import { USER_AGENT } from '../validate/urls';

/** Fetch a page and return its readable text, or throw with the reason it could not be read. */
export type PageFetcher = (url: string) => Promise<string>;

/** About 40k tokens: most of a long article after navigation and markup are stripped. */
const MAX_CHARACTERS = 160_000;
const TIMEOUT_MS = 20_000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  hellip: '...',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** The visible text of an HTML document, one block per line. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(
      /<\/?(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi,
      '\n',
    )
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export const fetchPageText: PageFetcher = async (url) => {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  const type = response.headers.get('content-type') ?? '';
  if (!/text\/(html|plain)|application\/xhtml/i.test(type)) {
    throw new Error(
      `the page is ${type || 'of an unknown type'}; only HTML and plain text are read`,
    );
  }
  const body = await response.text();
  const text = /html/i.test(type) ? htmlToText(body) : body.trim();
  if (!text) throw new Error('the page has no text without running its scripts');
  return text.length > MAX_CHARACTERS
    ? `${text.slice(0, MAX_CHARACTERS)}\n[Cut off after ${MAX_CHARACTERS} characters.]`
    : text;
};

/** A recorded fetch_page answer: the text, or why the page could not be read. */
type RecordedPage = { url: string; text?: string; error?: string };

const pageFile = (dir: string, url: string) =>
  join(dir, 'pages', `${createHash('sha256').update(url).digest('hex').slice(0, 16)}.json`);

/** Saves every answer next to the recorded responses, so `--replay` can give the same ones. */
export function recordPages(inner: PageFetcher, dir: string): PageFetcher {
  return async (url) => {
    const save = (page: RecordedPage) => {
      mkdirSync(join(dir, 'pages'), { recursive: true });
      writeJson(pageFile(dir, url), page);
    };
    try {
      const text = await inner(url);
      save({ url, text });
      return text;
    } catch (error) {
      save({ url, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
}

/** Answers from a recording made with recordPages, without the network. */
export function replayPages(dir: string): PageFetcher {
  return async (url) => {
    const file = pageFile(dir, url);
    if (!existsSync(file)) throw new Error(`no recorded page for ${url} (${file})`);
    const page = JSON.parse(readFileSync(file, 'utf8')) as RecordedPage;
    if (page.text === undefined) throw new Error(page.error ?? 'the recorded fetch failed');
    return page.text;
  };
}
