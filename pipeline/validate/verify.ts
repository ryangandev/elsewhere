// content:verify: every content:check rule, plus pending references and source URL reachability.
import { CountryFile, type CountryFile as CountryFileData } from '../../src/content/schema';
import {
  findPendingReferences,
  validateContent,
  type ContentIssue,
  type PendingReference,
} from '../../src/content/validate';
import { contentInput, landIndex } from '../content-tree';
import { cachedUrlStatuses, checkUrls, type UrlCheckOptions, type UrlStatus } from './urls';

export type SourceUse = { url: string; file: string; path: string; sourceId: string };

export type VerifyResult = {
  /** Schema, integrity, gazetteer and sea-route problems. Any of these fails verification. */
  issues: ContentIssue[];
  pending: PendingReference[];
  /** Every cited URL with its status; undefined status means not checked (offline, no cache). */
  urls: { url: string; status?: UrlStatus; uses: SourceUse[] }[];
};

export type VerifyOptions = {
  contentDir: string;
  /** Skip network checks; cached URL results are still reported. */
  offline: boolean;
  /** Only check URLs cited by these countries. */
  countryIds?: string[];
  urlOptions?: UrlCheckOptions;
};

/** Every source of every country file, with where it is declared. */
export function sourceUses(files: { file: string; data: CountryFileData }[]): SourceUse[] {
  return files.flatMap(({ file, data }) => [
    ...data.country.sources.map((source, index) => ({
      url: source.url,
      file,
      path: `country.sources[${index}]`,
      sourceId: source.id,
    })),
    ...data.stories.flatMap((story, storyIndex) =>
      story.sources.map((source, index) => ({
        url: source.url,
        file,
        path: `stories[${storyIndex}].sources[${index}]`,
        sourceId: source.id,
      })),
    ),
  ]);
}

export async function verifyContent(options: VerifyOptions): Promise<VerifyResult> {
  const input = contentInput(options.contentDir);
  const issues = validateContent({ ...input, land: landIndex() });

  const files = input.countryFiles.flatMap(({ file, data }) => {
    const parsed = CountryFile.safeParse(data);
    return parsed.success ? [{ file, data: parsed.data }] : [];
  });
  const pending = findPendingReferences(files.map(({ data }) => data));

  const selected = options.countryIds
    ? files.filter(({ data }) => options.countryIds!.includes(data.country.id))
    : files;
  const uses = new Map<string, SourceUse[]>();
  for (const use of sourceUses(selected)) uses.set(use.url, [...(uses.get(use.url) ?? []), use]);
  const urls = [...uses.keys()];
  const statuses = options.offline
    ? cachedUrlStatuses(urls, options.urlOptions)
    : await checkUrls(urls, options.urlOptions);

  return {
    issues,
    pending,
    urls: urls.map((url) => ({ url, status: statuses.get(url), uses: uses.get(url)! })),
  };
}
