// The whole pipeline on recorded responses: plan a batch, draft a country, verify it, review it,
// send a story back, redraft it through the batch runner, and review again. No network, no key.
import { join } from 'node:path';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages';
import { describe, expect, it } from 'vitest';
import { findPendingReferences } from '../../src/content/validate';
import { parsedCountryFiles, readCountryFile } from '../../pipeline/content-tree';
import { ReplayClient } from '../../pipeline/generate/model-client';
import { BatchFile, generatePlan, planMap } from '../../pipeline/generate/plan';
import { generate } from '../../pipeline/generate/run';
import { loadPrompts } from '../../pipeline/prompts';
import { approve, fileReport, requestRevision } from '../../pipeline/review/actions';
import { countrySummary } from '../../pipeline/review/summary';
import { verifyContent } from '../../pipeline/validate/verify';
import { FIXTURE_BATCH, REPLAY_DIR } from './fixtures/build-replay';
import { RUN_DATE, runContext, tempContentTree, tempDir } from './helpers';

const okFetch = (async () => new Response(null, { status: 200 })) as typeof fetch;

const lastTurn = (messages: BetaMessageParam[]) => JSON.stringify(messages.at(-1)?.content);

describe('content pipeline, end to end on replayed responses', () => {
  it('plans, drafts, verifies, reviews and redrafts', async () => {
    const contentDir = tempContentTree();
    const cacheDir = tempDir();
    const urlOptions = { cacheFile: join(cacheDir, 'url-status.json'), fetch: okFetch };
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
      promptVersion: 'v1',
      status: 'draft',
    });
    expect(chile.stories.map((story) => story.id)).toEqual(['length', 'desert', 'copper', 'andes']);
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

    // 4. Review: approve the overview and one story, send another back.
    const review = { contentDir, by: 'Tester', date: RUN_DATE, urlOptions };
    expect(approve({ ...review, country: 'CHL' }).approved).toEqual(['CHL']);
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

    // 5. Redraft the story through the batch runner; it now links to a planned country.
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

    // 6. The link to Argentina is pending: allowed in a draft, blocks approval, shown in review.
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
      { files: parsedCountryFiles(contentDir), ...fileReport(contentDir, revised, urlOptions) },
      'andes',
    );
    expect(summary).toContain('-> ARG/patagonia (pending: country not drafted yet)');
    expect(summary).toContain('andes: next question ARG/patagonia is pending');
    const offline = await verifyContent({ contentDir, offline: true, urlOptions });
    expect(offline.issues).toEqual([]);
    expect(offline.pending).toHaveLength(1);

    // 7. Reviewed content is never overwritten without --force.
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
  });
});
