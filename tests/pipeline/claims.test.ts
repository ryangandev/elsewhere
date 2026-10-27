// The claim check on recorded responses: which text units are checked, how verdicts are validated
// and repaired, where results are saved, and when they go stale. No network, no key.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages';
import { describe, expect, it } from 'vitest';
import type { CountryFile } from '../../src/content/schema';
import { claimsJobs, jobFor, jobScopes } from '../../pipeline/claims/plan';
import { checkClaims } from '../../pipeline/claims/run';
import { claimSession, type ClaimsContext } from '../../pipeline/claims/session';
import {
  claimsFilePath,
  defaultClaimsDir,
  readClaims,
  recordChecks,
  unitStatuses,
} from '../../pipeline/claims/store';
import {
  citedSources,
  overviewUnits,
  scopeUnits,
  storyUnits,
  type ClaimScope,
} from '../../pipeline/claims/units';
import {
  htmlToText,
  recordPages,
  replayPages,
  type PageFetcher,
} from '../../pipeline/claims/local-fetch';
import {
  checkVerdicts,
  fetchedTexts,
  fetchedUrls,
  normalizeForMatch,
  quoteInText,
} from '../../pipeline/claims/verdicts';
import { CLAIM_FETCH_RETRIES, CLAIM_LIMITS } from '../../pipeline/config';
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

/** The recorded fixtures cover the overview and the "length" story. */
const FIXTURE_SCOPES: ClaimScope[] = [{ kind: 'overview' }, { kind: 'story', storyId: 'length' }];

const scopeNames = (scopes: ClaimScope[]) =>
  scopes.map((scope) => (scope.kind === 'overview' ? 'overview' : scope.storyId));

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
  const texts = new Map<string, string[]>();
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
    const result = checkVerdicts(valid, { units, sources, fetched, texts, stamp });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
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
    const result = checkVerdicts(bad, { units, sources, fetched: new Set(), texts, stamp });
    expect(result.ok).toBe(false);
    expect(result.checks).toEqual({});
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
    const result = checkVerdicts(partial, { units, sources, fetched, texts, stamp });
    expect(result.issues).toEqual(['verdicts: give a verdict for "length-section-2"']);
    expect(Object.keys(result.checks)).toEqual([units[0].key]);
    expect([...result.failures.keys()]).toEqual(['length-section-2']);
  });

  it('checks quotes against the text fetched from their source', () => {
    const page = 'The Andes run the length of Chile \u2014 from the Atacama to Patagonia.';
    const withPage = new Map([['example.org/elsewhere-fixture/chile/geography', [page]]]);
    const quoted = structuredClone(valid);
    quoted.verdicts[0].evidence = [
      {
        sourceId: 'fixture-geography',
        quote: '"the andes run the length of Chile - from ... Patagonia"',
      },
    ];
    quoted.verdicts[1].evidence = [{ sourceId: 'fixture-geography', quote: 'Chile is long' }];
    const result = checkVerdicts(quoted, { units, sources, fetched, texts: withPage, stamp });
    const issue =
      'verdicts.length-section-2: the quote "Chile is long" is not in the text fetched from https://example.org/elsewhere-fixture/chile/geography; copy the words exactly (use "..." for a gap) or leave the quote out';
    expect(result.issues).toEqual([issue]);
    // The unit with the good quote passes on its own; the other one fails with its reason.
    expect(Object.keys(result.checks)).toEqual([units[0].key]);
    expect(result.failures).toEqual(new Map([['length-section-2', [issue]]]));
    // Without the page's text (a PDF), quotes are taken as given.
    expect(checkVerdicts(quoted, { units, sources, fetched, texts, stamp }).ok).toBe(true);
  });
});

