// The agent claim check: sessions a Claude Code subagent checks claims in, the reading fetch, and
// the submission, which validates verdicts with the API path's rules, verifies every quote against
// a live fetch it makes itself, and saves passing verdicts in the API path's claims format. Fetches
// go to stubs; no network, no key.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CountryFile } from '../../src/content/schema';
import {
  compareTexts,
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
  writeSession,
} from '../../pipeline/claims-agent/session';
import { BODY_CUT_RETRIES_MS, SERVER_ERROR_RETRIES_MS } from '../../pipeline/agent/reading';
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
import { QUOTE_MAX_GAP, QUOTE_MAX_WORDS } from '../../pipeline/claims/verdicts';
import { writeCountryFile } from '../../pipeline/content-tree';
import { assembleCountry } from '../../pipeline/generate/assemble';
import { CountryDraft } from '../../pipeline/generate/draft-schema';
import {
  CURRENT_CLAIMS_AGENT_PROMPT_VERSION,
  loadClaimsAgentPrompts,
} from '../../pipeline/prompts';
import { approve } from '../../pipeline/review/actions';
import { chileDraft } from './fixtures/build-replay';
import { RUN_DATE, minimalPdf, tempContentTree, tempDir } from './helpers';

const NOW = new Date('2026-10-27T09:30:00.000Z');
const fixtureUrl = (path: string) => `https://example.org/elsewhere-fixture/chile/${path}`;
const GEOGRAPHY = fixtureUrl('geography');

/** The two sections of the "length" story, which both cite fixture-geography. */
const SECTION_ONE = 'Placeholder text about length, part one for the pipeline tests.';
const SECTION_TWO = 'Placeholder text about length, part two for the pipeline tests.';

type Page = {
  type: string;
  body: string | Uint8Array<ArrayBuffer>;
  status?: number;
  finalUrl?: string;
};

/** Enough words that a fixture page reads as a whole page, not a stub (see page-check.ts). */
const PADDING = 'This fixture page has more words so that it reads as a whole page. '
  .repeat(5)
  .trim();

