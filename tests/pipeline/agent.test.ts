// Agent drafting: the session a Claude Code subagent works in, the pages it reads through the
// fetch command, and the submission check that accepts only fetched pages as evidence. Fetches
// go to a stub; no network, no key.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_CHARACTERS,
  fetchCommand,
  start,
  status,
  submit,
  type AgentDeps,
} from '../../pipeline/agent/commands';
import { AGENT_EVIDENCE_RULE } from '../../pipeline/agent/brief';
import {
  briefFile,
  draftFile,
  loadEvidence,
  readSession,
  sessionDir,
} from '../../pipeline/agent/session';
import { fetchPage } from '../../pipeline/claims/local-fetch';
import { DEFAULT_MODEL } from '../../pipeline/config';
import { countryFilePath, readCountryFile } from '../../pipeline/content-tree';
import { allPlans } from '../../pipeline/generate/plan';
import { chileDraft } from './fixtures/build-replay';
import { RUN_DATE, minimalPdf, tempContentTree, tempDir } from './helpers';

// A successful submission checks every route against land geometry, which takes a few seconds
// on a CI runner.
const SUBMIT_TIMEOUT_MS = 30_000;

type Page = {
  status?: number;
  type: string;
  body: string | Uint8Array<ArrayBuffer>;
  finalUrl?: string;
};

/** A network failure as Node's fetch reports it: "fetch failed", with the reason in the cause. */
function networkFailure(reason: string, code?: string): Error {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(reason), { code }) });
}

/** A fetch stub that serves the given pages by URL and counts requests. */
function stubFetch(pages: Record<string, Page>, failures: Record<string, Error> = {}) {
  const requested: string[] = [];
  const stub = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (failures[url]) throw failures[url];
    const page = pages[url];
    if (!page) return new Response('Not found', { status: 404 });
    const response = new Response(page.body, {
      status: page.status ?? 200,
      headers: { 'content-type': page.type },
    });
    Object.defineProperty(response, 'url', { value: page.finalUrl ?? url });
    return response;
  }) as typeof fetch;
  return { stub, requested };
}

const html = (title: string, text: string) =>
  `<!doctype html><html><head><title>${title}</title><script>var x = 1;</script></head><body><nav>Menu</nav><h1>${title}</h1><p>${text}</p></body></html>`;

/** Pages for every source the fixture's Chile draft cites. */
function chilePages(): Record<string, Page> {
  return Object.fromEntries(
    chileDraft().sources.map((source) => [
      source.url,
      { type: 'text/html; charset=utf-8', body: html(source.title, `Text of ${source.id}.`) },
    ]),
  );
}

function setup(
  options: {
    plan?: AgentDeps['plan'];
    pages?: Record<string, Page>;
    failures?: Record<string, Error>;
  } = {},
) {
  const contentDir = tempContentTree();
  const root = tempDir();
  const lines: string[] = [];
  const fetcher = stubFetch(options.pages ?? {}, options.failures);
  const deps: AgentDeps = {
    root,
    // The fixture draft answers its own questions, not the pilot plan's.
    plan: 'plan' in options ? options.plan : new Map(),
    fetch: fetcher.stub,
    now: () => new Date('2026-10-26T12:00:00Z'),
    out: (line) => lines.push(line),
  };
  const output = () => lines.splice(0).join('\n');
  const begin = (countryId = 'CHL', flags: { regenerate?: boolean; fresh?: boolean } = {}) =>
    start(
      {
        countryId,
        contentDir,
        model: DEFAULT_MODEL,
        date: RUN_DATE,
        regenerate: flags.regenerate ?? false,
        fresh: flags.fresh ?? false,
      },
      deps,
    );
  const read = (url: string, extra: { offset?: number; find?: string; refresh?: boolean } = {}) =>
    fetchCommand(
      {
        countryId: 'CHL',
        url,
        offset: extra.offset ?? 0,
        find: extra.find,
        refresh: !!extra.refresh,
      },
      deps,
    );
  const dir = sessionDir(root, 'CHL');
  const writeDraft = (draft: unknown) => writeFileSync(draftFile(dir), JSON.stringify(draft));
  return {
    contentDir,
    root,
    dir,
    deps,
    output,
    begin,
    read,
    writeDraft,
    requested: fetcher.requested,
  };
}