describe('quotes', () => {
  it('match loosely, with "..." for a gap in order', () => {
    const page = 'It’s the “Pacific   Ring of Fire” – about 1,500 volcanoes.\nMost are dormant.';
    expect(quoteInText('it\'s the "pacific ring of fire" - about', page)).toBe(true);
    expect(quoteInText('Ring of Fire … dormant', page)).toBe(true);
    expect(quoteInText('“1,500 volcanoes. Most are dormant.”', page)).toBe(true);
    expect(quoteInText('dormant ... Ring of Fire', page)).toBe(false);
    expect(quoteInText('2,000 volcanoes', page)).toBe(false);
    expect(quoteInText('...', page)).toBe(false);
  });

  // The quotes that failed the pilot run, with the page text they were checked against.
  it('ignore quotation mark and apostrophe styles, and marks a quote adds', () => {
    const rotterdam =
      'yet it is also open to the North Sea, the world’s most heavily navigated sea.';
    expect(quoteInText('the world"s most heavily navigated sea', rotterdam)).toBe(true);
    expect(quoteInText('the world`s most heavily navigated sea', rotterdam)).toBe(true);
    const banknotes =
      'Bank of Scotland issues banknotes in denominations of £5, £10, £20, £50 and £100. Bank of Scotland issued a new polymer £5 in 2016.';
    expect(
      quoteInText(
        'Bank of Scotland issues banknotes in denominations of "£5, £10, £20, £50 and £100.',
        banknotes,
      ),
    ).toBe(true);
    expect(quoteInText('euro ("€")', '**Currency**: euro (€)')).toBe(true);
    expect(quoteInText('hun land zelf hebben "gemaakt".', 'hun land zelf hebben ‘gemaakt’.')).toBe(
      true,
    );
  });

  it('decode escapes a model writes in place of a character', () => {
    const siberia =
      'It is notorious for its almost snowless winters. Temperatures of −90 °F (−68 °C) have been recorded.';
    expect(
      quoteInText(
        'Temperatures of \\u221290 \\u00b0F (\\u221268 \\u00b0C) have been recorded.',
        siberia,
      ),
    ).toBe(true);
    expect(quoteInText('the world\\"s most heavily', 'the world’s most heavily')).toBe(true);
  });

  it('fold dashes, minus signs, Unicode spaces and ellipses, and ignore case', () => {
    const page =
      'Temperatures of −90 °F (−68 °C) were recorded in 1892–1933 … at Verkhoyansk – a town in Sakha.';
    expect(quoteInText('temperatures of -90 °F (-68 °C)', page)).toBe(true);
    expect(quoteInText('in 1892 - 1933', page)).toBe(true);
    expect(quoteInText('verkhoyansk -- a town', page)).toBe(true);
    expect(quoteInText('Temperatures of ... 1892-1933 [...] Verkhoyansk', page)).toBe(true);
    expect(quoteInText('recorded in 1892–1933 … at Verkhoyansk', page)).toBe(true);
    expect(quoteInText('recorded in 1892–1933 . . . at', page)).toBe(true);
    expect(quoteInText('a town in Sakha', 'a town in Sa\u00adkha\u200b.')).toBe(true);
    // Narrow and ordinary non-breaking spaces, as typeset pages put between a number and its unit.
    expect(
      quoteInText(
        '-90 \u00b0F (-68 \u00b0C)',
        '\u221290\u202f\u00b0F\u00a0(\u221268\u202f\u00b0C)',
      ),
    ).toBe(true);
  });

  it('read Markdown as its words: links, emphasis and table rows', () => {
    expect(
      quoteInText(
        'Capital: Moscow. The population is primarily Russian',
        'Capital: [Moscow](https://www.britannica.com/summary/Moscow). The population is primarily Russian;',
      ),
    ).toBe(true);
    expect(
      quoteInText(
        'England 58,834,800 227,600 0.39%',
        '| Country | Population |\n| England   | 58,834,800 | 227,600 | 0.39% |',
      ),
    ).toBe(true);
    expect(quoteInText('around c. 1000 bc', 'around *c.* 1000 bc')).toBe(true);
  });

  it('stay strict on the words themselves', () => {
    const page = 'the world’s most heavily navigated sea, with £5, £10 and £20 notes';
    expect(quoteInText('the worlds most heavily navigated sea', page)).toBe(false);
    expect(quoteInText('the world’s most heavily navigated ocean', page)).toBe(false);
    expect(quoteInText('£5, £10, £20 and £50 notes', page)).toBe(false);
    expect(quoteInText('−90 °F', '90 °F')).toBe(false);
    expect(normalizeForMatch('It’s “Ring  of Fire” – 1,500 volcanoes…')).toBe(
      "it's ring of fire-1,500 volcanoes...",
    );
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

  it('keep the text of pages served as text, not of PDFs', () => {
    const result = (id: string, url: string, source: object) => [
      { type: 'server_tool_use', id, name: 'web_fetch', input: { url } },
      {
        type: 'web_fetch_tool_result',
        tool_use_id: id,
        content: { type: 'web_fetch_result', url, content: { type: 'document', source } },
      },
    ];
    const content = [
      ...result('a', 'https://a.org/x', { type: 'text', media_type: 'text/plain', data: 'Page A' }),
      ...result('b', 'https://b.org/y.pdf', {
        type: 'base64',
        media_type: 'application/pdf',
        data: 'JVBERi0xLjQK',
      }),
    ] as unknown as BetaContentBlock[];
    expect([...fetchedTexts(content)]).toEqual([['a.org/x', 'Page A']]);
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
    const setup = claimSession(
      context(),
      jobFor(chileFile(), [{ kind: 'story', storyId: 'length' }]),
    );
    expect(setup.tag).toBe('claims-CHL-length');
    await expect(setup.runTool('fetch_page', { url: 'https://example.org/other' })).rejects.toThrow(
      'https://example.org/other is not a source URL in this task',
    );
    const failing = claimSession(
      { ...context(), fetchPage: () => Promise.reject(new Error('the server answered 403')) },
      jobFor(chileFile(), [{ kind: 'story', storyId: 'length' }]),
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
  it('allow one fetch per cited page plus retries when the task cites more pages than the minimum', () => {
    const file = chileFile();
    const sources = new Set(
      [file.country, ...file.stories].flatMap((entry) => entry.sources.map((source) => source.id)),
    ).size;
    const setup = claimSession(
      { ...context(), limits: { ...CLAIM_LIMITS, webFetchesPerRequest: 1 } },
      jobFor(file, [
        { kind: 'overview' },
        ...file.stories.map((story) => ({ kind: 'story' as const, storyId: story.id })),
      ]),
    );
    expect(setup.limits.webFetchesPerRequest).toBe(sources + CLAIM_FETCH_RETRIES);
    expect(setup.tools[0]).toMatchObject({
      name: 'web_fetch',
      max_uses: sources + CLAIM_FETCH_RETRIES,
    });
  });

  it('check a country in one conversation with the basic web fetch, the local fallback and a strict verdict tool', () => {
    const setup = claimSession(context(), jobFor(chileFile(), FIXTURE_SCOPES));
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

    // Chile cites few sources, so the whole country is one session.
    expect(claimsJobs(file, {}, claimsDir).map((job) => scopeNames(jobScopes(job)))).toEqual([
      ['overview', 'length', 'desert', 'copper', 'andes'],
    ]);
    const { results, usage } = await checkClaims({
      client,
      context: context(),
      jobs: claimsJobs(file, { scopes: FIXTURE_SCOPES }, claimsDir),
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
    // A quote the page does not contain is sent back; the PDF's quote cannot be checked.
    expect(repair).toContain(
      'verdicts.overview: the quote \\"Chile is the longest country\\" is not in the text fetched from https://example.org/elsewhere-fixture/chile/overview',
    );
    expect(repair).not.toContain('verdicts.why-it-matters-1');

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

    // Checked units are skipped; an edited unit is due again, alone.
    expect(scopeNames(jobScopes(claimsJobs(file, {}, claimsDir)[0]))).toEqual([
      'desert',
      'copper',
      'andes',
    ]);
    const edited = structuredClone(file);
    edited.stories[0].sections[1].text = 'Changed placeholder text.';
    const length: ClaimScope[] = [{ kind: 'story', storyId: 'length' }];
    const due = claimsJobs(edited, { scopes: length }, claimsDir);
    expect(due).toMatchObject([{ tag: 'claims-CHL-length', label: 'CHL/length' }]);
    expect(due[0].parts.map((part) => part.units.map((unit) => unit.id))).toEqual([
      ['length-section-2'],
    ]);
    expect(
      claimsJobs(file, { scopes: length, recheck: true }, claimsDir)[0].parts[0].units,
    ).toHaveLength(2);
    expect(claimsJobs(file, { draftsOnly: true, scopes: length }, claimsDir)).toEqual([]);

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
      jobs: claimsJobs(file, { scopes: FIXTURE_SCOPES }, claimsDir),
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
