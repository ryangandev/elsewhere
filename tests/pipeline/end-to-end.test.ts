// The whole pipeline on recorded responses: plan a batch, draft a country, verify it, check its
// claims, review it, send a story back, redraft it through the batch runner, and review again.
// No network, no key.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages';
import { describe, expect, it } from 'vitest';
import { findPendingReferences } from '../../src/content/validate';
import { checkClaims, claimsJobs } from '../../pipeline/claims/run';
import { claimsFilePath, defaultClaimsDir, readClaims } from '../../pipeline/claims/store';
import { CLAIM_LIMITS } from '../../pipeline/config';
import { parsedCountryFiles, readCountryFile } from '../../pipeline/content-tree';
import { ReplayClient } from '../../pipeline/generate/model-client';
import { BatchFile, generatePlan, planMap } from '../../pipeline/generate/plan';
import { generate } from '../../pipeline/generate/run';
import { CURRENT_PROMPT_VERSION, loadClaimsPrompts, loadPrompts } from '../../pipeline/prompts';
import { approve, fileReport, requestRevision } from '../../pipeline/review/actions';
import { countrySummary } from '../../pipeline/review/summary';
import { verifyContent } from '../../pipeline/validate/verify';
import { FIXTURE_BATCH, REPLAY_DIR } from './fixtures/build-replay';
import { RUN_DATE, runContext, tempContentTree, tempDir } from './helpers';

const okFetch = (async () => new Response(null, { status: 200 })) as typeof fetch;

const lastTurn = (messages: BetaMessageParam[]) => JSON.stringify(messages.at(-1)?.content);

// The whole pipeline builds land geometry and checks every route several times: about 2.5s on a
// laptop and three times that on a CI runner, past Vitest's 5s default.
const PIPELINE_TIMEOUT_MS = 30_000;

