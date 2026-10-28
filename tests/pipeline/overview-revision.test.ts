// Sending a country's overview back alone: the request review records, how review shows it, and
// the API redraft of the country part, which keeps every story byte for byte. The agent redraft is
// tested in agent.test.ts. The API conversation is a replayed recording; no network, no key.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CountryFile } from '../../src/content/schema';
import { defaultClaimsDir, readClaims } from '../../pipeline/claims/store';
import { BATCH_CUSTOM_ID, DEFAULT_CONTENT_DIR } from '../../pipeline/config';
import {
  countryFilePath,
  parsedCountryFiles,
  readCountryFile,
  writeCountryFile,
} from '../../pipeline/content-tree';
import {
  assembleCountry,
  toDraftCountry,
  toDraftSources,
  toDraftStory,
} from '../../pipeline/generate/assemble';
import { CountryDraft } from '../../pipeline/generate/draft-schema';
import { ReplayClient, type ModelClient } from '../../pipeline/generate/model-client';
import { generate, jobTag, type Job } from '../../pipeline/generate/run';
import { checkRevisions } from '../../pipeline/generate/tasks';
import { approve, requestRevision, ReviewError } from '../../pipeline/review/actions';
import { countrySummary, listing } from '../../pipeline/review/summary';
import { chileDraft, REPLAY_DIR, revisedOverview } from './fixtures/build-replay';
import { RUN_DATE, runContext, tempContentTree, tempDir } from './helpers';

// A redraft checks every route against land geometry, which takes a few seconds on a CI runner.
const REDRAFT_TIMEOUT_MS = 30_000;
const NOTES = 'Name every neighbour.';

/** A draft Chile file in a temporary content tree, as the API path writes it. */
function chileTree() {
  const contentDir = tempContentTree();
  writeCountryFile(
    contentDir,
    assembleCountry(CountryDraft.parse(chileDraft()), {
      countryId: 'CHL',
      slug: 'chile',
      model: 'claude-opus-5-5',
      date: '2026-10-01',
      promptVersion: 'v3',
    }),
  );
  const review = { contentDir, by: 'Tester', date: RUN_DATE };
  return { contentDir, review, file: countryFilePath(contentDir, 'chile') };
}

const summaryContext = (contentDir: string, file: CountryFile) => ({
  files: parsedCountryFiles(contentDir),
  issues: [],
  pending: [],
  urlStatuses: new Map(),
  claims: readClaims(defaultClaimsDir(contentDir), file.country),
});

