// npm run content:agent -- <command> <country> [options]
// The commands a Claude Code drafting subagent (.claude/agents/content-drafter.md) runs. See
// docs/architecture.md#agent-drafting.
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { DEFAULT_CONTENT_DIR, DEFAULT_MODEL, today } from '../config';
import { fetchCommand, places, start, status, submit, type AgentDeps } from './commands';

const USAGE = `Usage: npm run content:agent -- <command> <country> [options]

Commands:
  start <country>         create the session and its brief.md (or continue an unfinished one)
    --content-dir <dir>   default ${DEFAULT_CONTENT_DIR}
    --model <id>          recorded as generatedBy (default ${DEFAULT_MODEL})
    --date YYYY-MM-DD     generatedAt and accessedAt (default today)
    --regenerate          the draft may replace an existing draft nobody sent back
    --fresh               discard an existing session first
  fetch <country> <url>   read a page on this computer, keep it as evidence, print a part
    --offset <n>          print the part starting at character n
    --find <words>        list where the words appear instead
    --links               list the page's links (text | URL) instead; --offset counts links
    --refresh             fetch again even when the page is stored
  places <country>        search the gazetteer
    --query <name>        part of a place name; repeat it to search several names at once
    --country <id>        only places in this map country
    --near <place id>     sort by distance from this place
  submit <country> [file] check the draft (default draft.json in the session) and write it
    --dry-run             run the same checks but write and record nothing
  status <country>        what the session has fetched and submitted
`;

type Options = NonNullable<ParseArgsConfig['options']>;

const OPTIONS: Record<string, Options> = {
  start: {
    'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
    model: { type: 'string', default: DEFAULT_MODEL },
    date: { type: 'string' },
    regenerate: { type: 'boolean', default: false },
    fresh: { type: 'boolean', default: false },
  },
  fetch: {
    offset: { type: 'string', default: '0' },
    find: { type: 'string' },
    links: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
  },
  places: {
    query: { type: 'string', multiple: true },
    country: { type: 'string' },
    near: { type: 'string' },
  },
  submit: { 'dry-run': { type: 'boolean', default: false } },
  status: {},
};

/** Positional arguments after the command, by command. */
const POSITIONALS: Record<string, { min: number; max: number }> = {
  start: { min: 1, max: 1 },
  fetch: { min: 2, max: 2 },
  places: { min: 1, max: 1 },
  submit: { min: 1, max: 2 },
  status: { min: 1, max: 1 },
};

async function main(): Promise<number> {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === '--help' || name === 'help' || !(name in OPTIONS)) {
    console.log(USAGE);
    return name && name !== '--help' && name !== 'help' ? 1 : 0;
  }
  const { values, positionals } = parseArgs({
    args: rest,
    options: OPTIONS[name],
    allowPositionals: true,
  });
  const { min, max } = POSITIONALS[name];
  if (positionals.length < min || positionals.length > max) {
    console.log(USAGE);
    return 1;
  }
  const [countryId, argument] = positionals;
  const deps: AgentDeps = { out: (line) => console.log(line) };
  const string = (key: string) => values[key] as string | undefined;

  switch (name) {
    case 'start': {
      const date = string('date') ?? today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date is YYYY-MM-DD');
      return start(
        {
          countryId,
          contentDir: string('content-dir')!,
          model: string('model')!,
          date,
          regenerate: values.regenerate === true,
          fresh: values.fresh === true,
        },
        deps,
      );
    }
    case 'fetch': {
      const offset = Number(string('offset'));
      if (!Number.isInteger(offset)) throw new Error('--offset is a whole number of characters');
      return fetchCommand(
        {
          countryId,
          url: argument,
          offset,
          find: string('find'),
          links: values.links === true,
          refresh: values.refresh === true,
        },
        deps,
      );
    }
    case 'places':
      return places(
        {
          countryId,
          queries: (values.query as string[] | undefined) ?? [],
          country: string('country'),
          near: string('near'),
        },
        deps,
      );
    case 'submit':
      return submit({ countryId, file: argument, dryRun: values['dry-run'] === true }, deps);
    default:
      return status({ countryId }, deps);
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