const html = (text: string) =>
  `<!doctype html><html><head><title>Fixture</title></head><body><p>${text}</p><p>${PADDING}</p></body></html>`;

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
    Object.defineProperty(response, 'url', { value: page.finalUrl ?? url });
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
    overviewOnly: false,
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
    const original = readFileSync('pipeline/prompts/claims-v1/system.md', 'utf8');
    const head = (text: string) => text.slice(0, text.indexOf('# How to work'));
    for (const version of ['claims-agent-v1', CURRENT_CLAIMS_AGENT_PROMPT_VERSION]) {
      expect(verdicts(version)).toBe(verdicts('claims-v1'));
      const system = readFileSync(`pipeline/prompts/${version}/system.md`, 'utf8');
      expect(head(system)).toBe(head(original));
    }
    // claims-agent-v1 stays loadable for the results and sessions that recorded it.
    expect(loadClaimsAgentPrompts('claims-agent-v1').version).toBe('claims-agent-v1');
  });

  it('states the limits the quote check enforces', () => {
    const system = loadClaimsAgentPrompts().system;
    expect(system).toContain(`at most ${QUOTE_MAX_GAP} characters between one part and the next`);
    expect(system).toContain(`A quote must be under ${QUOTE_MAX_WORDS + 1} words`);
    expect(system).toContain('`--offset`');
    expect(system).toContain('never save the output to a file');
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

  describe('overview only', () => {
    const overviewIds = (file: CountryFile) =>
      scopeUnits(file, { kind: 'overview' }).map((unit) => unit.id);
    const storyIds = (file: CountryFile) =>
      file.stories.flatMap((story) => storyUnits(story)).map((unit) => unit.id);

    function saveResult(
      claimsDir: string,
      file: CountryFile,
      unit: { key: string; label: string; text: string },
    ) {
      recordChecks(claimsDir, file, {
        [unit.key]: {
          label: unit.label,
          text: unit.text,
          verdict: 'supported',
          unsupported: [],
          evidence: [],
          note: null,
          sources: [],
          checkedAt: RUN_DATE,
          model: 'claude-opus-5-5',
          effort: 'high',
          promptVersion: 'claims-agent-v3',
        },
      });
    }

    const saveAll = (claimsDir: string, file: CountryFile) => {
      for (const scope of allScopes(file)) {
        for (const unit of scopeUnits(file, scope)) saveResult(claimsDir, file, unit);
      }
    };

    it('scopes a session to the overview units, named CHL-overview', () => {
      const { root, deps, startOptions, text } = setup();
      const file = chileFile();
      expect(start(startOptions({ overviewOnly: true }), deps())).toBe(0);
      expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL-overview']);
      const [{ session }] = listSessions(root);
      expect(session.units.map((unit) => unit.id).sort()).toEqual(overviewIds(file).sort());
      expect(session.label).toBe('CHL/overview');
      expect(session.units.some((unit) => storyIds(file).includes(unit.id))).toBe(false);
      expect(text()).toContain('CHL-overview:');
    });

    it('keeps the name CHL when the overview is merely the only part still due', () => {
      const { root, deps, startOptions, claimsDir } = setup();
      const file = chileFile();
      for (const story of file.stories) {
        for (const unit of storyUnits(story)) saveResult(claimsDir, file, unit);
      }
      expect(start(startOptions(), deps())).toBe(0);
      expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL']);
    });

    it('checks the overview units that are due, and with --recheck all of them but no story unit', () => {
      const { root, deps, startOptions, claimsDir } = setup();
      const file = chileFile();
      const [first, ...rest] = scopeUnits(file, { kind: 'overview' });
      saveResult(claimsDir, file, first);
      saveResult(claimsDir, file, storyUnits(file.stories[0])[0]);
      const idsOf = () =>
        listSessions(root).flatMap(({ session }) => session.units.map((unit) => unit.id));

      expect(start(startOptions({ overviewOnly: true }), deps())).toBe(0);
      expect(idsOf().sort()).toEqual(rest.map((unit) => unit.id).sort());

      const again = startOptions({ overviewOnly: true, recheck: true, fresh: true });
      expect(start(again, deps())).toBe(0);
      expect(idsOf().sort()).toEqual(overviewIds(file).sort());
      expect(listSessions(root).every(({ session }) => session.recheck)).toBe(true);
    });

    it('has nothing to check when every overview unit has a result, and --recheck alone covers stories too', () => {
      const { root, deps, startOptions, claimsDir, text } = setup();
      const file = chileFile();
      saveAll(claimsDir, file);
      expect(start(startOptions({ overviewOnly: true }), deps())).toBe(0);
      expect(text()).toContain('Nothing to check');
      expect(listSessions(root)).toEqual([]);

      expect(start(startOptions({ recheck: true }), deps())).toBe(0);
      const ids = listSessions(root).flatMap(({ session }) => session.units.map((u) => u.id));
      const every = allScopes(file).flatMap((scope) => scopeUnits(file, scope));
      expect(ids.sort()).toEqual(every.map((unit) => unit.id).sort());
    });

    it('refuses --overview together with a story', () => {
      const { root, deps, startOptions, text } = setup();
      expect(start(startOptions({ overviewOnly: true, storyId: 'length' }), deps())).toBe(1);
      expect(text()).toContain('--overview checks the overview alone');
      expect(listSessions(root)).toEqual([]);
    });
  });

  describe('replacing an earlier session', () => {
    const STAMP = 'CHL-length-2026-10-27T09-30-00-000Z';

    const finish = (dir: string) => {
      const current = readSession(dir, 'CHL-length');
      writeSession(dir, { ...current, passed: current.units.map((unit) => unit.id) });
    };

    it('moves a finished session to finished/ with its fetch records and submissions', async () => {
      const { dir, deps, root, startOptions, text } = await lengthSession();
      mkdirSync(submissionsDir(dir), { recursive: true });
      writeFileSync(join(submissionsDir(dir), '1.json'), '{}');
      finish(dir);
      expect(start(startOptions({ storyId: 'length', recheck: true }), deps())).toBe(0);

      const moved = join(root, 'finished', STAMP);
      expect(readdirSync(join(root, 'finished'))).toEqual([STAMP]);
      expect(readSession(moved, 'CHL-length').fetches).toHaveLength(1);
      expect(findPageRecord(pagesDir(moved), GEOGRAPHY)).toBeDefined();
      expect(existsSync(join(submissionsDir(moved), '1.json'))).toBe(true);
      expect(text()).toContain(`Moved the earlier session to ${moved}.`);

      // The new session starts empty, and the archive is not listed as a session.
      expect(readSession(dir, 'CHL-length').fetches).toEqual([]);
      expect(existsSync(pagesDir(dir))).toBe(false);
      expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL-length']);
    });

    it('does not overwrite an archive made at the same time', async () => {
      const { dir, deps, root, startOptions } = await lengthSession();
      for (let round = 0; round < 2; round += 1) {
        finish(dir);
        expect(start(startOptions({ storyId: 'length', recheck: true }), deps())).toBe(0);
      }
      expect(readdirSync(join(root, 'finished')).sort()).toEqual([STAMP, `${STAMP}-2`]);
    });

    it('moves an unfinished session that holds nothing this start would hand out', async () => {
      const { dir, deps, root, contentDir, startOptions } = await lengthSession();
      const oldKeys = readSession(dir, 'CHL-length').units.map((unit) => unit.key);
      // The text changed, so none of the session's units is a current one any more.
      const file = chileFile();
      file.stories[0].sections[0].text = 'Changed placeholder text for the pipeline tests.';
      file.stories[0].sections[1].text = 'Also changed placeholder text for the pipeline tests.';
      writeCountryFile(contentDir, file);
      expect(start(startOptions({ storyId: 'length' }), deps())).toBe(0);
      expect(readdirSync(join(root, 'finished'))).toEqual([STAMP]);
      const moved = readSession(join(root, 'finished', STAMP), 'CHL-length');
      expect(moved.units.map((unit) => unit.key)).toEqual(oldKeys);
      expect(readSession(dir, 'CHL-length').units.map((unit) => unit.key)).not.toEqual(oldKeys);
    });

    it('still refuses while an unfinished session holds a unit it would hand out, and keeps it', async () => {
      const { dir, deps, root, startOptions, text } = await lengthSession();
      expect(start(startOptions({ storyId: 'length' }), deps())).toBe(1);
      expect(text()).toContain('Unfinished sessions already hold some of these units: CHL-length');
      expect(existsSync(join(root, 'finished'))).toBe(false);
      expect(readSession(dir, 'CHL-length').fetches).toHaveLength(1);
    });

    it('--fresh sets an unfinished session aside instead of deleting it', async () => {
      const { dir, deps, root, startOptions } = await lengthSession();
      expect(start(startOptions({ storyId: 'length', fresh: true }), deps())).toBe(0);
      expect(readdirSync(join(root, 'finished'))).toEqual([STAMP]);
      expect(readSession(join(root, 'finished', STAMP), 'CHL-length').fetches).toHaveLength(1);
      expect(readSession(dir, 'CHL-length').fetches).toEqual([]);
    });

    /** A result for every unit of the country, so nothing is due. */
    const saveEverything = (claimsDir: string) => {
      const file = chileFile();
      for (const scope of allScopes(file)) {
        for (const unit of scopeUnits(file, scope)) {
          recordChecks(claimsDir, file, {
            [unit.key]: {
              label: unit.label,
              text: unit.text,
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
        }
      }
    };

    it('--fresh sets an unfinished session aside even when nothing is due', async () => {
      const { deps, root, startOptions, claimsDir, text } = await lengthSession();
      saveEverything(claimsDir);
      expect(start(startOptions({ fresh: true }), deps())).toBe(0);
      expect(text()).toContain('Nothing to check');
      expect(listSessions(root)).toEqual([]);
      expect(readdirSync(join(root, 'finished'))).toEqual([STAMP]);
    });

    it('without --fresh, nothing to check leaves every session where it is', async () => {
      const { deps, root, startOptions, claimsDir, text } = await lengthSession();
      saveEverything(claimsDir);
      expect(start(startOptions(), deps())).toBe(0);
      expect(text()).toContain('Nothing to check');
      expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL-length']);
      expect(existsSync(join(root, 'finished'))).toBe(false);
    });

    describe('--fresh scope', () => {
      /** CHL-length (unfinished) and CHL-overview side by side, then --fresh with these options. */
      const freshAmong = (options: Partial<StartOptions>) => {
        const env = setup();
        expect(start(env.startOptions({ storyId: 'length' }), env.deps())).toBe(0);
        expect(start(env.startOptions({ overviewOnly: true }), env.deps())).toBe(0);
        expect(listSessions(env.root).map(({ id }) => id)).toEqual(['CHL-length', 'CHL-overview']);
        env.text();
        const code = start(env.startOptions({ ...options, fresh: true }), env.deps());
        return { ...env, code };
      };

      it('--overview sets aside the overview session and leaves an unfinished story session alone', () => {
        const { code, root, text } = freshAmong({ overviewOnly: true });
        expect(code).toBe(0);
        expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL-length', 'CHL-overview']);
        expect(readdirSync(join(root, 'finished')).length).toBe(1);
        expect(readdirSync(join(root, 'finished'))[0]).toMatch(/^CHL-overview-/);
        expect(text()).not.toContain('CHL-length-');
      });

      it('the whole country sets aside a session whose units no longer exist, and so does a scoped --fresh', () => {
        for (const options of [{}, { overviewOnly: true }] as Partial<StartOptions>[]) {
          const env = setup();
          expect(start(env.startOptions({ storyId: 'length' }), env.deps())).toBe(0);
          // The story was removed from the country, so the session's units are gone.
          const file = chileFile();
          file.stories = file.stories.filter((story) => story.id !== 'length');
          writeCountryFile(env.contentDir, file);
          env.text();
          expect(start(env.startOptions({ ...options, fresh: true }), env.deps())).toBe(0);
          expect(listSessions(env.root).map(({ id }) => id)).not.toContain('CHL-length');
          expect(readdirSync(join(env.root, 'finished'))[0]).toMatch(/^CHL-length-/);
        }
      });

      it('still refuses when a session left outside the scope holds a unit by key', () => {
        const { root, deps, startOptions, text } = setup();
        const file = chileFile();
        expect(start(startOptions({ storyId: 'length' }), deps())).toBe(0);
        const dir = sessionDir(root, 'CHL-length');
        const held = readSession(dir, 'CHL-length');
        const [overview] = scopeUnits(file, { kind: 'overview' });
        // A unit of the story whose text hashes like an overview unit: outside the scope by ID,
        // but handed out again by --overview.
        writeSession(dir, {
          ...held,
          units: [{ ...held.units[0], key: overview.key }],
        });
        text();
        expect(start(startOptions({ overviewOnly: true, fresh: true }), deps())).toBe(1);
        expect(text()).toContain(
          'Unfinished sessions already hold some of these units: CHL-length',
        );
        expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL-length']);
        expect(existsSync(join(root, 'finished'))).toBe(false);
      });

      it('[story] sets aside that story session and leaves the overview session alone', () => {
        const { code, root } = freshAmong({ storyId: 'length' });
        expect(code).toBe(0);
        expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL-length', 'CHL-overview']);
        expect(readdirSync(join(root, 'finished')).length).toBe(1);
        expect(readdirSync(join(root, 'finished'))[0]).toMatch(/^CHL-length-/);
      });

      it('the whole country sets aside every session that overlaps it', () => {
        const { code, root } = freshAmong({});
        expect(code).toBe(0);
        expect(listSessions(root).map(({ id }) => id)).toEqual(['CHL']);
        expect(readdirSync(join(root, 'finished')).sort()).toEqual(
          expect.arrayContaining([expect.stringMatching(/^CHL-length-/)]),
        );
        expect(readdirSync(join(root, 'finished')).length).toBe(2);
      });
    });
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
      { url: GEOGRAPHY, reason: 'the server answered 404', attempts: 1 },
    ]);
    // Trying the page again keeps one entry for it, with the number of attempts.
    await fetchCommand(
      { sessionId: 'CHL-length', url: GEOGRAPHY, refresh: false },
      deps(failing.stub),
    );
    expect(readSession(dir, 'CHL-length').failedFetches).toMatchObject([
      { url: GEOGRAPHY, attempts: 2 },
    ]);
    expect(status({ target: 'CHL-length' }, deps())).toBe(0);
    expect(text()).toContain(
      `${GEOGRAPHY} (2 attempts, the latest ${NOW.toISOString()}): the server answered 404`,
    );

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

describe('agent claim check reading', () => {
  it('searches several terms at once, a few places per term', async () => {
    const { dir, deps, text } = await lengthSession();
    expect(dir).toBeTruthy();
    const { stub } = stubFetch(livePages());
    expect(
      await fetchCommand(
        {
          sessionId: 'CHL-length',
          url: GEOGRAPHY,
          find: ['part one', 'fixture page', 'absent'],
          refresh: false,
        },
        deps(stub),
      ),
    ).toBe(0);
    const printed = text();
    expect(printed).toMatch(/^## part one\n"part one" appears once in the text\./m);
    expect(printed).toMatch(
      /^## fixture page\n"fixture page" appears 5 times in the text; matches 1 to 5\./m,
    );
    expect(printed).toMatch(/^## absent\n"absent" does not appear in the text\./m);
    // Read from the stored copy: the page is not fetched again, and no redirect line repeats.
    expect(printed).toContain('(reading copy in');
  });
});

describe('live pages compared with the reading copy', () => {
  const lines = (...parts: string[]) => parts.join('\n');
  const copy = (text: string) => ({
    text,
    sha256: sha256(text),
    fetchedAt: NOW.toISOString(),
    characters: text.length,
  });
  const paragraph = `${SECTION_ONE} ${SECTION_TWO}`;

  it('tells the same text, the same main text and a different main text apart', () => {
    const read = lines('Menu', 'Updated 5 minutes ago', paragraph, PADDING);
    expect(compareTexts(read, copy(read))).toMatchObject({ same: true });
    expect(compareTexts(read, copy(read)).description).toContain(
      'the same text as the reading copy',
    );
    // Only short lines differ: navigation, a timestamp.
    const furniture = compareTexts(
      lines('Home', 'Updated 6 minutes ago', paragraph, PADDING),
      copy(read),
    );
    expect(furniture.same).toBe(true);
    expect(furniture.description).toContain(
      'the same main text as the reading copy (only short lines such as navigation, sidebars, dates or links differ)',
    );
    // A paragraph changed.
    const edited = compareTexts(
      lines('Menu', 'Updated 5 minutes ago', `${paragraph} Revised.`, PADDING),
      copy(read),
    );
    expect(edited.same).toBe(false);
    expect(edited.description).toContain('its main text differs');
    // Text with no long lines at all is never called the same main text.
    expect(compareTexts('Short a', copy('Short b')).same).toBe(false);
  });

  it('does not blame the live fetch for a miscopied quote when only page furniture changed', async () => {
    const page = (stamp: string): Record<string, Page> => ({
      ...livePages(),
      [GEOGRAPHY]: {
        type: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body><p>Updated ${stamp}</p><p>${SECTION_ONE} ${SECTION_TWO}</p><p>${PADDING}</p></body></html>`,
      },
    });
    const { dir, deps, text } = await lengthSession(page('5 minutes ago'));
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', 'Placeholder text about length, part three'),
    ]);
    const live = stubFetch(page('6 minutes ago'));
    expect(await submit({ sessionId: 'CHL-length' }, deps(live.stub))).toBe(1);
    const output = text();
    expect(output).toContain('the same main text as the reading copy');
    expect(output).not.toContain('The live page is not the text you read');
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
    expect(text()).toMatch(
      /same text as the reading copy[\s\S]*Units checked: 2\. 2 passed and are saved to .* \(2 supported, 0 partly supported, 0 not supported, 0 source unreachable\); 0 failed\.[\s\S]*The session is done/,
    );

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
      promptVersion: CURRENT_CLAIMS_AGENT_PROMPT_VERSION,
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
      `claim check: supported (2026-10-27, claude-opus-5-5, ${CURRENT_CLAIMS_AGENT_PROMPT_VERSION})`,
    );
    const session = readSession(dir, 'CHL-length');
    expect(session.passed).toEqual(['length-section-1', 'length-section-2']);
    expect(session.submissions[0].liveFetches).toEqual([
      {
        url: GEOGRAPHY,
        fetchedAt: NOW.toISOString(),
        characters: pageText.length,
        sha256: sha256(pageText),
        error: null,
      },
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
    // What the live fetch returned is told apart from the copy the quote was read from.
    const liveText = htmlToText(html(SECTION_ONE));
    const comparison = `${liveText.length} characters, not the text of the reading copy fetched ${NOW.toISOString()} (${forged.length} characters): its main text differs`;
    expect(output).toContain(`Fetched live to verify quotes: ${GEOGRAPHY} (${comparison})`);
    expect(output).toContain(
      `The live page is not the text you read: ${comparison}. If the quote is in your reading copy, the live fetch returned something else; submit again, or fetch with --refresh to see what the page returns now.`,
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
      ['Fixture statistics', ...PADDING.split('. ')],
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
    expect(output).toMatch(
      /Units checked: 2\. 1 passed and is saved to .*; 1 failed and is listed below\./,
    );
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
    text();
    expect(status({ target: 'CHL-length' }, deps())).toBe(0);
    expect(text()).toContain(
      'Submissions: 2; the last saved 2 units and had 0 problems, with 0 live fetches.',
    );
  });

  it('tries a page again after a server error before verifying its quotes', async () => {
    const { dir, deps, text } = await lengthSession();
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', SECTION_TWO),
    ]);
    const live = stubFetch(livePages());
    let answered = 0;
    const flaky = (async (input: string | URL | Request) =>
      (answered += 1) === 1
        ? new Response('Gateway Timeout', { status: 504 })
        : live.stub(input)) as typeof fetch;
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    expect(await submit({ sessionId: 'CHL-length' }, { ...deps(flaky), sleep })).toBe(0);
    expect(waits).toEqual([SERVER_ERROR_RETRIES_MS[0]]);
    expect(text()).toContain('Units checked: 2. 2 passed');
  });

  /** A fetch stub whose first answers for a URL are bodies cut off in the middle, as undici ends them. */
  const cutBodies = (inner: typeof fetch, cuts: number) => {
    let cut = 0;
    const cutBody = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<p>Half of the'));
            controller.error(
              new TypeError('terminated', {
                cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
              }),
            );
          },
        }),
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    return (async (input: string | URL | Request, init?: RequestInit) =>
      (cut += 1) <= cuts ? cutBody() : inner(input, init)) as typeof fetch;
  };

  it('downloads a page again when its body is cut off during the live verification', async () => {
    const { dir, deps, text } = await lengthSession();
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', SECTION_TWO),
    ]);
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const flaky = cutBodies(stubFetch(livePages()).stub, 2);
    expect(await submit({ sessionId: 'CHL-length' }, { ...deps(flaky), sleep })).toBe(0);
    expect(waits).toEqual(BODY_CUT_RETRIES_MS.slice(0, 2));
    expect(text()).toContain('Units checked: 2. 2 passed');
  });

  it('reports a body that is cut off on every attempt as a network cut, not a page problem', async () => {
    const { dir, deps, claimsDir, text } = await lengthSession();
    writeVerdicts(dir, [supported('length-section-1', SECTION_ONE)]);
    const sleep = async () => undefined;
    const cut = cutBodies(stubFetch(livePages()).stub, 100);
    expect(await submit({ sessionId: 'CHL-length' }, { ...deps(cut), sleep })).toBe(1);
    const output = text();
    expect(output).toContain(`Live fetch failed: ${GEOGRAPHY}: the connection was cut while`);
    expect(output).toContain(`on all ${BODY_CUT_RETRIES_MS.length + 1} attempts`);
    expect(output).toContain('not a problem with the page');
    expect(output).toContain('do not mark the source unreachable for it');
    expect(output).not.toContain('mark the source unreachable with the reason');
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(false);

    // The fetch command says the same, and logs the failure.
    expect(
      await fetchCommand(
        { sessionId: 'CHL-length', url: GEOGRAPHY, refresh: true },
        { ...deps(cut), sleep },
      ),
    ).toBe(1);
    expect(text()).toContain('Do not mark fixture-geography unreachable for a network cut');
  });

  it('warns about a page of only menus and footer in the fetch command, and still verifies a quote on it', async () => {
    const menu = Array.from(
      { length: 26 },
      (_, index) => `<li>Menu item ${String.fromCharCode(65 + index)}</li>`,
    ).join('');
    const menuOnly = {
      ...livePages(),
      [GEOGRAPHY]: {
        type: 'text/html',
        body: `<html><body><ul>${menu}</ul><p>About us | Contact | Terms of use | Privacy statement</p></body></html>`,
      },
    };
    const { dir, deps, claimsDir, text } = await lengthSession();
    expect(
      await fetchCommand(
        { sessionId: 'CHL-length', url: GEOGRAPHY, offset: 0, refresh: true },
        deps(stubFetch(menuOnly).stub),
      ),
    ).toBe(0);
    const warned = text();
    expect(warned).toContain('WARNING: this page may be only its menus and footer');
    expect(warned).toContain('almost all of its text is short navigation lines');
    expect(warned).not.toContain('probably not the cited page');
    // The guess never blocks verification: a quote that is on the live page passes, as it would
    // for any short page the guess is wrong about.
    writeVerdicts(dir, [supported('length-section-1', 'Menu item C')]);
    await submit({ sessionId: 'CHL-length' }, deps(stubFetch(menuOnly).stub));
    const submitted = text();
    expect(submitted).not.toContain('Live fetch failed');
    expect(submitted).toContain('Units checked: 2. 1 passed and is saved');
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(true);
  });

  it('--dry-run prints the word count of each quote that is over the limit or within 3 words of it', async () => {
    const { dir, deps, text } = await lengthSession();
    const words = (count: number) => Array.from({ length: count }, (_, i) => `w${i}`).join(' ');
    const live = stubFetch(livePages());
    writeVerdicts(dir, [
      supported('length-section-1', words(QUOTE_MAX_WORDS + 2)),
      supported('length-section-2', words(QUOTE_MAX_WORDS - 3)),
    ]);
    expect(await submit({ sessionId: 'CHL-length', dryRun: true }, deps(live.stub))).toBe(1);
    const output = text();
    expect(output).toContain(
      `Quote lengths (a quote may have at most ${QUOTE_MAX_WORDS} words), the long ones:`,
    );
    expect(output).toContain(
      `  length-section-1 (fixture-geography): ${QUOTE_MAX_WORDS + 2} words, 2 words over the limit: "w0 w1 w2`,
    );
    expect(output).toContain(
      `  length-section-2 (fixture-geography): ${QUOTE_MAX_WORDS - 3} words, 3 words under the limit: "w0 w1 w2`,
    );
    // The same function counts as the check, so the count agrees with its message.
    expect(output).toContain(`has ${QUOTE_MAX_WORDS + 2} words; a quote must be under`);

    // Shorter quotes are not listed, and a real submission prints no such lines.
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', words(QUOTE_MAX_WORDS - 4)),
    ]);
    await submit({ sessionId: 'CHL-length', dryRun: true }, deps(live.stub));
    expect(text()).not.toContain('Quote lengths');
    writeVerdicts(dir, [supported('length-section-1', words(QUOTE_MAX_WORDS + 1))]);
    await submit({ sessionId: 'CHL-length' }, deps(live.stub));
    expect(text()).not.toContain('Quote lengths');
  });

  it('never verifies a quote against a page that is not the cited page', async () => {
    // The cited URL now redirects to the site's home page, which happens to repeat the text.
    const home = 'https://example.org/';
    const moved = {
      ...livePages(),
      [GEOGRAPHY]: {
        type: 'text/html',
        body: html(`${SECTION_ONE} ${SECTION_TWO}`),
        finalUrl: home,
      },
    };
    const { dir, deps, claimsDir, text } = await lengthSession();
    const reading = stubFetch(moved);
    expect(
      await fetchCommand(
        { sessionId: 'CHL-length', url: GEOGRAPHY, offset: 0, refresh: true },
        deps(reading.stub),
      ),
    ).toBe(0);
    expect(text()).toContain(
      "WARNING: this is probably not the cited page: it redirected to the site's home page",
    );
    writeVerdicts(dir, [
      supported('length-section-1', SECTION_ONE),
      supported('length-section-2', SECTION_TWO),
    ]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(moved).stub))).toBe(1);
    expect(text()).toContain(
      `the live fetch of ${GEOGRAPHY} at submission failed (it is probably not the cited page: it redirected to the site's home page (${home}))`,
    );
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(false);

    // A page too short to be the page is refused the same way.
    const stub = {
      ...livePages(),
      [GEOGRAPHY]: { type: 'text/html', body: `<p>${SECTION_ONE}</p>` },
    };
    writeVerdicts(dir, [supported('length-section-1', SECTION_ONE)]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(stub).stub))).toBe(1);
    expect(text()).toContain('too short to be the page');
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
    expect(text()).toMatch(
      /Dry run[\s\S]*Units checked: 2\. 2 would pass and be saved to .*; 0 fail\.[\s\S]*Every unit would pass/,
    );
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(false);
    expect(existsSync(submissionsDir(dir))).toBe(false);
    expect(readFileSync(join(dir, 'session.json'), 'utf8')).toBe(before);

    // A failing dry run writes nothing either.
    writeVerdicts(dir, [supported('length-section-1', 'not on the page')]);
    expect(await submit({ sessionId: 'CHL-length', dryRun: true }, deps(live.stub))).toBe(1);
    expect(existsSync(claimsFilePath(claimsDir, 'chile'))).toBe(false);
    expect(readFileSync(join(dir, 'session.json'), 'utf8')).toBe(before);
  });

  it('refuses to continue a session started on prompts older than claims-agent-v3', async () => {
    const { dir, deps, root, startOptions, text } = await lengthSession();
    // A session as claims-agent-v2 wrote it, whose brief describes --find as listing 20 places.
    writeSession(dir, { ...readSession(dir, 'CHL-length'), promptVersion: 'claims-agent-v2' });
    const refusal =
      'Session CHL-length started on the claims-agent-v2 prompts, whose brief describes the fetch command as it no longer works. Set it aside and plan again with: npm run content:claims-agent -- start CHL length --fresh';
    expect(
      await fetchCommand(
        { sessionId: 'CHL-length', url: GEOGRAPHY, refresh: false },
        deps(stubFetch(livePages()).stub),
      ),
    ).toBe(1);
    expect(text()).toBe(refusal);
    writeVerdicts(dir, [supported('length-section-1', SECTION_ONE)]);
    expect(await submit({ sessionId: 'CHL-length' }, deps(stubFetch(livePages()).stub))).toBe(1);
    expect(text()).toBe(refusal);
    expect(start(startOptions({ storyId: 'length' }), deps())).toBe(1);
    expect(text()).toContain(
      'CHL-length started on older prompts, whose brief describes the fetch command as it no longer works, so pass --fresh',
    );
    expect(start(startOptions({ storyId: 'length', fresh: true }), deps())).toBe(0);
    expect(readSession(sessionDir(root, 'CHL-length'), 'CHL-length').promptVersion).toBe(
      'claims-agent-v3',
    );
  });

  it('points an old overview or whole-country session at a restart of its own scope', async () => {
    const hint = (label: string) => async () => {
      const { dir, deps, text } = await lengthSession();
      writeSession(dir, {
        ...readSession(dir, 'CHL-length'),
        label,
        promptVersion: 'claims-agent-v2',
      });
      await fetchCommand(
        { sessionId: 'CHL-length', url: GEOGRAPHY, refresh: false },
        deps(stubFetch(livePages()).stub),
      );
      return text();
    };
    expect(await hint('CHL/overview')()).toMatch(/start CHL --overview --fresh$/);
    expect(await hint('CHL, part 2 of 3')()).toMatch(/start CHL --fresh$/);
    expect(await hint('CHL/length, part 1 of 2')()).toMatch(/start CHL length --fresh$/);
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
      promptVersion: CURRENT_CLAIMS_AGENT_PROMPT_VERSION,
      accepted: { by: 'Tester', reason: 'Read the page myself.' },
    });
    expect(accepted.verification!.pages).toHaveLength(1);
  });
});
