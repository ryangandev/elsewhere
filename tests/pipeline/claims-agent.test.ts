// The agent claim check: sessions a Claude Code subagent checks claims in, the reading fetch, and
// the submission, which validates verdicts with the API path's rules, verifies every quote against
// a live fetch it makes itself, and saves passing verdicts in the API path's claims format. Fetches
// go to stubs; no network, no key.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CountryFile } from '../../src/content/schema';
import {
  fetchCommand,
  start,
  status,
  submit,
  type ClaimsAgentDeps,
  type StartOptions,
} from '../../pipeline/claims-agent/commands';
import {
  briefFile,
  listSessions,
  pagesDir,
  readSession,
  sessionDir,
  submissionsDir,
  verdictFile,
} from '../../pipeline/claims-agent/session';
import { findPageRecord } from '../../pipeline/agent/session';
import { htmlToText } from '../../pipeline/claims/local-fetch';
import { claimsJobs, jobUnits } from '../../pipeline/claims/plan';
import {
  claimsFilePath,
  defaultClaimsDir,
  describeCheck,
  readClaims,
  recordChecks,
} from '../../pipeline/claims/store';
import { allScopes, scopeUnits, storyUnits } from '../../pipeline/claims/units';
import { QUOTE_MAX_GAP } from '../../pipeline/claims/verdicts';
import { writeCountryFile } from '../../pipeline/content-tree';
import { assembleCountry } from '../../pipeline/generate/assemble';
import { CountryDraft } from '../../pipeline/generate/draft-schema';
import { CURRENT_CLAIMS_AGENT_PROMPT_VERSION } from '../../pipeline/prompts';
import { approve } from '../../pipeline/review/actions';
import { chileDraft } from './fixtures/build-replay';
import { RUN_DATE, minimalPdf, tempContentTree, tempDir } from './helpers';

const NOW = new Date('2026-10-27T09:30:00.000Z');
const fixtureUrl = (path: string) => `https://example.org/elsewhere-fixture/chile/${path}`;
const GEOGRAPHY = fixtureUrl('geography');

/** The two sections of the "length" story, which both cite fixture-geography. */
const SECTION_ONE = 'Placeholder text about length, part one for the pipeline tests.';
const SECTION_TWO = 'Placeholder text about length, part two for the pipeline tests.';

type Page = { type: string; body: string | Uint8Array<ArrayBuffer>; status?: number };

const html = (text: string) =>
  `<!doctype html><html><head><title>Fixture</title></head><body><p>${text}</p></body></html>`;

/** A fetch stub serving pages by URL; anything else is a 404. It records every request. */
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
    Object.defineProperty(response, 'url', { value: url });
    return response;
  }) as typeof fetch;
  return { stub, requested };
}

/** Every fixture source, each stating its own placeholder sentences. */
function livePages(geography = `${SECTION_ONE} ${SECTION_TWO}`): Record<string, Page> {
  const page = (text: string): Page => ({ type: 'text/html; charset=utf-8', body: html(text) });
  return {
    [fixtureUrl('overview')]: page(
      'Placeholder text about the overview for the pipeline tests. Capital: Fixture value.',
    ),
    [GEOGRAPHY]: page(geography),
    [fixtureUrl('economy')]: page('Placeholder text about point one for the pipeline tests.'),
    [fixtureUrl('history')]: page('Placeholder text about point two for the pipeline tests.'),
  };
}

function chileFile(): CountryFile {
  return assembleCountry(CountryDraft.parse(chileDraft()), {
    countryId: 'CHL',
    slug: 'chile',
    model: 'claude-opus-5-5',
    date: RUN_DATE,
    promptVersion: 'v3',
  });
}