describe('agent drafting session', () => {
  it('writes a brief with the planned stories and the agent rules', () => {
    const { dir, begin, output } = setup({ plan: undefined });
    expect(begin()).toBe(0);
    expect(output()).toContain(`Read the whole brief before you research: ${briefFile(dir)}`);

    const session = readSession(dir, 'CHL');
    expect(session).toMatchObject({
      countryId: 'CHL',
      model: DEFAULT_MODEL,
      promptVersion: 'agent-v1',
      date: RUN_DATE,
      regenerate: false,
      submissions: [],
    });

    const brief = readFileSync(briefFile(dir), 'utf8');
    for (const planned of allPlans().get('CHL')!) {
      expect(brief).toContain(`- ${planned.id}: ${planned.question}`);
    }
    expect(brief).toContain('Never use the WebFetch tool');
    expect(brief).toContain('Cite only pages you read with the fetch command');
    expect(brief).toContain('npm run content:agent -- fetch CHL "<url>"');
    expect(brief).toContain(`write it to ${draftFile(dir)}`);
    // The shared pieces of the API prompts: reference example, gazetteer, link targets.
    expect(brief).toContain('# Reference example');
    expect(brief).toContain('# Shared gazetteer');
    expect(brief).toContain('ARG/pampas:');
    // The submission schema, with the source URL described for the fetch command.
    expect(brief).toContain('"starterStoryIds"');
    expect(brief).toContain('The exact URL of a page you read with the fetch command');
    // Nothing from the API's tools.
    expect(brief).not.toMatch(/web_search|web_fetch|find_places|submit_draft/);
  });

  it('refuses a country with reviewed content', () => {
    const { begin, output } = setup();
    expect(begin('SGP')).toBe(1);
    expect(output()).toContain('contains reviewed content');
  });
});