describe('content pipeline, end to end on replayed responses', () => {
  it(
    'plans, drafts, verifies, reviews and redrafts',
    async () => {
      const contentDir = tempContentTree();
      const cacheDir = tempDir();
      const urlOptions = { cacheFile: join(cacheDir, 'url-status.json'), fetch: okFetch };
      // Claim results are kept with the content, in the tree's claims/ directory.
      const claimsDir = defaultClaimsDir(contentDir);
      const client = new ReplayClient(REPLAY_DIR);
      const log: string[] = [];

      // 1. Plan the batch.
      const { plan } = await generatePlan({
        client,
        batch: BatchFile.parse(FIXTURE_BATCH),
        prompts: loadPrompts(),
        model: 'claude-opus-5-5',
        effort: 'high',
        contentDir,
        date: RUN_DATE,
      });
      expect(plan.countries.map((entry) => entry.countryId)).toEqual(['CHL', 'ARG']);
      const context = runContext(contentDir, planMap(plan));
      expect(context.linkTargets).toContain(
        'ARG/patagonia: Fixture question about patagonia? (planned)',
      );

      // 2. Draft Chile: research, a paused turn, a gazetteer lookup, a rejected and a fixed submission.
      const drafted = await generate({
        client,
        context,
        jobs: [{ kind: 'country', countryId: 'CHL' }],
        mode: 'sync',
        regenerate: false,
        force: false,
        resume: false,
        log: (line) => log.push(line),
        cacheDir,
      });
      expect(drafted.results.map((result) => result.outcome)).toEqual(['written']);
      expect(drafted.usage).toMatchObject({ requests: 4, webSearches: 2 });

      const requests = client.requests.filter((request) => request.tag === 'CHL');
      expect(requests).toHaveLength(4);
      expect(requests[0].request.tools?.map((tool) => (tool as { name: string }).name)).toEqual([
        'web_search',
        'web_fetch',
        'find_places',
        'submit_draft',
      ]);
      // After pause_turn the conversation is resent unchanged.
      expect(requests[1].request.messages.at(-1)?.role).toBe('assistant');
      expect(lastTurn(requests[2].request.messages)).toContain('drake-passage | Drake Passage');
      const repair = lastTurn(requests[3].request.messages);
      expect(repair).toContain('Unknown gazetteer place \\"valparaiso\\"');
      expect(repair).toContain('was not retrieved in this task');

      const chile = readCountryFile(contentDir, 'chile')!;
      expect(chile.country.provenance).toEqual({
        generatedBy: 'claude-opus-5-5',
        generatedAt: RUN_DATE,
        promptVersion: CURRENT_PROMPT_VERSION,
        status: 'draft',
      });
      expect(chile.stories.map((story) => story.id)).toEqual([
        'length',
        'desert',
        'copper',
        'andes',
      ]);
      expect(chile.country.sources.map((source) => source.id)).toEqual([
        'fixture-overview',
        'fixture-geography',
        'fixture-economy',
        'fixture-history',
      ]);
      expect(chile.stories[2].sources.map((source) => source.id)).toEqual(['fixture-economy']);
      for (const source of [
        ...chile.country.sources,
        ...chile.stories.flatMap((story) => story.sources),
      ]) {
        expect(source.accessedAt).toBe(RUN_DATE);
      }

      // 3. Verify: every content rule plus source URLs (fetch mocked).
      const verified = await verifyContent({
        contentDir,
        offline: false,
        countryIds: ['CHL'],
        urlOptions,
      });
      expect(verified.issues).toEqual([]);
      expect(verified.pending).toEqual([]);
      expect(verified.urls.map(({ status }) => status?.state)).toEqual(['ok', 'ok', 'ok', 'ok']);

      // 4. Check the claims of the overview and one story against their sources.
      const review = { contentDir, by: 'Tester', date: RUN_DATE, urlOptions };
      expect(() => approve({ ...review, country: 'CHL' })).toThrow(
        /CHL Quick fact "Capital": not claim-checked[\s\S]*npm run content:claims -- CHL/,
      );
      const claimed = await checkClaims({
        client,
        context: {
          prompts: loadClaimsPrompts(),
          model: 'claude-opus-5-5',
          effort: 'high',
          limits: CLAIM_LIMITS,
          cacheTtl: '5m',
          date: RUN_DATE,
          fetchPage: async () => 'Placeholder text about the geography page.',
        },
        jobs: claimsJobs(chile, {}, claimsDir).map((job) => ({
          ...job,
          scopes: job.scopes.filter(
            (scope) => scope.kind === 'overview' || scope.storyId === 'length',
          ),
        })),
        mode: 'sync',
        claimsDir,
        log: (line) => log.push(line),
      });
      expect(claimed.results.map((result) => result.outcome)).toEqual(['checked']);
      expect(existsSync(claimsFilePath(join(contentDir, 'claims'), 'chile'))).toBe(true);
      // Content discovery and validation ignore the claims directory.
      expect(parsedCountryFiles(contentDir).has('CHL')).toBe(true);
      const overviewSummary = countrySummary(chile, {
        files: parsedCountryFiles(contentDir),
        ...fileReport(contentDir, chile, urlOptions),
      });
      expect(overviewSummary).toContain(
        '  - Capital: Fixture value [fixture-overview]\n      claim check: NOT SUPPORTED',
      );
      expect(overviewSummary).toContain(
        '## Claim check\n  5 supported, 0 partly supported, 1 not supported, 1 source unreachable, 6 not checked\n  - CHL Why it matters "Fixture point two": source unreachable',
      );

      // 5. Review: flagged claims block the overview until the reviewer accepts them; approve a
      // story whose claims are all supported, and send another back.
      expect(() => approve({ ...review, country: 'CHL' })).toThrow(
        /CHL Quick fact "Capital": not supported: "Capital: Fixture value"[\s\S]*--accept-claims/,
      );
      expect(
        approve({ ...review, country: 'CHL', acceptClaims: 'Checked the fixture pages.' }),
      ).toMatchObject({ approved: ['CHL'], acceptedClaims: 2 });
      expect(
        Object.values(readClaims(claimsDir, chile.country).checks)
          .filter((check) => check.accepted)
          .map((check) => [check.label, check.accepted]),
      ).toEqual([
        [
          'Why it matters "Fixture point two"',
          { by: 'Tester', on: RUN_DATE, reason: 'Checked the fixture pages.' },
        ],
        [
          'Quick fact "Capital"',
          { by: 'Tester', on: RUN_DATE, reason: 'Checked the fixture pages.' },
        ],
      ]);
      expect(approve({ ...review, country: 'chile', storyId: 'length' }).approved).toEqual([
        'CHL/length',
      ]);
      requestRevision({ ...review, country: 'CHL', storyId: 'andes', notes: 'Link to Argentina.' });
      expect(() => approve({ ...review, country: 'CHL', storyId: 'andes' })).toThrow(
        /Waiting for a revision: CHL\/andes/,
      );
      expect(() => requestRevision({ ...review, country: 'CHL', notes: 'Start over.' })).toThrow(
        /already reviewed/,
      );
      expect(readCountryFile(contentDir, 'chile')!.stories[3].provenance.revision).toEqual({
        notes: 'Link to Argentina.',
        requestedBy: 'Tester',
        requestedAt: RUN_DATE,
      });

      // 6. Redraft the story through the batch runner; it now links to a planned country.
      const redrafted = await generate({
        client,
        context: runContext(contentDir, planMap(plan)),
        jobs: [{ kind: 'story', countryId: 'CHL', storyId: 'andes' }],
        mode: 'batch',
        regenerate: false,
        force: false,
        resume: false,
        log: (line) => log.push(line),
        cacheDir,
      });
      expect(redrafted.results.map((result) => result.outcome)).toEqual(['written']);
      const revised = readCountryFile(contentDir, 'chile')!;
      const andes = revised.stories.find((story) => story.id === 'andes')!;
      expect(andes.provenance.revision).toBeUndefined();
      expect(andes.provenance.status).toBe('draft');
      expect(andes.next).toContainEqual({
        countryId: 'ARG',
        storyId: 'patagonia',
        reason: 'The other side of the same mountains.',
      });
      expect(revised.stories.find((story) => story.id === 'length')!.provenance.status).toBe(
        'reviewed',
      );

      // 7. The link to Argentina is pending: allowed in a draft, blocks approval, shown in review.
      const pending = findPendingReferences([...parsedCountryFiles(contentDir).values()]);
      expect(pending).toEqual([
        {
          from: { countryId: 'CHL', storyId: 'andes' },
          to: { countryId: 'ARG', storyId: 'patagonia' },
          reason: 'The other side of the same mountains.',
        },
      ]);
      expect(() => approve({ ...review, country: 'CHL', storyId: 'andes' })).toThrow(
        /next question ARG\/patagonia is pending/,
      );
      const summary = countrySummary(
        revised,
        {
          files: parsedCountryFiles(contentDir),
          ...fileReport(contentDir, revised, urlOptions),
        },
        'andes',
      );
      expect(summary).toContain('-> ARG/patagonia (pending: country not drafted yet)');
      expect(summary).toContain('andes: next question ARG/patagonia is pending');
      const offline = await verifyContent({ contentDir, offline: true, urlOptions });
      expect(offline.issues).toEqual([]);
      expect(offline.pending).toHaveLength(1);

      // 8. Reviewed content is never overwritten without --force.
      const again = await generate({
        client,
        context: runContext(contentDir, planMap(plan)),
        jobs: [{ kind: 'country', countryId: 'CHL' }],
        mode: 'sync',
        regenerate: true,
        force: false,
        resume: false,
        log: (line) => log.push(line),
        cacheDir,
      });
      expect(again.results).toMatchObject([{ outcome: 'skipped', detail: /reviewed content/ }]);
    },
    PIPELINE_TIMEOUT_MS,
  );
});