function setup() {
  const contentDir = tempContentTree();
  writeCountryFile(contentDir, chileFile());
  const root = tempDir();
  const out: string[] = [];
  const deps = (fetchImpl?: typeof fetch): ClaimsAgentDeps => ({
    root,
    fetch: fetchImpl,
    now: () => NOW,
    out: (line) => out.push(line),
  });
  const startOptions = (options: Partial<StartOptions> = {}): StartOptions => ({
    country: 'CHL',
    contentDir,
    model: 'claude-opus-5-5',
    effort: 'default',
    recheck: false,
    draftsOnly: false,
    maxSources: 10,
    fresh: false,
    ...options,
  });
  const claimsDir = defaultClaimsDir(contentDir);
  const text = () => out.splice(0).join('\n');
  return { contentDir, root, deps, startOptions, claimsDir, text };
}

type Verdict = {
  unitId: string;
  verdict: 'supported' | 'partly_supported' | 'not_supported' | 'source_unreachable';
  unsupported?: string[];
  evidence?: { sourceId: string; quote: string }[];
};

function writeVerdicts(
  dir: string,
  verdicts: Verdict[],
  sources: { id: string; status: 'read' | 'unreachable'; note?: string }[] = [
    { id: 'fixture-geography', status: 'read' },
  ],
) {
  writeFileSync(
    verdictFile(dir),
    JSON.stringify({
      sources: sources.map((source) => ({ note: null, ...source })),
      verdicts: verdicts.map((entry) => ({
        unsupported: [],
        evidence: [],
        note: null,
        ...entry,
      })),
    }),
  );
}

const supported = (unitId: string, quote: string): Verdict => ({
  unitId,
  verdict: 'supported',
  evidence: [{ sourceId: 'fixture-geography', quote }],
});

