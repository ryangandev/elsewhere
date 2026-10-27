// The paraphrase step on replayed responses: what it asks for, how it repairs, what it writes,
// and what it leaves alone. No network and no API key.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CountryFile } from '../../src/content/schema';
import { validateContent } from '../../src/content/validate';
import {
  contentInput,
  landIndex,
  readCountryFile,
  writeCountryFile,
  writeJson,
} from '../../pipeline/content-tree';
import { ReplayClient } from '../../pipeline/generate/model-client';
import { sharedSystem, storySession } from '../../pipeline/generate/tasks';
import {
  paraphraseCountry,
  paraphraseJobs,
  runParaphrase,
} from '../../pipeline/paraphrase/paraphrase';
import { loadParaphrasePrompts } from '../../pipeline/prompts';
import { REPLAY_DIR } from './fixtures/build-replay';
import { RUN_DATE, runContext, tempContentTree, tempDir } from './helpers';

const options = (contentDir: string, client: ReplayClient) => ({
  client,
  contentDir,
  prompts: loadParaphrasePrompts(),
  model: 'claude-opus-5-5',
  effort: 'low' as const,
  date: RUN_DATE,
});

const singapore = (contentDir: string) => readCountryFile(contentDir, 'singapore')!;

/** A content tree with no paraphrases anywhere, whatever content/en holds. */
function treeWithoutParaphrases(): string {
  const contentDir = tempContentTree();
  for (const slug of ['singapore', 'japan']) {
    const file = readCountryFile(contentDir, slug)!;
    writeCountryFile(contentDir, {
      ...file,
      // writeJson drops undefined fields, as JSON.stringify does.
      stories: file.stories.map((story) => ({ ...story, paraphrases: undefined })),
    });
  }
  return contentDir;
}

describe('paraphrase jobs', () => {
  it('cover stories without paraphrases, or whose question changed', () => {
    const contentDir = treeWithoutParaphrases();
    expect(paraphraseJobs(contentDir, { countryIds: ['SGP'] })).toEqual([
      { countryId: 'SGP', slug: 'singapore', storyIds: ['wealth', 'shipping', 'identity'] },
    ]);

    const file = singapore(contentDir);
    const stamp = { generatedBy: 'human', generatedAt: RUN_DATE };
    writeCountryFile(contentDir, {
      ...file,
      stories: file.stories.map((story) => ({
        ...story,
        paraphrases: {
          // The wealth story's question has changed since its paraphrases were written.
          question: story.id === 'wealth' ? 'Why is Singapore rich?' : story.question,
          phrasings: ['One?', 'Two?', 'Three?'],
          ...stamp,
        },
      })),
    });
    expect(paraphraseJobs(contentDir, { countryIds: ['SGP'] })).toEqual([
      { countryId: 'SGP', slug: 'singapore', storyIds: ['wealth'] },
    ]);
    expect(
      paraphraseJobs(contentDir, { countryIds: ['SGP'], regenerate: true })[0].storyIds,
    ).toEqual(['wealth', 'shipping', 'identity']);
    // --all leaves out countries with nothing to do.
    expect(
      paraphraseJobs(contentDir, {}).some(
        (job) => job.countryId === 'SGP' && job.storyIds.length > 1,
      ),
    ).toBe(false);
    expect(() => paraphraseJobs(contentDir, { countryIds: ['CHL'] })).toThrow(/CHL/);
  });
});

