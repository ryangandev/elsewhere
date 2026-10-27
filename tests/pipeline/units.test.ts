import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BetaContentBlock, BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountryFile } from '../../src/content/schema';
import { findPendingReferences, validateContent } from '../../src/content/validate';
import {
  contentInput,
  landIndex,
  readCountryFile,
  writeCountryFile,
} from '../../pipeline/content-tree';
import {
  BatchPlan,
  CountryDraft,
  toStrictJsonSchema,
  toToolJsonSchema,
} from '../../pipeline/generate/draft-schema';
import { cleanUrl, normalizeUrl, retrievedUrls } from '../../pipeline/generate/evidence';
import { AnthropicModelClient, MissingApiKeyError } from '../../pipeline/generate/model-client';
import { BatchFile, checkPlan, readBatch } from '../../pipeline/generate/plan';
import { addUsage, estimateCost, emptyUsage } from '../../pipeline/generate/usage';
import { render } from '../../pipeline/prompts';
import { KNOWN_BLOCKED_URLS } from '../../pipeline/config';
import { checkUrls, cachedUrlStatuses } from '../../pipeline/validate/urls';
import { REPLAY_DIR, FIXTURE_BATCH, replayFixtures } from './fixtures/build-replay';
import { tempContentTree, tempDir } from './helpers';

describe('replay fixtures', () => {
  it('match the script that builds them', () => {
    const fixtures = replayFixtures();
    expect(readdirSync(REPLAY_DIR).sort()).toEqual(Object.keys(fixtures).sort());
    for (const [tag, turns] of Object.entries(fixtures)) {
      turns.forEach((turn, index) => {
        const file = join(REPLAY_DIR, tag, `${String(index + 1).padStart(3, '0')}.json`);
        expect(JSON.parse(readFileSync(file, 'utf8')), file).toEqual(turn);
      });
    }
  });
});

describe('JSON schemas for the model', () => {
  it('leave out keywords strict structured outputs reject', () => {
    const text = JSON.stringify(toStrictJsonSchema(BatchPlan));
    for (const keyword of ['pattern', 'minLength', 'maxLength', 'maxItems', '$schema']) {
      expect(text).not.toContain(`"${keyword}"`);
    }
    expect(text).not.toMatch(/"minItems":[2-9]/);
    expect(text).toContain('"additionalProperties":false');
  });

  it('show a submission tool every constraint zod checks', () => {
    const text = JSON.stringify(toToolJsonSchema(CountryDraft));
    expect(text).toContain('"pattern"');
    expect(text).toContain('"minItems":3');
    expect(text).toContain('"additionalProperties":false');
    expect(text).not.toContain('"$schema"');
  });
});

describe('evidence', () => {
  it('normalizes URLs for comparison', () => {
    expect(normalizeUrl('https://WWW.Example.org/a/b/#part')).toBe('example.org/a/b');
    expect(normalizeUrl('https://example.org/a?b=1')).toBe('example.org/a?b=1');
    expect(normalizeUrl('https://example.org/a?b=1&utm_source=x&cmpIsGdpr=false')).toBe(
      'example.org/a?b=1',
    );
  });

  it('cites URLs without tracking parameters', () => {
    expect(cleanUrl('https://kids.example.org/a/1?cmpCountryCode=US&cmpIsGdpr=false')).toBe(
      'https://kids.example.org/a/1',
    );
    expect(cleanUrl('https://example.org/a?id=7&utm_medium=email')).toBe(
      'https://example.org/a?id=7',
    );
  });

  it('counts retrieved pages, not requested ones', () => {
    const content = [
      {
        type: 'server_tool_use',
        id: 's1',
        name: 'web_fetch',
        input: { url: 'https://requested.example/' },
      },
      {
        type: 'web_search_tool_result',
        tool_use_id: 's0',
        content: [{ type: 'web_search_result', url: 'https://found.example/page', title: 'x' }],
      },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: 's1',
        content: { type: 'web_fetch_tool_error', error_code: 'url_not_accessible' },
      },
      {
        type: 'code_execution_tool_result',
        tool_use_id: 's2',
        content: { stdout: 'kept https://filtered.example/doc.pdf' },
      },
      {
        type: 'text',
        text: 'cited',
        citations: [{ type: 'web_search_result_location', url: 'https://cited.example/' }],
      },
    ] as unknown as BetaContentBlock[];
    expect([...retrievedUrls(content)].sort()).toEqual([
      'cited.example',
      'filtered.example/doc.pdf',
      'found.example/page',
    ]);
  });
});

