// The checks a submission must pass before it is written: every rule of `npm run content:check`
// applied to the draft inside the current content tree, plus the pipeline's own rules (sources
// were retrieved in this task, links go to existing or planned stories, and a whole draft keeps
// every story ID that is planned or that other content or an old URL names). Problems go back to the model as a repair request.
import type { LandIndex } from '../../src/content/geometry';
import { HomeFile, TrailsFile, type CountryFile } from '../../src/content/schema';
import { validateContent } from '../../src/content/validate';
import { PROTOTYPE_QUESTIONS } from '../../src/domain/prototype-urls';
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
  const tree = contentInput(contentDir, [{ file, data: candidate }]);
  for (const issue of validateContent({ ...tree, land: input.land })) {
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
  const existing = others.get(countryId);
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
    // The home screen, trails and the prototype's URLs name stories here by ID too. content:check
    // reports a missing one against home.json or trails.json, which the checks above leave out.
    const home = HomeFile.safeParse(tree.home.data).data;
    home?.suggestedQuestions.forEach((ref) => {
      if (ref.countryId === countryId && !ids.has(ref.storyId)) {
        issues.push(
          `stories: the home screen suggests story "${ref.storyId}" here. Keep a story with that ID.`,
        );
      }
    });
    for (const trail of TrailsFile.safeParse(tree.trails.data).data ?? []) {
      for (const stop of trail.stops) {
        if (stop.countryId === countryId && !ids.has(stop.storyId)) {
          issues.push(
            `stories: the trail "${trail.id}" (${trail.title}) stops at story "${stop.storyId}" here. Keep a story with that ID.`,
          );
        }
      }
    }
    // A prototype question's path is linked from outside as well as redirected to, so it keeps
    // its slug too.
    for (const storyId of PROTOTYPE_QUESTIONS[countryId] ?? []) {
      const index = candidate.stories.findIndex((story) => story.id === storyId);
      const slug = existing?.stories.find((story) => story.id === storyId)?.slug;
      if (index < 0) {
        issues.push(
          `stories: the prototype published story "${storyId}" here, and its old URL redirects to it. Keep a story with that ID.`,
        );
      } else if (slug && candidate.stories[index].slug !== slug) {
        issues.push(
          `stories[${index}].slug: keep the slug "${slug}"; "${storyId}" is a question the prototype published, and links and its old URL lead to that path.`,
        );
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
