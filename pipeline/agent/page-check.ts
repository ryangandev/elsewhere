// Whether a fetched page is the page that was asked for. Some URLs redirect to a login page, a
// site's home page, another site or a script stub, and the server still answers 200, so the text
// is stored like any other. Such a page states nothing about the topic and must never be cited.
// The result is computed from the stored record every time (never saved), so the fetch command's
// warning and the submit command's rejection always agree. Whether the text could be extracted at
// all, and what a redirect means for the URL to cite, are worked out here the same way.
import type { EvidenceRecord } from './session';

/**
 * A page with less text than this is not a page that supports a claim. The cases that prompted
 * the check were a script stub of 209 characters and login pages, whose text (a form with
 * "Sign in", "Email" and "Password") runs to about 100 to 250. A real article, statistics page
 * or reference entry that a drafter cites has thousands of characters, and even a one-paragraph
 * government notice with its navigation reaches 400 to 500. 300 sits between the two groups.
 */
export const MIN_PAGE_CHARACTERS = 300;

/** A login, single sign-on or consent step, as a path: /login, /user/sign-in, /idp/authorize. */
const LOGIN_PATH =
  /(^|[/_.-])(log-?in|sign-?in|sign-?on|sso|auth|authorize|authenticate|consent|cookies?)($|[/_.-])/i;

/** The same on a different host: idp.nature.com, accounts.google.com, consent.example.org. */
const LOGIN_HOST = /^(login|signin|sso|auth|idp|account|accounts|consent)\./i;

/** A site's home page: /, /index.html, or a language root such as /en or /pt-br. */
const HOME_PATH = /^(\/index\.(html?|php|aspx?))?\/?$|^\/[a-z]{2}([-_][a-z]{2,4})?\/?$/i;

/**
 * Hosts whose whole purpose is to redirect to the document a persistent identifier names (a DOI,
 * a handle), so a redirect from them to another site is the expected one.
 */
const RESOLVER_HOSTS = new Set([
  'doi.org',
  'dx.doi.org',
  'hdl.handle.net',
  'n2t.net',
  'identifiers.org',
  'purl.org',
]);

/**
 * Second-level labels that country code registries use as public suffixes ("gov.uk", "co.ke",
 * "gob.mx"), so the site is the label before them. Any other label under a country code is the
 * site itself ("ine.es", "bcn.cl", "cbs.nl"), whatever its length.
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'go',
  'gob',
  'gouv',
  'gov',
  'govt',
  'gub',
  'gv',
  'info',
  'int',
  'ltd',
  'mil',
  'ne',
  'net',
  'nic',
  'nom',
  'or',
  'org',
  'plc',
  'sch',
]);

/**
 * The site a host belongs to, as far as a redirect is concerned: its last two labels without a
 * leading "www.", or three under a country code whose second level is a registry suffix
 * ("knbs.or.ke", "ons.gov.uk", "bbc.co.uk"). So "www.ons.gov.uk" and "data.ons.gov.uk" are one
 * site, "ine.es" and "www.ine.es" one, and "pilates.example" another.
 */
export function siteOf(hostname: string): string {
  const labels = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '')
    .split('.');
  if (labels.length <= 2) return labels.join('.');
  const [second, top] = labels.slice(-2);
  const keep = top.length === 2 && SECOND_LEVEL_SUFFIXES.has(second) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * Why the page is probably not the one requested, or undefined when it looks right. A redirect to
 * another site is suspicious unless it came from a DOI or handle resolver: a commonwealth
 * governance page once redirected to a pilates studio. A page that did move to another site is
 * fetched and cited by its new URL, which then has no redirect. Another host of the same site
 * ("data.ons.gov.uk" for "www.ons.gov.uk") is not suspicious; the redirect target decides.
 */
