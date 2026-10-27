// The claim check on recorded responses: which text units are checked, how verdicts are validated
// and repaired, where results are saved, and when they go stale. No network, no key.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages';
import { describe, expect, it } from 'vitest';
import type { CountryFile } from '../../src/content/schema';
import { checkClaims, claimsJobs, type ClaimsJob } from '../../pipeline/claims/run';
import { claimSession, type ClaimsContext } from '../../pipeline/claims/session';
import {
  claimsFilePath,
  defaultClaimsDir,
  readClaims,
  recordChecks,
  unitStatuses,
} from '../../pipeline/claims/store';
import { citedSources, overviewUnits, scopeUnits, storyUnits } from '../../pipeline/claims/units';
import {
  htmlToText,
  recordPages,
  replayPages,
  type PageFetcher,
} from '../../pipeline/claims/local-fetch';
import { checkVerdicts, fetchedUrls } from '../../pipeline/claims/verdicts';
import { CLAIM_LIMITS } from '../../pipeline/config';
import { readCountryFile, writeCountryFile } from '../../pipeline/content-tree';
import { assembleCountry } from '../../pipeline/generate/assemble';
import { CountryDraft } from '../../pipeline/generate/draft-schema';
import { ReplayClient } from '../../pipeline/generate/model-client';
import { CURRENT_CLAIMS_PROMPT_VERSION, loadClaimsPrompts } from '../../pipeline/prompts';
import { chileDraft, REPLAY_DIR } from './fixtures/build-replay';
import { RUN_DATE, tempContentTree, tempDir } from './helpers';

/** The fixture's Chile draft, as content:generate would write it. */
function chileFile(): CountryFile {
  return assembleCountry(CountryDraft.parse(chileDraft()), {
    countryId: 'CHL',
    slug: 'chile',
    model: 'claude-opus-5-5',
    date: RUN_DATE,
    promptVersion: 'v3',
  });
}

/** Pages fetch_page was asked for. */
const locallyFetched: string[] = [];

const fetchPage: PageFetcher = async (url) => {
  locallyFetched.push(url);
  return 'Placeholder text about the geography page, fetched locally.';
};

const context = (mode: 'sync' | 'batch' = 'sync'): ClaimsContext => ({
  prompts: loadClaimsPrompts(),
  model: 'claude-opus-5-5',
  effort: 'high',
  limits: CLAIM_LIMITS,
  cacheTtl: mode === 'batch' ? '1h' : '5m',
  date: RUN_DATE,
  fetchPage,
});

/** The overview and the "length" story: the scopes the fixtures answer. */
/** The recorded fixtures cover the overview and the "length" story. */
const fixtureJobs = (jobs: ClaimsJob[]) =>
  jobs.map((job) => ({
    ...job,
    scopes: job.scopes.filter(
      (scope) =>
        scope.kind === 'overview' || (scope.kind === 'story' && scope.storyId === 'length'),
    ),
  }));

const lastTurn = (request: { request: { messages: unknown[] } }) =>
  JSON.stringify(request.request.messages.at(-1));

describe('claim units', () => {
  it('are every entry that cites sources, keyed by text and sources', () => {
    const file = chileFile();
    const units = overviewUnits(file.country);
    expect(units.map((unit) => unit.id)).toEqual([
      'overview',
      'why-it-matters-1',
      'why-it-matters-2',
      'quick-fact-1',
      'quick-fact-2',
    ]);
    expect(units[3]).toMatchObject({
      label: 'Quick fact "Capital"',
      text: 'Capital: Fixture value',
    });
    expect(units[4].text).toBe('Population: Fixture value (as of 2026)');
    expect(citedSources(units).map((source) => source.id)).toEqual([
      'fixture-overview',
      'fixture-geography',
      'fixture-economy',
      'fixture-history',
    ]);
    expect(storyUnits(file.stories[0]).map((unit) => unit.label)).toEqual([
      'Section "First part of length"',
      'Section "Second part of length"',
    ]);

    // The key follows the text and the cited sources, not the position.
    const edited = structuredClone(file);
    edited.country.quickFacts[0].value = 'Santiago';
    edited.country.sources[2].url = 'https://example.org/elsewhere-fixture/chile/economy-2';
    const after = overviewUnits(edited.country);
    expect(after[0].key).toBe(units[0].key);
    expect(after[3].key).not.toBe(units[3].key);
    expect(after[1].key).not.toBe(units[1].key);
    expect(overviewUnits(chileFile().country).map((unit) => unit.key)).toEqual(
      units.map((unit) => unit.key),
    );
  });
});

