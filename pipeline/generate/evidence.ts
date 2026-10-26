// Which pages the model actually retrieved. A draft may cite only URLs that came back from
// web_search or web_fetch in its own conversation, so every source is a page that was read
// in this task rather than one recalled from training data.
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages';

const URL_PATTERN = /https?:\/\/[^\s"'<>\\)\]]+/g;

/** Query parameters that track a visit or record consent rather than choose the page. */
const TRACKING_PARAM = /^(utm_|cmp|fbclid$|gclid$|msclkid$|mc_cid$|mc_eid$|redirectedfrom$)/i;

/** A URL without tracking parameters, as a source should be cited. */
export function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    for (const name of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAM.test(name)) parsed.searchParams.delete(name);
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/** A URL in a comparable form: no tracking parameters, fragment, "www." or trailing slash, lowercase host. */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(cleanUrl(url));
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${host}${path}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

function collectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(URL_PATTERN)) into.add(normalizeUrl(match[0]));
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}

/**
 * URLs retrieved in one response: web search results, fetched pages, URLs printed by the code
 * that filters search results (dynamic filtering), and web citations on text. The model's own
 * tool calls are not evidence, since a requested URL may have failed to load, and neither are
 * links inside a fetched page, which were not themselves read.
 */
export function retrievedUrls(content: BetaContentBlock[]): Set<string> {
  const urls = new Set<string>();
  for (const block of content) {
    if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        for (const result of block.content) urls.add(normalizeUrl(result.url));
      }
    } else if (block.type === 'web_fetch_tool_result') {
      if (block.content.type === 'web_fetch_result') urls.add(normalizeUrl(block.content.url));
    } else if (block.type.endsWith('_tool_result')) {
      collectStrings(block, urls);
    } else if (block.type === 'text' && block.citations) {
      for (const citation of block.citations) {
        if ('url' in citation && typeof citation.url === 'string') {
          urls.add(normalizeUrl(citation.url));
        }
      }
    }
  }
  return urls;
}