/** A started session for the "length" story, with its page read through the fetch command. */
async function lengthSession(pages: Record<string, Page> = livePages()) {
  const env = setup();
  expect(start(env.startOptions({ storyId: 'length' }), env.deps())).toBe(0);
  const dir = sessionDir(env.root, 'CHL-length');
  const reading = stubFetch(pages);
  const fetched = await fetchCommand(
    { sessionId: 'CHL-length', url: GEOGRAPHY, offset: 0, refresh: false },
    env.deps(reading.stub),
  );
  expect(fetched).toBe(0);
  env.text();
  return { ...env, dir };
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

describe('agent claim check sessions', () => {
  it('writes a brief from the claims-agent prompts with the units, sources and verdict schema', () => {
    const { root, deps, startOptions, text } = setup();
    expect(start(startOptions({ storyId: 'length' }), deps())).toBe(0);
    expect(text()).toContain('1 claims agent session for Chile (CHL)');
    const dir = sessionDir(root, 'CHL-length');
    const session = readSession(dir, 'CHL-length');
    expect(session).toMatchObject({
      countryId: 'CHL',
      label: 'CHL/length',
      promptVersion: CURRENT_CLAIMS_AGENT_PROMPT_VERSION,
      model: 'claude-opus-5-5',
      effort: 'default',
      units: [
        { id: 'length-section-1', label: 'Section "First part of length"' },
        { id: 'length-section-2', label: 'Section "Second part of length"' },
      ],
      sources: [{ id: 'fixture-geography', url: GEOGRAPHY }],
      passed: [],
    });
    const brief = readFileSync(briefFile(dir), 'utf8');
    expect(brief).toContain('# Check the story "length" of Chile (CHL)');
    expect(brief).toContain('### length-section-1: Section "First part of length"');
    expect(brief).toContain(`- fixture-geography: "Fixture geography page"`);
    expect(brief).toContain(`npm run content:claims-agent -- fetch CHL-length "<url>"`);
    expect(brief).toContain(verdictFile(dir));
    expect(brief).toContain('"unitId"');
    expect(brief).not.toContain('{{');
    expect(brief).not.toMatch(/web_fetch|fetch_page|submit_verdicts|—/);
  });

  it('keeps every judging rule of the claims-v1 prompt', () => {
    const verdicts = (version: string) => {
      const system = readFileSync(`pipeline/prompts/${version}/system.md`, 'utf8');
      return system.slice(system.indexOf('# Verdicts'));
    };
    expect(verdicts(CURRENT_CLAIMS_AGENT_PROMPT_VERSION)).toBe(verdicts('claims-v1'));
    const system = readFileSync('pipeline/prompts/claims-agent-v1/system.md', 'utf8');
    const original = readFileSync('pipeline/prompts/claims-v1/system.md', 'utf8');
    const head = (text: string) => text.slice(0, text.indexOf('# How to work'));
    expect(head(system)).toBe(head(original));
  });

  it('splits a country into sessions that share no units and together cover every due unit', () => {
    const { root, deps, startOptions, claimsDir, text } = setup();
    const file = chileFile();
    // One unit already has a current result, so it is not due.
    const [first] = storyUnits(file.stories[0]);
    recordChecks(claimsDir, file, {
      [first.key]: {
        label: first.label,
        text: first.text,
        verdict: 'supported',
        unsupported: [],
        evidence: [],
        note: null,
        sources: [],
        checkedAt: RUN_DATE,
        model: 'claude-opus-5-5',
        effort: 'high',
        promptVersion: 'claims-v1',
      },
    });
    expect(start(startOptions({ maxSources: 2 }), deps())).toBe(0);
    const sessions = listSessions(root);
    expect(sessions.length).toBeGreaterThan(1);
    expect(sessions.every(({ id }) => /^CHL-part\d+$/.test(id))).toBe(true);
    const keys = sessions.flatMap(({ session }) => session.units.map((unit) => unit.key));
    const due = allScopes(file)
      .flatMap((scope) => scopeUnits(file, scope))
      .filter((unit) => unit.key !== first.key)
      .map((unit) => unit.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...due].sort());
    // Each session reads at most two sources, the bound asked for.
    for (const { session } of sessions) expect(session.sources.length).toBeLessThanOrEqual(2);
    expect(claimsJobs(file, { maxSources: 2 }, claimsDir).flatMap(jobUnits)).toHaveLength(
      due.length,
    );
    text();

    // Unfinished sessions hold these units, so planning again would hand them out twice.
    expect(start(startOptions(), deps())).toBe(1);
    expect(text()).toMatch(/Unfinished sessions already hold some of these units: CHL-part1/);
    expect(start(startOptions({ fresh: true }), deps())).toBe(0);
    expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL']);
  });

  it('fetches only the cited URLs and logs failures', async () => {
    const { root, deps, startOptions, text } = setup();
    start(startOptions({ storyId: 'length' }), deps());
    text();
    const { stub, requested } = stubFetch(livePages());
    expect(
      await fetchCommand(
        {
          sessionId: 'CHL-length',
          url: 'https://example.org/other',
          offset: 0,
          refresh: false,
        },
        deps(stub),
      ),
    ).toBe(1);
    expect(text()).toContain('is not a source of this session');
    expect(requested).toEqual([]);

    const failing = stubFetch({});
    expect(
      await fetchCommand(
        { sessionId: 'CHL-length', url: GEOGRAPHY, offset: 0, refresh: false },
        deps(failing.stub),
      ),
    ).toBe(1);
    expect(text()).toContain('Could not read');
    const dir = sessionDir(root, 'CHL-length');
    expect(readSession(dir, 'CHL-length').failedFetches).toMatchObject([
      { url: GEOGRAPHY, reason: 'the server answered 404' },
    ]);

    // The URL may differ in ways normalization ignores; the cited URL is what is fetched.
    expect(
      await fetchCommand(
        { sessionId: 'CHL-length', url: `${GEOGRAPHY}/`, offset: 0, refresh: false },
        deps(stub),
      ),
    ).toBe(0);
    expect(requested).toEqual([GEOGRAPHY]);
    expect(text()).toContain(SECTION_ONE);
    expect(readSession(dir, 'CHL-length').fetches).toMatchObject([{ url: GEOGRAPHY }]);
    expect(status({ target: 'CHL' }, deps())).toBe(0);
    expect(text()).toMatch(/2 still to check[\s\S]*Fetched pages: 1 of 1 sources/);
  });
});

