// Review decisions recorded in the content files themselves: approve a country overview or a story,
// or send a draft back for regeneration with the reviewer's notes. Every change is validated
// against the whole tree before it is written, so review can never leave the tree invalid.
// Approval also needs a current claim check (pipeline/claims) for every cited text it covers.
import { execFileSync } from 'node:child_process';
import type { CountryFile, Provenance } from '../../src/content/schema';
import {
  acceptFlagged,
  defaultClaimsDir,
  claimProblems,
  isFlagged,
  readClaims,
  unitStatuses,
  type ClaimsFile,
  type UnitStatus,
} from '../claims/store';
import { scopeLabel, scopeUnits, type ClaimScope } from '../claims/units';
import {
  findPendingReferences,
  validateContent,
  type ContentIssue,
  type PendingReference,
} from '../../src/content/validate';
import {
  contentInput,
  countryFilePath,
  landIndex,
  mapCountryList,
  parsedCountryFiles,
  readCountryFile,
  writeCountryFile,
} from '../content-tree';
import { cachedUrlStatuses, type UrlCheckOptions, type UrlStatus } from '../validate/urls';

export class ReviewError extends Error {}

/** A country by ID ("CHL") or content slug ("chile"). */
export function resolveCountry(key: string): { id: string; slug: string } {
  const lower = key.toLowerCase();
  const country = mapCountryList().find(
    (entry) => entry.id.toLowerCase() === lower || entry.slug === lower,
  );
  if (!country) throw new ReviewError(`Unknown country "${key}"`);
  return { id: country.id, slug: country.slug };
}

export function loadCountry(contentDir: string, key: string): CountryFile {
  const { slug } = resolveCountry(key);
  const file = readCountryFile(contentDir, slug);
  if (!file)
    throw new ReviewError(`No content file for "${key}" (${countryFilePath(contentDir, slug)})`);
  return file;
}

/** The reviewer's name: --by, or else the git user name. */
export function reviewerName(by: string | undefined): string {
  if (by?.trim()) return by.trim();
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim();
    if (name) return name;
  } catch {
    // Not a git checkout or no git: fall through to the error.
  }
  throw new ReviewError('Pass --by <name> to record who reviewed it.');
}

export type FileReport = {
  issues: ContentIssue[];
  pending: PendingReference[];
  urlStatuses: Map<string, UrlStatus>;
  /** Saved claim check results for the country. */
  claims: ClaimsFile;
};

const citedUrls = (file: CountryFile) => [
  ...file.country.sources.map((source) => source.url),
  ...file.stories.flatMap((story) => story.sources.map((source) => source.url)),
];

/**
 * Validation issues, pending references, cached URL results and claim check results for one
 * file, as it would be written.
 */
export function fileReport(
  contentDir: string,
  file: CountryFile,
  urlOptions?: UrlCheckOptions,
  claimsDir: string = defaultClaimsDir(contentDir),
): FileReport {
  const path = countryFilePath(contentDir, file.country.slug);
  const issues = validateContent({
    ...contentInput(contentDir, [{ file: path, data: file }]),
    land: landIndex(),
  }).filter((issue) => issue.file === path);
  const others = [...parsedCountryFiles(contentDir).values()].filter(
    (entry) => entry.country.id !== file.country.id,
  );
  const pending = findPendingReferences([...others, file]).filter(
    (ref) => ref.from.countryId === file.country.id,
  );
  return {
    issues,
    pending,
    urlStatuses: cachedUrlStatuses(citedUrls(file), urlOptions),
    claims: readClaims(claimsDir, file.country),
  };
}

const reviewed = (provenance: Provenance, by: string, date: string): Provenance => ({
  ...provenance,
  revision: undefined,
  status: 'reviewed',
  reviewedBy: by,
  reviewedAt: date,
});

export type ApproveOptions = {
  contentDir: string;
  country: string;
  /** Approve one story; without it, approve the country overview. */
  storyId?: string;
  /** With no story: approve the overview and every story in the file. */
  all?: boolean;
  by: string;
  date: string;
  urlOptions?: UrlCheckOptions;
  /** Claim check results (default pipeline/.cache/claims). */
  claimsDir?: string;
  /**
   * Approve despite flagged claim check verdicts, after the reviewer checked the sources
   * themselves; the reason is recorded on each flagged result. Text never checked still blocks.
   */
  acceptClaims?: string;
};

/**
 * Mark content reviewed. Refuses while the content has validation issues, pending references,
 * a revision request, a source URL last seen broken, or cited text without a current claim check
 * or with a flagged one that was not accepted: those need attention before a human signs off.
 */