describe('verdict validation', () => {
  const file = chileFile();
  const units = scopeUnits(file, { kind: 'story', storyId: 'length' });
  const sources = citedSources(units);
  const fetched = new Set(['example.org/elsewhere-fixture/chile/geography']);
  const stamp = {
    checkedAt: RUN_DATE,
    model: 'claude-opus-5-5',
    effort: 'high',
    promptVersion: 'claims-v1',
  };
  const valid = {
    sources: [{ id: 'fixture-geography', status: 'read', note: null }],
    verdicts: units.map((unit) => ({
      unitId: unit.id,
      verdict: 'supported',
      unsupported: [] as string[],
      evidence: [{ sourceId: 'fixture-geography', quote: 'Placeholder text' }],
      note: null,
    })),
  };

  it('accepts a complete submission and keys results by unit', () => {
    const result = checkVerdicts(valid, { units, sources, fetched, stamp });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.checks)).toEqual(units.map((unit) => unit.key));
    expect(result.checks[units[0].key]).toMatchObject({
      label: units[0].label,
      verdict: 'supported',
      sources: [
        {
          id: 'fixture-geography',
          url: 'https://example.org/elsewhere-fixture/chile/geography',
          status: 'read',
          note: null,
        },
      ],
      ...stamp,
    });
  });

  it('sends back what does not fit the scope', () => {
    const bad = structuredClone(valid);
    bad.verdicts[0] = {
      ...bad.verdicts[0],
      verdict: 'partly_supported',
      unsupported: ['a phrase that is not in the text'],
    };
    bad.verdicts[1] = { ...bad.verdicts[1], verdict: 'source_unreachable', evidence: [] };
    bad.verdicts.push({ ...bad.verdicts[0], unitId: 'section-9' });
    const result = checkVerdicts(bad, { units, sources, fetched: new Set(), stamp });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      'sources.fixture-geography: marked read, but https://example.org/elsewhere-fixture/chile/geography was not fetched with web_fetch or fetch_page in this conversation. Fetch it, or mark it unreachable and say why.',
      'verdicts.length-section-1: "a phrase that is not in the text" is not in the unit text; copy the phrase exactly',
      'verdicts.length-section-2: list the phrases the sources do not state in unsupported',
      'verdicts.length-section-2: source_unreachable needs one of its sources (fixture-geography) marked unreachable',
      'verdicts: "section-9" is not a unit in this task',
    ]);
  });

  it('matches unsupported phrases loosely and requires a verdict per unit', () => {
    const partial = structuredClone(valid);
    partial.verdicts[0] = {
      ...partial.verdicts[0],
      verdict: 'partly_supported',
      unsupported: ['FIRST   part of length'],
    };
    partial.verdicts.pop();
    const result = checkVerdicts(partial, { units, sources, fetched, stamp });
    expect(result).toEqual({
      ok: false,
      issues: ['verdicts: give a verdict for "length-section-2"'],
    });
  });
});

describe('fetched pages', () => {
  it('count only direct web_fetch calls that returned a page', () => {
    const content = [
      {
        type: 'server_tool_use',
        id: 'a',
        name: 'web_fetch',
        input: { url: 'https://www.a.org/x/' },
      },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: 'a',
        content: { type: 'web_fetch_result', url: 'https://www.a.org/x/', content: {} },
      },
      {
        type: 'server_tool_use',
        id: 'b',
        name: 'web_fetch',
        input: { url: 'https://b.org/y' },
        caller: { type: 'code_execution_20260120', tool_id: 'c' },
      },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: 'b',
        content: { type: 'web_fetch_result', url: 'https://b.org/y', content: {} },
      },
      { type: 'server_tool_use', id: 'd', name: 'web_fetch', input: { url: 'https://d.org/z' } },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: 'd',
        content: { type: 'web_fetch_tool_error', error_code: 'url_not_accessible' },
      },
    ] as unknown as BetaContentBlock[];
    expect([...fetchedUrls(content)]).toEqual(['a.org/x']);
  });
});

