// npm run content:paraphrase -- <country>... | --all
// See docs/architecture.md#content-pipeline for what paraphrases are and when to run this.
import { parseArgs } from 'node:util';
import { DEFAULT_CONTENT_DIR, DEFAULT_MODEL, loadLocalEnv, today, type Effort } from '../config';
import {
  AnthropicModelClient,
  RecordingClient,
  ReplayClient,
  type ModelClient,
} from '../generate/model-client';
import { formatUsage } from '../generate/usage';
import { loadParaphrasePrompts } from '../prompts';
import { resolveCountry } from '../review/actions';
import { paraphraseJobs, runParaphrase } from './paraphrase';

/** Restating a question is light work; low effort keeps the step cheap. */
const DEFAULT_PARAPHRASE_EFFORT: Effort = 'low';

const USAGE = `Usage: npm run content:paraphrase -- <country>... | --all [options]

Writes search phrasings for stories that have none or whose question changed.

  <country>             country ID (CHL) or slug (chile), one or more
  --all                 every country file
  --regenerate          replace current phrasings too
  --dry-run             list what would be written, without calling the API
  --model <id>          default ${DEFAULT_MODEL}
  --effort <level>      low | medium | high | xhigh | max (default ${DEFAULT_PARAPHRASE_EFFORT})
  --concurrency <n>     countries in flight at once (default 4)
  --no-fallback         do not retry refusals on the server's fallback model
  --content-dir <dir>   default ${DEFAULT_CONTENT_DIR}
  --record <dir>        save every response, to replay later
  --replay <dir>        replay recorded responses instead of calling the API
`;

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      regenerate: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      model: { type: 'string', default: DEFAULT_MODEL },
      effort: { type: 'string', default: DEFAULT_PARAPHRASE_EFFORT },
      concurrency: { type: 'string', default: '4' },
      'no-fallback': { type: 'boolean', default: false },
      'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
      record: { type: 'string' },
      replay: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || values.all === positionals.length > 0) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  if (!EFFORTS.has(values.effort)) throw new Error(`Unknown effort "${values.effort}"`);
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('--concurrency is a positive whole number');
  }

  const contentDir = values['content-dir'];
  const jobs = paraphraseJobs(contentDir, {
    countryIds: values.all ? undefined : positionals.map((key) => resolveCountry(key).id),
    regenerate: values.regenerate,
  });
  if (!jobs.length) {
    console.log('Every story already has phrasings for its current question.');
    return 0;
  }
  for (const job of jobs) console.log(`${job.countryId}: ${job.storyIds.join(', ')}`);
  if (values['dry-run']) return 0;

  loadLocalEnv();
  let client: ModelClient = values.replay
    ? new ReplayClient(values.replay)
    : new AnthropicModelClient({ fallbacks: !values['no-fallback'] });
  if (values.record) client = new RecordingClient(client, values.record);

  const model = values.model;
  console.log(`Writing phrasings for ${jobs.length} countries (${client.description}).`);
  const { results, usage } = await runParaphrase(jobs, {
    client,
    contentDir,
    prompts: loadParaphrasePrompts(),
    model,
    effort: values.effort as Effort,
    date: today(),
    concurrency,
    log: (line) => console.log(line),
  });
  const failed = results.filter((result) => result.outcome === 'failed').length;
  console.log(
    `\n${results.length - failed} written, ${failed} failed. ${formatUsage(usage, model)}`,
  );
  if (results.length > failed) {
    console.log('Next: read them with npm run content:review -- show <country>.');
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
