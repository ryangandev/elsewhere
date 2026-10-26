// Batches and their question plans. Before drafting a batch, one request plans the questions for
// every country in it. Drafts keep the planned story IDs, so a story can link to a planned story
// in a country that has not been drafted yet, and the link resolves once that country is drafted.
// The plan is written next to the batch file so Ryan can read and edit it before drafting.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages';
import { z } from 'zod';
import { CountryId, IsoDate, Slug, StoryId } from '../../src/content/schema';
import { BATCHES_DIR, type Effort } from '../config';
import { parsedCountryFiles, readJson, requireMapCountry, writeJson } from '../content-tree';
import { render, type PromptSet } from '../prompts';
import type { Plan } from './check';
import { BatchPlan, toStrictJsonSchema } from './draft-schema';
import type { ModelClient } from './model-client';
import { addUsage, emptyUsage, type Usage } from './usage';

const Text = z.string().trim().min(1);

/** pipeline/batches/<id>.json */
export const BatchFile = z.strictObject({
  id: Slug,
  description: Text,
  /** Why these countries: the selection rationale, kept with the list. */
  selection: z.array(Text).min(1),
  stories: z.strictObject({ min: z.number().int().min(1), max: z.number().int().min(1) }),
  countries: z.array(z.strictObject({ id: CountryId, why: Text })).min(1),
});
export type BatchFile = z.infer<typeof BatchFile>;

/** pipeline/batches/<id>.plan.json */
export const PlanFile = z.strictObject({
  batch: Slug,
  generatedBy: Text,
  generatedAt: IsoDate,
  promptVersion: Text,
  countries: z.array(
    z.strictObject({
      countryId: CountryId,
      stories: z.array(
        z.strictObject({ id: StoryId, question: Text, angle: z.enum(['common', 'unexpected']) }),
      ),
    }),
  ),
});
export type PlanFile = z.infer<typeof PlanFile>;

export const batchFilePath = (id: string) => join(BATCHES_DIR, `${id}.json`);
export const planFilePath = (id: string) => join(BATCHES_DIR, `${id}.plan.json`);

export function readBatch(id: string): BatchFile {
  const file = batchFilePath(id);
  if (!existsSync(file)) throw new Error(`No batch file ${file}`);
  const batch = BatchFile.parse(readJson(file));
  for (const country of batch.countries) requireMapCountry(country.id);
  return batch;
}

export function readPlan(id: string): PlanFile | undefined {
  const file = planFilePath(id);
  return existsSync(file) ? PlanFile.parse(readJson(file)) : undefined;
}

export function planMap(plan: PlanFile | undefined): Plan {
  return new Map(
    (plan?.countries ?? []).map(({ countryId, stories }) => [
      countryId,
      stories.map(({ id, question }) => ({ id, question })),
    ]),
  );
}

/** Problems with a plan for this batch; empty when it can be used. */
export function checkPlan(
  plan: BatchPlan | PlanFile,
  batch: BatchFile,
  contentDir: string,
): string[] {
  const issues: string[] = [];
  const existing = parsedCountryFiles(contentDir);
  const planned = new Map(plan.countries.map((entry) => [entry.countryId, entry]));
  for (const { id } of batch.countries) {
    const entry = planned.get(id);
    if (!entry) {
      issues.push(`countries: plan ${id}`);
      continue;
    }
    const { min, max } = batch.stories;
    if (entry.stories.length < min || entry.stories.length > max) {
      issues.push(`${id}: plan ${min} to ${max} questions, not ${entry.stories.length}`);
    }
    const ids = entry.stories.map((story) => story.id);
    for (const storyId of ids) {
      if (!Slug.safeParse(storyId).success) {
        issues.push(`${id}/${storyId}: story IDs are lowercase, hyphenated slugs`);
      }
    }
    for (const storyId of new Set(ids.filter((storyId, index) => ids.indexOf(storyId) !== index))) {
      issues.push(`${id}: story ID "${storyId}" is used twice`);
    }
    if (!entry.stories.some((story) => story.angle === 'unexpected')) {
      issues.push(`${id}: include at least one unexpected question`);
    }
    const questions = new Set(
      (existing.get(id)?.stories ?? []).map((story) => story.question.toLowerCase()),
    );
    for (const story of entry.stories) {
      if (questions.has(story.question.toLowerCase())) {
        issues.push(`${id}/${story.id}: an existing story already asks "${story.question}"`);
      }
    }
  }
  for (const countryId of planned.keys()) {
    if (!batch.countries.some((country) => country.id === countryId)) {
      issues.push(`countries: ${countryId} is not in the batch`);
    }
  }
  return issues;
}