describe('local page fetches', () => {
  it('keep the visible text of a page', () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body>
      <nav><a href="/">Home</a></nav><script>var x = "<p>no</p>";</script>
      <h1>Economic history</h1><p>Singapore built public&nbsp;housing &amp; schools.</p>
      <table><tr><td>2024</td><td>6.04&#160;million</td></tr></table><!-- hidden --></body></html>`;
    expect(htmlToText(html)).toBe(
      'Home\nEconomic history\nSingapore built public housing & schools.\n| 2024 | 6.04 million',
    );
  });

  it('are recorded with the responses and replayed offline', async () => {
    const dir = tempDir();
    const live: PageFetcher = async (url) => {
      if (url.endsWith('/gone')) throw new Error('the server answered 404');
      return `Text of ${url}`;
    };
    const recording = recordPages(live, dir);
    await expect(recording('https://example.org/page')).resolves.toBe(
      'Text of https://example.org/page',
    );
    await expect(recording('https://example.org/gone')).rejects.toThrow('404');

    const replay = replayPages(dir);
    await expect(replay('https://example.org/page')).resolves.toBe(
      'Text of https://example.org/page',
    );
    await expect(replay('https://example.org/gone')).rejects.toThrow('the server answered 404');
    await expect(replay('https://example.org/other')).rejects.toThrow('no recorded page');
  });

  it('are limited to the cited URLs of the task', async () => {
    const setup = claimSession(context(), chileFile(), [{ kind: 'story', storyId: 'length' }]);
    expect(setup.tag).toBe('claims-CHL-length');
    await expect(setup.runTool('fetch_page', { url: 'https://example.org/other' })).rejects.toThrow(
      'https://example.org/other is not a source URL in this task',
    );
    const failing = claimSession(
      { ...context(), fetchPage: () => Promise.reject(new Error('the server answered 403')) },
      chileFile(),
      [{ kind: 'story', storyId: 'length' }],
    );
    await expect(
      failing.runTool('fetch_page', {
        url: 'https://www.example.org/elsewhere-fixture/chile/geography/',
      }),
    ).rejects.toThrow(
      'Could not fetch https://example.org/elsewhere-fixture/chile/geography: the server answered 403',
    );
  });
});

describe('claim check sessions', () => {
  it('check a country in one conversation with the basic web fetch, the local fallback and a strict verdict tool', () => {
    const setup = claimSession(context(), chileFile(), [
      { kind: 'overview' },
      { kind: 'story', storyId: 'length' },
    ]);
    expect(setup.tag).toBe('claims-CHL');
    expect(setup.units.map((unit) => unit.id)).toEqual([
      'overview',
      'why-it-matters-1',
      'why-it-matters-2',
      'quick-fact-1',
      'quick-fact-2',
      'length-section-1',
      'length-section-2',
    ]);
    expect(setup.tools).toMatchObject([
      { type: 'web_fetch_20250910', name: 'web_fetch' },
      { name: 'fetch_page', strict: true },
      { name: 'submit_verdicts', strict: true },
    ]);
    const task = setup.task.map((block) => block.text).join('\n');
    expect(task).toContain(
      '- fixture-history: "Fixture history page", Elsewhere test fixtures. https://example.org/elsewhere-fixture/chile/history',
    );
    expect(task).toContain('### quick-fact-1: Quick fact "Capital"\nCites: fixture-overview');
    expect(task).toContain('# Check the overview and the story "length" of Chile (CHL)');
    // A source shared by the overview and the story is listed, and read, once.
    expect(task.match(/- fixture-geography:/g)).toHaveLength(1);
    expect(task).not.toContain('{{');
  });
});