describe('agent fetch command', () => {
  const PDF_URL = 'https://stats.example.org/yearbook.pdf';
  const pages: Record<string, Page> = {
    'https://example.org/article': {
      type: 'text/html; charset=utf-8',
      body: html('Copper', 'Chile is the largest producer of copper.'),
      finalUrl: 'https://www.example.org/article/',
    },
    'https://example.org/notes.txt': { type: 'text/plain', body: '  Plain notes.  ' },
    [PDF_URL]: {
      // Served as a download, as statistics offices often do.
      type: 'application/octet-stream',
      body: minimalPdf([['Population 19.6 million'], ['Second page']]),
    },
    'https://example.org/blocked': { status: 403, type: 'text/html', body: 'Forbidden' },
    'https://example.org/challenge': {
      type: 'text/html',
      body: html('Just a moment...', 'Checking if the site connection is secure.'),
    },
    'https://example.org/image': { type: 'image/png', body: 'png' },
    'https://example.org/long': { type: 'text/plain', body: 'x'.repeat(45_000) },
  };

  it('stores HTML, plain text and PDF pages as evidence', async () => {
    const { dir, begin, read, output } = setup({ pages });
    begin();
    output();

    expect(await read('https://example.org/article')).toBe(0);
    const article = output();
    expect(article).toContain('Chile is the largest producer of copper.');
    expect(article).not.toContain('var x');
    expect(article).toContain('Redirected to https://www.example.org/article/');

    expect(await read('https://example.org/notes.txt')).toBe(0);
    expect(output()).toContain('Plain notes.');

    expect(await read(PDF_URL)).toBe(0);
    const pdf = output();
    expect(pdf).toContain('[Page 1]\nPopulation 19.6 million');
    expect(pdf).toContain('[Page 2]\nSecond page');

    const { records, problems } = loadEvidence(dir);
    expect(problems).toEqual([]);
    expect(records.map(({ record }) => record.requestedUrl).sort()).toEqual(
      ['https://example.org/article', 'https://example.org/notes.txt', PDF_URL].sort(),
    );
    const stored = records.find(({ record }) => record.requestedUrl.endsWith('/article'))!.record;
    expect(stored).toMatchObject({
      finalUrl: 'https://www.example.org/article/',
      normalizedUrls: ['example.org/article'],
      status: 200,
      contentType: 'text/html; charset=utf-8',
      fetchedAt: '2026-10-26T12:00:00.000Z',
      truncated: false,
    });
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores nothing for a page it cannot read', async () => {
    const { dir, begin, read, output } = setup({ pages });
    begin();
    output();
    for (const [url, reason] of [
      ['https://example.org/blocked', 'the server answered 403'],
      ['https://example.org/challenge', 'bot challenge'],
      ['https://example.org/image', 'image/png'],
      ['https://example.org/missing', 'the server answered 404'],
    ]) {
      expect(await read(url)).toBe(1);
      const printed = output();
      expect(printed).toContain(reason);
      expect(printed).toContain('Nothing was stored');
    }
    expect(loadEvidence(dir).records).toEqual([]);
  });

  it('pages through long text and searches it from the stored copy', async () => {
    const { begin, read, output, requested } = setup({ pages });
    begin();
    output();
    expect(await read('https://example.org/long')).toBe(0);
    expect(output()).toContain(`Characters 0 to 20,000 of 45,000. Next part:`);
    expect(await read('https://example.org/long', { offset: 2 * CHUNK_CHARACTERS })).toBe(0);
    expect(output()).toContain('Characters 40,000 to 45,000 of 45,000. This is the end');
    expect(await read('https://example.org/long', { find: 'y' })).toBe(0);
    expect(output()).toContain('"y" does not appear');
    expect(requested.filter((url) => url === 'https://example.org/long')).toHaveLength(1);
  });

  it('says why a request failed at the network level, and records the attempt', async () => {
    const refused = new AggregateError([Object.assign(new Error(''), { code: 'ECONNREFUSED' })]);
    const failures = {
      'https://loop.example/a': networkFailure('redirect count exceeded'),
      'https://wrong.example/': networkFailure(
        "Hostname/IP does not match certificate's altnames: Host: wrong.example",
        'ERR_TLS_CERT_ALTNAME_INVALID',
      ),
      'https://reset.example/': networkFailure('read ECONNRESET', 'ECONNRESET'),
      'https://refused.example/': new TypeError('fetch failed', { cause: refused }),
      'https://odd.example/': new TypeError('fetch failed'),
    };
    const { dir, begin, read, output, deps } = setup({ pages, failures });
    begin();
    output();
    for (const [url, reason] of [
      ['https://loop.example/a', 'fetch failed (redirect count exceeded)'],
      [
        'https://wrong.example/',
        "fetch failed (ERR_TLS_CERT_ALTNAME_INVALID: Hostname/IP does not match certificate's altnames: Host: wrong.example)",
      ],
      ['https://reset.example/', 'fetch failed (read ECONNRESET)'],
      ['https://refused.example/', 'fetch failed (ECONNREFUSED)'],
      ['https://odd.example/', 'Could not read https://odd.example/: fetch failed.'],
    ]) {
      expect(await read(url)).toBe(1);
      expect(output()).toContain(reason);
    }

    const session = readSession(dir, 'CHL');
    expect(session.failedFetches.map(({ url }) => url)).toEqual(Object.keys(failures));
    expect(session.failedFetches[0]).toEqual({
      url: 'https://loop.example/a',
      attemptedAt: '2026-10-26T12:00:00.000Z',
      reason: 'fetch failed (redirect count exceeded)',
    });
    // A failed attempt is a note for the drafter, never evidence.
    expect(loadEvidence(dir).records).toEqual([]);

    status({ countryId: 'CHL' }, deps);
    const printed = output();
    expect(printed).toContain('Failed fetches: 5');
    expect(printed).toContain(
      'https://reset.example/ (2026-10-26T12:00:00.000Z): fetch failed (read ECONNRESET)',
    );
  });

  it('records a server error and shows none for a session without failures', async () => {
    const { dir, begin, read, output, deps } = setup({ pages });
    begin();
    await read('https://example.org/article');
    output();
    status({ countryId: 'CHL' }, deps);
    expect(output()).toContain('Failed fetches: none');

    await read('https://example.org/blocked');
    expect(readSession(dir, 'CHL').failedFetches).toMatchObject([
      { url: 'https://example.org/blocked', reason: 'the server answered 403' },
    ]);
  });

  it('keeps failed fetches when a session continues, and reads sessions without them', async () => {
    const { dir, begin, read, output } = setup({ pages });
    begin();
    await read('https://example.org/blocked');
    output();
    expect(begin()).toBe(0);
    expect(readSession(dir, 'CHL').failedFetches).toHaveLength(1);

    const file = join(dir, 'session.json');
    const older = JSON.parse(readFileSync(file, 'utf8'));
    delete older.failedFetches;
    writeFileSync(file, JSON.stringify(older));
    expect(readSession(dir, 'CHL').failedFetches).toEqual([]);
  });

  it('adds the cause to the claim check fetch as well', async () => {
    const reset = { 'https://reset.example/': networkFailure('read ECONNRESET', 'ECONNRESET') };
    const { stub } = stubFetch({}, reset);
    await expect(fetchPage('https://reset.example/', { fetch: stub })).rejects.toThrow(
      'fetch failed (read ECONNRESET)',
    );
  });

  it('leaves the claim check reading HTML and plain text only', async () => {
    const { stub } = stubFetch(pages);
    await expect(fetchPage(PDF_URL, { fetch: stub })).rejects.toThrow(
      'only HTML and plain text are read',
    );
  });
});