export function approve(options: ApproveOptions): {
  file: string;
  approved: string[];
  acceptedClaims: number;
} {
  const current = loadCountry(options.contentDir, options.country);
  const approveCountry = !options.storyId;
  const storyIds = options.storyId
    ? [options.storyId]
    : options.all
      ? current.stories.map((story) => story.id)
      : [];
  for (const id of storyIds) {
    if (!current.stories.some((story) => story.id === id)) {
      throw new ReviewError(`${current.country.id} has no story "${id}"`);
    }
  }

  const entries = [
    ...(approveCountry
      ? [{ label: current.country.id, provenance: current.country.provenance }]
      : []),
    ...current.stories
      .filter((story) => storyIds.includes(story.id))
      .map((story) => ({
        label: `${current.country.id}/${story.id}`,
        provenance: story.provenance,
      })),
  ];
  const waiting = entries.filter((entry) => entry.provenance.revision);
  if (waiting.length) {
    throw new ReviewError(
      `Waiting for a revision: ${waiting.map((entry) => entry.label).join(', ')}. Run npm run content:generate -- --revisions first.`,
    );
  }

  const next: CountryFile = {
    country: approveCountry
      ? {
          ...current.country,
          provenance: reviewed(current.country.provenance, options.by, options.date),
        }
      : current.country,
    stories: current.stories.map((story) =>
      storyIds.includes(story.id)
        ? { ...story, provenance: reviewed(story.provenance, options.by, options.date) }
        : story,
    ),
  };

  const claimsDir = options.claimsDir ?? defaultClaimsDir(options.contentDir);
  const report = fileReport(options.contentDir, next, options.urlOptions, claimsDir);
  const scopes: ClaimScope[] = [
    ...(approveCountry ? [{ kind: 'overview' as const }] : []),
    ...storyIds.map((storyId) => ({ kind: 'story' as const, storyId })),
  ];
  const acceptReason = options.acceptClaims?.trim();
  const claimStatuses = scopes.map((scope) => ({
    scope,
    statuses: unitStatuses(scopeUnits(next, scope), report.claims),
  }));
  const touched = (path: string) =>
    (approveCountry && (path === '' || path.startsWith('country'))) ||
    storyIds.some((id) =>
      path.startsWith(`stories[${current.stories.findIndex((story) => story.id === id)}]`),
    );
  const problems = [
    ...report.issues
      .filter((issue) => touched(issue.path))
      .map((issue) => `${issue.path}: ${issue.message}`),
    ...report.pending
      .filter((ref) => storyIds.includes(ref.from.storyId))
      .map(
        (ref) =>
          `${ref.from.storyId}: next question ${ref.to.countryId}/${ref.to.storyId} is pending`,
      ),
    ...approvedUrls(next, approveCountry, storyIds)
      .filter((url) => report.urlStatuses.get(url)?.state === 'broken')
      .map((url) => `broken source URL ${url}`),
    ...claimStatuses.flatMap(({ scope, statuses }) =>
      claimProblems(
        acceptReason ? statuses.filter(({ check }) => !check) : statuses,
        scopeLabel(current.country.id, scope),
      ),
    ),
  ];
  if (problems.length) {
    const unchecked = claimStatuses.some(({ statuses }) => statuses.some(({ check }) => !check));
    const flagged = claimStatuses.some(({ statuses }) => statuses.some(isUnacceptedFlag));
    const hints = [
      ...(unchecked
        ? [
            `Check the claims first: npm run content:claims -- ${current.country.id}${options.storyId ? ` ${options.storyId}` : ''}`,
          ]
        : []),
      ...(flagged && !acceptReason
        ? [
            'Send flagged text back with revise, or open the sources yourself and approve with --accept-claims "<why>".',
          ]
        : []),
    ];
    throw new ReviewError(
      ['Cannot approve yet:', ...problems.map((problem) => `  - ${problem}`), ...hints].join('\n'),
    );
  }
  const acceptedClaims = acceptReason
    ? acceptFlagged(
        claimsDir,
        next,
        claimStatuses.flatMap(({ statuses }) => statuses),
        { by: options.by, on: options.date, reason: acceptReason },
      )
    : 0;
  return {
    file: writeCountryFile(options.contentDir, next),
    approved: entries.map((entry) => entry.label),
    acceptedClaims,
  };
}

const isUnacceptedFlag = ({ check }: UnitStatus) =>
  check !== undefined && isFlagged(check) && !check.accepted;

const approvedUrls = (file: CountryFile, country: boolean, storyIds: string[]) => [
  ...(country ? file.country.sources.map((source) => source.url) : []),
  ...file.stories
    .filter((story) => storyIds.includes(story.id))
    .flatMap((story) => story.sources.map((source) => source.url)),
];

export type ReviseOptions = {
  contentDir: string;
  country: string;
  /** Send back one story; without it, the whole country is redrafted. */
  storyId?: string;
  notes: string;
  by: string;
  date: string;
};

/** Ask for a redraft. npm run content:generate -- --revisions consumes the request. */
export function requestRevision(options: ReviseOptions): { file: string; target: string } {
  const current = loadCountry(options.contentDir, options.country);
  const notes = options.notes.trim();
  if (!notes) throw new ReviewError('Say what should change with --notes "...".');
  const revision = { notes, requestedBy: options.by, requestedAt: options.date };

  if (!options.storyId) {
    const reviewedLabels = [
      ...(current.country.provenance.status === 'reviewed' ? [current.country.id] : []),
      ...current.stories
        .filter((story) => story.provenance.status === 'reviewed')
        .map((story) => `${current.country.id}/${story.id}`),
    ];
    if (reviewedLabels.length) {
      throw new ReviewError(
        `A country redraft replaces the whole file, and ${reviewedLabels.join(', ')} is already reviewed. Send back single stories instead.`,
      );
    }
    const next = {
      ...current,
      country: { ...current.country, provenance: { ...current.country.provenance, revision } },
    };
    return { file: writeCountryFile(options.contentDir, next), target: current.country.id };
  }

  const story = current.stories.find((entry) => entry.id === options.storyId);
  if (!story) throw new ReviewError(`${current.country.id} has no story "${options.storyId}"`);
  if (story.provenance.status === 'reviewed') {
    throw new ReviewError(`${current.country.id}/${story.id} is already reviewed.`);
  }
  const next: CountryFile = {
    ...current,
    stories: current.stories.map((entry) =>
      entry.id === story.id ? { ...entry, provenance: { ...entry.provenance, revision } } : entry,
    ),
  };
  return {
    file: writeCountryFile(options.contentDir, next),
    target: `${current.country.id}/${story.id}`,
  };
}
