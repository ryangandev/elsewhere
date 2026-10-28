// The checks a submission must pass before it is written: every rule of `npm run content:check`
// applied to the draft inside the current content tree, plus the pipeline's own rules (sources
// were retrieved in this task, links go to existing or planned stories, planned and linked story
// IDs are kept). Problems go back to the model as a repair request.
import type { LandIndex } from '../../src/content/geometry';
import type { CountryFile } from '../../src/content/schema';
import { validateContent } from '../../src/content/validate';
import { contentInput, countryFilePath, parsedCountryFiles } from '../content-tree';
import type { DraftSource } from './draft-schema';
import { normalizeUrl } from './evidence';

export type PlannedStory = { id: string; question: string };
/** Planned stories by country ID. */
export type Plan = Map<string, PlannedStory[]>;

export type CheckInput = {
  contentDir: string;
  candidate: CountryFile;
  /**
   * "country" for a whole draft, "overview" for the country part a revision replaced (every story
   * kept), or the one story a revision replaced.
   */
  scope: 'country' | 'overview' | { storyId: string };
  plan: Plan;
  /** Sources declared in this submission; each must have been retrieved in this task. */
  submittedSources: DraftSource[];
  /** Normalized URLs retrieved so far in this task. */
  evidence: Set<string>;
  /** Which pages may be cited, told to the drafter when a source was not retrieved. */
  evidenceRule?: string;
  /** Normalized URLs that were retrieved but cannot be cited, with the reason. */
  unusableEvidence?: Map<string, string>;
  storyCount: { min: number; max: number };
  land?: LandIndex;
};

const DEFAULT_EVIDENCE_RULE =
  'Cite only pages from your web_search results or pages you fetched with web_fetch.';

export function checkCandidate(input: CheckInput): string[] {
  const { candidate, scope, plan, contentDir } = input;
  const countryId = candidate.country.id;
  const file = countryFilePath(contentDir, candidate.country.slug);
  const issues: string[] = [];

  // Every content:check rule, for the candidate in the context of the whole tree.
  const inScope = (path: string) => {
    if (scope === 'country') return true;
    if (path === 'sources') return true;
    if (scope === 'overview') return path.startsWith('country');
    const revisedIndex = candidate.stories.findIndex((story) => story.id === scope.storyId);
    return path.startsWith(`stories[${revisedIndex}]`) || path === 'stories';
  };
  for (const issue of validateContent({
    ...contentInput(contentDir, [{ file, data: candidate }]),
    land: input.land,
  })) {
    if (issue.file === file && inScope(issue.path)) issues.push(`${issue.path}: ${issue.message}`);
  }

  for (const source of input.submittedSources) {
    const url = normalizeUrl(source.url);
    if (input.evidence.has(url)) continue;
    const unusable = input.unusableEvidence?.get(url);
    issues.push(
      unusable
        ? `sources: "${source.id}" (${source.url}) is not the page it should be: ${unusable}. It cannot support a claim; read the real page or choose another source.`
        : `sources: "${source.id}" (${source.url}) was not retrieved in this task. ${input.evidenceRule ?? DEFAULT_EVIDENCE_RULE}`,
    );
  }

  const others = parsedCountryFiles(contentDir);
  others.delete(countryId);
  const drafted =
    scope === 'country'
      ? candidate.stories
      : scope === 'overview'
        ? []
        : candidate.stories.filter((story) => story.id === scope.storyId);
  for (const story of drafted) {
    story.next.forEach((ref, index) => {
      if (ref.countryId === countryId || others.has(ref.countryId)) return; // content:check covers these
      if (!plan.get(ref.countryId)?.some((planned) => planned.id === ref.storyId)) {
        issues.push(
          `story "${story.id}" next[${index}]: "${ref.countryId}/${ref.storyId}" is neither an existing nor a planned story. Choose one from the link targets.`,
        );
      }
    });
  }

  if (scope === 'country') {
    const ids = new Set(candidate.stories.map((story) => story.id));
    for (const planned of plan.get(countryId) ?? []) {
      if (!ids.has(planned.id)) {
        issues.push(`stories: keep the planned story "${planned.id}" (${planned.question})`);
      }
    }
    for (const other of others.values()) {
      for (const story of other.stories) {
        for (const ref of story.next) {
          if (ref.countryId === countryId && !ids.has(ref.storyId)) {
            issues.push(
              `stories: "${other.country.id}/${story.id}" (${story.question}) links to story "${ref.storyId}" here. Keep a story with that ID.`,
            );
          }
        }
      }
    }
    const { min, max } = input.storyCount;
    if (candidate.stories.length < min || candidate.stories.length > max) {
      issues.push(`stories: write ${min} to ${max} stories, not ${candidate.stories.length}`);
    }
  }

  const text = JSON.stringify(candidate, (key, value) =>
    key === 'nativeName' ? undefined : value,
  );
  if (/\p{Script=Han}/u.test(text)) issues.push('Write in English only, apart from nativeName.');

  return [...new Set(issues)];
}