export function notTheRequestedPage(
  record: Pick<EvidenceRecord, 'requestedUrl' | 'finalUrl' | 'text'> & { contentType?: string },
): string | undefined {
  const requested = parse(record.requestedUrl);
  const final = parse(record.finalUrl);
  if (requested && final && final.href !== requested.href) {
    const login =
      (LOGIN_PATH.test(final.pathname) && !LOGIN_PATH.test(requested.pathname)) ||
      (LOGIN_HOST.test(final.hostname) && !LOGIN_HOST.test(requested.hostname));
    if (login) return `it redirected to a login, sign-in or consent page (${record.finalUrl})`;
    if (HOME_PATH.test(final.pathname) && !HOME_PATH.test(requested.pathname)) {
      return `it redirected to the site's home page (${record.finalUrl})`;
    }
    const requestedSite = siteOf(requested.hostname);
    if (
      siteOf(final.hostname) !== requestedSite &&
      !RESOLVER_HOSTS.has(requested.hostname.toLowerCase().replace(/^www\./, ''))
    ) {
      return `it redirected to another site (${record.finalUrl}); if that is a page you want, fetch it by its own URL`;
    }
  }
  if (record.text.length < MIN_PAGE_CHARACTERS) {
    return `its text is only ${record.text.length} characters, too short to be the page (probably a script stub, an error or a login form)`;
  }
  return undefined;
}

/** A line of this many words or more is prose: a sentence, or part of a paragraph. */
export const PROSE_WORDS = 6;
/** A page needs this many characters of content lines, and this share of its text in them. */
const MIN_CONTENT_CHARACTERS = 300;
const MIN_CONTENT_SHARE = 0.1;
/** Menus and footers are many lines; fewer lines than this is not a page of navigation. */
const MIN_MENU_LINES = 8;

/** Scripts that write without spaces: every two characters count as a word. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu;

/** The words of a line: spaced words, and for Chinese, Japanese and Thai, two characters a word. */
function wordsOf(line: string): number {
  const unspaced = line.match(UNSPACED_SCRIPT)?.length ?? 0;
  const spaced = line
    .replace(UNSPACED_SCRIPT, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return spaced + Math.ceil(unspaced / 2);
}

/**
 * Whether a line of a page's text is content and not navigation: prose of at least six words (a
 * line of links is cut at its "|" separators and counts by its longest part, and a paragraph that
 * the page's source wraps over several lines still has lines of six words or more), a row of
 * figures or a dated line (a digit and at least two words), or a "label: value" line of a fact
 * sheet. Menu entries are one to four words, with no digit and no colon.
 */
function isContentLine(line: string): boolean {
  const longest = Math.max(...line.split(/\s[|•·]\s/).map(wordsOf));
  if (longest >= PROSE_WORDS) return true;
  if (/\p{N}/u.test(line) && (wordsOf(line) >= 2 || line.startsWith('|'))) return true;
  return /^[^:|]{1,60}:\s*[\p{L}\p{N}]/u.test(line);
}

/**
 * Why an HTML page is probably only its menus and footer, or undefined. Some sites build their
 * answer text with scripts (mnd.gov.sg did), and the fetch gets the navigation, the footer and
 * little else, long enough to pass the length check. A page with content has at least 300
 * characters, and at least a tenth of its text, in content lines (see isContentLine). A page of
 * fewer than eight lines is not tested, and neither are PDFs and plain text, whose lines are cut
 * by the page's width. This is only a guess from the text, so it is a warning that the fetch
 * commands print and never a reason to refuse a page: a short page of facts, a table among menus
 * or a language the guess does not know may still be the page.
 */
export function menuOnlyText(record: { text: string; contentType?: string }): string | undefined {
  if (record.contentType !== undefined && !/html/i.test(record.contentType)) return undefined;
  if (record.text.startsWith('[Page 1]')) return undefined;
  const lines = record.text.split('\n').filter((line) => line.trim());
  if (lines.length < MIN_MENU_LINES) return undefined;
  const content = lines.filter(isContentLine).reduce((total, line) => total + line.length, 0);
  if (content >= MIN_CONTENT_CHARACTERS && content >= record.text.length * MIN_CONTENT_SHARE) {
    return undefined;
  }
  const longest = Math.max(...lines.map(wordsOf));
  return `almost all of its text is short navigation lines (${lines.length} lines, the longest has ${longest === 1 ? '1 word' : `${longest} words`}), so it is probably only the site's menus and footer, with the answer text built by scripts that are not run here`;
}

/** Words of a path, for telling whether a redirect stayed on the same subject. */
function pathWords(pathname: string): Set<string> {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Keep the raw path.
  }
  return new Set(
    decoded
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 4 && !/^(index|html?|php|aspx?|default)$/.test(word)),
  );
}