describe('pending references', () => {
  const withLink = (contentDir: string, status: 'draft' | 'reviewed') => {
    const singapore = readCountryFile(contentDir, 'singapore')!;
    const story = singapore.stories[0];
    const next = [
      ...story.next.slice(0, 2),
      { countryId: 'CHL', storyId: 'length', reason: 'A test link.' },
    ];
    const provenance =
      status === 'draft'
        ? { generatedBy: 'human', generatedAt: '2026-10-26', status }
        : {
            generatedBy: 'human',
            generatedAt: '2026-10-26',
            status,
            reviewedBy: 'Tester',
            reviewedAt: '2026-10-26',
          };
    return CountryFile.parse({
      ...singapore,
      stories: [{ ...story, next, provenance }, ...singapore.stories.slice(1)],
    });
  };

  it('are allowed in drafts and rejected in reviewed stories', () => {
    const contentDir = tempContentTree();
    writeCountryFile(contentDir, withLink(contentDir, 'draft'));
    const input = { ...contentInput(contentDir), land: landIndex() };
    expect(validateContent(input)).toEqual([]);
    expect(
      findPendingReferences(input.countryFiles.map(({ data }) => CountryFile.parse(data))),
    ).toEqual([
      {
        from: { countryId: 'SGP', storyId: 'wealth' },
        to: { countryId: 'CHL', storyId: 'length' },
        reason: 'A test link.',
      },
    ]);

    writeCountryFile(contentDir, withLink(contentDir, 'reviewed'));
    expect(validateContent({ ...contentInput(contentDir), land: landIndex() })).toMatchObject([
      { path: 'stories[0].next[2]', message: 'Unknown story "CHL/length"' },
    ]);
  });
});

describe('batch plans', () => {
  it('report missing countries, counts, duplicates and the missing unexpected angle', () => {
    const batch = BatchFile.parse(FIXTURE_BATCH);
    const story = (id: string) => ({ id, question: `About ${id}?`, angle: 'common' as const });
    const issues = checkPlan(
      {
        countries: [
          { countryId: 'CHL', stories: [story('a'), story('a'), story('b')] },
          { countryId: 'PER', stories: [] },
        ],
      },
      batch,
      tempContentTree(),
    );
    expect(issues).toEqual([
      'CHL: plan 4 to 6 questions, not 3',
      'CHL: story ID "a" is used twice',
      'CHL: include at least one unexpected question',
      'countries: plan ARG',
      'countries: PER is not in the batch',
    ]);
  });

  it('keep the pilot batch valid', () => {
    const pilot = readBatch('pilot');
    expect(pilot.countries).toHaveLength(20);
    expect(new Set(pilot.countries.map((country) => country.id)).size).toBe(20);
  });
});