describe('sending the overview back alone', () => {
  it('records the request on the country part and tells it apart from a whole country', () => {
    const { contentDir, review } = chileTree();
    const sent = requestRevision({ ...review, country: 'CHL', overview: true, notes: NOTES });
    expect(sent.target).toBe('CHL overview');
    expect(sent.agentCommand).toBe('npm run content:agent -- start CHL --revisions');
    const file = readCountryFile(contentDir, 'chile')!;
    expect(file.country.provenance.revision).toEqual({
      notes: NOTES,
      requestedBy: 'Tester',
      requestedAt: RUN_DATE,
      scope: 'overview',
    });
    expect(file.stories.every((story) => !story.provenance.revision)).toBe(true);

    // Review shows what is sent back.
    expect(listing([{ file: 'chile.json', data: file }])[0]).toMatchObject({
      countryRevision: 'overview',
      storyRevisions: 0,
    });
    expect(countrySummary(file, summaryContext(contentDir, file))).toContain(
      `REVISION REQUESTED for the overview alone by Tester on ${RUN_DATE}: ${NOTES}`,
    );
    expect(() => approve({ ...review, country: 'CHL' })).toThrow(
      /Waiting for a revision: .*\(the overview\)\. Redraft first with npm run content:generate -- --revisions, or in a Claude Code subagent with npm run content:agent -- start CHL --revisions\./,
    );

    // A story sent back as well is listed beside it.
    requestRevision({ ...review, country: 'CHL', storyId: 'andes', notes: 'Shorter.' });
    expect(
      listing([{ file: 'chile.json', data: readCountryFile(contentDir, 'chile')! }])[0],
    ).toMatchObject({ countryRevision: 'overview', storyRevisions: 1 });

    // Sending the whole country back replaces the request with one without a scope.
    const whole = requestRevision({ ...review, country: 'CHL', notes: 'Start over.' });
    expect(whole.agentCommand).toBe('npm run content:agent -- start CHL');
    const restarted = readCountryFile(contentDir, 'chile')!;
    expect(restarted.country.provenance.revision).toEqual({
      notes: 'Start over.',
      requestedBy: 'Tester',
      requestedAt: RUN_DATE,
    });
    expect(listing([{ file: 'chile.json', data: restarted }])[0].countryRevision).toBe(
      'whole country',
    );
    expect(countrySummary(restarted, summaryContext(contentDir, restarted))).toContain(
      'REVISION REQUESTED for the whole country by Tester',
    );
  });

  it('refuses an overview request with a story, or for a reviewed overview', () => {
    const { contentDir, review } = chileTree();
    expect(() =>
      requestRevision({
        ...review,
        country: 'CHL',
        storyId: 'andes',
        overview: true,
        notes: NOTES,
      }),
    ).toThrow('--overview sends back the country part alone');
    const file = readCountryFile(contentDir, 'chile')!;
    writeCountryFile(contentDir, {
      ...file,
      country: {
        ...file.country,
        provenance: {
          ...file.country.provenance,
          status: 'reviewed',
          reviewedBy: 'Tester',
          reviewedAt: RUN_DATE,
        },
      },
    });
    expect(() =>
      requestRevision({ ...review, country: 'CHL', overview: true, notes: NOTES }),
    ).toThrow(ReviewError);
  });

  it('allows a scope only on the country part', () => {
    const file = readCountryFile(chileTree().contentDir, 'chile')!;
    const request = {
      notes: NOTES,
      requestedBy: 'Tester',
      requestedAt: RUN_DATE,
      scope: 'overview',
    };
    const withStoryScope = structuredClone(file) as unknown as {
      stories: { provenance: Record<string, unknown> }[];
    };
    withStoryScope.stories[0].provenance.revision = request;
    const parsed = CountryFile.safeParse(withStoryScope);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain(
      'Only a country sends back its overview alone; a story revision has no scope',
    );
    const withCountryScope = structuredClone(file) as unknown as {
      country: { provenance: Record<string, unknown> };
    };
    withCountryScope.country.provenance.revision = request;
    expect(CountryFile.safeParse(withCountryScope).success).toBe(true);
  });
});