describe('agent claim check submissions', () => {
  it('saves passing verdicts in the API format with the agent method and live fetch recorded', async () => {
    const { dir, deps, claimsDir, text } = await lengthSession();
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', 'about length, part two'),
    ]);
    const live = stubFetch(livePages());
    expect(await submit({ sessionId: 'CHL-length' }, deps(live.stub))).toBe(0);
    expect(live.requested).toEqual([GEOGRAPHY]);
    expect(text()).toMatch(/Saved 2 verdicts[\s\S]*The session is done/);

    const pageText = htmlToText(html(`${SECTION_ONE} ${SECTION_TWO}`));
    const units = storyUnits(chileFile().stories[0]);
    const checks = readClaims(claimsDir, { id: 'CHL', slug: 'chile' }).checks;
    expect(Object.keys(checks)).toEqual(units.map((unit) => unit.key));
    expect(checks[units[0].key]).toEqual({
      label: 'Section "First part of length"',
      text: units[0].text,
      verdict: 'supported',
      unsupported: [],
      evidence: [{ sourceId: 'fixture-geography', quote: SECTION_ONE }],
      note: null,
      sources: [{ id: 'fixture-geography', url: GEOGRAPHY, status: 'read', note: null }],
      checkedAt: '2026-10-27',
      model: 'claude-opus-5-5',
      effort: 'default',
      promptVersion: 'claims-agent-v1',
      verification: {
        pages: [
          {
            sourceId: 'fixture-geography',
            url: GEOGRAPHY,
            finalUrl: GEOGRAPHY,
            fetchedAt: NOW.toISOString(),
            characters: pageText.length,
            sha256: sha256(pageText),
          },
        ],
      },
    });
    // The file reads like an API result, with the verification after the API fields.
    const raw = readFileSync(claimsFilePath(claimsDir, 'chile'), 'utf8');
    expect(Object.keys(JSON.parse(raw).checks[units[0].key])).toEqual([
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
      'verification',
    ]);
    expect(describeCheck(checks[units[0].key]).join('\n')).toContain(
      `claim check: supported (2026-10-27, claude-opus-5-5, claims-agent-v1)`,
    );
    const session = readSession(dir, 'CHL-length');
    expect(session.passed).toEqual(['length-section-1', 'length-section-2']);
    expect(session.submissions[0].liveFetches).toEqual([
      { url: GEOGRAPHY, fetchedAt: NOW.toISOString(), sha256: sha256(pageText), error: null },
    ]);
    expect(existsSync(join(submissionsDir(dir), '1.json'))).toBe(true);
  });

  it('fails a quote that is only in the stored reading copy, not on the live page', async () => {
    const { dir, deps, claimsDir, text } = await lengthSession();
    // The reading copy is a file the subagent could edit: make it say anything at all.
    const stored = findPageRecord(pagesDir(dir), GEOGRAPHY)!;
    const forged = `${stored.record.text} Chile has the longest coastline in the world.`;
    writeFileSync(
      stored.file,
      JSON.stringify({
        ...stored.record,
        text: forged,
        characters: forged.length,
        sha256: sha256(forged),
      }),
    );
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', 'Chile has the longest coastline in the world'),
    ]);
    // The live page no longer has section two's sentence either.
    const live = stubFetch(livePages(SECTION_ONE));
    expect(await submit({ sessionId: 'CHL-length' }, deps(live.stub))).toBe(1);
    const output = text();
    expect(output).toContain(
      `verdicts.length-section-2: the quote "Chile has the longest coastline in the world" is not in the page as fetched live at submission from ${GEOGRAPHY}`,
    );
    expect(output).toMatch(/1 unit still to check:\n {2}length-section-2/);
    expect(Object.keys(readClaims(claimsDir, { id: 'CHL', slug: 'chile' }).checks)).toEqual([
      storyUnits(chileFile().stories[0])[0].key,
    ]);
  });

  it(`fails a quote whose parts are more than ${QUOTE_MAX_GAP} characters apart on the live page`, async () => {
    const filler = 'Unrelated words fill this part of the page. '.repeat(10);
    const pages = livePages(`${SECTION_ONE} ${filler} ${SECTION_TWO}`);
    const { dir, deps, text } = await lengthSession(pages);
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', 'about length, part one ... about length, part two'),
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(pages).stub))).toBe(1);
    expect(text()).toContain(
      `the parts of the quote "about length, part one ... about length, part two" are more than ${QUOTE_MAX_GAP} characters apart in the page as fetched live at submission from ${GEOGRAPHY}`,
    );
  });

  it('verifies quotes from a PDF source against its live text layer', async () => {
    const pdf = minimalPdf([
      ['Fixture statistics'],
      ['Placeholder text about length, part one', 'for the pipeline tests.', SECTION_TWO],
    ]);
    const pages = { ...livePages(), [GEOGRAPHY]: { type: 'application/pdf', body: pdf } };
    const { dir, deps, claimsDir } = await lengthSession(pages);
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', SECTION_TWO),
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(pages).stub))).toBe(0);
    const checks = Object.values(readClaims(claimsDir, { id: 'CHL', slug: 'chile' }).checks);
    expect(checks.map((check) => check.verdict)).toEqual(['supported', 'supported']);
    expect(checks[0].verification!.pages[0]).toMatchObject({ sourceId: 'fixture-geography' });

    // A quote that is not in the PDF's text fails like any other.
    const fresh = await lengthSession(pages);
    writeVerdicts(fresh.dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', 'part three'),
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, fresh.deps(stubFetch(pages).stub))).toBe(1);
    expect(fresh.text()).toContain('the quote "part three" is not in the page');
  });

  it('saves the units that pass and lists the others, then takes a fix for only those', async () => {
    const { dir, deps, claimsDir, text } = await lengthSession();
    const units = storyUnits(chileFile().stories[0]);
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      {
        unitId: 'length-section-2',
        verdict: 'partly_supported',
        unsupported: ['a phrase the unit does not have'],
        evidence: [{ sourceId: 'fixture-geography', quote: SECTION_TWO }],
      },
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(livePages()).stub))).toBe(1);
    const output = text();
    expect(output).toContain('Saved 1 verdict');
    expect(output).toContain(
      'verdicts.length-section-2: "a phrase the unit does not have" is not in the unit text',
    );
    expect(Object.keys(readClaims(claimsDir, { id: 'CHL', slug: 'chile' }).checks)).toEqual([
      units[0].key,
    ]);
    expect(readSession(dir, 'CHL-length')).toMatchObject({
      passed: ['length-section-1'],
      submissions: [{ saved: ['length-section-1'] }],
    });

    // The fix covers only the unit still due; the first keeps its saved verdict.
    writeVerdicts(dir, [
      {
        unitId: 'length-section-2',
        verdict: 'partly_supported',
        unsupported: ['It is not real content.'],
        evidence: [{ sourceId: 'fixture-geography', quote: SECTION_TWO }],
      },
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(livePages()).stub))).toBe(0);
    const checks = readClaims(claimsDir, { id: 'CHL', slug: 'chile' }).checks;
    expect(Object.values(checks).map((check) => check.verdict)).toEqual([
      'supported',
      'partly_supported',
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, deps())).toBe(0);
    expect(text()).toContain('nothing to submit');
  });

  it('never passes a supported verdict whose source cannot be fetched live', async () => {
    const { dir, deps, claimsDir, text } = await lengthSession();
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', SECTION_TWO),
    ]);
    const down = stubFetch(
      {},
      {
        [GEOGRAPHY]: new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND example.org'), {
            code: 'ENOTFOUND',
          }),
        }),
      },
    );
    expect(await submit({ sessionId: 'CHL-length' }, deps(down.stub))).toBe(1);
    const output = text();
    expect(output).toContain(`Live fetch failed: ${GEOGRAPHY}`);
    expect(output).toContain(
      `the quote "${SECTION_ONE}" cannot be checked: the live fetch of ${GEOGRAPHY} at submission failed (fetch failed (getaddrinfo ENOTFOUND example.org))`,
    );
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(false);
    expect(readSession(dir, 'CHL-length').passed).toEqual([]);

    // The subagent may say the page cannot be read; then the units are flagged, not supported.
    writeVerdicts(
      dir,
      ['length-section-1', 'length-section-2'].map((unitId, index) => ({
        unitId,
        verdict: 'source_unreachable' as const,
        unsupported: [index ? SECTION_TWO : SECTION_ONE],
      })),
      [{ id: 'fixture-geography', status: 'unreachable', note: 'The host does not resolve.' }],
    );
    expect(await submit({ sessionId: 'CHL-length' }, deps(down.stub))).toBe(0);
    const checks = Object.values(readClaims(claimsDir, { id: 'CHL', slug: 'chile' }).checks);
    expect(checks.map((check) => [check.verdict, check.verification])).toEqual([
      ['source_unreachable', { pages: [] }],
      ['source_unreachable', { pages: [] }],
    ]);
  });

  it('--dry-run runs every check and the live fetch but writes nothing', async () => {
    const { dir, deps, claimsDir, text } = await lengthSession();
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', SECTION_TWO),
    ]);
    const before = readFileSync(join(dir, 'session.json'), 'utf8');
    const live = stubFetch(livePages());
    expect(await submit({ sessionId: 'CHL-length', dryRun: true }, deps(live.stub))).toBe(0);
    expect(live.requested).toEqual([GEOGRAPHY]);
    expect(text()).toMatch(/Dry run[\s\S]*Would save 2 verdicts[\s\S]*Every unit would pass/);
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(false);
    expect(existsSync(submissionsDir(dir))).toBe(false);
    expect(readFileSync(join(dir, 'session.json'), 'utf8')).toBe(before);

    // A failing dry run writes nothing either.
    writeVerdicts(dir, [supported('length-section-1', 'not on the page')]);
    expect(await submit({ sessionId: 'CHL-length', dryRun: true }, deps(live.stub))).toBe(1);
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(false);
    expect(readFileSync(join(dir, 'session.json'), 'utf8')).toBe(before);
  });

  it('refuses a submission once the checked text has changed', async () => {
    const { dir, deps, contentDir, text } = await lengthSession();
    const file = chileFile();
    file.stories[0].sections[0].text = 'Changed placeholder text for the pipeline tests.';
    writeCountryFile(contentDir, file);
    writeVerdicts(dir, [supported('length-section-1', SECTION_ONE)]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(livePages()).stub))).toBe(1);
    expect(text()).toContain('changed since this session started');
  });
});

