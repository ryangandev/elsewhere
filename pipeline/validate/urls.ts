// Source URL reachability. Every cited page should still open for a reader.
//
// - ok: the page answered 2xx, after redirects.
// - broken: the page is gone (404, 410) or its host does not resolve. Fails content:verify.
// - unverified: the check could not tell (401, 403, 429, 5xx, timeouts). Many sites block
//   automated requests, so these are reported as warnings for a human to open, never dropped.
//   Pages a person has opened and listed in KNOWN_BLOCKED_URLS (pipeline/config.ts) count as ok
//   when they refuse the check, until the entry lapses.
//
// Results are cached in pipeline/.cache/url-status.json so repeated runs only re-check stale URLs.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CACHE_DIR,
  KNOWN_BLOCKED_RECHECK_DAYS,
  KNOWN_BLOCKED_URLS,
  type KnownBlockedUrl,
} from '../config';
import { writeJson } from '../content-tree';

export type UrlState = 'ok' | 'broken' | 'unverified';

export type UrlStatus = {
  state: UrlState;
  /** Final HTTP status, when the server answered. */
  code?: number;
  detail: string;
  /** ISO timestamp of the check. */
  checkedAt: string;
};

export const URL_CACHE_FILE = join(CACHE_DIR, 'url-status.json');

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a result is trusted before the URL is checked again. */
const CACHE_TTL_MS: Record<UrlState, number> = {
  ok: 30 * DAY_MS,
  broken: DAY_MS,
  unverified: DAY_MS,
};

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 ElsewhereContentCheck/1.0';

export type UrlCheckOptions = {
  cacheFile?: string;
  /** Ignore cached results. */
  refresh?: boolean;
  timeoutMs?: number;
  /** Retries after a timeout, 429 or 5xx. */
  retries?: number;
  concurrency?: number;
  perHost?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Pages known to refuse automated checks; defaults to KNOWN_BLOCKED_URLS. */
  knownBlocked?: Record<string, KnownBlockedUrl>;
};

type Cache = Record<string, UrlStatus>;

function readCache(file: string): Cache {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Cache;
  } catch {
    return {};
  }
}

/** Answers that mean the server refused an automated request, not that the page is gone. */
const REFUSALS = new Set([401, 403, 429]);

/**
 * The status a reader should see: a refusal from a page someone opened by hand recently counts
 * as ok. The cache keeps the raw answer, so a lapsed entry turns back into a warning.
 */
function withKnownBlocked(url: string, status: UrlStatus, options: UrlCheckOptions): UrlStatus {
  const known = (options.knownBlocked ?? KNOWN_BLOCKED_URLS)[url];
  if (!known || status.state !== 'unverified' || !REFUSALS.has(status.code ?? 0)) return status;
  const now = (options.now ?? (() => new Date()))().getTime();
  if (now - Date.parse(known.openedOn) >= KNOWN_BLOCKED_RECHECK_DAYS * DAY_MS) return status;
  return {
    ...status,
    state: 'ok',
    detail: `${status.detail}, known to refuse automated checks; opened by hand on ${known.openedOn}`,
  };
}

function freshCached(urls: string[], options: UrlCheckOptions): Map<string, UrlStatus> {
  const cache = readCache(options.cacheFile ?? URL_CACHE_FILE);
  const now = (options.now ?? (() => new Date()))().getTime();
  const result = new Map<string, UrlStatus>();
  for (const url of urls) {
    const entry = cache[url];
    if (entry && now - Date.parse(entry.checkedAt) < CACHE_TTL_MS[entry.state])
      result.set(url, entry);
  }
  return result;
}

/** Cached results that are still fresh, without touching the network. */
export function cachedUrlStatuses(
  urls: string[],
  options: UrlCheckOptions = {},
): Map<string, UrlStatus> {
  const result = new Map<string, UrlStatus>();
  for (const [url, status] of freshCached(urls, options))
    result.set(url, withKnownBlocked(url, status, options));
  return result;
}

const RETRYABLE = (code: number) => code === 408 || code === 429 || code >= 500;
const GONE = new Set([404, 410]);

function classify(code: number): UrlState {
  if (code >= 200 && code < 300) return 'ok';
  if (GONE.has(code)) return 'broken';
  return 'unverified';
}

/** Network errors that mean the host is not there, as opposed to slow or refusing us. */
function isDeadHost(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_NONAME';
}

async function request(
  url: string,
  method: 'HEAD' | 'GET',
  options: Required<Pick<UrlCheckOptions, 'timeoutMs' | 'fetch'>>,
): Promise<number> {
  const response = await options.fetch(url, {
    method,
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/pdf,*/*;q=0.8' },
  });
  // Only the status matters; do not download the page.
  await response.body?.cancel().catch(() => undefined);
  return response.status;
}

async function checkOne(
  url: string,
  options: UrlCheckOptions,
  now: () => Date,
): Promise<UrlStatus> {
  const settings = { timeoutMs: options.timeoutMs ?? 15_000, fetch: options.fetch ?? fetch };
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retries = options.retries ?? 2;
  const status = (state: UrlState, detail: string, code?: number): UrlStatus => ({
    state,
    detail,
    ...(code === undefined ? {} : { code }),
    checkedAt: now().toISOString(),
  });

  let last: UrlStatus = status('unverified', 'not checked');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(1000 * 3 ** (attempt - 1));
    try {
      // Many servers mishandle HEAD; anything but a clear answer is retried as GET.
      let code = await request(url, 'HEAD', settings);
      if (classify(code) !== 'ok') code = await request(url, 'GET', settings);
      last = status(classify(code), `HTTP ${code}`, code);
      if (!RETRYABLE(code)) return last;
    } catch (error) {
      if (isDeadHost(error)) return status('broken', 'host not found');
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      last = status('unverified', timedOut ? 'timed out' : `request failed: ${String(error)}`);
    }
  }
  return last;
}

/**
 * Check URLs, reusing fresh cached results. Requests run concurrently with a per-host limit so
 * one slow or rate-limiting site does not hold up the rest or get hammered.
 */
export async function checkUrls(
  urls: string[],
  options: UrlCheckOptions = {},
): Promise<Map<string, UrlStatus>> {
  const cacheFile = options.cacheFile ?? URL_CACHE_FILE;
  const now = options.now ?? (() => new Date());
  const unique = [...new Set(urls)];
  const results = options.refresh ? new Map<string, UrlStatus>() : freshCached(unique, options);
  const queue = unique.filter((url) => !results.has(url));

  const perHost = options.perHost ?? 2;
  const active = new Map<string, number>();
  const host = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };
  const worker = async () => {
    for (;;) {
      const index = queue.findIndex((url) => (active.get(host(url)) ?? 0) < perHost);
      if (index === -1) {
        if (!queue.length) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const [url] = queue.splice(index, 1);
      active.set(host(url), (active.get(host(url)) ?? 0) + 1);
      try {
        results.set(url, await checkOne(url, options, now));
      } finally {
        active.set(host(url), active.get(host(url))! - 1);
      }
    }
  };
  await Promise.all(Array.from({ length: options.concurrency ?? 8 }, worker));

  const cache = readCache(cacheFile);
  for (const [url, status] of results) cache[url] = status;
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeJson(
    cacheFile,
    Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))),
  );
  return new Map(
    [...results].map(([url, status]) => [url, withKnownBlocked(url, status, options)]),
  );
}