describe('the API redraft of an overview', () => {
  it('tags every job with a valid batch custom ID that no other job shares', () => {
    const jobs: Job[] = [];
    for (const file of [
      ...parsedCountryFiles(DEFAULT_CONTENT_DIR).values(),
      readCountryFile(chileTree().contentDir, 'chile')!,
    ]) {
      const countryId = file.country.id;
      jobs.push({ kind: 'country', countryId }, { kind: 'overview', countryId });
      for (const story of file.stories) jobs.push({ kind: 'story', countryId, storyId: story.id });
    }
    // The longest IDs the schema allows in a tag's place.
    jobs.push({ kind: 'story', countryId: 'XXX', storyId: 'a'.repeat(60) });
    const tags = jobs.map(jobTag);
    expect(tags).toContain('CHL_overview');
    for (const tag of tags) expect(tag, tag).toMatch(BATCH_CUSTOM_ID);
    expect(new Set(tags).size).toBe(tags.length);
    // A story tag joins the country and story IDs with "-", and neither ID has an underscore.
    expect(
      tags.filter((tag) => tag.includes('_')).every((tag) => /^[A-Z]{3}_overview$/.test(tag)),
    ).toBe(true);
  });

  it(
    'redrafts an overview in batch mode',
    async () => {
      const { contentDir, review, file } = chileTree();
      requestRevision({ ...review, country: 'CHL', overview: true, notes: NOTES });
      const run = await generate({
        client: new ReplayClient(REPLAY_DIR),
        context: runContext(contentDir),
        jobs: [{ kind: 'overview', countryId: 'CHL' }],
        mode: 'batch',
        regenerate: false,
        force: false,
        resume: false,
        log: () => {},
        cacheDir: tempDir(),
      });
      expect(run.results).toMatchObject([{ tag: 'CHL_overview', outcome: 'written' }]);
      expect(JSON.parse(readFileSync(file, 'utf8')).country.overview.summary).toBe(
        revisedOverview().country.overview.summary,
      );
    },
    REDRAFT_TIMEOUT_MS,
  );

  it(
    'does not write a redraft whose request changed or widened during the run',
    async () => {
      const cases: { change: (contentDir: string) => void; reason: string }[] = [
        {
          change: (contentDir) =>
            requestRevision({
              contentDir,
              country: 'CHL',
              overview: true,
              notes: 'Shorter, please.',
              by: 'Tester',
              date: RUN_DATE,
            }),
          reason: 'the overview of CHL was sent back again with other notes',
        },
        {
          change: (contentDir) =>
            requestRevision({
              contentDir,
              country: 'CHL',
              notes: 'Start over.',
              by: 'Tester',
              date: RUN_DATE,
            }),
          reason: 'the whole of CHL is sent back now, not only its overview',
        },
      ];
      for (const { change, reason } of cases) {
        const { contentDir, review, file } = chileTree();
        requestRevision({ ...review, country: 'CHL', overview: true, notes: NOTES });
        const replay = new ReplayClient(REPLAY_DIR);
        // The editor changes the request while the conversation runs.
        const client: ModelClient = {
          description: replay.description,
          create: async (request) => {
            change(contentDir);
            return replay.create(request);
          },
          runBatch: (requests, options) => replay.runBatch(requests, options),
        };
        const before = readFileSync(file, 'utf8');
        const run = await generate({
          client,
          context: runContext(contentDir),
          jobs: [{ kind: 'overview', countryId: 'CHL' }],
          mode: 'sync',
          regenerate: false,
          force: false,
          resume: false,
          log: () => {},
          cacheDir: tempDir(),
        });
        expect(run.results).toMatchObject([{ tag: 'CHL_overview', outcome: 'failed' }]);
        expect(run.results[0].detail).toContain(
          `${reason} since this job started, so the redraft was not written; run npm run content:generate -- --revisions again for the current request`,
        );
        // Only the request changed; the redraft never reached the file.
        const after = readCountryFile(contentDir, 'chile')!;
        expect(after.country.overview.summary).toBe(
          CountryFile.parse(JSON.parse(before)).country.overview.summary,
        );
      }
    },
    REDRAFT_TIMEOUT_MS,
  );

  it(
    'redrafts the country part in its own conversation and keeps every story byte for byte',
    async () => {
      const { contentDir, review, file } = chileTree();
      requestRevision({ ...review, country: 'CHL', overview: true, notes: NOTES });
      const before = readFileSync(file, 'utf8');
      const original = readCountryFile(contentDir, 'chile')!;
      const client = new ReplayClient(REPLAY_DIR);
      const log: string[] = [];
      const run = await generate({
        client,
        context: runContext(contentDir),
        jobs: [{ kind: 'overview', countryId: 'CHL' }],
        mode: 'sync',
        regenerate: false,
        force: false,
        resume: false,
        log: (line) => log.push(line),
        cacheDir: tempDir(),
      });
      expect(run.results).toMatchObject([{ tag: 'CHL_overview', outcome: 'written' }]);

      // The task gives the notes and the country part as drafted, in the submission's shape.
      const prompt = JSON.stringify(client.requests[0]);
      expect(prompt).toContain(NOTES);
      expect(prompt).toContain(
        JSON.stringify(
          JSON.stringify(
            {
              country: toDraftCountry(original.country),
              sources: toDraftSources(original.country.sources),
            },
            null,
            2,
          ),
        ).slice(1, -1),
      );
      expect(prompt).toContain('submit_overview');

      const after = readFileSync(file, 'utf8');
      const revised = readCountryFile(contentDir, 'chile')!;
      expect(revised.country.overview.summary).toBe(revisedOverview().country.overview.summary);
      expect(revised.country.sources.map((source) => source.id)).toEqual([
        'fixture-overview',
        'fixture-geography',
        'fixture-economy',
        'fixture-history-report',
      ]);
      expect(revised.country.provenance).toEqual({
        generatedBy: 'claude-opus-5-5',
        generatedAt: RUN_DATE,
        promptVersion: 'v3',
        status: 'draft',
      });
      const storiesBlock = (text: string) => text.slice(text.indexOf('"stories"'));
      expect(storiesBlock(after)).toBe(storiesBlock(before));

      // Nothing is sent back any more, so a second run skips the job.
      const again = await generate({
        client,
        context: runContext(contentDir),
        jobs: [{ kind: 'overview', countryId: 'CHL' }],
        mode: 'sync',
        regenerate: false,
        force: false,
        resume: false,
        log: (line) => log.push(line),
        cacheDir: tempDir(),
      });
      expect(again.results).toMatchObject([
        { outcome: 'skipped', detail: 'no overview revision requested' },
      ]);
    },
    REDRAFT_TIMEOUT_MS,
  );

  it('refuses a submission that does not match what was sent back', () => {
    const { contentDir, review } = chileTree();
    requestRevision({ ...review, country: 'CHL', storyId: 'andes', notes: 'Shorter.' });
    const existing = readCountryFile(contentDir, 'chile')!;
    const draft = CountryDraft.parse(chileDraft());
    const evidence = new Set(draft.sources.map((source) => source.url.replace(/^https:\/\//, '')));
    const check = (submission: Parameters<typeof checkRevisions>[3], overview: boolean) =>
      checkRevisions(
        runContext(contentDir),
        existing,
        { overview, storyIds: overview ? [] : ['andes'] },
        submission,
        {
          model: 'claude-opus-5-5',
          evidence,
        },
      );
    // The overview is not sent back, so the country part may not come with the story.
    const withCountry = check(
      {
        country: { path: 'country', country: draft.country },
        stories: [{ path: 'stories[0]', story: draft.stories[3] }],
        sources: draft.sources,
      },
      false,
    );
    expect(withCountry).toMatchObject({ ok: false });
    expect(!withCountry.ok && withCountry.issues).toContain(
      'country: the overview is not sent back, so leave the country part out',
    );
    // An overview revision needs the country part, and takes no story.
    const withoutCountry = check(
      { stories: [{ path: 'stories[0]', story: draft.stories[3] }], sources: draft.sources },
      true,
    );
    expect(!withoutCountry.ok && withoutCountry.issues).toEqual([
      'country: the overview is sent back; revise it and submit the country part',
      'stories[0]: no story is sent back, so leave the stories out',
    ]);
  });

  it('refuses a part submitted as drafted, whatever its provenance or source order', () => {
    const { contentDir, review } = chileTree();
    requestRevision({ ...review, country: 'CHL', overview: true, notes: NOTES });
    requestRevision({ ...review, country: 'CHL', storyId: 'andes', notes: 'Shorter.' });
    const existing = readCountryFile(contentDir, 'chile')!;
    const andes = existing.stories.find((story) => story.id === 'andes')!;
    const sources = toDraftSources([...existing.country.sources, ...andes.sources]).reverse();
    const evidence = new Set(sources.map((source) => source.url.replace(/^https:\/\//, '')));
    const result = checkRevisions(
      runContext(contentDir),
      existing,
      { overview: true, storyIds: ['andes'] },
      {
        country: { path: 'country', country: toDraftCountry(existing.country) },
        stories: [{ path: 'stories[0]', story: toDraftStory(andes) }],
        sources,
      },
      { model: 'claude-opus-5-5', evidence },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues).toEqual(
      expect.arrayContaining([
        "country: the country part is the same as drafted, so the editor's notes on the overview are not addressed; revise it as the notes ask",
        `stories[0]: "andes" is the same as drafted, so the editor's notes on it are not addressed; revise it as the notes ask`,
      ]),
    );
  });
});