describe('source URL checks', () => {
  const statusFetch = (statuses: Record<string, number[]>) =>
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const queue = statuses[url];
      const status = queue.length > 1 ? queue.shift()! : queue[0];
      return new Response(null, { status });
    }) as unknown as typeof fetch;

  it('classifies, retries, and caches results', async () => {
    const cacheFile = join(tempDir(), 'url-status.json');
    const fetch = statusFetch({
      'https://ok.example/': [200],
      'https://gone.example/': [404],
      'https://blocked.example/': [403],
      // HEAD and GET both fail once, then the retry succeeds.
      'https://flaky.example/': [503, 503, 200],
    });
    const options = { cacheFile, fetch, sleep: async () => undefined, perHost: 1 };
    const urls = Object.keys({
      'https://ok.example/': 0,
      'https://gone.example/': 0,
      'https://blocked.example/': 0,
      'https://flaky.example/': 0,
    });
    const statuses = await checkUrls(urls, options);
    expect(urls.map((url) => statuses.get(url)?.state)).toEqual([
      'ok',
      'broken',
      'unverified',
      'ok',
    ]);

    // Fresh results come from the cache without another request.
    const calls = vi.mocked(fetch).mock.calls.length;
    await checkUrls(urls, options);
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    expect(cachedUrlStatuses(urls, { cacheFile }).size).toBe(4);
  });

  it('counts a refusal from a page opened by hand as ok, until the entry lapses', async () => {
    const cacheFile = join(tempDir(), 'url-status.json');
    const fetch = statusFetch({
      'https://blocked.example/': [403],
      'https://gone.example/': [404],
      'https://other.example/': [403],
    });
    const knownBlocked = {
      'https://blocked.example/': { openedOn: '2026-10-01', page: 'A page' },
      'https://gone.example/': { openedOn: '2026-10-01', page: 'A page that went away' },
    };
    const urls = ['https://blocked.example/', 'https://gone.example/', 'https://other.example/'];
    const at = (day: string) => ({ cacheFile, fetch, knownBlocked, now: () => new Date(day) });

    const statuses = await checkUrls(urls, at('2026-10-26'));
    expect(urls.map((url) => statuses.get(url)?.state)).toEqual(['ok', 'broken', 'unverified']);
    expect(statuses.get('https://blocked.example/')?.detail).toContain('2026-10-01');

    // The cache keeps the raw answer; reading it applies the list again.
    expect(cachedUrlStatuses(urls, at('2026-10-26')).get(urls[0])?.state).toBe('ok');
    const lapsed = await checkUrls(urls, { ...at('2027-06-01'), refresh: true });
    expect(lapsed.get('https://blocked.example/')?.state).toBe('unverified');
  });

  it('lists only exact pages a person opened as known to refuse checks', () => {
    for (const [url, entry] of Object.entries(KNOWN_BLOCKED_URLS)) {
      expect(new URL(url).pathname, url).not.toBe('/');
      expect(entry.openedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.page.length).toBeGreaterThan(0);
    }
  });

  it('treats an unknown host as broken', async () => {
    const deadHost = (async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }) as unknown as typeof globalThis.fetch;
    const statuses = await checkUrls(['https://nowhere.example/'], {
      cacheFile: join(tempDir(), 'url-status.json'),
      fetch: deadHost,
    });
    expect(statuses.get('https://nowhere.example/')).toMatchObject({
      state: 'broken',
      detail: 'host not found',
    });
  });
});

describe('model client', () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  });

  it('fails fast with a clear message when no API key is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    expect(() => new AnthropicModelClient({ fallbacks: true })).toThrow(MissingApiKeyError);
    expect(() => new AnthropicModelClient({ fallbacks: true })).toThrow(/\.env\.local/);
  });
});

describe('prompts and cost', () => {
  it('render every placeholder and nothing else', () => {
    expect(render('Hi {{name}}.', { name: 'Ryan' })).toBe('Hi Ryan.');
    expect(() => render('Hi {{name}}.', {})).toThrow('{{name}}');
    expect(() => render('Hi.', { name: 'Ryan' })).toThrow('name');
  });

  it('estimates cost from usage', () => {
    const usage = {
      ...emptyUsage(),
      requests: 1,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      webSearches: 10,
    };
    expect(estimateCost(usage, 'claude-opus-5-5')).toBeCloseTo(4 + 2 + 0.1);
    expect(estimateCost(usage, 'unknown-model')).toBeUndefined();
  });

  it('counts cache writes from every iteration of a server tool loop', () => {
    // Shape of a real response: the top-level breakdown covers only the first iteration.
    const iteration = (write: number, ttl: '5m' | '1h') => ({
      type: 'message',
      input_tokens: 2,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: write,
      cache_creation: {
        ephemeral_5m_input_tokens: ttl === '5m' ? write : 0,
        ephemeral_1h_input_tokens: ttl === '1h' ? write : 0,
      },
    });
    const total = emptyUsage();
    addUsage(
      total,
      {
        input_tokens: 4,
        output_tokens: 200,
        cache_read_input_tokens: 3812,
        cache_creation_input_tokens: 149444,
        cache_creation: { ephemeral_5m_input_tokens: 3812, ephemeral_1h_input_tokens: 0 },
        iterations: [iteration(3812, '5m'), iteration(145632, '5m')],
      } as unknown as BetaUsage,
      false,
    );
    expect(total).toMatchObject({ cacheWrite5mTokens: 149444, cacheWrite1hTokens: 0 });

    const batch = emptyUsage();
    addUsage(
      batch,
      {
        input_tokens: 4,
        output_tokens: 200,
        cache_creation_input_tokens: 5000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 },
        iterations: [iteration(1000, '1h'), iteration(4000, '1h')],
      } as unknown as BetaUsage,
      true,
    );
    expect(batch).toMatchObject({ cacheWrite5mTokens: 0, cacheWrite1hTokens: 5000 });
  });
});