/**
 * What a redirect means for the URL to cite, for a page that is otherwise the one requested:
 * none (no redirect), a file (it ended at a PDF or another document, as a download link does, so
 * the file's URL is the one to cite), unrelated (it stayed on the site but on a path that shares
 * no word with the requested one, such as an error or search page), or same (either URL names the
 * page). A redirect that makes the page not the requested one is notTheRequestedPage's.
 */
export function redirectKind(
  record: Pick<EvidenceRecord, 'requestedUrl' | 'finalUrl' | 'contentType' | 'text'>,
): 'none' | 'file' | 'unrelated' | 'same' {
  const requested = parse(record.requestedUrl);
  const final = parse(record.finalUrl);
  if (!requested || !final || requested.href === final.href) return 'none';
  if (/pdf|octet-stream/i.test(record.contentType) || record.text.startsWith('[Page 1]')) {
    return 'file';
  }
  const before = pathWords(requested.pathname + requested.search);
  const after = pathWords(final.pathname + final.search);
  if (before.size && after.size && ![...before].some((word) => after.has(word))) {
    return 'unrelated';
  }
  return 'same';
}

/** The share of characters that no text has: U+FFFD, private-use characters and controls. */
const BROKEN_CHARACTER = /[\uFFFD\uE000-\uF8FF\u0001-\u0008\u000E-\u001F]/gu;
/**
 * A token that says nothing about whether text is words: one with a digit in it (a number, a date,
 * a percentage, a range, "Rs.1,234", "2023-24", "Q3") or a lone separator, such as the "|" between
 * the cells of a table.
 */
const NEUTRAL_TOKEN = /\p{N}|^[|\u2013\u2014\u2022\u00b7/\\:;,.\-]$/u;
/** A word: letters with an apostrophe or hyphen inside, and punctuation around it. */
const WORD_TOKEN = /^[("'\u2018\u201C\[]*\p{L}[\p{L}\p{M}'\u2019-]*[)"'\u2019\u201D\].,;:!?%]*$/u;
const LATIN_VOWEL = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœ]/i;

/**
 * Why a page's text is probably not its words, or undefined when it reads as text. Some PDFs map
 * their fonts' glyphs to arbitrary characters, so pdf.js extracts hundreds of thousands of
 * characters that are not words (the Facts about Germany PDF did), and a search for a phrase the
 * page states finds nothing. The text is unreadable when more than 5% of its characters are
 * replacement, private-use or control characters, or when fewer than half of its tokens that are
 * not numbers are words. A Latin word of four letters or more needs a vowel, which catches glyphs
 * mapped to shifted letters ("Kdssb"). Numbers are left out, and so are the "|" between table
 * cells, so a table of numbers and short labels passes: numbers are not unreadable, and the check
 * is for font-encoded garbage.
 */
export function unreadableText(text: string): string | undefined {
  const sample = text.length > 400_000 ? text.slice(0, 400_000) : text;
  const visible = sample.replace(/\s+/g, '');
  if (visible.length < 200) return undefined;
  const broken = visible.match(BROKEN_CHARACTER)?.length ?? 0;
  if (broken / visible.length > 0.05) {
    return `${Math.round((broken / visible.length) * 100)}% of its characters are replacement, private-use or control characters`;
  }
  const tokens = sample
    .replace(/^\[Page \d+\]$/gm, '')
    .split(/\s+/)
    .filter((token) => token && !NEUTRAL_TOKEN.test(token));
  if (tokens.length < 100) return undefined;
  const words = tokens.filter((token) => {
    if (!WORD_TOKEN.test(token)) return false;
    const letters = token.replace(/[^\p{L}]/gu, '');
    return !(letters.length >= 4 && /^[a-z]+$/i.test(letters) && !LATIN_VOWEL.test(letters));
  }).length;
  const share = words / tokens.length;
  return share < 0.5
    ? `only ${Math.round(share * 100)}% of its tokens are words, so the text was probably not extracted from the page's fonts`
    : undefined;
}
