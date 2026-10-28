// When a new country draft may replace the file already in the content tree. Kept apart from
// run.ts, which loads the Anthropic SDK, so the agent drafting commands can use it without
// paying that startup cost.
import type { CountryFile, RevisionRequest } from '../../src/content/schema';

/** The country's revision request when review sent back the whole country, which is drafted again. */
export const wholeCountryRevision = (file: CountryFile): RevisionRequest | undefined => {
  const request = file.country.provenance.revision;
  return request && !request.scope ? request : undefined;
};

/**
 * The country's revision request when review sent back only the country part (the overview, quick
 * facts, starter questions and scene), which is redrafted in place while every story stays.
 */
export const overviewRevision = (file: CountryFile): RevisionRequest | undefined => {
  const request = file.country.provenance.revision;
  return request?.scope === 'overview' ? request : undefined;
};

const hasReviewed = (file: CountryFile) =>
  file.country.provenance.status === 'reviewed' ||
  file.stories.some((story) => story.provenance.status === 'reviewed');

/**
 * Why a new country draft may not replace the existing file: it has reviewed content (only
 * --force replaces it), or it is a draft nobody sent back as a whole (only --regenerate replaces
 * it). A country whose overview alone is sent back is still such a draft: its overview is
 * redrafted in place, not the file.
 */
export function replaceConflict(
  existing: CountryFile | undefined,
  flags: { regenerate: boolean; force: boolean },
): 'reviewed' | 'draft' | undefined {
  if (!existing) return undefined;
  if (hasReviewed(existing) && !flags.force) return 'reviewed';
  if (wholeCountryRevision(existing) || flags.regenerate || flags.force) return undefined;
  return 'draft';
}
