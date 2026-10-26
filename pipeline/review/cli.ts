// npm run content:review -- <command>
//
//   list [--all]                                 drafts waiting for review (--all: every file)
//   show <country> [story] [--check-urls]        readable summary with claim checks and warnings
//   approve <country> [story] [--all] [--by me]  mark the overview, a story, or everything reviewed
//   revise <country> [story] --notes "..."       send a draft back for regeneration
import { parseArgs } from 'node:util';
import { DEFAULT_CONTENT_DIR, today } from '../config';
import { parsedCountryFiles, countryFilePath } from '../content-tree';
import { checkUrls } from '../validate/urls';
import {
  approve,
  fileReport,
  loadCountry,
  requestRevision,
  reviewerName,
  ReviewError,
} from './actions';
import { countrySummary, listing } from './summary';

const USAGE = `Usage: npm run content:review -- <command> [options]

  list [--all]                         countries with draft content (--all: every country file)
  show <country> [story]               summary: questions, sections with sources and claim check
                                       verdicts, map scene, next questions and validation warnings
       --check-urls                    check this file's source URLs first (network)
  approve <country> [story]            mark the overview, or one story, reviewed; needs a current
                                       claim check (npm run content:claims) with nothing flagged
       --all                           with no story: the overview and every story
       --accept-claims "<why>"         approve despite flagged claims after checking the sources
                                       yourself; the reason is recorded on each flagged result
       --by <name>                     reviewer (default: git user.name)
  revise <country> [story]             send a draft story, or the whole draft country, back
       --notes "<what to change>"      reviewer notes the regeneration must address
       --by <name>                     reviewer (default: git user.name)
  --content-dir <dir>                  content tree (default ${DEFAULT_CONTENT_DIR})

<country> is a country ID (CHL) or slug (chile). After revise, run
npm run content:generate -- --revisions to redraft everything sent back.`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      'check-urls': { type: 'boolean', default: false },
      by: { type: 'string' },
      notes: { type: 'string' },
      'accept-claims': { type: 'string' },
      'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
      help: { type: 'boolean', default: false },
    },
  });
  const [command, country, storyId] = positionals;
  const contentDir = values['content-dir'];
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  if (command === 'list') {
    const entries = [...parsedCountryFiles(contentDir).values()].map((data) => ({
      file: countryFilePath(contentDir, data.country.slug),
      data,
    }));
    const rows = listing(entries).filter(
      (row) => values.all || row.countryStatus === 'draft' || row.draftStories > 0,
    );
    if (!rows.length) {
      console.log(values.all ? 'No country files.' : 'Nothing waiting for review.');
      return 0;
    }
    for (const row of rows) {
      const revisions = row.revisions ? `, ${row.revisions} sent back` : '';
      console.log(
        `${row.countryId}  ${row.name.padEnd(24)} overview ${row.countryStatus.padEnd(8)} stories: ${row.draftStories} draft, ${row.reviewedStories} reviewed${revisions}  (${row.generatedBy})`,
      );
    }
    return 0;
  }

  if (!country) {
    console.log(USAGE);
    return 1;
  }

  if (command === 'show') {
    const file = loadCountry(contentDir, country);
    if (storyId && !file.stories.some((story) => story.id === storyId)) {
      throw new ReviewError(`${file.country.id} has no story "${storyId}"`);
    }
    if (values['check-urls']) {
      const urls = [
        ...file.country.sources.map((source) => source.url),
        ...file.stories.flatMap((story) => story.sources.map((source) => source.url)),
      ];
      await checkUrls(urls);
    }
    const report = fileReport(contentDir, file);
    console.log(
      countrySummary(file, { files: parsedCountryFiles(contentDir), ...report }, storyId),
    );
    return 0;
  }

  if (command === 'approve') {
    if (values['accept-claims'] !== undefined && !values['accept-claims'].trim()) {
      throw new ReviewError('Say why the flagged claims are fine with --accept-claims "...".');
    }
    const result = approve({
      contentDir,
      country,
      storyId,
      all: values.all,
      by: reviewerName(values.by),
      date: today(),
      acceptClaims: values['accept-claims'],
    });
    const accepted = result.acceptedClaims
      ? ` Accepted ${result.acceptedClaims} flagged claim check result${result.acceptedClaims === 1 ? '' : 's'}.`
      : '';
    console.log(
      `Approved ${result.approved.join(', ') || 'nothing'} in ${result.file}.${accepted}`,
    );
    return 0;
  }

  if (command === 'revise') {
    const result = requestRevision({
      contentDir,
      country,
      storyId,
      notes: values.notes ?? '',
      by: reviewerName(values.by),
      date: today(),
    });
    console.log(
      `Sent ${result.target} back in ${result.file}. Run npm run content:generate -- --revisions to redraft.`,
    );
    return 0;
  }

  console.log(USAGE);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
