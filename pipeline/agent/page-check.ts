// Whether a fetched page is the page that was asked for. Some URLs redirect to a login page, a
// site's home page or a script stub, and the server still answers 200, so the text is stored like
// any other. Such a page states nothing about the topic and must never be cited. The result is
// computed from the stored record every time (never saved), so the fetch command's warning and the
// submit command's rejection always agree.
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

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/**
 * Why the page is probably not the one requested, or undefined when it looks right. A change of
 * host alone is not suspicious, since a DOI or an agency's new domain legitimately lands on
 * another site; the redirect target decides.
 */
export function notTheRequestedPage(
  record: Pick<EvidenceRecord, 'requestedUrl' | 'finalUrl' | 'text'>,
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
  }
  if (record.text.length < MIN_PAGE_CHARACTERS) {
    return `its text is only ${record.text.length} characters, too short to be the page (probably a script stub, an error or a login form)`;
  }
  return undefined;
}
