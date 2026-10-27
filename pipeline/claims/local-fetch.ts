// Read pages from the editor's computer, as an ordinary request from a browser would.
//
// - The claim check offers fetchPageText as its fetch_page tool, a fallback for pages the
//   server-side web fetch cannot read: some sites refuse Anthropic's fetcher but answer a request
//   from here. It is limited to the cited URLs of its task. It reads HTML and plain text as the
//   server returns them; it runs no scripts and does not read PDFs.
// - Agent drafting (pipeline/agent) reads every page it cites through fetchPage with PDFs on,
//   and keeps the text as evidence.
// - The agent claim check (pipeline/claims-agent) reads cited pages the same way, and fetches every
//   quoted page again at submission to verify its quotes against the live text.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson } from '../content-tree';
import { USER_AGENT } from '../validate/urls';

/** Fetch a page and return its readable text, or throw with the reason it could not be read. */
export type PageFetcher = (url: string) => Promise<string>;

/** About 40k tokens: most of a long article after navigation and markup are stripped. */
const MAX_CHARACTERS = 160_000;
/** Larger downloads are refused before they are read; statistics PDFs can be tens of megabytes. */
const MAX_BYTES = 20_000_000;
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

/** A link on an HTML page: an absolute URL and its anchor text (empty when it has none). */
export type PageLink = { url: string; text: string };

/** Pages with more links than this keep the first ones, in page order. */
const MAX_LINKS = 5000;
const MAX_LINK_TEXT = 150;

/** The value of an HTML attribute, decoded, or undefined when the tag has no such attribute. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(
    tag,
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? undefined : decodeEntities(value);
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The links of an HTML page in page order, as absolute http(s) URLs without fragments, each
 * once, with the anchor text of its first link that has any. Links to the page itself, mailto:
 * and javascript: links are left out. An image link is described by its title or alt text.
 */
export function extractLinks(html: string, pageUrl: string): PageLink[] {
  const self = new URL(pageUrl);
  self.hash = '';
  const links = new Map<string, string>();
  for (const [, tag, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attribute(tag, 'href')?.trim();
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, self);
    } catch {
      continue;
    }
    url.hash = '';
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.href === self.href) continue;
    const text = collapse(
      htmlToText(inner) ||
        attribute(tag, 'aria-label') ||
        attribute(tag, 'title') ||
        attribute(/<img\b[^>]*>/i.exec(inner)?.[0] ?? '', 'alt') ||
        '',
    );
    const shown = text.length > MAX_LINK_TEXT ? `${text.slice(0, MAX_LINK_TEXT)}...` : text;
    if (links.has(url.href)) {
      if (!links.get(url.href) && shown) links.set(url.href, shown);
    } else if (links.size < MAX_LINKS) {
      links.set(url.href, shown);
    }
  }
  return [...links].map(([url, text]) => ({ url, text }));
}

export type FetchedPage = {
  /** The URL asked for. */
  url: string;
  /** Where redirects ended. */
  finalUrl: string;
  status: number;
  contentType: string;
  text: string;
  /** The text was cut off at the character limit. */
  truncated: boolean;
  /** The page's links; empty for plain text and PDF, whose text is all that is kept. */
  links: PageLink[];
};

export type FetchPageOptions = {
  /** Also read PDFs, as their text layer with a "[Page n]" line before each page. */
  pdf?: boolean;
  maxCharacters?: number;
  maxBytes?: number;
  timeoutMs?: number;
  /** The fetch implementation; tests pass a stub. */
  fetch?: typeof fetch;
};

/**
 * Phrases of the interstitial pages that bot protection serves instead of the content (Cloudflare,
 * Akamai, Imperva and the like), sometimes with a 200. Only short pages are tested, so an
 * article that mentions a captcha is still read.
 */
const BOT_CHALLENGE =
  /just a moment\.\.\.|checking (if the site connection is secure|your browser)|enable javascript and cookies to continue|verify(ing)? (that )?you are (a )?human|are you a robot|attention required|pardon our interruption|request unsuccessful\. incapsula|captcha/i;
const BOT_CHALLENGE_MAX_CHARACTERS = 3000;

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** The body, refusing one larger than maxBytes before or while it downloads. */
async function readBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  const tooLarge = (size: number) =>
    new Error(`the page is over ${megabytes(maxBytes)} (${megabytes(size)} so far)`);
  if (declared > maxBytes) throw tooLarge(declared);
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(size);
    }
    chunks.push(read.value);
  }
  return Buffer.concat(chunks);
}

const CHARSET = /charset\s*=\s*["']?([\w.:-]+)/i;

/** How far into an HTML document a <meta> charset declaration is looked for (HTML says 1024 bytes). */
const META_SNIFF_BYTES = 2048;

/**
 * The charset an HTML document declares in a <meta charset> or <meta http-equiv="Content-Type">
 * near its start. The bytes are read as Latin-1, which keeps ASCII as it is in every charset a
 * declaration can name.
 */
function sniffMetaCharset(body: Uint8Array): string | undefined {
  const head = Buffer.from(body.subarray(0, META_SNIFF_BYTES)).toString('latin1');
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const charset = CHARSET.exec(tag)?.[1];
    if (charset) return charset;
  }
  return undefined;
}

