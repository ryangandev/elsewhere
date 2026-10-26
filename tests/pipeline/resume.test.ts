// An interrupted batch run resumed in sync mode: the round in flight is collected from the
// Batches API, and the rest of the conversation runs one request at a time.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ModelClient } from '../../pipeline/generate/model-client';
import { ReplayClient } from '../../pipeline/generate/model-client';
import { BatchFile, generatePlan, planMap } from '../../pipeline/generate/plan';
import { batchRunFile, generate, type Job } from '../../pipeline/generate/run';
import { loadPrompts } from '../../pipeline/prompts';
import { FIXTURE_BATCH, REPLAY_DIR } from './fixtures/build-replay';
import { RUN_DATE, runContext, tempContentTree, tempDir } from './helpers';

// Drafting builds land geometry and checks routes; see end-to-end.test.ts.
const PIPELINE_TIMEOUT_MS = 30_000;

describe('resuming a batch run', () => {
  it(
    'collects the round in flight, then finishes in sync mode',
    async () => {
      const contentDir = tempContentTree();
      const cacheDir = tempDir();
      const { plan } = await generatePlan({
        client: new ReplayClient(REPLAY_DIR),
        batch: BatchFile.parse(FIXTURE_BATCH),
        prompts: loadPrompts(),
        model: 'claude-opus-5-5',
        effort: 'high',
        contentDir,
        date: RUN_DATE,
      });
      const context = runContext(contentDir, planMap(plan));
      const jobs: Job[] = [{ kind: 'country', countryId: 'CHL' }];
      const base = { context, jobs, regenerate: false, force: false, log: () => {}, cacheDir };

      // The first run submits its round, then the process stops before the batch ends.
      const interrupted: ModelClient = {
        description: 'interrupted',
        create: () => Promise.reject(new Error('not used')),
        runBatch: async (_requests, options) => {
          options?.onSubmitted?.('msgbatch_1');
          throw new Error('process stopped');
        },
      };
      await expect(
        generate({ ...base, client: interrupted, mode: 'batch', resume: false }),
      ).rejects.toThrow('process stopped');
      expect(existsSync(batchRunFile(cacheDir))).toBe(true);

      const replay = new ReplayClient(REPLAY_DIR);
      const awaited: (string | undefined)[] = [];
      const resumed: ModelClient = {
        description: 'resumed',
        create: (request) => replay.create(request),
        runBatch: (requests, options) => {
          awaited.push(options?.resumeBatchId);
          return replay.runBatch(requests);
        },
      };

      await expect(
        generate({
          ...base,
          context: { ...context, effort: 'max' },
          client: resumed,
          mode: 'sync',
          resume: true,
        }),
      ).rejects.toThrow(/same settings/);

      const summary = await generate({ ...base, client: resumed, mode: 'sync', resume: true });
      expect(summary.results.map((result) => result.outcome)).toEqual(['written']);
      // Only the round already submitted goes through the Batches API; three turns follow in sync.
      expect(awaited).toEqual(['msgbatch_1']);
      expect(replay.requests).toHaveLength(4);
      expect(summary.usage).toMatchObject({ requests: 4 });
      expect(existsSync(batchRunFile(cacheDir))).toBe(false);
    },
    PIPELINE_TIMEOUT_MS,
  );
});