function planRequestText(batch: BatchFile, contentDir: string): string {
  const existing = [...parsedCountryFiles(contentDir).values()];
  return [
    `# Batch "${batch.id}"`,
    batch.description,
    '## Countries, in order',
    ...batch.countries.map(({ id, why }) => {
      const country = requireMapCountry(id);
      return `- ${id}: ${country.name} (${country.region}). ${why}`;
    }),
    '## Existing stories',
    'These are already answered. Do not repeat them; questions that connect to them are welcome.',
    ...existing.flatMap((file) =>
      file.stories.map((story) => `- ${story.countryId}/${story.id}: ${story.question}`),
    ),
  ].join('\n');
}

export type PlanResult = { plan: PlanFile; usage: Usage };

const MAX_PLAN_REPAIRS = 2;

/** Ask the model for a question plan, with a bounded repair loop on validation problems. */
export async function generatePlan(options: {
  client: ModelClient;
  batch: BatchFile;
  prompts: PromptSet;
  model: string;
  effort: Effort;
  contentDir: string;
  date: string;
}): Promise<PlanResult> {
  const { client, batch, prompts } = options;
  const usage = emptyUsage();
  const messages: BetaMessageParam[] = [
    { role: 'user', content: planRequestText(batch, options.contentDir) },
  ];
  let issues: string[] = [];
  for (let attempt = 0; attempt <= MAX_PLAN_REPAIRS; attempt += 1) {
    const message = await client.create({
      tag: `plan-${batch.id}`,
      request: {
        model: options.model,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: options.effort,
          format: { type: 'json_schema', schema: toStrictJsonSchema(BatchPlan) },
        },
        system: render(prompts.plan, {
          storiesMin: batch.stories.min,
          storiesMax: batch.stories.max,
        }),
        messages,
      },
    });
    addUsage(usage, message.usage, false);
    if (message.stop_reason !== 'end_turn') {
      throw new Error(`Planning stopped with "${message.stop_reason}"`);
    }
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    let parsed: BatchPlan | undefined;
    try {
      const result = BatchPlan.safeParse(JSON.parse(text));
      if (result.success) parsed = result.data;
      else issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    } catch {
      issues = ['The response was not valid JSON.'];
    }
    if (parsed) issues = checkPlan(parsed, batch, options.contentDir);
    if (parsed && !issues.length) {
      return {
        usage,
        plan: {
          batch: batch.id,
          generatedBy: message.model,
          generatedAt: options.date,
          promptVersion: prompts.version,
          countries: batch.countries.map(({ id }) =>
            parsed.countries.find((entry) => entry.countryId === id)!,
          ),
        },
      };
    }
    messages.push(
      { role: 'assistant', content: message.content },
      {
        role: 'user',
        content: render(prompts['plan-repair'], {
          issues: issues.map((issue) => `- ${issue}`).join('\n'),
        }),
      },
    );
  }
  throw new Error(
    `The plan is still invalid after ${MAX_PLAN_REPAIRS} repairs:\n  ${issues.join('\n  ')}`,
  );
}

export function writePlan(plan: PlanFile): string {
  const file = planFilePath(plan.batch);
  writeJson(file, plan);
  return file;
}