/** The decoder for a charset label, or undefined when TextDecoder does not know it. */
function decoder(label: string): TextDecoder | undefined {
  try {
    return new TextDecoder(label);
  } catch {
    return undefined;
  }
}

/**
 * Text in the charset the response declares in its Content-Type header, else the one an HTML page
 * declares in a <meta> tag, else UTF-8. A page that declares nothing and is not valid UTF-8 (UTF-8
 * decoding leaves replacement characters) is read as windows-1252, which older government sites
 * such as Argentina's InfoLEG still serve without saying so, so "Constitución" does not become
 * "Constituci�n".
 */
function decode(body: Uint8Array, contentType: string): string {
  const declared =
    CHARSET.exec(contentType)?.[1] ??
    (/html/i.test(contentType) ? sniffMetaCharset(body) : undefined);
  const chosen = declared ? decoder(declared) : undefined;
  if (chosen) return chosen.decode(body);
  const text = new TextDecoder('utf-8').decode(body);
  return text.includes('�') ? new TextDecoder('windows-1252').decode(body) : text;
}

const isPdf = (body: Uint8Array) => Buffer.from(body.subarray(0, 5)).toString('latin1') === '%PDF-';

/** The text layer of a PDF, with a "[Page n]" line before each page. */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pages: string[];
  try {
    // pdf.js refuses a Node Buffer and may take ownership of the bytes, so it gets its own copy.
    const document = await getDocumentProxy(new Uint8Array(data));
    ({ text: pages } = await extractText(document, { mergePages: false }));
  } catch (error) {
    throw new Error(
      `the PDF could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const cleaned = pages.map((page) =>
    page
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n'),
  );
  if (!cleaned.some(Boolean)) throw new Error('the PDF has no text layer; it may be a scan');
  return cleaned.map((page, index) => `[Page ${index + 1}]\n${page}`).join('\n\n');
}

/** What a failed request says in `error.cause`: its error code and message, if it has either. */
function causeDetail(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const { code, message, errors } = cause as {
    code?: unknown;
    message?: unknown;
    errors?: unknown;
  };
  const text = typeof message === 'string' ? message : '';
  const name = typeof code === 'string' ? code : '';
  if (text) return !name || text.includes(name) ? text : `${name}: ${text}`;
  // A connection refused on every address is an AggregateError with no message of its own.
  return name || (Array.isArray(errors) ? causeDetail(errors[0]) : undefined);
}

/**
 * Node's fetch reports every network failure as "fetch failed" and keeps the real reason (a
 * redirect loop, a certificate for another name, a reset connection, an unknown host) in the
 * error's cause. The reason is added to the message so a person or an agent can tell a page that
 * will never load from one that may load later.
 */
async function request(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const detail = error instanceof Error ? causeDetail(error.cause) : undefined;
    if (!(error instanceof Error) || !detail) throw error;
    throw new Error(`${error.message} (${detail})`, { cause: error });
  }
}

/** Fetch a page and extract its text, or throw with the reason it could not be read. */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  const {
    pdf = false,
    maxCharacters = MAX_CHARACTERS,
    maxBytes = MAX_BYTES,
    timeoutMs = TIMEOUT_MS,
  } = options;
  const response = await request(options.fetch ?? fetch, url, {
    redirect: 'follow',
    headers: {
      'user-agent': USER_AGENT,
      accept: pdf
        ? 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5'
        : 'text/html,text/plain;q=0.9,*/*;q=0.5',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  const isText = /text\/(html|plain)|application\/xhtml/i.test(contentType);
  // Servers often label a PDF as a download, so a PDF is recognised by its first bytes.
  const mayBePdf = pdf && /application\/(pdf|octet-stream)|binary\/octet-stream/i.test(contentType);
  if (!isText && !mayBePdf) {
    throw new Error(
      `the page is ${contentType || 'of an unknown type'}; only HTML${pdf ? ', plain text and PDF' : ' and plain text'} are read`,
    );
  }
  const body = await readBody(response, maxBytes);
  let text: string;
  let links: PageLink[] = [];
  if (pdf && isPdf(body)) {
    text = await pdfToText(body);
  } else if (isText) {
    const raw = decode(body, contentType);
    const html = /html/i.test(contentType);
    text = html ? htmlToText(raw) : raw.trim();
    if (html) links = extractLinks(raw, response.url || url);
    if (!text) throw new Error('the page has no text without running its scripts');
    if (text.length <= BOT_CHALLENGE_MAX_CHARACTERS && BOT_CHALLENGE.test(text)) {
      throw new Error('the server answered with a bot challenge instead of the page');
    }
  } else {
    throw new Error(`the page is ${contentType} but not a PDF`);
  }
  const truncated = text.length > maxCharacters;
  return {
    url,
    finalUrl: response.url || url,
    status: response.status,
    contentType,
    text: truncated ? text.slice(0, maxCharacters) : text,
    truncated,
    links,
  };
}

export const fetchPageText: PageFetcher = async (url) => {
  const page = await fetchPage(url);
  return page.truncated ? `${page.text}\n[Cut off after ${MAX_CHARACTERS} characters.]` : page.text;
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
