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
import { decodeHTML, decodeHTMLAttribute } from 'entities';
import { writeJson } from '../content-tree';
import { USER_AGENT } from '../validate/urls';

/** Fetch a page and return its readable text, or throw with the reason it could not be read. */
export type PageFetcher = (url: string) => Promise<string>;

/** About 40k tokens: most of a long article after navigation and markup are stripped. */
const MAX_CHARACTERS = 160_000;
/** Larger downloads are refused before they are read; statistics PDFs can be tens of megabytes. */
const MAX_BYTES = 20_000_000;
const TIMEOUT_MS = 20_000;

const isSpace = (char: string | undefined) =>
  char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';

/** A tag as a browser reads it: where it ends, and its attributes by lower-case name (first wins). */
type Tag = { end: number; attributes: Map<string, string> };

/**
 * Read the attributes of a tag whose name ends at `from`, up to its closing ">", the way a browser
 * tokenizes them. A quote opens a value only right after "=" (an attribute name may hold quotes,
 * `data-x"y`, and an unquoted value may hold them, `title=Don't`), and a quoted value may hold
 * ">", which is how pib.gov.in keeps an escaped copy of each release in a hidden input. Undefined
 * when the tag never ends: a browser reads the rest of the document as that tag, and so does this.
 * One pass over the tag, so a long run of broken tags costs time in proportion to its length.
 * Attribute values are collected, and decoded, only when `collect` is set.
 */
function scanTag(html: string, from: number, collect = false): Tag | undefined {
  const attributes = new Map<string, string>();
  const length = html.length;
  let i = from;
  while (i < length) {
    const char = html[i];
    if (char === '>') return { end: i + 1, attributes };
    if (char === '/' || isSpace(char)) {
      i += 1;
      continue;
    }
    const nameStart = i;
    i += 1;
    while (
      i < length &&
      !isSpace(html[i]) &&
      html[i] !== '/' &&
      html[i] !== '>' &&
      html[i] !== '='
    ) {
      i += 1;
    }
    const name = html.slice(nameStart, i).toLowerCase();
    let at = i;
    while (isSpace(html[at])) at += 1;
    let value = '';
    if (html[at] === '=') {
      at += 1;
      while (isSpace(html[at])) at += 1;
      const quote = html[at];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, at + 1);
        if (close === -1) return undefined;
        value = html.slice(at + 1, close);
        i = close + 1;
      } else {
        const start = at;
        while (at < length && !isSpace(html[at]) && html[at] !== '>') at += 1;
        value = html.slice(start, at);
        i = at;
      }
    }
    if (collect && !attributes.has(name)) attributes.set(name, decodeHTMLAttribute(value));
  }
  return undefined;
}

/** Whether `char` ends a tag name: whitespace, "/" or ">". */
const endsName = (char: string | undefined) => isSpace(char) || char === '/' || char === '>';

/**
 * Where the end tag that starts at `lt` (`</name`, then whitespace, "/" or ">") ends, or undefined
 * when the text there is not an end tag of `name`. Like any tag it may have attributes
 * (`</script type="x">`). Returns -1 when the tag never ends, which a browser reads to the end of
 * the document.
 */
function endTagAt(html: string, lt: number, name: string): number | undefined {
  if (html[lt] !== '<' || html[lt + 1] !== '/') return undefined;
  const nameEnd = lt + 2 + name.length;
  if (html.slice(lt + 2, nameEnd).toLowerCase() !== name || !endsName(html[nameEnd])) {
    return undefined;
  }
  return scanTag(html, nameEnd)?.end ?? -1;
}

/**
 * Where the content of a style, noscript, svg, template or head element ends (just after its end
 * tag), or -1: the first end tag of that name, which may have attributes.
 */
function rawElementEnd(html: string, from: number, name: string): number {
  const start = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
  start.lastIndex = from;
  const found = start.exec(html);
  return found ? (endTagAt(html, found.index, name) ?? -1) : -1;
}

