// The paraphrase step: other ways a reader might type each story's question, for search.
// One small structured-output request per country fills the stories that have no paraphrases
// or whose question changed since they were written. It never touches a story's text, sources
// or review status: paraphrases restate the question and make no claims. See
// docs/architecture.md#content-pipeline.
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import type { CountryFile, Story } from '../../src/content/schema';
import { validateContent } from '../../src/content/validate';
import type { Effort } from '../config';
import {
  contentInput,
  countryFilePath,
  parsedCountryFiles,
  readCountryFile,
  writeCountryFile,
} from '../content-tree';
import { toStrictJsonSchema } from '../generate/draft-schema';
import type { ModelClient } from '../generate/model-client';
import { addUsage, emptyUsage, sumUsage, type Usage } from '../generate/usage';
import { render, type ParaphrasePromptSet } from '../prompts';

/** Phrasings asked for per story; the content schema accepts a few more or fewer. */
export const PHRASINGS_PER_STORY = 5;
const MAX_REPAIRS = 2;
/** Room for adaptive thinking plus a few dozen short lines. */
const MAX_TOKENS = 32000;

/** A story needs paraphrases when it has none, or they were written for another question. */
export function needsParaphrases(story: Story): boolean {
  return story.paraphrases?.question !== story.question;
}

export type ParaphraseJob = { countryId: string; slug: string; storyIds: string[] };

/**
 * What to paraphrase in a content tree: the given countries (or every country file), each with
 * the stories that need it, or all of its stories with `regenerate`. Countries with nothing to
 * do are left out.
 */
export function paraphraseJobs(
  contentDir: string,
  options: { countryIds?: string[]; regenerate?: boolean },
): ParaphraseJob[] {
  const files = parsedCountryFiles(contentDir);
  const ids = options.countryIds ?? [...files.keys()];
  return ids.flatMap((countryId) => {
    const file = files.get(countryId);
    if (!file) throw new Error(`No valid content file for ${countryId}`);
    const storyIds = file.stories
      .filter((story) => options.regenerate || needsParaphrases(story))
      .map((story) => story.id);
    return storyIds.length ? [{ countryId, slug: file.country.slug, storyIds }] : [];
  });
}

/** What the model returns: phrasings by story ID, limited to the stories asked for. */
function responseSchema(storyIds: string[]) {
  return z.strictObject({
    stories: z.array(
      z.strictObject({
        id: z.enum(storyIds as [string, ...string[]]),
        phrasings: z
          .array(z.string().trim().min(1))
          .describe(`${PHRASINGS_PER_STORY} other ways a reader would type the question.`),
      }),
    ),
  });
}

function taskText(prompts: ParaphrasePromptSet, file: CountryFile, storyIds: string[]): string {
  const { country } = file;
  const targets = file.stories.filter((story) => storyIds.includes(story.id));
  const others = file.stories.filter((story) => !storyIds.includes(story.id));
  return render(prompts.task, {
    countryName: country.name,
    countryId: country.id,
    stories: targets
      .map((story) =>
        [
          `## ${story.id}`,
          `Question: ${story.question}`,
          `Category: ${story.category}`,
          `Summary: ${story.summary}`,
        ].join('\n'),
      )
      .join('\n\n'),
    otherStories: others.length
      ? others.map((story) => `- ${story.id}: ${story.question}`).join('\n')
      : 'None besides the stories above; keep each story apart from the others.',
  });
}

/** Non-Latin script outside proper names: the content is English only. */
const NON_LATIN = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

/**
 * The country file with the response applied, or the problems that keep it from being written:
 * a story missing from the response or answered twice, text that is not English, and every
 * content rule for paraphrases (count, length, no em dash, no repeats, not stale).
 */
