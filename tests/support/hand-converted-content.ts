// The content loaders (`@/content`) over the frozen hand-converted tree, for tests of the layers
// built on them: page views, search, the sitemap. Use it from a test file with
//
//   vi.mock('@/content', async () => (await import('./support/hand-converted-content')).loaders());
//
// so those tests run the same however many countries content/en has and whatever is reviewed in it.
//
// The loaders behave as in a production build: reviewed content only, which is what the sitemap,
// the search index and the pages must be built from. `developmentContent` is the same tree read
// the way development reads content/en, drafts included, so a test can tell the two apart. The
// frozen tree is all reviewed, so they differ only where a test reopens a story (see `reopened`).
import { vi } from 'vitest';
import { readContentTree, type ContentTree } from '../../src/content/files';
import { createContentStore } from '../../src/content/store';
import { HAND_CONVERTED_CONTENT_DIR } from '../content/load';

export type StoryRef = { countryId: string; storyId: string };

type StoryData = {
  id: string;
  countryId: string;
  provenance: Record<string, unknown>;
};

/**
 * The frozen tree with these stories reopened, the way `content:review -- reopen` leaves them: a
 * draft with a revision request, no reviewer outside it. Done on a copy as it is read, so the
 * frozen files stay as they are.
 */
export function handConvertedTree(reopened: StoryRef[] = []): ContentTree {
  const tree = readContentTree(HAND_CONVERTED_CONTENT_DIR);
  for (const { countryId, storyId } of reopened) {
    const story = tree.countryFiles
      .flatMap(({ data }) => (data as { stories: StoryData[] }).stories)
      .find((entry) => entry.countryId === countryId && entry.id === storyId);
    if (!story) throw new Error(`The frozen tree has no story ${countryId}/${storyId}`);
    const { reviewedBy, reviewedAt, ...provenance } = story.provenance;
    story.provenance = {
      ...provenance,
      status: 'draft',
      revision: {
        notes: 'Reopened by the test setup.',
        requestedBy: 'Tester',
        requestedAt: '2026-10-28',
        reopened: { reviewedBy, reviewedAt },
      },
    };
  }
  return tree;
}

export async function loaders(options: { reopened?: StoryRef[] } = {}) {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content');
  const tree = () => handConvertedTree(options.reopened);
  const published = createContentStore(tree, { includeDrafts: false });
  return {
    ...actual,
    ...published,
    publishedContent: published,
    developmentContent: createContentStore(tree, { includeDrafts: true }),
  };
}