/**
 * Where the content of a script element ends (just after its end tag), or -1, following the
 * browser's script data states. A script may hold `<!--`, and while it does a `<script` inside it
 * opens a nested script whose `</script` does not end the element; only a `</script` outside that
 * nesting does, and `-->` closes the comment. So `<script><!-- document.write("<script>x</script>")
 * ; var a = 1; --></script>` is one element, as the browser reads it. One pass.
 */
function scriptEnd(html: string, from: number): number {
  const length = html.length;
  let state: 'data' | 'escaped' | 'double' = 'data';
  let dashes = 0;
  let i = from;
  const word = (start: number) => {
    let end = start;
    while (end < length && /[a-zA-Z]/.test(html[end])) end += 1;
    return end;
  };
  while (i < length) {
    const char = html[i];
    if (char === '-' && state !== 'data') {
      dashes += 1;
      i += 1;
      continue;
    }
    if (char === '>' && state !== 'data' && dashes >= 2) {
      state = 'data';
      dashes = 0;
      i += 1;
      continue;
    }
    if (char !== '<') {
      dashes = 0;
      i += 1;
      continue;
    }
    dashes = 0;
    if (html[i + 1] === '/') {
      const end = state === 'double' ? undefined : endTagAt(html, i, 'script');
      if (end !== undefined) return end;
      if (state === 'double') {
        const nameEnd = word(i + 2);
        if (html.slice(i + 2, nameEnd).toLowerCase() === 'script' && endsName(html[nameEnd])) {
          state = 'escaped';
        }
        i = nameEnd;
      } else {
        i += 2;
      }
    } else if (state === 'data' && html.startsWith('!--', i + 1)) {
      state = 'escaped';
      dashes = 2;
      i += 4;
    } else if (state === 'escaped' && /[a-zA-Z]/.test(html[i + 1] ?? '')) {
      const nameEnd = word(i + 1);
      if (html.slice(i + 1, nameEnd).toLowerCase() === 'script' && endsName(html[nameEnd])) {
        state = 'double';
      }
      i = nameEnd;
    } else {
      i += 1;
    }
  }
  return -1;
}

/**
 * Where a comment that starts at `lt` (`<!--`) ends, just after its end, or -1. A browser ends a
 * comment at `-->` or `--!>`, and at once for the abrupt `<!-->` and `<!--->`.
 */
function commentEnd(html: string, lt: number): number {
  const from = lt + 4;
  if (html[from] === '>') return from + 1;
  if (html.startsWith('->', from)) return from + 2;
  const end = /--!?>/g;
  end.lastIndex = from;
  const found = end.exec(html);
  return found ? found.index + found[0].length : -1;
}

/** Elements whose start and end tags each break the text into lines. */
const BLOCK_ELEMENTS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'li',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'tr',
  'table',
  'blockquote',
]);
/** Elements whose content is never shown as text: scripts, styles, markup that is not rendered. */
const HIDDEN_ELEMENTS = new Set(['script', 'style', 'noscript', 'svg', 'template', 'head']);

/**
 * The visible text of an HTML document, one block per line: a line break comes from a block
 * element, a <br> or a row, never from a line break in the page's source, which a browser shows as
 * a space (except inside <pre>), so a paragraph the source wraps over many lines is one line, and a
 * table row whose cells the source puts on separate lines is one row. Character references are decoded
 * once, as a browser does, with every named reference HTML defines ("&eacute;" is "é"); text a
 * page escaped twice ("&amp;eacute;") shows as "&eacute;", as it does in a browser.
 *
 * Tags and comments are read by the browser's own rules where they matter for what is shown (see
 * scanTag, commentEnd and scriptEnd): a quote opens an attribute value only after "=", comments end
 * at `-->`, `--!>`, `<!-->` and `<!--->`, a bogus end tag (`</ p>`) is a comment and `</>` is
 * nothing, and a script, style, noscript, svg, template or head element is skipped whole to its
 * end tag, however the end tag is written, with the nesting a script allows after `<!--`. An
 * unterminated script or style takes the rest of the document. A tag the page never closes is not
 * text either. This is not a full HTML parser: it does not build a tree, so it does not repair
 * misnested elements, and text a page escaped (`&lt;`) shows as the text it spells, since a
 * reader sees it.
 */
