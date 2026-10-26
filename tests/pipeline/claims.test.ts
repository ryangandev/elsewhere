// The claim check on recorded responses: which text units are checked, how verdicts are validated
// and repaired, where results are saved, and when they go stale. No network, no key.
import { join } from 'node:path';
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages';
import { describe, expect, it } from 'vitest';
import type { CountryFile } from '../../src/content/schema';
import { checkClaims, claimsJobs, type ClaimsJob } from '../../pipeline/claims/run';
import { claimSession, type ClaimsContext } from '../../pipeline/claims/session';
import { readClaims, unitStatuses } from '../../pipeline/claims/store';
import { citedSources, overviewUnits, scopeUnits, storyUnits } from '../../pipeline/claims/units';
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

const context = (mode: 'sync' | 'batch' = 'sync'): ClaimsContext => ({
  prompts: loadClaimsPrompts(),
  model: 'claude-opus-5-5',
  effort: 'high',
  limits: CLAIM_LIMITS,
  cacheTtl: mode === 'batch' ? '1h' : '5m',
  date: RUN_DATE,
});

/** The overview and the "length" story: the scopes the fixtures answer. */
const fixtureJobs = (jobs: ClaimsJob[]) =>
  jobs.filter(
    ({ scope }) =>
      scope.kind === 'overview' || (scope.kind === 'story' && scope.storyId === 'length'),
  );

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
      'sources.fixture-geography: marked read, but https://example.org/elsewhere-fixture/chile/geography was not fetched with web_fetch in this conversation. Fetch it, or mark it unreachable and say why.',
      'verdicts.section-1: "a phrase that is not in the text" is not in the unit text; copy the phrase exactly',
      'verdicts.section-2: list the phrases the sources do not state in unsupported',
      'verdicts.section-2: source_unreachable needs one of its sources (fixture-geography) marked unreachable',
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
    expect(result).toEqual({ ok: false, issues: ['verdicts: give a verdict for "section-2"'] });
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

describe('claim check sessions', () => {
  it('ask only for the basic web fetch and a strict verdict tool', () => {
    const setup = claimSession(context(), chileFile(), { kind: 'overview' });
    expect(setup.tag).toBe('claims-CHL');
    expect(setup.tools).toMatchObject([
      { type: 'web_fetch_20250910', name: 'web_fetch' },
      { name: 'submit_verdicts', strict: true },
    ]);
    const task = setup.task.map((block) => block.text).join('\n');
    expect(task).toContain(
      '- fixture-history: "Fixture history page", Elsewhere test fixtures. https://example.org/elsewhere-fixture/chile/history',
    );
    expect(task).toContain('### quick-fact-1: Quick fact "Capital"\nCites: fixture-overview');
    expect(task).not.toContain('{{');
  });
});

describe('checking claims on replayed responses', () => {
  it('saves verdicts, repairs and reminds, and checks again only what changed', async () => {
    const contentDir = tempContentTree();
    const claimsDir = join(tempDir(), 'claims');
    writeCountryFile(contentDir, chileFile());
    const file = readCountryFile(contentDir, 'chile')!;
    const client = new ReplayClient(REPLAY_DIR);
    const log: string[] = [];

    const jobs = claimsJobs(file, {}, claimsDir);
    expect(
      jobs.map(({ scope }) => (scope.kind === 'overview' ? 'overview' : scope.storyId)),
    ).toEqual(['overview', 'length', 'desert', 'copper', 'andes']);
    const { results, usage } = await checkClaims({
      client,
      context: context(),
      jobs: fixtureJobs(jobs),
      mode: 'sync',
      claimsDir,
      log: (line) => log.push(line),
    });
    expect(results.map((result) => [result.label, result.outcome])).toEqual([
      ['CHL', 'checked'],
      ['CHL/length', 'checked'],
    ]);
    expect(results[0].detail).toBe(
      '5 units: 3 supported, 0 partly supported, 1 not supported, 1 source unreachable, 0 not checked (claude-opus-5-5)',
    );
    expect(usage).toMatchObject({ requests: 4, webFetches: 5 });

    // The first overview submission was sent back; the story was reminded to submit.
    const overview = client.requests.filter((request) => request.tag === 'claims-CHL');
    expect(overview).toHaveLength(2);
    const repair = lastTurn(overview[1]);
    expect(repair).toContain('sources.fixture-history: marked read');
    expect(repair).toContain('give a verdict for \\"quick-fact-2\\"');
    const story = client.requests.filter((request) => request.tag === 'claims-CHL-length');
    expect(lastTurn(story[1])).toContain('You ended your turn without submitting');

    // The flagged unit is reported with what the sources do not state.
    const report = log.find((line) => line.startsWith('CHL: checked'))!;
    expect(report).toContain('Quick fact "Capital"');
    expect(report).toContain('claim check: NOT SUPPORTED (2026-10-26, claude-opus-5-5)');
    expect(report).toContain('not stated by the sources: "Capital: Fixture value"');
    expect(report).toContain('[fixture-history] could not be read: The fetch failed.');

    const saved = readClaims(claimsDir, 'CHL');
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
    expect(fixtureJobs(claimsJobs(file, {}, claimsDir))).toEqual([]);
    const edited = structuredClone(file);
    edited.stories[0].sections[1].text = 'Changed placeholder text.';
    expect(claimsJobs(edited, { storyId: 'length' }, claimsDir)).toHaveLength(1);
    expect(claimsJobs(file, { storyId: 'length', recheck: true }, claimsDir)).toHaveLength(1);
    expect(claimsJobs(file, { draftsOnly: true, storyId: 'length' }, claimsDir)).toEqual([]);
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
    expect(results.map((result) => result.outcome)).toEqual(['checked', 'checked']);
    expect(log.filter((line) => line.startsWith('Round'))).toEqual([
      'Round 1: 2 requests.',
      'Round 2: 2 requests.',
    ]);
    expect(usage).toMatchObject({ requests: 4, batchRequests: 4 });
  });
});
