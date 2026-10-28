// Agent drafting: the session a Claude Code subagent works in, the pages it reads through the
// fetch command, and the submission check that accepts only fetched pages as evidence. Fetches
// go to a stub; no network, no key.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHUNK_CHARACTERS,
  fetchCommand,
  places,
  start,
  status,
  submit,
  type AgentDeps,
} from '../../pipeline/agent/commands';
import { AGENT_EVIDENCE_RULE } from '../../pipeline/agent/brief';
import { MIN_PAGE_CHARACTERS, notTheRequestedPage } from '../../pipeline/agent/page-check';
import {
  briefFile,
  draftFile,
  loadEvidence,
  readSession,
  sessionDir,
  writeSession,
} from '../../pipeline/agent/session';
import { extractLinks, fetchPage } from '../../pipeline/claims/local-fetch';
import { parseArgsOnce } from '../../pipeline/cli-args';
import { DEFAULT_MODEL } from '../../pipeline/config';
import { countryFilePath, readCountryFile, writeCountryFile } from '../../pipeline/content-tree';
import { assembleCountry } from '../../pipeline/generate/assemble';
import { CountryDraft } from '../../pipeline/generate/draft-schema';
import { allPlans } from '../../pipeline/generate/plan';
import { loadAgentPrompts, loadAgentRevisionPrompts } from '../../pipeline/prompts';
import { requestRevision } from '../../pipeline/review/actions';
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

/** Background text, so a page is longer than the shortest the pipeline accepts as a page. */
const BACKGROUND = ' Statistics, history and background for the readers of this page.'.repeat(8);
const fullPage = (title: string, text: string) => html(title, text + BACKGROUND);