export function htmlToText(html: string): string {
  let text = '';
  let at = 0;
  // Hidden elements with no end tag after some point have none after any later point.
  const unterminated = new Set<string>();
  // Inside <pre> a line break is a line break; anywhere else it is a space, as in a browser.
  let preformatted = 0;
  const shown = (segment: string) => (preformatted ? segment : segment.replace(/\s+/g, ' '));
  const tagName = /<(\/?)([a-zA-Z][^\s/>]*)/y;
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt === -1) {
      text += shown(html.slice(at));
      break;
    }
    text += shown(html.slice(at, lt));
    if (html.startsWith('<!--', lt)) {
      const close = commentEnd(html, lt);
      if (close === -1) break;
      text += ' ';
      at = close;
      continue;
    }
    // A declaration, a processing instruction, and an end tag that does not start with a letter
    // (`</ p>`) are bogus comments, which run to the next ">"; `</>` is ignored.
    const bogus =
      html[lt + 1] === '!' ||
      html[lt + 1] === '?' ||
      (html[lt + 1] === '/' && html[lt + 2] !== undefined && !/[a-zA-Z]/.test(html[lt + 2]));
    if (bogus) {
      if (html.startsWith('</>', lt)) {
        at = lt + 3;
        continue;
      }
      const close = html.indexOf('>', lt);
      if (close === -1) break;
      text += ' ';
      at = close + 1;
      continue;
    }
    tagName.lastIndex = lt;
    const named = tagName.exec(html);
    if (!named) {
      text += '<';
      at = lt + 1;
      continue;
    }
    const tag = scanTag(html, lt + named[0].length);
    if (!tag) break;
    at = tag.end;
    const closing = named[1] === '/';
    const name = named[2].toLowerCase();
    if (name === 'pre') preformatted = Math.max(0, preformatted + (closing ? -1 : 1));
    if (!closing && HIDDEN_ELEMENTS.has(name) && !unterminated.has(name)) {
      const end = name === 'script' ? scriptEnd(html, at) : rawElementEnd(html, at, name);
      if (end !== -1) {
        text += ' ';
        at = end;
        continue;
      }
      if (name === 'script' || name === 'style') break;
      unterminated.add(name);
    }
    text +=
      BLOCK_ELEMENTS.has(name) || (!closing && (name === 'br' || name === 'hr'))
        ? '\n'
        : !closing && (name === 'td' || name === 'th')
          ? ' | '
          : ' ';
  }
  return decodeHTML(text)
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

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The first start tag of an element in the HTML, or undefined. */
function firstTag(html: string, name: string): Tag | undefined {
  const start = new RegExp(`<${name}(?=[\\s/>])`, 'i').exec(html);
  return start ? scanTag(html, start.index + name.length + 1, true) : undefined;
}

/**
 * The links of an HTML page in page order, as absolute http(s) URLs without fragments, each
 * once, with the anchor text of its first link that has any. Relative links resolve against the
 * page's `<base href>` when it has one, as a browser resolves them (Destatis pages set one, and
 * resolving against the page URL repeated their path). Links to the page itself, mailto: and
 * javascript: links are left out. An image link is described by its title or alt text.
 */
