// npm run content:claims -- <country> [story] | --all | --drafts
// Check every claim-bearing text against the sources it cites. See
// docs/architecture.md#content-pipeline for the workflow and every option.
import { parseArgs } from 'node:util';
import {
  CLAIM_LIMITS,
  CLAIM_SOURCES_PER_SESSION,
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
import { claimsJobs, jobUnits, type ClaimsJob, type JobSelection } from './plan';
import { checkClaims, describeUnchecked } from './run';
import { countVerdicts, defaultClaimsDir, formatCounts, isFlagged } from './store';

const USAGE = `Usage: npm run content:claims -- <what> [options]

What to check (one of):
  <country> [story]     a country's overview and stories, or one story; <country> is an ID
                        (SGP) or slug (singapore)
  --all                 every country file
  --drafts              every overview and story that is still a draft

Only units without a result for their current text are checked, so a run after a partial one
checks only what is left.

Options:
  --recheck             check again even when every unit has a current result
  --mode sync|batch     a few sessions at a time (default), or rounds through the Batches API at half price
  --sources-per-session <n>
                        most cited sources one conversation reads (default ${CLAIM_SOURCES_PER_SESSION});
                        a country citing more is split into several sessions
  --model <id>          default ${DEFAULT_MODEL}
  --effort <level>      low | medium | high | xhigh | max (default ${DEFAULT_CLAIMS_EFFORT})
  --no-fallback         do not retry refusals on the server's fallback model
  --content-dir <dir>   default ${DEFAULT_CONTENT_DIR}
  --claims-dir <dir>    where results are saved (default: claims/ in the content directory)
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
      'sources-per-session': { type: 'string', default: String(CLAIM_SOURCES_PER_SESSION) },
      model: { type: 'string', default: DEFAULT_MODEL },
      effort: { type: 'string', default: DEFAULT_CLAIMS_EFFORT },
      'no-fallback': { type: 'boolean', default: false },
      'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
      'claims-dir': { type: 'string' },
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
  const maxSources = Number(values['sources-per-session']);
  if (!Number.isInteger(maxSources) || maxSources < 1) {
    throw new Error('--sources-per-session is a whole number of at least 1');
  }

  const contentDir = values['content-dir'];
  const claimsDir = values['claims-dir'] ?? defaultClaimsDir(contentDir);
  const selection: JobSelection = {
    scopes: storyId ? [{ kind: 'story', storyId }] : undefined,
    draftsOnly: values.drafts,
    recheck: values.recheck,
    maxSources,
  };
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

  const units = jobs.flatMap(jobUnits).length;
  const countries = new Set(jobs.map((job) => job.file.country.id)).size;
  const plural = (count: number, word: string, many = `${word}s`) =>
    `${count} ${count === 1 ? word : many}`;
  console.log(
    `Checking ${plural(units, 'unit')} of ${plural(countries, 'country', 'countries')} in ${plural(jobs.length, 'session')} (${client.description}, ${values.model} at ${values.effort} effort).`,
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
  const unchecked = results.flatMap((result) => result.unchecked);
  const incomplete = results.filter(
    (result) => result.outcome === 'partial' || result.outcome === 'failed',
  ).length;
  const flagged = statuses.filter(({ check }) => check && isFlagged(check)).length;
  console.log(
    `\n${formatCounts(countVerdicts(statuses))}${incomplete ? `; ${plural(incomplete, 'session')} did not check every unit` : ''}. ${formatUsage(usage, model)}`,
  );
  if (unchecked.length) {
    console.log(
      [
        `${plural(unchecked.length, 'unit')} not checked. Every verdict that passed is saved; running the same command again checks only these:`,
        ...results.flatMap((result) =>
          result.unchecked.length
            ? [`  ${result.label}:`, ...describeUnchecked(result.unchecked, '    ')]
            : [],
        ),
      ].join('\n'),
    );
  }
  if (flagged) {
    console.log(
      'Flagged text needs a source that states it: send it back with npm run content:review -- revise, or approve with --accept-claims "<why>" after checking the source yourself.',
    );
  }
  return unchecked.length || flagged ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
