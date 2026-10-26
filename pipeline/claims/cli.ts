// npm run content:claims -- <country> [story] | --all | --drafts
// Check every claim-bearing text against the sources it cites. See
// docs/architecture.md#content-pipeline for the workflow and every option.
import { parseArgs } from 'node:util';
import {
  CLAIM_LIMITS,
  CLAIMS_DIR,
  DEFAULT_CLAIMS_EFFORT,
  DEFAULT_CONTENT_DIR,
  DEFAULT_MODEL,
  loadLocalEnv,
  today,
  type Effort,
} from '../config';
import { parsedCountryFiles } from '../content-tree';
import {
  AnthropicModelClient,
  RecordingClient,
  ReplayClient,
  type ModelClient,
} from '../generate/model-client';
import { formatUsage } from '../generate/usage';
import { loadClaimsPrompts } from '../prompts';
import { loadCountry } from '../review/actions';
import { fetchPageText, recordPages, replayPages } from './local-fetch';
import { checkClaims, claimsJobs, type ClaimsJob, type JobSelection } from './run';
import { countVerdicts, formatCounts, isFlagged } from './store';
import { scopeUnits } from './units';

const USAGE = `Usage: npm run content:claims -- <what> [options]

What to check (one of):
  <country> [story]     a country's overview and stories, or one story; <country> is an ID
                        (SGP) or slug (singapore)
  --all                 every country file
  --drafts              every overview and story that is still a draft

Only overviews and stories with a unit that has no result for its current text are checked.

Options:
  --recheck             check again even when every unit has a current result
  --mode sync|batch     a few sessions at a time (default), or rounds through the Batches API at half price
  --model <id>          default ${DEFAULT_MODEL}
  --effort <level>      low | medium | high | xhigh | max (default ${DEFAULT_CLAIMS_EFFORT})
  --no-fallback         do not retry refusals on the server's fallback model
  --content-dir <dir>   default ${DEFAULT_CONTENT_DIR}
  --claims-dir <dir>    where results are saved (default ${CLAIMS_DIR})
  --record <dir>        save every response and local page fetch, to replay later
  --replay <dir>        replay recorded responses instead of calling the API
`;

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      drafts: { type: 'boolean', default: false },
      recheck: { type: 'boolean', default: false },
      mode: { type: 'string', default: 'sync' },
      model: { type: 'string', default: DEFAULT_MODEL },
      effort: { type: 'string', default: DEFAULT_CLAIMS_EFFORT },
      'no-fallback': { type: 'boolean', default: false },
      'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
      'claims-dir': { type: 'string', default: CLAIMS_DIR },
      record: { type: 'string' },
      replay: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const [country, storyId] = positionals;
  const targets = [country, values.all || undefined, values.drafts || undefined].filter(Boolean);
  if (values.help || targets.length !== 1 || positionals.length > 2) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }
  const mode = values.mode;
  if (mode !== 'sync' && mode !== 'batch') throw new Error('--mode is sync or batch');
  if (!EFFORTS.has(values.effort)) throw new Error(`Unknown effort "${values.effort}"`);

  const contentDir = values['content-dir'];
  const claimsDir = values['claims-dir'];
  const selection: JobSelection = { storyId, draftsOnly: values.drafts, recheck: values.recheck };
  const files = country
    ? [loadCountry(contentDir, country)]
    : [...parsedCountryFiles(contentDir).values()];
  if (storyId && !files[0].stories.some((story) => story.id === storyId)) {
    throw new Error(`${files[0].country.id} has no story "${storyId}"`);
  }
  const jobs: ClaimsJob[] = files.flatMap((file) => claimsJobs(file, selection, claimsDir));
  if (!jobs.length) {
    console.log(
      'Nothing to check: every unit has a result for its current text. Pass --recheck to check again.',
    );
    return 0;
  }

  loadLocalEnv();
  let client: ModelClient = values.replay
    ? new ReplayClient(values.replay)
    : new AnthropicModelClient({ fallbacks: !values['no-fallback'] });
  if (values.record) client = new RecordingClient(client, values.record);
  // fetch_page answers are recorded and replayed with the responses, so a replay stays offline.
  let fetchPage = values.replay ? replayPages(values.replay) : fetchPageText;
  if (values.record) fetchPage = recordPages(fetchPage, values.record);

  const units = jobs.reduce((sum, job) => sum + scopeUnits(job.file, job.scope).length, 0);
  console.log(
    `Checking ${units} units in ${jobs.length} overview${jobs.length === 1 ? '' : 's'} and stories (${client.description}, ${values.model} at ${values.effort} effort).`,
  );
  const model = values.model;
  const { results, usage } = await checkClaims({
    client,
    context: {
      prompts: loadClaimsPrompts(),
      model,
      effort: values.effort as Effort,
      limits: CLAIM_LIMITS,
      cacheTtl: mode === 'batch' ? '1h' : '5m',
      date: today(),
      fetchPage,
    },
    jobs,
    mode,
    claimsDir,
    log: (line) => console.log(line),
  });

  const statuses = results.flatMap((result) => result.statuses);
  const failed = results.filter((result) => result.outcome === 'failed').length;
  const flagged = statuses.filter(({ check }) => check && isFlagged(check)).length;
  console.log(
    `\n${formatCounts(countVerdicts(statuses))}${failed ? `; ${failed} failed` : ''}. ${formatUsage(usage, model)}`,
  );
  if (flagged) {
    console.log(
      'Flagged text needs a source that states it: send it back with npm run content:review -- revise, or approve with --accept-claims "<why>" after checking the source yourself.',
    );
  }
  return failed || flagged ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