export function extractLinks(html: string, pageUrl: string): PageLink[] {
  const self = new URL(pageUrl);
  self.hash = '';
  let base = self;
  const baseHref = firstTag(html, 'base')?.attributes.get('href')?.trim();
  if (baseHref) {
    try {
      base = new URL(baseHref, self);
    } catch {
      // A base that is not a URL is ignored, as a browser ignores it.
    }
  }
  const links = new Map<string, string>();
  const anchors = /<a(?=[\s/>])/gi;
  const ends = /<\/a\s*>/gi;
  for (let found = anchors.exec(html); found; found = anchors.exec(html)) {
    const anchor = scanTag(html, found.index + 2, true);
    if (!anchor) break;
    ends.lastIndex = anchor.end;
    const end = ends.exec(html);
    // An anchor with no end tag is no link, and none after it has one either.
    if (!end) break;
    anchors.lastIndex = end.index + end[0].length;
    const inner = html.slice(anchor.end, end.index);
    const href = anchor.attributes.get('href')?.trim();
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    url.hash = '';
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.href === self.href) continue;
    const text = collapse(
      htmlToText(inner) ||
        anchor.attributes.get('aria-label') ||
        anchor.attributes.get('title') ||
        firstTag(inner, 'img')?.attributes.get('alt') ||
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
  /**
   * Where an HTML page's main text starts in `text`, when the page marks it (a `<main>` element,
   * an element with role="main", or its only `<article>`) and navigation fills the start of the
   * text before it; absent otherwise.
   */
  mainOffset?: number;
};

/** A page whose main text starts sooner than this is printed from its start. */
const MIN_MAIN_OFFSET = 1500;

/**
 * Where the main text of an HTML page starts in its text (htmlToText of the whole page), or
 * undefined. The page's own mark decides: a `<main>` element, an element with role="main", or the
 * page's only `<article>`. Both elements start a new line of text, so the text before the mark is
 * whole lines, and the offset is used only when the page's text starts with exactly that text.
 */
export function mainTextOffset(html: string, text: string): number | undefined {
  const main = /<main[\s>]|<[a-z][a-z0-9]*\b[^>]*\brole\s*=\s*["']?main\b/i.exec(html);
  const articles = [...html.matchAll(/<article\b/gi)];
  const at = main?.index ?? (articles.length === 1 ? articles[0].index : undefined);
  if (at === undefined) return undefined;
  const before = htmlToText(html.slice(0, at));
  if (!before || !text.startsWith(before)) return undefined;
  const offset = text[before.length] === '\n' ? before.length + 1 : before.length;
  return offset >= MIN_MAIN_OFFSET && offset < text.length ? offset : undefined;
}

export type FetchPageOptions = {
  /** Also read PDFs, as their text layer with a "[Page n]" line before each page. */
  pdf?: boolean;
  maxCharacters?: number;
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * How long to wait before each new attempt after a server error (5xx), which is often a
   * moment's overload; none by default. A Retry-After header of up to a minute replaces the wait.
   * Nothing else is retried: a 4xx (a refusal, a rate limit or a bot challenge is never worked
   * around), a timeout or a network failure before the body is an answer of its own.
   */
  serverErrorRetriesMs?: number[];
  /**
   * How long to wait before each new attempt after the connection was cut while the body
   * downloaded (undici's "terminated", ECONNRESET, a premature close), which long PDFs often hit
   * once and not again; none by default. A page that still fails ends in a NetworkCutError.
   */
  bodyCutRetriesMs?: number[];
  /** Waits between attempts; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<void>;
  /** The fetch implementation; tests pass a stub. */
  fetch?: typeof fetch;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The longest Retry-After a server may ask for before the next attempt. */
const MAX_RETRY_AFTER_MS = 60_000;

/** A Retry-After header in milliseconds, when it gives a number of seconds within the bound. */
function retryAfter(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after') ?? NaN);
  return Number.isFinite(seconds) && seconds >= 0 && seconds * 1000 <= MAX_RETRY_AFTER_MS
    ? seconds * 1000
    : undefined;
}

/**
 * Phrases of the interstitial pages that bot protection serves instead of the content (Cloudflare,
 * Akamai, Imperva, Anubis and the like), sometimes with a 200. Only short pages are tested, so an
 * article that mentions a captcha is still read. Anubis (hal.ird.fr) serves a proof-of-work page
 * that opens with "Making sure you're not a bot!", with a straight or a curly apostrophe.
 */
const BOT_CHALLENGE =
  /just a moment\.\.\.|checking (if the site connection is secure|your browser)|enable javascript and cookies to continue|verify(ing)? (that )?you are (a )?human|are you a robot|making sure you['\u2019]re not a bot|set up anubis to protect the server|attention required|pardon our interruption|request unsuccessful\. incapsula|captcha/i;
const BOT_CHALLENGE_MAX_CHARACTERS = 3000;

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

/**
 * The connection was cut while the body downloaded, on every attempt. It says nothing about the
 * page: the same URL may download whole a minute later, so it is reported as a network failure and
 * never as a reason to treat the page as unreadable.
 */
export class NetworkCutError extends Error {
  constructor(
    readonly detail: string,
    attempts: number,
    options?: ErrorOptions,
  ) {
    super(
      `the connection was cut while the page downloaded (${detail})${attempts > 1 ? ` on all ${attempts} attempts` : ''}; this is a network failure, not a problem with the page, so try again later`,
      options,
    );
    this.name = 'NetworkCutError';
  }
}

/** The error codes of a connection that ended or was reset in the middle of a body. */
const BODY_CUT_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'UND_ERR_SOCKET',
  'ERR_STREAM_PREMATURE_CLOSE',
]);

/** Whether an error read from a response body means the connection was cut, not that time ran out. */
function isBodyCut(error: unknown): error is Error {
  if (!(error instanceof Error) || error.name === 'TimeoutError' || error.name === 'AbortError') {
    return false;
  }
  const code = causeCode(error.cause) ?? (error as { code?: unknown }).code;
  return (
    (typeof code === 'string' && BODY_CUT_CODES.has(code)) ||
    /^terminated$|premature close|socket hang up|other side closed|ECONNRESET/i.test(error.message)
  );
}

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
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge(size);
      }
      chunks.push(read.value);
    }
  } catch (error) {
    if (isBodyCut(error)) {
      const detail = causeDetail(error.cause);
      throw new NetworkCutError(detail ? `${error.message}: ${detail}` : error.message, 1, {
        cause: error,
      });
    }
    throw error;
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

/**
 * A run of text pdf.js found on a page: the matrix that places it (its scale is the font size,
 * its last two values where the run starts on its baseline) and its width in the same units.
 */
export type PdfTextItem = { str: string; transform: number[]; width: number; hasEOL: boolean };

/** How far apart, in PDF units (1/72 inch), two runs may be and still count as one place. */
const SAME_PLACE = 1;

/**
 * The runs of a page without the copies some PDFs draw over the original text: a second text
 * layer, or text drawn twice to fake bold. Read in drawing order, every such line runs into a copy
 * of itself, and the copy is not always split into runs the same way ("caused" and "devastation
 * ..." in one layer, "caused devastation ..." in the other). A run is a copy when it lies on the
 * same baseline, in the same size, within the stretch of longer runs it overlaps, and its letters
 * are among theirs: two different texts are never drawn over each other. Longer runs are kept
 * first, so the copy kept is the most whole one, and the runs stay in drawing order. A dropped run
 * that ended a line passes the line end to the kept run before it.
 */
export function dropOverdrawnText(items: PdfTextItem[]): PdfTextItem[] {
  const letters = (item: PdfTextItem) => item.str.replace(/\s+/g, '');
  const upright = (item: PdfTextItem) => item.transform[1] === 0 && item.transform[2] === 0;
  const byLength = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => letters(b.item).length - letters(a.item).length || a.index - b.index);
  const kept = new Set<number>();
  // Kept upright runs by their baseline rounded to a whole unit, so only runs near one are compared.
  const lines = new Map<number, PdfTextItem[]>();
  for (const { item, index } of byLength) {
    if (!letters(item) || !upright(item)) {
      kept.add(index);
      continue;
    }
    const [size, , , , x, y] = item.transform;
    const line = Math.round(y);
    const under = [line - 1, line, line + 1]
      .flatMap((near) => lines.get(near) ?? [])
      .filter(
        (other) =>
          Math.abs(other.transform[5] - y) <= SAME_PLACE &&
          Math.abs(other.transform[0] - size) <= SAME_PLACE &&
          other.transform[4] < x + item.width &&
          x < other.transform[4] + other.width,
      )
      .sort((a, b) => a.transform[4] - b.transform[4]);
    const covered =
      under.length > 0 &&
      under[0].transform[4] <= x + SAME_PLACE &&
      Math.max(...under.map((other) => other.transform[4] + other.width)) >=
        x + item.width - SAME_PLACE &&
      under.map(letters).join('').includes(letters(item));
    if (covered) continue;
    kept.add(index);
    lines.set(line, [...(lines.get(line) ?? []), item]);
  }
  const result: PdfTextItem[] = [];
  items.forEach((item, index) => {
    if (kept.has(index)) result.push({ ...item });
    else if (item.hasEOL && result.length) result[result.length - 1].hasEOL = true;
  });
  return result;
}