describe('checking claims on replayed responses', () => {
  it('saves verdicts, falls back, repairs and reminds, and checks again only what changed', async () => {
    locallyFetched.length = 0;
    const contentDir = tempContentTree();
    const claimsDir = defaultClaimsDir(contentDir);
    writeCountryFile(contentDir, chileFile());
    const file = readCountryFile(contentDir, 'chile')!;
    const client = new ReplayClient(REPLAY_DIR);
    const log: string[] = [];

    const jobs = claimsJobs(file, {}, claimsDir);
    expect(
      jobs.map(({ scopes }) =>
        scopes.map((scope) => (scope.kind === 'overview' ? 'overview' : scope.storyId)),
      ),
    ).toEqual([['overview', 'length', 'desert', 'copper', 'andes']]);
    const { results, usage } = await checkClaims({
      client,
      context: context(),
      jobs: fixtureJobs(jobs),
      mode: 'sync',
      claimsDir,
      log: (line) => log.push(line),
    });
    expect(results.map((result) => [result.label, result.outcome])).toEqual([['CHL', 'checked']]);
    expect(results[0].detail).toBe(
      '7 units: 5 supported, 0 partly supported, 1 not supported, 1 source unreachable, 0 not checked (claude-opus-5-5)',
    );
    expect(usage).toMatchObject({ requests: 4, webFetches: 4 });

    // The geography page refused web_fetch, so it was fetched locally, which counts as read. The
    // turn then ended without a submission and was reminded, and the first submission was sent back.
    const requests = client.requests.filter((request) => request.tag === 'claims-CHL');
    expect(requests).toHaveLength(4);
    expect(locallyFetched).toEqual(['https://example.org/elsewhere-fixture/chile/geography']);
    expect(lastTurn(requests[1])).toContain(
      "fetched from the editor's computer:\\n\\nPlaceholder text about the geography page",
    );
    expect(lastTurn(requests[2])).toContain('You ended your turn without submitting');
    const repair = lastTurn(requests[3]);
    expect(repair).toContain('sources.fixture-history: marked read');
    expect(repair).toContain('give a verdict for \\"quick-fact-2\\"');

    // The flagged unit is reported with what the sources do not state.
    const report = log.find((line) => line.startsWith('CHL: checked'))!;
    expect(report).toContain('Quick fact "Capital"');
    expect(report).toContain('claim check: NOT SUPPORTED (2026-10-26, claude-opus-5-5)');
    expect(report).toContain('not stated by the sources: "Capital: Fixture value"');
    expect(report).toContain('[fixture-history] could not be read: The fetch failed.');

    const saved = readClaims(claimsDir, file.country);
    const statuses = unitStatuses(overviewUnits(file.country), saved);
    expect(statuses.map(({ check }) => check?.verdict)).toEqual([
      'supported',
      'supported',
      'source_unreachable',
      'not_supported',
      'supported',
    ]);
    expect(statuses[0].check).toMatchObject({
      promptVersion: CURRENT_CLAIMS_PROMPT_VERSION,
      effort: 'high',
      checkedAt: RUN_DATE,
    });

    // Checked scopes are skipped; an edited unit makes its scope due again.
    expect(claimsJobs(file, {}, claimsDir)[0].scopes.map((scope) => scope.kind)).toEqual([
      'story',
      'story',
      'story',
    ]);
    const edited = structuredClone(file);
    edited.stories[0].sections[1].text = 'Changed placeholder text.';
    expect(claimsJobs(edited, { storyId: 'length' }, claimsDir)).toEqual([
      { file: edited, scopes: [{ kind: 'story', storyId: 'length' }] },
    ]);
    expect(claimsJobs(file, { storyId: 'length', recheck: true }, claimsDir)).toHaveLength(1);
    expect(claimsJobs(file, { draftsOnly: true, storyId: 'length' }, claimsDir)).toEqual([]);

    // The saved file is ordered like the content, formatted like it, and keeps only current units.
    const path = claimsFilePath(join(contentDir, 'claims'), 'chile');
    const text = readFileSync(path, 'utf8');
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    const units = [...overviewUnits(file.country), ...storyUnits(file.stories[0])];
    expect(Object.keys(saved.checks)).toEqual(units.map((unit) => unit.key));
    expect(Object.keys(Object.values(saved.checks)[0])).toEqual([
      'label',
      'text',
      'verdict',
      'unsupported',
      'evidence',
      'note',
      'sources',
      'checkedAt',
      'model',
      'effort',
      'promptVersion',
    ]);
    recordChecks(claimsDir, edited, {});
    expect(Object.keys(readClaims(claimsDir, file.country).checks)).toEqual(
      units.filter((unit) => unit !== units[6]).map((unit) => unit.key),
    );
    expect(readFileSync(path, 'utf8')).toContain('"countryId": "CHL"');
  });

  it('runs the same sessions through the Batches API', async () => {
    const contentDir = tempContentTree();
    const claimsDir = join(tempDir(), 'claims');
    writeCountryFile(contentDir, chileFile());
    const file = readCountryFile(contentDir, 'chile')!;
    const log: string[] = [];
    const { results, usage } = await checkClaims({
      client: new ReplayClient(REPLAY_DIR),
      context: context('batch'),
      jobs: fixtureJobs(claimsJobs(file, {}, claimsDir)),
      mode: 'batch',
      claimsDir,
      log: (line) => log.push(line),
    });
    expect(results.map((result) => result.outcome)).toEqual(['checked']);
    expect(log.filter((line) => line.startsWith('Round'))).toEqual([
      'Round 1: 1 request.',
      'Round 2: 1 request.',
      'Round 3: 1 request.',
      'Round 4: 1 request.',
    ]);
    expect(usage).toMatchObject({ requests: 4, batchRequests: 4 });
  });
});