describe('agent submit command', () => {
  it(
    'rejects a source that was never fetched',
    async () => {
      const { contentDir, dir, begin, read, writeDraft, output, deps } = setup({
        pages: chilePages(),
      });
      begin();
      const [unfetched, ...fetched] = chileDraft().sources;
      for (const source of fetched) await read(source.url);
      output();
      writeDraft(chileDraft());

      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      const printed = output();
      expect(printed).toContain(
        `sources: "${unfetched.id}" (${unfetched.url}) was not retrieved in this task. ${AGENT_EVIDENCE_RULE}`,
      );
      expect(printed).toMatch(/^1\. /m);
      expect(existsSync(join(dir, 'submissions', '1.json'))).toBe(true);
      expect(readSession(dir, 'CHL').submissions).toHaveLength(1);
      expect(existsSync(countryFilePath(contentDir, 'chile'))).toBe(false);
    },
    SUBMIT_TIMEOUT_MS,
  );

  it(
    'rejects a tampered evidence record',
    async () => {
      const { contentDir, dir, begin, read, writeDraft, output, deps } = setup({
        pages: chilePages(),
      });
      begin();
      for (const source of chileDraft().sources) await read(source.url);
      output();
      const { records } = loadEvidence(dir);
      const target = records[0];
      writeFileSync(
        target.file,
        JSON.stringify({ ...target.record, text: `${target.record.text} Edited by hand.` }),
      );
      writeDraft(chileDraft());

      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      const printed = output();
      expect(printed).toContain('its text no longer matches the hash');
      expect(printed).toContain(`(${target.record.requestedUrl}) was not retrieved in this task`);
      expect(existsSync(countryFilePath(contentDir, 'chile'))).toBe(false);
    },
    SUBMIT_TIMEOUT_MS,
  );

  it(
    'checks a draft with --dry-run without writing or recording anything',
    async () => {
      const { contentDir, dir, begin, read, writeDraft, output, deps } = setup({
        pages: chilePages(),
      });
      begin();
      const [unfetched, ...fetched] = chileDraft().sources;
      for (const source of fetched) await read(source.url);
      output();
      writeDraft(chileDraft());
      const sessionBefore = readFileSync(join(dir, 'session.json'), 'utf8');

      // The same problems as a real submission, and no trace of the attempt.
      expect(submit({ countryId: 'CHL', dryRun: true }, deps)).toBe(1);
      const dryProblems = output();
      expect(dryProblems).toContain('Dry run: the draft has');
      expect(dryProblems).toContain(`"${unfetched.id}" (${unfetched.url}) was not retrieved`);
      expect(existsSync(join(dir, 'submissions'))).toBe(false);
      expect(readFileSync(join(dir, 'session.json'), 'utf8')).toBe(sessionBefore);

      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      const realProblems = output();
      const numbered = (text: string) => text.split('\n').filter((line) => /^\d+\. /.test(line));
      expect(numbered(dryProblems)).toEqual(numbered(realProblems));
      expect(readSession(dir, 'CHL').submissions).toHaveLength(1);

      // Once the draft passes, the dry run says so and still writes nothing.
      await read(unfetched.url);
      output();
      expect(submit({ countryId: 'CHL', dryRun: true }, deps)).toBe(0);
      const passed = output();
      expect(passed).toContain('Dry run: the draft would pass. Nothing was written');
      expect(passed).toContain('4 stories, 4 sources, 0 pending references.');
      expect(existsSync(countryFilePath(contentDir, 'chile'))).toBe(false);
      expect(readSession(dir, 'CHL').written).toBeUndefined();
      expect(readSession(dir, 'CHL').submissions).toHaveLength(1);
      expect(existsSync(join(dir, 'submissions', '2.json'))).toBe(false);

      // It did not finish the session, so a real submission still works.
      expect(submit({ countryId: 'CHL' }, deps)).toBe(0);
      expect(existsSync(countryFilePath(contentDir, 'chile'))).toBe(true);
    },
    SUBMIT_TIMEOUT_MS,
  );

  it(
    'writes a valid draft into the content tree',
    async () => {
      const { contentDir, dir, begin, read, writeDraft, output, deps } = setup({
        pages: chilePages(),
      });
      begin();
      for (const source of chileDraft().sources) await read(source.url);
      output();
      writeDraft(chileDraft());

      expect(submit({ countryId: 'CHL' }, deps)).toBe(0);
      const printed = output();
      expect(printed).toContain(`Wrote ${countryFilePath(contentDir, 'chile')}`);
      expect(printed).toContain('4 stories, 4 sources, 0 pending references.');

      const file = readCountryFile(contentDir, 'chile')!;
      expect(file.country.provenance).toEqual({
        generatedBy: DEFAULT_MODEL,
        generatedAt: RUN_DATE,
        promptVersion: 'agent-v1',
        status: 'draft',
      });
      expect(file.stories.map((story) => story.id)).toEqual([
        'length',
        'desert',
        'copper',
        'andes',
      ]);
      expect(file.country.sources.every((source) => source.accessedAt === RUN_DATE)).toBe(true);
      expect(readSession(dir, 'CHL').written?.file).toBe(countryFilePath(contentDir, 'chile'));

      status({ countryId: 'CHL' }, deps);
      expect(output()).toContain('Fetched pages: 4');

      // The session is finished, and the draft it wrote is replaced only on request.
      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      expect(begin()).toBe(1);
      expect(begin('CHL', { fresh: true })).toBe(1);
      expect(output()).toContain('is a draft nobody sent back');
      expect(begin('CHL', { fresh: true, regenerate: true })).toBe(0);
    },
    SUBMIT_TIMEOUT_MS,
  );
});