/** Lines at the top and at the bottom of a page where running headers and footers are looked for. */
const RUNNING_LINES = 3;

/**
 * What a line at the edge of page `index` is compared by: the line itself, and for each number in
 * it, the line with that number standing for the page number (the number minus the page index,
 * which stays the same from page to page). "Brief: South China Sea 16" on one page and "... 17" on
 * the next share a key; a table's "Total 1,204" and "Total 1,388" do not.
 */
function runningKeys(line: string, index: number): string[] {
  const keys = [`=${line}`];
  for (const match of line.matchAll(/\d+/g)) {
    const at = match.index;
    const page = Number(match[0]) - index;
    keys.push(`${page}:${line.slice(0, at)}#${line.slice(at + match[0].length)}`);
  }
  return keys;
}

/**
 * Pages without the running headers and footers they repeat: a line among the first or last
 * RUNNING_LINES of at least two in five pages (and at least three) that is the same on each, or
 * differs only by the page number. Every such line is kept where it first appears and dropped
 * from the pages after, so no text is lost, and a sentence that runs on from one page to the next
 * reads on with only the "[Page n]" marker between.
 */
export function dropRunningLines(pages: string[][]): string[][] {
  const keep = runningLinesKept(pages);
  return pages.map((lines, index) => lines.filter((_, at) => keep[index][at]));
}