export function applyPhrasings(options: {
  contentDir: string;
  file: CountryFile;
  storyIds: string[];
  response: { id: string; phrasings: string[] }[];
  stamp: { generatedBy: string; generatedAt: string; promptVersion: string };
}): { file: CountryFile; issues: string[] } {
  const { file, storyIds, response, stamp } = options;
  const issues: string[] = [];
  const byId = new Map<string, string[]>();
  for (const entry of response) {
    if (byId.has(entry.id)) issues.push(`${entry.id}: answered twice; return each story once`);
    byId.set(entry.id, entry.phrasings);
  }
  for (const id of storyIds) {
    if (!byId.has(id)) issues.push(`${id}: missing; return phrasings for it`);
  }
  for (const [id, phrasings] of byId) {
    for (const phrasing of phrasings) {
      if (NON_LATIN.test(phrasing)) issues.push(`${id}: "${phrasing}" is not in English`);
    }
  }

  const candidate: CountryFile = {
    country: file.country,
    stories: file.stories.map((story) => {
      const phrasings = byId.get(story.id);
      if (!phrasings || !storyIds.includes(story.id)) return story;
      return { ...story, paraphrases: { question: story.question, phrasings, ...stamp } };
    }),
  };
  const path = countryFilePath(options.contentDir, file.country.slug);
  for (const issue of validateContent(
    contentInput(options.contentDir, [{ file: path, data: candidate }]),
  )) {
    const match = /^stories\[(\d+)\]\.paraphrases/.exec(issue.path);
    if (issue.file !== path || !match) continue;
    const story = candidate.stories[Number(match[1])];
    if (storyIds.includes(story.id)) issues.push(`${story.id}: ${issue.message}`);
  }
  return { file: candidate, issues: [...new Set(issues)] };
}

export type ParaphraseOptions = {
  client: ModelClient;
  contentDir: string;
  prompts: ParaphrasePromptSet;
  model: string;
  effort: Effort;
  date: string;
};

export type ParaphraseResult =
  | { countryId: string; outcome: 'written'; storyIds: string[]; usage: Usage }
  | { countryId: string; outcome: 'failed'; error: string; usage: Usage };

/** Ask for phrasings for one country's stories, repair what fails the rules, and write them. */
export async function paraphraseCountry(
  job: ParaphraseJob,
  options: ParaphraseOptions,
): Promise<ParaphraseResult> {
  const { client, prompts, contentDir } = options;
  const usage = emptyUsage();
  const file = readCountryFile(contentDir, job.slug);
  if (!file) throw new Error(`No content file for ${job.countryId}`);
  const schema = responseSchema(job.storyIds);
  const messages: BetaMessageParam[] = [
    { role: 'user', content: taskText(prompts, file, job.storyIds) },
  ];
  let issues: string[] = [];
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt += 1) {
    const message = await client.create({
      tag: `paraphrase-${job.countryId}`,
      request: {
        model: options.model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: options.effort,
          format: { type: 'json_schema', schema: toStrictJsonSchema(schema) },
        },
        system: render(prompts.system, { count: PHRASINGS_PER_STORY }),
        messages,
      },
    });
    addUsage(usage, message.usage, false);
    if (message.stop_reason !== 'end_turn') {
      return {
        countryId: job.countryId,
        outcome: 'failed',
        error: `the response stopped with "${message.stop_reason}"`,
        usage,
      };
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      if (parsed.success) {
        const result = applyPhrasings({
          contentDir,
          file,
          storyIds: job.storyIds,
          response: parsed.data.stories,
          stamp: {
            generatedBy: message.model,
            generatedAt: options.date,
            promptVersion: prompts.version,
          },
        });
        issues = result.issues;
        if (!issues.length) {
          writeCountryFile(contentDir, result.file);
          return { countryId: job.countryId, outcome: 'written', storyIds: job.storyIds, usage };
        }
      } else {
        issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      }
    } catch {
      issues = ['The response was not valid JSON.'];
    }
    messages.push(
      { role: 'assistant', content: message.content },
      {
        role: 'user',
        content: render(prompts.repair, { issues: issues.map((issue) => `- ${issue}`).join('\n') }),
      },
    );
  }
  return {
    countryId: job.countryId,
    outcome: 'failed',
    error: `still invalid after ${MAX_REPAIRS} repairs: ${issues.join('; ')}`,
    usage,
  };
}

/** Run jobs a few at a time; each country is one small conversation and its own file. */
export async function runParaphrase(
  jobs: ParaphraseJob[],
  options: ParaphraseOptions & { concurrency?: number; log?: (line: string) => void },
): Promise<{ results: ParaphraseResult[]; usage: Usage }> {
  const results: ParaphraseResult[] = [];
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const result = await paraphraseCountry(job, options).catch(
        (error: unknown): ParaphraseResult => ({
          countryId: job.countryId,
          outcome: 'failed',
          error: error instanceof Error ? error.message : String(error),
          usage: emptyUsage(),
        }),
      );
      results.push(result);
      options.log?.(
        result.outcome === 'written'
          ? `${job.countryId}: wrote phrasings for ${result.storyIds.join(', ')}`
          : `${job.countryId}: failed, ${result.error}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
  return { results, usage: sumUsage(results.map((result) => result.usage)) };
}