/** Pages for every source the fixture's Chile draft cites. */
function chilePages(): Record<string, Page> {
  return Object.fromEntries(
    chileDraft().sources.map((source) => [
      source.url,
      { type: 'text/html; charset=utf-8', body: fullPage(source.title, `Text of ${source.id}.`) },
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
  const read = (
    url: string,
    extra: { offset?: number; find?: string; links?: boolean; refresh?: boolean } = {},
  ) =>
    fetchCommand(
      {
        countryId: 'CHL',
        url,
        offset: extra.offset ?? 0,
        find: extra.find,
        links: extra.links,
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
      promptVersion: 'agent-v2',
      date: RUN_DATE,
      regenerate: false,
      submissions: [],
    });

    const brief = readFileSync(briefFile(dir), 'utf8');
    for (const planned of allPlans().get('CHL')!) {
      expect(brief).toContain(`- ${planned.id}: ${planned.question}`);
    }
    expect(brief).toContain('never use the WebFetch tool');
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

  it('keeps the prompt version of a session it continues', () => {
    const { dir, begin } = setup({ plan: undefined });
    begin();
    writeSession(dir, { ...readSession(dir, 'CHL'), promptVersion: 'agent-v1' });
    expect(begin()).toBe(0);
    expect(readSession(dir, 'CHL').promptVersion).toBe('agent-v1');
    expect(readFileSync(briefFile(dir), 'utf8')).toContain('Britannica (the main edition');
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
      body: fullPage('Copper', 'Chile is the largest producer of copper.'),
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

  it('says how many times words appear and lists the rest from an offset', async () => {
    const MANY = 'https://example.org/many';
    const sentence = 'Copper is mined here.\n';
    const { begin, read, output } = setup({
      pages: { ...pages, [MANY]: { type: 'text/plain', body: sentence.repeat(25) } },
    });
    begin();
    output();
    expect(await read(MANY, { find: 'copper' })).toBe(0);
    const first = output();
    expect(first).toContain(
      '"copper" appears 25 times in the text; matches 1 to 20. Each excerpt shows line breaks and runs of spaces as one space.',
    );
    expect(first).toContain('- offset 418: ...');
    expect(first).not.toContain('- offset 440:');
    expect(first).toContain(
      `Next matches: npm run content:agent -- fetch CHL "${MANY}" --find "copper" --offset 419`,
    );
    expect(await read(MANY, { find: 'copper', offset: 419 })).toBe(0);
    const rest = output();
    expect(rest).toContain('matches 21 to 25, from character 419 on.');
    expect(rest).toContain('- offset 440: ...');
    expect(rest).not.toContain('Next matches');
    expect(await read(MANY, { find: 'copper', offset: 540 })).toBe(0);
    expect(output()).toContain(
      '"copper" appears 25 times in the text, but not from character 540 on.',
    );
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
        "certificate error: the site's TLS certificate could not be verified (ERR_TLS_CERT_ALTNAME_INVALID: Hostname/IP does not match certificate's altnames: Host: wrong.example), and a page is never read over an unverified connection",
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

  it('decodes pages that do not declare their charset in the header', async () => {
    // "Constitución" as windows-1252 bytes, as Argentina's InfoLEG serves it with no charset.
    const latin1 = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'));
    const body = (head: string) =>
      latin1(
        `<html><head>${head}<title>t</title></head><body><p>Constitución Nacional</p></body></html>`,
      );
    const utf8 = new Uint8Array(
      Buffer.from('<html><body><p>Constitución Nacional</p></body></html>', 'utf8'),
    );
    const { stub } = stubFetch({
      'https://infoleg.example/plain': { type: 'text/html', body: body('') },
      'https://infoleg.example/meta': {
        type: 'text/html',
        body: body('<meta charset="iso-8859-1">'),
      },
      'https://infoleg.example/equiv': {
        type: 'text/html',
        body: body('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">'),
      },
      'https://infoleg.example/utf8': { type: 'text/html', body: utf8 },
      'https://infoleg.example/header': { type: 'text/html; charset=utf-8', body: utf8 },
    });
    for (const path of ['plain', 'meta', 'equiv', 'utf8', 'header']) {
      const page = await fetchPage(`https://infoleg.example/${path}`, { fetch: stub });
      expect(page.text, path).toContain('Constitución Nacional');
      expect(page.text, path).not.toContain('�');
    }
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
        promptVersion: 'agent-v2',
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

describe('agent fetch --links', () => {
  const ARTICLE = 'https://stats.example.org/section/report';
  const links = `
    <a href="/data/table-1.pdf">Table 1 (PDF)</a>
    <a href="https://other.example.org/source?a=1&amp;b=2#part"><span>Primary</span>
      <em>source</em></a>
    <a href="table-2.xlsx"></a>
    <a href="/data/table-1.pdf">Table 1 again</a>
    <a href="/data/table-2.pdf" title="Second table"><img alt="icon" src="x.png"></a>
    <a href="#top">Top</a>
    <a href="${ARTICLE}#notes">This page</a>
    <a href="mailto:press@example.org">Press</a>
    <a href="javascript:void(0)">Script</a>
    <a name="anchor-only">No target</a>
    <a href="http://[bad">Broken</a>`;
  const many = Array.from({ length: 700 }, (_, n) => `<a href="/doc/${n}">Document ${n}</a>`).join(
    ' ',
  );
  const pages: Record<string, Page> = {
    [ARTICLE]: { type: 'text/html', body: fullPage('Report', links) },
    'https://stats.example.org/plain.txt': { type: 'text/plain', body: 'Plain. '.repeat(100) },
    'https://stats.example.org/many': { type: 'text/html', body: fullPage('Many', many) },
    'https://stats.example.org/none': { type: 'text/html', body: fullPage('None', 'No links.') },
  };

  it('extracts absolute links in page order, once each, with their anchor text', () => {
    expect(extractLinks(links, ARTICLE)).toEqual([
      { url: 'https://stats.example.org/data/table-1.pdf', text: 'Table 1 (PDF)' },
      { url: 'https://other.example.org/source?a=1&b=2', text: 'Primary source' },
      { url: 'https://stats.example.org/section/table-2.xlsx', text: '' },
      { url: 'https://stats.example.org/data/table-2.pdf', text: 'Second table' },
    ]);
    // The text of a later link fills in an earlier link to the same URL that had none.
    const texts = extractLinks('<a href="/a"></a><a href="/b">B</a><a href="/a">A</a>', ARTICLE);
    expect(texts.map((link) => link.text)).toEqual(['A', 'B']);
  });

  it('lists the stored links instead of the text', async () => {
    const { dir, begin, read, output, requested } = setup({ pages });
    begin();
    output();
    expect(await read(ARTICLE, { links: true })).toBe(0);
    const printed = output();
    expect(printed).toContain('Links 1 to 4 of 4, as "text | URL". This is the end of the links.');
    expect(printed).toContain('Table 1 (PDF) | https://stats.example.org/data/table-1.pdf');
    expect(printed).toContain('Primary source | https://other.example.org/source?a=1&b=2');
    expect(printed).toContain('(no text) | https://stats.example.org/section/table-2.xlsx');
    expect(printed).not.toContain('Statistics, history and background');

    // The text is still there, from the stored copy.
    expect(await read(ARTICLE)).toBe(0);
    expect(output()).toContain('Statistics, history and background');
    expect(requested).toEqual([ARTICLE]);
    expect(loadEvidence(dir).records[0].record.links).toHaveLength(4);
  });

  it('pages through many links like the text, by link number', async () => {
    const { begin, read, output } = setup({ pages });
    begin();
    output();
    const url = 'https://stats.example.org/many';
    expect(await read(url, { links: true })).toBe(0);
    const first = output();
    const shown = Number(/^Links 1 to (\d+) of 700/m.exec(first)?.[1]);
    expect(shown).toBeGreaterThan(100);
    expect(shown).toBeLessThan(700);
    expect(first).toContain(`--links --offset ${shown}`);
    expect(first.length).toBeLessThan(CHUNK_CHARACTERS + 1000);

    expect(await read(url, { links: true, offset: shown })).toBe(0);
    expect(output()).toContain(`Document ${shown} | https://stats.example.org/doc/${shown}`);

    expect(await read(url, { links: true, offset: 700 })).toBe(1);
    expect(output()).toContain('--offset counts links: between 0 and 699');
  });

  it('says so when a page has no links, and refuses --links with --find', async () => {
    const { begin, read, output } = setup({ pages });
    begin();
    output();
    expect(await read('https://stats.example.org/none', { links: true })).toBe(0);
    expect(output()).toContain('The page has no links.');
    expect(await read('https://stats.example.org/plain.txt', { links: true })).toBe(0);
    expect(output()).toContain('The page has no links.');
    expect(await read(ARTICLE, { links: true, find: 'links' })).toBe(1);
    expect(output()).toContain('cannot be combined');
  });

  it('asks for a fresh fetch when the stored copy predates links', async () => {
    const { dir, begin, read, output } = setup({ pages });
    begin();
    await read(ARTICLE);
    output();
    const { file, record } = loadEvidence(dir).records[0];
    // JSON leaves out the undefined links, as a record stored before links were kept does.
    writeFileSync(file, JSON.stringify({ ...record, links: undefined }));
    expect(await read(ARTICLE, { links: true })).toBe(1);
    expect(output()).toContain('before links were kept. Fetch it again with --refresh');
    expect(await read(ARTICLE, { links: true, refresh: true })).toBe(0);
    expect(output()).toContain('Links 1 to 4 of 4');
  });
});

describe('pages that are not the requested page', () => {
  const suspicious: { url: string; page: Page; reason: string }[] = [
    {
      // A script stub.
      url: 'https://app.example.org/report',
      page: { type: 'text/html', body: html('App', 'You need JavaScript.') },
      reason: 'its text is only',
    },
    {
      url: 'https://news.example.org/2026/story',
      page: {
        type: 'text/html',
        body: fullPage('News', 'Front page.'),
        finalUrl: 'https://news.example.org/',
      },
      reason: "redirected to the site's home page",
    },
    {
      url: 'https://agency.example.gov/statistics/2026',
      page: {
        type: 'text/html',
        body: fullPage('Agency', 'Welcome.'),
        finalUrl: 'https://agency.example.gov/en',
      },
      reason: "redirected to the site's home page",
    },
    {
      url: 'https://journal.example.org/articles/x1',
      page: {
        type: 'text/html',
        body: fullPage('Sign in', 'Email and password.'),
        finalUrl: 'https://journal.example.org/user/sign-in?next=%2Farticles%2Fx1',
      },
      reason: 'redirected to a login, sign-in or consent page',
    },
    {
      // A login host, as a journal's identity provider.
      url: 'https://www.nature.example/articles/s1',
      page: {
        type: 'text/html',
        body: fullPage('Log in', 'Access through your institution.'),
        finalUrl: 'https://idp.nature.example/session?redirect=1',
      },
      reason: 'redirected to a login, sign-in or consent page',
    },
    {
      url: 'https://daily.example.com/world/story',
      page: {
        type: 'text/html',
        body: fullPage('Before you continue', 'We value your privacy.'),
        finalUrl: 'https://daily.example.com/consent?url=story',
      },
      reason: 'redirected to a login, sign-in or consent page',
    },
  ];

  /** Pages that move or are short, but are the page that was asked for. */
  const ordinary: Record<string, Page> = {
    // A DOI lands on the publisher's article, on another host.
    'https://doi.example/10.1/abc': {
      type: 'text/html',
      body: fullPage('Article', 'Findings.'),
      finalUrl: 'https://publisher.example.net/articles/10.1-abc',
    },
    // A site that moved to www and added a language path.
    'https://agency.example.gov/statistics': {
      type: 'text/html',
      body: fullPage('Statistics', 'Tables.'),
      finalUrl: 'https://www.agency.example.gov/en/statistics/',
    },
    // A page about logging in is still that page.
    'https://help.example.org/login': {
      type: 'text/html',
      body: fullPage('Login help', 'How to log in.'),
    },
    // A home page asked for as such.
    'https://example.net/': {
      type: 'text/html',
      body: fullPage('Home', 'Welcome.'),
      finalUrl: 'https://example.net/en/',
    },
    'https://example.org/exactly-enough': {
      type: 'text/plain',
      body: 'x'.repeat(MIN_PAGE_CHARACTERS),
    },
  };

  it('recognises the suspicious cases and leaves ordinary pages alone', () => {
    const check = (requestedUrl: string, finalUrl: string, length = 5000) =>
      notTheRequestedPage({ requestedUrl, finalUrl, text: 'x'.repeat(length) });
    // The cases that prompted the check: a 209-character stub, and an article behind a login.
    expect(check('https://a.example/p', 'https://a.example/p', 209)).toContain(
      'only 209 characters',
    );
    expect(
      check(
        'https://www.nature.com/articles/s41586-024-07000-0',
        'https://idp.nature.com/authorize?response_type=cb&client_id=grover',
      ),
    ).toContain('login');
    for (const [url, page] of Object.entries(ordinary)) {
      expect(check(url, page.finalUrl ?? url, MIN_PAGE_CHARACTERS)).toBeUndefined();
    }
  });

  it('warns in the fetch output, still stores the page, and marks it in status', async () => {
    const pages = Object.fromEntries(suspicious.map(({ url, page }) => [url, page]));
    const { begin, read, output, deps, dir } = setup({ pages: { ...pages, ...ordinary } });
    begin();
    output();
    for (const { url, reason } of suspicious) {
      expect(await read(url)).toBe(0);
      const printed = output();
      expect(printed).toContain('WARNING: this is probably not the page you asked for');
      expect(printed).toContain(reason);
      expect(printed).toContain('rejected at submit');
    }
    for (const url of Object.keys(ordinary)) {
      expect(await read(url)).toBe(0);
      expect(output()).not.toContain('WARNING');
    }
    expect(loadEvidence(dir).records).toHaveLength(
      suspicious.length + Object.keys(ordinary).length,
    );

    status({ countryId: 'CHL' }, deps);
    expect(output().match(/NOT CITABLE/g)).toHaveLength(suspicious.length);
  });

  it(
    'rejects a draft that cites such a page',
    async () => {
      const cited = suspicious.slice(0, 4);
      const { contentDir, dir, begin, read, writeDraft, output, deps } = setup({
        pages: Object.fromEntries(cited.map(({ url, page }) => [url, page])),
      });
      begin();
      for (const { url } of cited) await read(url);
      output();
      // The fixture draft, citing the suspicious pages in place of its own sources.
      const draft = chileDraft();
      const sources = draft.sources.map((source, index) => ({ ...source, url: cited[index].url }));
      writeDraft({ ...draft, sources });

      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      const printed = output();
      for (const [index, source] of sources.entries()) {
        expect(printed).toContain(
          `sources: "${source.id}" (${source.url}) is not the page it should be`,
        );
        expect(printed).toContain(cited[index].reason);
      }
      expect(printed).not.toContain('was not retrieved in this task');
      expect(existsSync(countryFilePath(contentDir, 'chile'))).toBe(false);
      expect(readSession(dir, 'CHL').written).toBeUndefined();
    },
    SUBMIT_TIMEOUT_MS,
  );
});

describe('agent-v2 prompts', () => {
  const research = (system: string) =>
    system.slice(system.indexOf('# Research and sources'), system.indexOf('# The map scene'));

  it('is the current line, with agent-v1 left as it was', () => {
    const v1 = loadAgentPrompts('agent-v1');
    expect(v1.system).toContain('the CIA World Factbook, Britannica (the main edition');
    expect(v1.system).not.toContain('curl');

    const v2 = loadAgentPrompts();
    expect(v2.version).toBe('agent-v2');
    // Everything outside the research section and the command list is unchanged.
    expect(v2.system.replace(research(v2.system), '')).toBe(
      v1.system.replace(research(v1.system), ''),
    );
    expect(v2['link-targets']).toBe(v1['link-targets']);
    expect(v2.repair).toBe(v1.repair);
    // Only revision sessions use revise-story, which agent-v1 never had.
    expect(loadAgentRevisionPrompts()['revise-story']).toContain('# Task: revise');
    expect(() => loadAgentRevisionPrompts('agent-v1')).toThrow(
      'The agent-v1 agent prompts have no revise-story template.',
    );
    for (const sentence of [
      'Do not cite Wikipedia or other wikis.',
      'If you cannot find a source for a claim, leave the claim out.',
      'Cite only pages you read with the fetch command, by the URL you fetched.',
    ]) {
      expect(research(v2.system)).toContain(sentence);
    }
  });

  it('recommends sources the fetch command can read and states the new rules', () => {
    const { dir, begin } = setup({ plan: undefined });
    begin();
    const brief = readFileSync(briefFile(dir), 'utf8');
    const sources = research(brief);
    expect(sources).toContain('national statistics offices');
    expect(sources).toContain('parliament pages');
    expect(sources).toContain('the OECD');
    expect(sources).toContain('museums, archives and libraries');
    expect(sources).toContain(
      'Britannica) and discontinued references (the CIA World Factbook) cannot be fetched',
    );
    expect(sources).not.toContain('Britannica (the main edition');
    expect(brief).toContain('Never use curl, wget or any other tool that makes HTTP requests');
    expect(brief).toContain('Never put personal information');
    expect(brief).toContain('run the fetch command with --links');
    expect(brief).toContain('Add `--links` to list the page');
    expect(brief).toContain('Repeat `--query` to search several names in one call.');
  });
});

describe('agent places command', () => {
  it('searches several names in one call, headed by each query', () => {
    const { deps, output } = setup();
    expect(
      places({ countryId: 'CHL', queries: ['santiago', 'punta arenas'], countries: [] }, deps),
    ).toBe(0);
    const printed = output();
    expect(printed).toMatch(/^## santiago\n[^\n]*Santiago \| city in CHL/m);
    expect(printed).toMatch(/^## punta arenas\n[^\n]*Punta Arenas/m);
  });

  it('prints a single query, or none, without a heading', () => {
    const { deps, output } = setup();
    expect(places({ countryId: 'CHL', queries: ['santiago'], countries: [] }, deps)).toBe(0);
    expect(output()).not.toContain('##');
    expect(places({ countryId: 'CHL', queries: [], countries: ['CHL'] }, deps)).toBe(0);
    expect(output()).toContain('| city in CHL |');
  });

  it('searches places in any of several countries', () => {
    const { deps, output } = setup();
    const near = (countries: string[]) => {
      expect(places({ countryId: 'CHL', queries: [], countries, near: 'santiago' }, deps)).toBe(0);
      return output();
    };
    const both = near(['CHL', 'arg']);
    expect(both).toContain('| city in CHL |');
    expect(both).toContain('| city in ARG |');
    expect(both).not.toMatch(/\| (city|region) in (?!CHL|ARG)/);
    expect(near(['ARG'])).not.toContain('in CHL');
    expect(() => near(['XXX'])).toThrow('Unknown map country "XXX"');
  });
});

describe('command-line options', () => {
  const options = {
    country: { type: 'string', multiple: true },
    near: { type: 'string' },
    'dry-run': { type: 'boolean' },
  } as const;
  const parse = (args: string[]) => parseArgsOnce({ args, options, allowPositionals: true });

  it('keeps every value of a repeatable option', () => {
    expect(parse(['NGA', '--country', 'NGA', '--country', 'CMR']).values.country).toEqual([
      'NGA',
      'CMR',
    ]);
  });

  it('refuses an option that takes one value given twice, instead of keeping the last', () => {
    expect(() => parse(['NGA', '--near', 'lagos', '--near', 'abuja'])).toThrow(
      '--near was given more than once',
    );
    expect(() => parse(['NGA', '--dry-run', '--dry-run'])).toThrow('--dry-run was given');
    expect(parse(['NGA', '--near', 'lagos', '--dry-run']).values).toEqual({
      near: 'lagos',
      'dry-run': true,
    });
  });
});

describe('agent revision session', () => {
  const NOTES = 'Explain how people cross the mountains today.';
  const REVISED_SUMMARY = 'Revised fixture answer about the passes through the andes.';
  const geography = () => chileDraft().sources.find((source) => source.id === 'fixture-geography')!;

  type FixtureStory = ReturnType<typeof chileDraft>['stories'][number];

  /** The andes story revised, citing the page it cited before. */
  function revisedAndes(change: (story: FixtureStory) => void = () => {}) {
    const andes = chileDraft().stories.find((story) => story.id === 'andes')!;
    andes.summary = REVISED_SUMMARY;
    change(andes);
    return { stories: [andes], sources: [geography()] };
  }

  /** A draft Chile file in the content tree, as the API path writes it, and its session tools. */
  function revisionSetup() {
    const context = setup({ pages: chilePages() });
    const { contentDir, deps } = context;
    writeCountryFile(
      contentDir,
      assembleCountry(CountryDraft.parse(chileDraft()), {
        countryId: 'CHL',
        slug: 'chile',
        model: DEFAULT_MODEL,
        date: '2026-10-01',
        promptVersion: 'v3',
      }),
    );
    const sendBack = (notes = NOTES) =>
      requestRevision({
        contentDir,
        country: 'CHL',
        storyId: 'andes',
        notes,
        by: 'Tester',
        date: RUN_DATE,
      });
    const reviseStart = (regenerate = false) =>
      start(
        {
          countryId: 'CHL',
          contentDir,
          model: DEFAULT_MODEL,
          date: RUN_DATE,
          regenerate,
          fresh: false,
          revisions: true,
        },
        deps,
      );
    return { ...context, sendBack, reviseStart, file: countryFilePath(contentDir, 'chile') };
  }

  it('refuses to start when nothing is sent back', () => {
    const { contentDir, dir, reviseStart, output } = revisionSetup();
    expect(reviseStart()).toBe(1);
    expect(output()).toContain(
      'No story in Chile is sent back for revision. Send one back first with: npm run content:review -- revise CHL <story>',
    );
    expect(existsSync(dir)).toBe(false);

    requestRevision({
      contentDir,
      country: 'CHL',
      notes: 'Start over.',
      by: 'Tester',
      date: RUN_DATE,
    });
    expect(reviseStart()).toBe(1);
    expect(output()).toContain(
      'The whole of Chile was sent back. Draft it again with: npm run content:agent -- start CHL',
    );
    expect(reviseStart(true)).toBe(1);
    expect(output()).toContain('--regenerate is for drafting a whole country again');
  });

  it('writes a brief with the notes and the story as drafted', () => {
    const { contentDir, dir, sendBack, reviseStart, output } = revisionSetup();
    sendBack();
    expect(reviseStart()).toBe(0);
    expect(output()).toContain(
      `Agent revision session for Chile (CHL) in ${dir}, revising "andes".`,
    );
    expect(readSession(dir, 'CHL')).toMatchObject({
      promptVersion: 'agent-v2',
      model: DEFAULT_MODEL,
      revisions: [
        {
          storyId: 'andes',
          request: { notes: NOTES, requestedBy: 'Tester', requestedAt: RUN_DATE },
        },
      ],
    });

    const brief = readFileSync(briefFile(dir), 'utf8');
    expect(brief).toContain('# Task: revise the story "andes" in Chile');
    expect(brief).toContain(
      `### "andes": Fixture question about andes?\n\n#### Editor's notes\n\n${NOTES}\n\n#### The story as drafted\n\n`,
    );
    // The story as drafted, as the API revision task shows it: without the revision request.
    const old = readCountryFile(contentDir, 'chile')!.stories[3];
    const { revision, ...provenance } = old.provenance;
    expect(revision?.notes).toBe(NOTES);
    expect(brief).toContain(
      `\`\`\`json\n${JSON.stringify({ ...old, provenance }, null, 2)}\n\`\`\``,
    );
    expect(brief).toContain(
      'Other stories in Chile (country ID CHL): "length" (Fixture question about length?)',
    );
    expect(brief).toContain('fetch each one again before you keep it');
    expect(brief).toContain(
      `write the complete revised stories and the sources they cite to ${draftFile(dir)}`,
    );
    expect(brief).toContain('npm run content:agent -- fetch CHL "<url>"');
    expect(brief).toContain('"The ID of the story this revises, unchanged."');
    // The shared pieces of every drafting brief.
    expect(brief).toContain('never use the WebFetch tool');
    expect(brief).toContain('# Reference example');
    expect(brief).toContain('# Link targets');
    expect(brief).not.toMatch(/web_search|web_fetch|find_places|submit_story/);
  });

  it(
    'moves a finished session aside and counts only pages fetched again',
    async () => {
      const { contentDir, root, dir, deps, read, sendBack, reviseStart, writeDraft, output, file } =
        revisionSetup();
      // A finished drafting session that read the page the story cites.
      const draftingStart = { contentDir, model: DEFAULT_MODEL, date: RUN_DATE, fresh: false };
      start({ countryId: 'CHL', ...draftingStart, regenerate: true }, deps);
      await read(geography().url);
      writeSession(dir, {
        ...readSession(dir, 'CHL'),
        written: { file, writtenAt: '2026-10-01T10:00:00.000Z' },
      });
      sendBack();
      output();

      expect(reviseStart()).toBe(0);
      const archived = join(root, 'finished', 'CHL-2026-10-01T10-00-00-000Z');
      expect(output()).toContain(`Moved the finished session to ${archived}.`);
      expect(loadEvidence(archived).records).toHaveLength(1);
      expect(loadEvidence(dir).records).toEqual([]);

      writeDraft(revisedAndes());
      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      expect(output()).toContain(
        `sources: "fixture-geography" (${geography().url}) was not retrieved in this task. ${AGENT_EVIDENCE_RULE}`,
      );
      expect(readCountryFile(contentDir, 'chile')!.stories[3].provenance.revision?.notes).toBe(
        NOTES,
      );
    },
    SUBMIT_TIMEOUT_MS,
  );

  it(
    'rejects a changed story ID',
    async () => {
      const { deps, read, sendBack, reviseStart, writeDraft, output } = revisionSetup();
      sendBack();
      reviseStart();
      await read(geography().url);
      output();
      writeDraft(revisedAndes((story) => (story.id = 'mountain-passes')));
      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      expect(output()).toContain('1. stories[0].id: keep the story ID "andes"');
    },
    SUBMIT_TIMEOUT_MS,
  );

  it(
    'writes only the revised story, keeps the rest of the file and clears the request',
    async () => {
      const { contentDir, dir, deps, read, sendBack, reviseStart, writeDraft, output, file } =
        revisionSetup();
      sendBack();
      const before = readFileSync(file, 'utf8');
      expect(reviseStart()).toBe(0);
      await read(geography().url);
      output();
      writeDraft(revisedAndes());

      expect(submit({ countryId: 'CHL', dryRun: true }, deps)).toBe(0);
      expect(output()).toContain('Dry run: the revised "andes" would pass. Nothing was written');
      expect(readFileSync(file, 'utf8')).toBe(before);
      expect(readSession(dir, 'CHL').submissions).toEqual([]);

      expect(submit({ countryId: 'CHL' }, deps)).toBe(0);
      const printed = output();
      expect(printed).toContain(
        `Submission 1 passed. Wrote "andes" into ${file} (draft, agent-v2, ${DEFAULT_MODEL}); the revision requests are cleared`,
      );
      expect(printed).toContain('1 revised story, 1 sources, 0 pending references.');

      // Only the story changed: putting the old story back gives the old file, byte for byte.
      const after = readFileSync(file, 'utf8');
      const andesBlock = (text: string) => {
        const story = JSON.parse(text).stories[3];
        expect(story.id).toBe('andes');
        return JSON.stringify(story, null, 2).replaceAll('\n', '\n    ');
      };
      expect(after).not.toBe(before);
      expect(after.replace(andesBlock(after), andesBlock(before))).toBe(before);

      const andes = readCountryFile(contentDir, 'chile')!.stories[3];
      expect(andes.summary).toBe(REVISED_SUMMARY);
      expect(andes.provenance).toEqual({
        generatedBy: DEFAULT_MODEL,
        generatedAt: RUN_DATE,
        promptVersion: 'agent-v2',
        status: 'draft',
      });
      expect(andes.sources.map((source) => source.url)).toEqual([geography().url]);
      expect(readSession(dir, 'CHL').written?.file).toBe(file);

      status({ countryId: 'CHL' }, deps);
      expect(output()).toContain(
        `Revising 1 stories sent back:\n  andes (Tester, ${RUN_DATE}): ${NOTES}`,
      );
      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      expect(reviseStart()).toBe(1);
      expect(output()).toContain('No story in Chile is sent back for revision.');
    },
    SUBMIT_TIMEOUT_MS,
  );

  it(
    'refuses a submission when a request changed since start, and keeps drafting apart',
    async () => {
      const { deps, read, sendBack, reviseStart, writeDraft, output, begin } = revisionSetup();
      sendBack();
      reviseStart();
      expect(begin('CHL', { regenerate: true })).toBe(1);
      expect(output()).toContain('An unfinished revision session for Chile');

      await read(geography().url);
      writeDraft(revisedAndes());
      sendBack('Shorter, please.');
      output();
      expect(submit({ countryId: 'CHL' }, deps)).toBe(1);
      expect(output()).toContain(
        'CHL/andes no longer has the revision request this session started from. Run npm run content:agent -- start CHL --revisions',
      );
      // Starting again continues the session with the new notes and keeps its evidence.
      expect(reviseStart()).toBe(0);
      expect(output()).toContain('Kept 1 fetched pages and 0 submissions');
      expect(submit({ countryId: 'CHL' }, deps)).toBe(0);
    },
    SUBMIT_TIMEOUT_MS,
  );
});