/** For each line of each page, whether dropRunningLines keeps it. */
function runningLinesKept(pages: string[][]): boolean[][] {
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  if (pages.length < threshold) return pages.map((lines) => lines.map(() => true));
  const atEdge = (lines: string[], at: number) =>
    at < RUNNING_LINES || at >= lines.length - RUNNING_LINES;
  const counts = new Map<string, number>();
  pages.forEach((lines, index) => {
    const keys = new Set(
      lines.filter((_, at) => atEdge(lines, at)).flatMap((line) => runningKeys(line, index)),
    );
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const seen = new Set<string>();
  return pages.map((lines, index) =>
    lines.map((line, at) => {
      if (!atEdge(lines, at)) return true;
      const key = runningKeys(line, index).find((each) => (counts.get(each) ?? 0) >= threshold);
      if (!key) return true;
      const first = !seen.has(key);
      seen.add(key);
      return first;
    }),
  );
}

/**
 * A line of a PDF page: its text, the font size most of its letters are in, and the baseline of its
 * first run (PDF units, measured up from the bottom of the page).
 */
export type PdfLine = { text: string; size: number; y: number };

/** The lines of a page's runs, split where pdf.js marks a line end, each with its size and place. */
export function pdfLines(items: PdfTextItem[]): PdfLine[] {
  const lines: PdfLine[] = [];
  let parts: PdfTextItem[] = [];
  const flush = () => {
    const text = parts
      .map((item) => item.str)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      // The size of the run with the most letters, so a superscript marker does not decide it.
      const main = parts.reduce((best, item) =>
        item.str.replace(/\s+/g, '').length > best.str.replace(/\s+/g, '').length ? item : best,
      );
      const first = parts.find((item) => item.str.trim()) ?? main;
      lines.push({
        text,
        size: Math.hypot(main.transform[2], main.transform[3]),
        y: first.transform[5],
      });
    }
    parts = [];
  };
  for (const item of items) {
    parts.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/** How a footnote begins: a number of up to three digits or a footnote symbol. */
const FOOTNOTE_MARKER = /^(\d{1,3}|[*\u2020\u2021\u00a7\u00b6]+)(?=[\s(\p{L}])/u;
/** A line that is only a page number, which stays where it is. */
const PAGE_NUMBER = /^(page\s+)?\d{1,4}$/i;
/** A footnote is set this much smaller than the page's body text, or more. */
const FOOTNOTE_SIZE = 0.85;

/**
 * Split a page's lines into its body and the footnotes at its foot. Footnotes are the last lines
 * of the page, from one that starts with a footnote marker on: all of them set at most 85% of the
 * body's size (the size most of the page's letters are in) and all below every line of body text.
 * A page needs five lines of body text to tell. Page numbers among them stay in the body, where
 * the running header and footer step finds them. Moving footnotes out lets a sentence that runs
 * on to the next page read on without a footnote in the middle of it.
 */
export function splitFootnotes(lines: PdfLine[]): { body: PdfLine[]; footnotes: PdfLine[] } {
  const none = { body: lines, footnotes: [] };
  const letters = new Map<number, number>();
  for (const line of lines) {
    const size = Math.round(line.size * 2) / 2;
    letters.set(size, (letters.get(size) ?? 0) + line.text.replace(/\s+/g, '').length);
  }
  const [bodySize] = [...letters].reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    [0, 0],
  );
  const isBody = (line: PdfLine) => Math.abs(line.size - bodySize) <= 0.5;
  const bodyLines = lines.filter(isBody);
  if (bodyLines.length < 5) return none;
  const lowestBody = Math.min(...bodyLines.map((line) => line.y));
  const small = (line: PdfLine) => line.size <= bodySize * FOOTNOTE_SIZE && line.y < lowestBody;
  let start = lines.length;
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at];
    if (!small(line) && !PAGE_NUMBER.test(line.text)) break;
    if (small(line) && FOOTNOTE_MARKER.test(line.text)) start = at;
  }
  if (start === lines.length) return none;
  const tail = lines.slice(start);
  return {
    body: [...lines.slice(0, start), ...tail.filter((line) => PAGE_NUMBER.test(line.text))],
    footnotes: tail.filter((line) => !PAGE_NUMBER.test(line.text)),
  };
}

/**
 * The text layer of a PDF, with a "[Page n]" line before each page. Text drawn twice over itself
 * is read once, running headers and footers once, and pdf.js keeps its warnings about fonts to
 * itself (verbosity 0 is errors only), so they never mix with a command's output. Footnotes leave
 * the page they are on and follow the last page, each page's under a "[Footnotes of page n]" line,
 * so a sentence that runs on to the next page is not cut by them, and no text is lost.
 */
export async function pdfToText(data: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import('unpdf');
  const pages: PdfLine[][] = [];
  try {
    // pdf.js refuses a Node Buffer and may take ownership of the bytes, so it gets its own copy.
    const document = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 });
    try {
      for (let number = 1; number <= document.numPages; number += 1) {
        const content = await (await document.getPage(number)).getTextContent();
        const items: PdfTextItem[] = content.items.flatMap((item) => ('str' in item ? [item] : []));
        pages.push(pdfLines(dropOverdrawnText(items)));
      }
    } finally {
      await document.loadingTask.destroy();
    }
  } catch (error) {
    throw new Error(
      `the PDF could not be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!pages.some((lines) => lines.length)) {
    throw new Error('the PDF has no text layer; it may be a scan');
  }
  const keep = runningLinesKept(pages.map((lines) => lines.map((line) => line.text)));
  const split = pages.map((lines, index) =>
    splitFootnotes(lines.filter((_, at) => keep[index][at])),
  );
  const text = (lines: PdfLine[]) => lines.map((line) => line.text).join('\n');
  return [
    ...split.map(({ body }, index) => `[Page ${index + 1}]\n${text(body)}`),
    ...split.flatMap(({ footnotes }, index) =>
      footnotes.length ? [`[Footnotes of page ${index + 1}]\n${text(footnotes)}`] : [],
    ),
  ].join('\n\n');
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
 * The error codes of a TLS certificate that could not be verified: expired, not yet valid, self
 * signed, issued for another name, or signed by an issuer this computer does not trust (or whose
 * intermediate certificate the server does not send, as knbs.or.ke's did).
 */
const CERTIFICATE_ERROR =
  /CERT|SELF_SIGNED|UNABLE_TO_(VERIFY|GET_ISSUER|DECRYPT)|ALTNAME|HOSTNAME_MISMATCH|ERR_TLS_CERT/;

/** The error code of a request's cause, or of the first of several causes. */
function causeCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return undefined;
  const { code, errors } = cause as { code?: unknown; errors?: unknown };
  if (typeof code === 'string') return code;
  return Array.isArray(errors) ? causeCode(errors[0]) : undefined;
}

/**
 * Node's fetch reports every network failure as "fetch failed" and keeps the real reason (a
 * redirect loop, a certificate for another name, a reset connection, an unknown host) in the
 * error's cause. The reason is added to the message so a person or an agent can tell a page that
 * will never load from one that may load later. A certificate that could not be verified is named
 * as such: the page is never read over a connection whose certificate failed, so it cannot be read
 * from this computer until the site fixes it.
 */
async function request(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    const detail = error instanceof Error ? causeDetail(error.cause) : undefined;
    if (!(error instanceof Error) || !detail) throw error;
    const code = causeCode(error.cause) ?? '';
    if (CERTIFICATE_ERROR.test(code)) {
      throw new Error(
        `certificate error: the site's TLS certificate could not be verified (${detail}), and a page is never read over an unverified connection`,
        { cause: error },
      );
    }
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
    serverErrorRetriesMs = [],
    bodyCutRetriesMs = [],
  } = options;
  const attempt = () =>
    request(options.fetch ?? fetch, url, {
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: pdf
          ? 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.5'
          : 'text/html,text/plain;q=0.9,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  /** One download: the request (retried after a server error), the checks of its answer, the body. */
  const download = async () => {
    let response = await attempt();
    for (const wait of serverErrorRetriesMs) {
      if (response.status < 500) break;
      await response.body?.cancel();
      await (options.sleep ?? sleep)(retryAfter(response) ?? wait);
      response = await attempt();
    }
    if (!response.ok) {
      const retried = response.status >= 500 && serverErrorRetriesMs.length > 0;
      throw new Error(
        `the server answered ${response.status}${retried ? ` on all ${serverErrorRetriesMs.length + 1} attempts` : ''}`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    const isText = /text\/(html|plain)|application\/xhtml/i.test(contentType);
    // Servers often label a PDF as a download, so a PDF is recognised by its first bytes.
    const mayBePdf =
      pdf && /application\/(pdf|octet-stream)|binary\/octet-stream/i.test(contentType);
    if (!isText && !mayBePdf) {
      throw new Error(
        `the page is ${contentType || 'of an unknown type'}; only HTML${pdf ? ', plain text and PDF' : ' and plain text'} are read`,
      );
    }
    return { response, contentType, isText, body: await readBody(response, maxBytes) };
  };
  // A body cut off in the middle starts over from the request, after a wait. Only the cut is
  // retried: a refusal (401, 403, 429) or a bot challenge is an answer and is never tried again.
  let downloaded: Awaited<ReturnType<typeof download>> | undefined;
  for (let cuts = 0; !downloaded; cuts += 1) {
    try {
      downloaded = await download();
    } catch (error) {
      if (!(error instanceof NetworkCutError)) throw error;
      const wait = bodyCutRetriesMs[cuts];
      if (wait === undefined) {
        throw new NetworkCutError(error.detail, cuts + 1, { cause: error.cause });
      }
      await (options.sleep ?? sleep)(wait);
    }
  }
  const { response, contentType, isText, body } = downloaded;
  let text: string;
  let links: PageLink[] = [];
  let mainOffset: number | undefined;
  if (pdf && isPdf(body)) {
    text = await pdfToText(body);
  } else if (isText) {
    const raw = decode(body, contentType);
    const html = /html/i.test(contentType);
    text = html ? htmlToText(raw) : raw.trim();
    if (html) {
      links = extractLinks(raw, response.url || url);
      mainOffset = mainTextOffset(raw, text);
    }
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
    ...(mainOffset !== undefined && mainOffset < maxCharacters ? { mainOffset } : {}),
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
