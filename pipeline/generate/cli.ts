// npm run content:generate -- --batch pilot | --country CHL [--country EGY] | --revisions
// See docs/architecture.md#content-pipeline for the workflow and every option.
import { parseArgsOnce } from '../cli-args';
import { findPendingReferences } from '../../src/content/validate';
import {
  DEFAULT_CONTENT_DIR,
  DEFAULT_EFFORT,
  DEFAULT_LIMITS,
  DEFAULT_MODEL,
  STORIES_PER_COUNTRY,
  loadLocalEnv,
  today,
  type Effort,
} from '../config';
import { landIndex, parsedCountryFiles, requireMapCountry } from '../content-tree';
import { loadPrompts } from '../prompts';
import {
  AnthropicModelClient,
  RecordingClient,
  ReplayClient,
  type ModelClient,
} from './model-client';
import { allPlans, generatePlan, readBatch, readPlan, writePlan } from './plan';
import { generate, type Job } from './run';
import { renderLinkTargets, type RunContext } from './tasks';
import { formatUsage } from './usage';

const USAGE = `Usage: npm run content:generate -- <what> [options]

What to draft (one of):
  --batch <id>          every country in pipeline/batches/<id>.json; plans questions first
  --country <id>        one country by map ID, e.g. CHL (repeatable)
  --revisions           every country or story that review sent back

Options:
  --plan-only           with --batch: write the question plan and stop, for review
  --replan              with --batch: plan again even if a plan file exists
  --mode sync|batch     one request at a time (default), or rounds through the Batches API at half price
  --resume              continue an interrupted batch-mode run; with --mode sync, collect the
                        round in flight, then finish one request at a time
  --regenerate          replace existing drafts
  --force               replace files that contain reviewed content
  --model <id>          default ${DEFAULT_MODEL}
  --effort <level>      low | medium | high | xhigh | max (default ${DEFAULT_EFFORT})
  --no-fallback         do not retry refusals on the server's fallback model
  --content-dir <dir>   default ${DEFAULT_CONTENT_DIR}
  --record <dir>        save every response, to replay later
  --replay <dir>        replay recorded responses instead of calling the API
`;

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

function revisionJobs(contentDir: string): Job[] {
  const jobs: Job[] = [];
  for (const file of parsedCountryFiles(contentDir).values()) {
    if (file.country.provenance.revision) {
      jobs.push({ kind: 'country', countryId: file.country.id });
      continue;
    }
    for (const story of file.stories) {
      if (story.provenance.revision) {
        jobs.push({ kind: 'story', countryId: file.country.id, storyId: story.id });
      }
    }
  }
  return jobs;
}

async function main(): Promise<number> {
  const { values } = parseArgsOnce({
    options: {
      batch: { type: 'string' },
      country: { type: 'string', multiple: true },
      revisions: { type: 'boolean', default: false },
      'plan-only': { type: 'boolean', default: false },
      replan: { type: 'boolean', default: false },
      mode: { type: 'string' },
      resume: { type: 'boolean', default: false },
      regenerate: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      model: { type: 'string', default: DEFAULT_MODEL },
      effort: { type: 'string', default: DEFAULT_EFFORT },
      'no-fallback': { type: 'boolean', default: false },
      'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
      record: { type: 'string' },
      replay: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const targets = [values.batch, values.country, values.revisions || undefined].filter(Boolean);
  if (values.help || (targets.length !== 1 && !values.resume)) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  // A resumed run continues in batch mode unless --mode sync is given.
  const mode = values.mode ?? (values.resume ? 'batch' : 'sync');
  if (mode !== 'sync' && mode !== 'batch') throw new Error('--mode is sync or batch');
  if (!EFFORTS.has(values.effort)) throw new Error(`Unknown effort "${values.effort}"`);

  loadLocalEnv();
  // Fail fast on a missing key, before any planning or file work.
  let client: ModelClient = values.replay
    ? new ReplayClient(values.replay)
    : new AnthropicModelClient({ fallbacks: !values['no-fallback'] });
  if (values.record) client = new RecordingClient(client, values.record);

  const contentDir = values['content-dir'];
  const prompts = loadPrompts();
  const date = today();
  const model = values.model;
  const effort = values.effort as Effort;
  let jobs: Job[] = [];
  let storyCount = STORIES_PER_COUNTRY;

  if (values.batch) {
    const batch = readBatch(values.batch);
    storyCount = batch.stories;
    if (!readPlan(batch.id) || values.replan) {
      console.log(
        `Planning questions for ${batch.countries.length} countries (${client.description}).`,
      );
      const { plan, usage } = await generatePlan({
        client,
        batch,
        prompts,
        model,
        effort,
        contentDir,
        date,
      });
      console.log(`Wrote ${writePlan(plan)}: ${formatUsage(usage, model)}`);
    }
    if (values['plan-only']) return 0;
    jobs = batch.countries.map(({ id }) => ({ kind: 'country', countryId: id }));
  } else if (values.country) {
    jobs = values.country.map((id) => ({ kind: 'country', countryId: requireMapCountry(id).id }));
  } else if (values.revisions) {
    jobs = revisionJobs(contentDir);
    if (!jobs.length) console.log('No revision requests.');
  }

  const plan = allPlans();
  const context: RunContext = {
    contentDir,
    prompts,
    model,
    effort,
    limits: DEFAULT_LIMITS,
    // A resumed batch run keeps the hour-long cache its conversations were written with.
    cacheTtl: mode === 'batch' || values.resume ? '1h' : '5m',
    date,
    plan,
    linkTargets: renderLinkTargets(contentDir, plan),
    storyCount,
    land: landIndex(),
  };
  const { results, usage } = await generate({
    client,
    context,
    jobs,
    mode,
    regenerate: values.regenerate,
    force: values.force,
    resume: values.resume,
    log: (line) => console.log(line),
  });

  const count = (outcome: string) => results.filter((result) => result.outcome === outcome).length;
  console.log(
    `\n${count('written')} written, ${count('skipped')} skipped, ${count('failed')} failed. ${formatUsage(usage, model)}`,
  );
  const pending = findPendingReferences([...parsedCountryFiles(contentDir).values()]);
  if (pending.length) {
    console.log(`${pending.length} pending references (resolve when their countries are drafted):`);
    for (const ref of pending) {
      console.log(
        `  ${ref.from.countryId}/${ref.from.storyId} -> ${ref.to.countryId}/${ref.to.storyId}`,
      );
    }
  }
  if (count('written')) {
    console.log(
      'Next: npm run content:verify, npm run content:paraphrase -- --all for search phrasings, then npm run content:review.',
    );
  }
  return count('failed') ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
