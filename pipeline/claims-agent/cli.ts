// npm run content:claims-agent -- <command> ...
// The commands a Claude Code claim checking subagent (.claude/agents/claim-checker.md) runs. See
// docs/architecture.md#agent-claim-check.
import type { ParseArgsConfig } from 'node:util';
import { parseArgsOnce } from '../cli-args';
import { ignoreClosedOutput } from '../closed-output';
import { CLAIM_SOURCES_PER_SESSION, DEFAULT_CONTENT_DIR, DEFAULT_MODEL } from '../config';
import { DEFAULT_FIND_MATCHES, MAX_FIND_MATCHES } from '../agent/reading';
import { fetchCommand, start, status, submit, type ClaimsAgentDeps } from './commands';

const USAGE = `Usage: npm run content:claims-agent -- <command> ... [options]

Commands:
  start <country> [story]   plan the units to check into sessions and write each brief.md;
                            prints the session IDs
                            Scope: the country's overview units (summary, geography, why it
                            matters, quick facts) and its stories' units, of which only those
                            without a result for their current text are due.
                            [story] narrows it to that story's units (session CHL-length).
    --overview              narrows it to the overview units (session CHL-overview); not
                            with [story]
    --recheck               makes every unit in scope due, even with a result for its
                            current text; with [story] or --overview only that part
    --drafts                only the overview and stories that are still drafts
    --sources-per-session <n>
                            most cited sources one session reads (default ${CLAIM_SOURCES_PER_SESSION});
                            a country citing more is split into sessions that share no units
    --content-dir <dir>     default ${DEFAULT_CONTENT_DIR}
    --claims-dir <dir>      where results are saved (default: claims/ in the content directory)
    --model <id>            recorded as the model that judged (default ${DEFAULT_MODEL})
    --effort <level>        recorded with it (default "default", the subagent's own)
    --fresh                 move the existing sessions that overlap the requested scope (the
                            whole country, [story] or --overview) to finished/ first,
                            unfinished ones too, even when nothing is due; sessions of other
                            parts of the country stay
                            Without it, start moves a finished session of the same name to
                            finished/ (fetch records and submissions stay), and refuses while
                            an unfinished one holds a unit it would hand out.
  fetch <session> <url>     read one of the session's cited pages and print a part
    --offset <n>            print the part starting at character n (without it, a page
                            that marks its main text is printed from there)
    --find <words>          list where the words appear instead; repeat it for several
                            (with --offset, those from character n on)
    --matches <n>           places listed per --find term (default ${DEFAULT_FIND_MATCHES}, at most ${MAX_FIND_MATCHES})
    --refresh               fetch again even when a reading copy is stored
  submit <session> [file]   check the verdict file (default verdicts.json in the session),
                            verify every quote against a live fetch, save what passes
    --dry-run               run the same checks and live fetch but save and record nothing
  status <session|country>  units checked and still due, fetches, failures and submissions
`;

type Options = NonNullable<ParseArgsConfig['options']>;

const OPTIONS: Record<string, Options> = {
  start: {
    overview: { type: 'boolean', default: false },
    recheck: { type: 'boolean', default: false },
    drafts: { type: 'boolean', default: false },
    'sources-per-session': { type: 'string', default: String(CLAIM_SOURCES_PER_SESSION) },
    'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
    'claims-dir': { type: 'string' },
    model: { type: 'string', default: DEFAULT_MODEL },
    effort: { type: 'string', default: 'default' },
    fresh: { type: 'boolean', default: false },
  },
  fetch: {
    offset: { type: 'string' },
    find: { type: 'string', multiple: true },
    matches: { type: 'string' },
    refresh: { type: 'boolean', default: false },
  },
  submit: { 'dry-run': { type: 'boolean', default: false } },
  status: {},
};

/** Positional arguments after the command, by command. */
const POSITIONALS: Record<string, { min: number; max: number }> = {
  start: { min: 1, max: 2 },
  fetch: { min: 2, max: 2 },
  submit: { min: 1, max: 2 },
  status: { min: 1, max: 1 },
};

async function main(): Promise<number> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === '--help' || name === 'help' || !(name in OPTIONS)) {
    console.log(USAGE);
    return name && name !== '--help' && name !== 'help' ? 1 : 0;
  }
  const { values, positionals } = parseArgsOnce({
    args: rest,
    options: OPTIONS[name],
    allowPositionals: true,
  });
  const { min, max } = POSITIONALS[name];
  if (positionals.length < min || positionals.length > max) {
    console.log(USAGE);
    return 1;
  }
  const [target, argument] = positionals;
  const deps: ClaimsAgentDeps = { out: (line) => console.log(line) };
  const string = (key: string) => values[key] as string | undefined;

  switch (name) {
    case 'start': {
      const maxSources = Number(string('sources-per-session'));
      if (!Number.isInteger(maxSources) || maxSources < 1) {
        throw new Error('--sources-per-session is a whole number of at least 1');
      }
      return start(
        {
          country: target,
          storyId: argument,
          overviewOnly: values.overview === true,
          contentDir: string('content-dir')!,
          claimsDir: string('claims-dir'),
          model: string('model')!,
          effort: string('effort')!,
          recheck: values.recheck === true,
          draftsOnly: values.drafts === true,
          maxSources,
          fresh: values.fresh === true,
        },
        deps,
      );
    }
    case 'fetch': {
      const offset = string('offset') === undefined ? undefined : Number(string('offset'));
      if (offset !== undefined && !Number.isInteger(offset)) {
        throw new Error('--offset is a whole number of characters');
      }
      const matches = string('matches') === undefined ? undefined : Number(string('matches'));
      return fetchCommand(
        {
          sessionId: target,
          url: argument,
          offset,
          find: values.find as string[] | undefined,
          matches,
          refresh: values.refresh === true,
        },
        deps,
      );
    }
    case 'submit':
      return submit(
        { sessionId: target, file: argument, dryRun: values['dry-run'] === true },
        deps,
      );
    default:
      return status({ target }, deps);
  }
}

// A subagent may pipe a fetch into head.
ignoreClosedOutput();
main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
