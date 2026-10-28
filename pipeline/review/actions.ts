// Review decisions recorded in the content files themselves: approve a country overview or a story,
// send a draft back for regeneration with the reviewer's notes, or reopen reviewed content so it
// is redrafted the same way. An approval is validated against the whole tree before it is
// written, so review never signs off on an invalid tree.
// Approval also needs a current claim check (pipeline/claims) for every cited text it covers.
import { execFileSync } from 'node:child_process';
import type { CountryFile, Provenance, RevisionRequest } from '../../src/content/schema';
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
import { isReopened, wholeCountryRevision } from '../generate/replace';
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
    const labels = waiting.map((entry) =>
      entry.provenance === current.country.provenance
        ? `${entry.label} (${wholeCountryRevision(current) ? 'the whole country' : 'the overview'})`
        : entry.label,
    );
    throw new ReviewError(
      `Waiting for a revision: ${labels.join(', ')}. Redraft first with npm run content:generate -- --revisions, or in a Claude Code subagent with ${agentRedraftCommand(current)}.`,
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

/**
 * The agent drafting command that redrafts what review sent back in a country: the whole country
 * is drafted again with `start`, anything else (the overview, stories) in a revision session.
 */
export function agentRedraftCommand(file: CountryFile): string {
  const id = file.country.id;
  return `npm run content:agent -- start ${id}${wholeCountryRevision(file) ? '' : ' --revisions'}`;
}

export type ReviseOptions = {
  contentDir: string;
  country: string;
  /** Send back one story; without it (and without `overview`), the whole country is redrafted. */
  storyId?: string;
  /**
   * Send back only the country part: kicker, overview, quick facts, starter questions and scene.
   * Every story is kept as it is.
   */
  overview?: boolean;
  notes: string;
  by: string;
  date: string;
};

/**
 * Ask for a redraft. npm run content:generate -- --revisions consumes the request, or agent
 * drafting (npm run content:agent -- start <country> --revisions for the overview and stories,
 * start <country> for a whole country).
 */
export function requestRevision(options: ReviseOptions): {
  file: string;
  target: string;
  /** The agent drafting command that redrafts everything now sent back in the country. */
  agentCommand: string;
} {
  const current = loadCountry(options.contentDir, options.country);
  const notes = options.notes.trim();
  if (!notes) throw new ReviewError('Say what should change with --notes "...".');
  const revision = { notes, requestedBy: options.by, requestedAt: options.date };
  const written = (next: CountryFile, target: string) => ({
    file: writeCountryFile(options.contentDir, next),
    target,
    agentCommand: agentRedraftCommand(next),
  });

  if (options.overview) {
    if (options.storyId) {
      throw new ReviewError(
        '--overview sends back the country part alone; send a story back on its own, without --overview.',
      );
    }
    if (current.country.provenance.status === 'reviewed') {
      throw new ReviewError(
        `The overview of ${current.country.id} is already reviewed. To redraft it, reopen it with npm run content:review -- reopen ${current.country.id} --overview --notes "..."`,
      );
    }
    const next = {
      ...current,
      country: {
        ...current.country,
        provenance: {
          ...current.country.provenance,
          revision: {
            ...revision,
            scope: 'overview' as const,
            ...keptReopening(current.country.provenance),
          },
        },
      },
    };
    return written(next, `${current.country.id} overview`);
  }

  if (!options.storyId) {
    const parts = [
      { label: current.country.id, provenance: current.country.provenance },
      ...current.stories.map((story) => ({
        label: `${current.country.id}/${story.id}`,
        provenance: story.provenance,
      })),
    ];
    const reviewedLabels = parts
      .filter(({ provenance }) => provenance.status === 'reviewed')
      .map(({ label }) => label);
    const reopenedLabels = parts
      .filter(({ provenance }) => isReopened(provenance))
      .map(({ label }) => label);
    if (reviewedLabels.length || reopenedLabels.length) {
      const what = [
        ...(reviewedLabels.length ? [`${reviewedLabels.join(', ')} is already reviewed`] : []),
        ...(reopenedLabels.length
          ? [`${reopenedLabels.join(', ')} was reviewed and is reopened`]
          : []),
      ].join(', and ');
      const reopenHint = reviewedLabels.length
        ? `; reopen reviewed parts with npm run content:review -- reopen ${current.country.id} --all --notes "..."`
        : '';
      throw new ReviewError(
        `A country redraft replaces the whole file and could renumber or drop stories, and ${what}. Send back the overview alone (--overview) or single stories instead${reopenHint}.`,
      );
    }
    const next = {
      ...current,
      country: { ...current.country, provenance: { ...current.country.provenance, revision } },
    };
    return written(next, current.country.id);
  }

  const story = current.stories.find((entry) => entry.id === options.storyId);
  if (!story) throw new ReviewError(`${current.country.id} has no story "${options.storyId}"`);
  if (story.provenance.status === 'reviewed') {
    throw new ReviewError(
      `${current.country.id}/${story.id} is already reviewed. To redraft it, reopen it with npm run content:review -- reopen ${current.country.id} ${story.id} --notes "..."`,
    );
  }
  const next: CountryFile = {
    ...current,
    stories: current.stories.map((entry) =>
      entry.id === story.id
        ? {
            ...entry,
            provenance: {
              ...entry.provenance,
              revision: { ...revision, ...keptReopening(entry.provenance) },
            },
          }
        : entry,
    ),
  };
  return written(next, `${current.country.id}/${story.id}`);
}

/**
 * The review a reopened part's request records, kept when review sends the part back again with
 * new notes, so it still shows that it was reviewed and reopened.
 */
const keptReopening = (provenance: Provenance): Pick<RevisionRequest, 'reopened'> =>
  provenance.revision?.reopened ? { reopened: provenance.revision.reopened } : {};

export type ReopenOptions = {
  contentDir: string;
  country: string;
  /** Reopen one reviewed story. */
  storyId?: string;
  /** Reopen the reviewed country part: kicker, overview, quick facts, starter questions, scene. */
  overview?: boolean;
  /** Reopen the overview and every story that is reviewed, each as its own part. */
  all?: boolean;
  notes: string;
  by: string;
  date: string;
};

/** A part reopened, with the review it undid. */
export type ReopenedPart = { label: string; reviewedBy: string; reviewedAt: string };

export type ReopenResult = {
  file: string;
  countryId: string;
  /** Whether the overview was reopened, which takes the whole country out of production. */
  overview: boolean;
  /** The story IDs reopened. */
  storyIds: string[];
  reopened: ReopenedPart[];
  /** Drafts that --all left as they were. */
  skipped: string[];
  /** The agent drafting command that redrafts everything now sent back in the country. */
  agentCommand: string;
};

/**
 * Reopen reviewed content: each named part becomes a draft again with a revision request that
 * carries the reviewer's notes and the review it undid (`revision.reopened`), so the paths that
 * redraft what review sent back (npm run content:generate -- --revisions, or
 * npm run content:agent -- start <country> --revisions) redraft it in place with all their checks.
 * The overview is reopened with `scope: "overview"` and each story on its own, never the whole
 * country as one file: a whole-file redraft could renumber or drop stories, whose IDs are
 * permanent. Production builds leave a reopened part out until it is approved again.
 */
export function reopen(options: ReopenOptions): ReopenResult {
  const current = loadCountry(options.contentDir, options.country);
  const id = current.country.id;
  const notes = options.notes.trim();
  if (!notes) {
    throw new ReviewError('Say why it is reopened and what should change with --notes "...".');
  }
  if (options.all && (options.storyId || options.overview)) {
    throw new ReviewError(
      '--all reopens the overview and every reviewed story; leave out the story and --overview.',
    );
  }
  if (options.overview && options.storyId) {
    throw new ReviewError(
      '--overview reopens the country part alone; reopen a story on its own, without --overview.',
    );
  }
  if (!options.all && !options.overview && !options.storyId) {
    throw new ReviewError(
      `Say what to reopen: a story (reopen ${id} <story>), the overview (--overview), or the overview and every reviewed story (--all). A reviewed country is never redrafted as one file, which could renumber or drop its stories.`,
    );
  }

  const notReviewed = (label: string, provenance: Provenance, revise: string) =>
    new ReviewError(
      provenance.revision
        ? `${label} is not reviewed: it is a draft already sent back, so there is nothing to reopen.`
        : `${label} is not reviewed: it is a draft, so there is nothing to reopen. Send it back with npm run content:review -- revise ${revise} --notes "..."`,
    );
  if (options.overview && current.country.provenance.status !== 'reviewed') {
    throw notReviewed(`The overview of ${id}`, current.country.provenance, `${id} --overview`);
  }
  if (options.storyId) {
    const story = current.stories.find((entry) => entry.id === options.storyId);
    if (!story) throw new ReviewError(`${id} has no story "${options.storyId}"`);
    if (story.provenance.status !== 'reviewed') {
      throw notReviewed(`${id}/${story.id}`, story.provenance, `${id} ${story.id}`);
    }
  }
  const reopenCountry = options.all
    ? current.country.provenance.status === 'reviewed'
    : !!options.overview;
  const storyIds = options.storyId
    ? [options.storyId]
    : options.all
      ? current.stories
          .filter((story) => story.provenance.status === 'reviewed')
          .map((story) => story.id)
      : [];
  if (!reopenCountry && !storyIds.length) {
    throw new ReviewError(
      `Nothing in ${id} is reviewed, so there is nothing to reopen. Send drafts back with npm run content:review -- revise.`,
    );
  }

  const revision = { notes, requestedBy: options.by, requestedAt: options.date };
  const reopened: ReopenedPart[] = [];
  const reopenPart = (
    label: string,
    provenance: Provenance,
    scope: Pick<RevisionRequest, 'scope'>,
  ): Provenance => {
    // The schema requires a reviewed part to name its reviewer and date.
    const { reviewedBy, reviewedAt, ...rest } = provenance;
    const review = { reviewedBy: reviewedBy!, reviewedAt: reviewedAt! };
    reopened.push({ label, ...review });
    return { ...rest, status: 'draft', revision: { ...revision, ...scope, reopened: review } };
  };
  const next: CountryFile = {
    country: reopenCountry
      ? {
          ...current.country,
          provenance: reopenPart(`${id} overview`, current.country.provenance, {
            scope: 'overview',
          }),
        }
      : current.country,
    stories: current.stories.map((story) =>
      storyIds.includes(story.id)
        ? { ...story, provenance: reopenPart(`${id}/${story.id}`, story.provenance, {}) }
        : story,
    ),
  };
  const skipped = options.all
    ? [
        ...(reopenCountry ? [] : [`${id} overview`]),
        ...current.stories
          .filter((story) => !storyIds.includes(story.id))
          .map((story) => `${id}/${story.id}`),
      ]
    : [];
  return {
    file: writeCountryFile(options.contentDir, next),
    countryId: id,
    overview: reopenCountry,
    storyIds,
    reopened,
    skipped,
    agentCommand: agentRedraftCommand(next),
  };
}
