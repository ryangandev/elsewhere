// npm run content:verify [-- --offline] [--country CHL] [--refresh] [--content-dir <dir>]
// Exits non-zero on content issues or broken source URLs; unverified URLs are warnings.
import { parseArgsOnce } from '../cli-args';
import { DEFAULT_CONTENT_DIR } from '../config';
import { verifyContent } from './verify';

async function main(): Promise<number> {
  const { values } = parseArgsOnce({
    options: {
      offline: { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
      country: { type: 'string', multiple: true },
      'content-dir': { type: 'string', default: DEFAULT_CONTENT_DIR },
    },
  });
  const result = await verifyContent({
    contentDir: values['content-dir'],
    offline: values.offline,
    countryIds: values.country?.map((id) => id.toUpperCase()),
    urlOptions: { refresh: values.refresh },
  });

  for (const issue of result.issues) {
    console.error(`${issue.file}${issue.path ? ` ${issue.path}` : ''}: ${issue.message}`);
  }
  for (const ref of result.pending) {
    console.log(
      `pending: ${ref.from.countryId}/${ref.from.storyId} -> ${ref.to.countryId}/${ref.to.storyId} (no ${ref.to.countryId} file yet)`,
    );
  }

  const broken = result.urls.filter(({ status }) => status?.state === 'broken');
  const unverified = result.urls.filter(({ status }) => status?.state === 'unverified');
  const unchecked = result.urls.filter(({ status }) => !status);
  const where = (uses: { file: string; path: string }[]) =>
    uses.map((use) => `${use.file} ${use.path}`).join('; ');
  for (const { url, status, uses } of broken) {
    console.error(`broken: ${url} (${status!.detail}) in ${where(uses)}`);
  }
  for (const { url, status, uses } of unverified) {
    console.log(`unverified: ${url} (${status!.detail}) in ${where(uses)}`);
  }

  const urlSummary = values.offline
    ? `${result.urls.length} source URLs (offline; ${unchecked.length} without a cached result)`
    : `${result.urls.length} source URLs: ${result.urls.length - broken.length - unverified.length} ok, ${unverified.length} unverified, ${broken.length} broken`;
  console.log(
    `\n${result.issues.length} content issue${result.issues.length === 1 ? '' : 's'}, ${result.pending.length} pending reference${result.pending.length === 1 ? '' : 's'}, ${urlSummary}.`,
  );
  return result.issues.length || broken.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
