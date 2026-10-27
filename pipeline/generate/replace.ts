// When a new country draft may replace the file already in the content tree. Kept apart from
// run.ts, which loads the Anthropic SDK, so the agent drafting commands can use it without
// paying that startup cost.
import type { CountryFile } from '../../src/content/schema';

const hasReviewed = (file: CountryFile) =>
  file.country.provenance.status === 'reviewed' ||
  file.stories.some((story) => story.provenance.status === 'reviewed');

/**
 * Why a new country draft may not replace the existing file: it has reviewed content (only
 * --force replaces it), or it is a draft nobody sent back (only --regenerate replaces it).
 */
export function replaceConflict(
  existing: CountryFile | undefined,
  flags: { regenerate: boolean; force: boolean },
): 'reviewed' | 'draft' | undefined {
  if (!existing) return undefined;
  if (hasReviewed(existing) && !flags.force) return 'reviewed';
  if (existing.country.provenance.revision || flags.regenerate || flags.force) return undefined;
  return 'draft';
}