describe('review of agent results', () => {
  const urlOptions = (dir: string) => ({
    cacheFile: join(dir, 'url-status.json'),
    fetch: (async () => new Response('ok', { status: 200 })) as typeof fetch,
  });

  it('approves on supported agent verdicts and refuses on flagged ones, as for API results', async () => {
    const { dir, deps, contentDir, text } = await lengthSession();
    const review = {
      contentDir,
      country: 'CHL',
      storyId: 'length',
      by: 'Tester',
      date: RUN_DATE,
      urlOptions: urlOptions(tempDir()),
    };
    expect(() => approve(review)).toThrow(
      /CHL\/length Section "First part of length": not claim-checked/,
    );

    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      {
        unitId: 'length-section-2',
        verdict: 'partly_supported',
        unsupported: ['It is not real content.'],
        evidence: [{ sourceId: 'fixture-geography', quote: SECTION_TWO }],
      },
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(livePages()).stub))).toBe(0);
    text();
    expect(() => approve(review)).toThrow(
      /CHL\/length Section "Second part of length": partly supported: "It is not real content."[\s\S]*--accept-claims/,
    );
    expect(approve({ ...review, acceptClaims: 'Read the page myself.' })).toMatchObject({
      approved: ['CHL/length'],
      acceptedClaims: 1,
    });
    const accepted = Object.values(
      readClaims(defaultClaimsDir(contentDir), { id: 'CHL', slug: 'chile' }).checks,
    ).find((check) => check.accepted)!;
    expect(accepted).toMatchObject({
      promptVersion: 'claims-agent-v1',
      accepted: { by: 'Tester', reason: 'Read the page myself.' },
    });
    expect(accepted.verification!.pages).toHaveLength(1);
  });
});