describe('the paraphrase step', () => {
  it('asks once per country, repairs what fails the rules, and writes only paraphrases', async () => {
    const contentDir = treeWithoutParaphrases();
    const before = singapore(contentDir);
    const client = new ReplayClient(REPLAY_DIR);
    const [job] = paraphraseJobs(contentDir, { countryIds: ['SGP'] });

    const result = await paraphraseCountry(job, options(contentDir, client));
    expect(result).toMatchObject({
      outcome: 'written',
      storyIds: ['wealth', 'shipping', 'identity'],
    });
    expect(result.usage.requests).toBe(2);

    // One small structured request: the task lists the stories, the schema allows only their IDs.
    const [first, repair] = client.requests;
    expect(first.tag).toBe('paraphrase-SGP');
    expect(first.request.output_config?.effort).toBe('low');
    const format = JSON.stringify(first.request.output_config?.format);
    expect(format).toContain('"enum":["wealth","shipping","identity"]');
    expect(JSON.stringify(first.request.messages)).toContain(
      'Question: How did a tiny island become so wealthy?',
    );
    expect(first.request.tools).toBeUndefined();

    // The repair names both problems and keeps the first answer, thinking included.
    const feedback = JSON.stringify(repair.request.messages.at(-1));
    expect(feedback).toContain(
      'wealth: \\"How did a tiny island become so wealthy?\\" repeats the question',
    );
    expect(feedback).toContain('shipping: missing');
    expect(repair.request.messages.at(-2)?.role).toBe('assistant');

    const after = singapore(contentDir);
    after.stories.forEach((story, index) => {
      const { paraphrases, ...rest } = story;
      // Everything but the paraphrases is untouched, review status included.
      expect(rest).toEqual(before.stories[index]);
      expect(paraphrases).toMatchObject({
        question: story.question,
        generatedBy: 'claude-opus-5-5',
        generatedAt: RUN_DATE,
        promptVersion: 'paraphrase/v1',
      });
      expect(paraphrases?.phrasings).toHaveLength(5);
    });
    expect(after.stories.every((story) => story.provenance.status === 'reviewed')).toBe(true);
    expect(after.country).toEqual(before.country);
    expect(validateContent({ ...contentInput(contentDir), land: landIndex() })).toEqual([]);

    // Nothing left to do for Singapore.
    expect(paraphraseJobs(contentDir, { countryIds: ['SGP'] })).toEqual([]);
  });

  it('gives up after its repairs and leaves the file as it was', async () => {
    const contentDir = treeWithoutParaphrases();
    const before = singapore(contentDir);
    const replay = tempDir();
    const tag = join(replay, 'paraphrase-SGP');
    mkdirSync(tag);
    for (const turn of [1, 2, 3]) {
      writeJson(join(tag, `00${turn}.json`), {
        id: `msg_${turn}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: '{"stories": []}', citations: null }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 10 },
      });
    }
    const jobs = paraphraseJobs(contentDir, { countryIds: ['SGP'] });
    const lines: string[] = [];
    const { results, usage } = await runParaphrase(jobs, {
      ...options(contentDir, new ReplayClient(replay)),
      log: (line) => lines.push(line),
    });
    expect(results).toMatchObject([{ countryId: 'SGP', outcome: 'failed' }]);
    expect(usage.requests).toBe(3);
    expect(lines[0]).toMatch(/^SGP: failed, still invalid after 2 repairs: wealth: missing/);
    expect(singapore(contentDir)).toEqual(before);
  });

  it('reports a request that fails without stopping the other countries', async () => {
    const contentDir = treeWithoutParaphrases();
    const jobs = paraphraseJobs(contentDir, { countryIds: ['JPN', 'SGP'] });
    const { results } = await runParaphrase(jobs, {
      ...options(contentDir, new ReplayClient(REPLAY_DIR)),
      concurrency: 1,
    });
    expect(results.map((result) => [result.countryId, result.outcome])).toEqual([
      ['JPN', 'failed'],
      ['SGP', 'written'],
    ]);
  });
});

describe('drafting prompts', () => {
  it('never show paraphrases, so drafts do not imitate them', () => {
    const contentDir = tempContentTree();
    const system = JSON.stringify(sharedSystem(runContext(contentDir)));
    expect(system).not.toContain('paraphrases');

    // A story sent back for revision is shown to the model without its paraphrases too.
    const file: CountryFile = singapore(contentDir);
    const story = file.stories[0];
    writeCountryFile(contentDir, {
      ...file,
      stories: [
        {
          ...story,
          paraphrases: {
            question: story.question,
            phrasings: ['One?', 'Two?', 'Three?'],
            generatedBy: 'human',
            generatedAt: RUN_DATE,
          },
          provenance: {
            generatedBy: 'human',
            generatedAt: RUN_DATE,
            status: 'draft',
            revision: { notes: 'Shorter.', requestedBy: 'Ryan', requestedAt: RUN_DATE },
          },
        },
        ...file.stories.slice(1),
      ],
    });
    const session = storySession(runContext(contentDir), singapore(contentDir), story.id);
    expect(JSON.stringify(session.task)).not.toContain('paraphrases');
  });
});
