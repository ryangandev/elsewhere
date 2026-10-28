// The content loaders (`@/content`) over the frozen hand-converted tree, for tests of the layers
// built on them: page views, search, the sitemap. Use it from a test file with
//
//   vi.mock('@/content', async () => (await import('./support/hand-converted-content')).loaders());
//
// so those tests run the same however many countries content/en has and whatever is reviewed in it.
import { vi } from 'vitest';
import { readContentTree } from '../../src/content/files';
import { createContentStore } from '../../src/content/store';
import { HAND_CONVERTED_CONTENT_DIR } from '../content/load';

export async function loaders() {
  const actual = await vi.importActual<typeof import('../../src/content')>('../../src/content');
  const tree = () => readContentTree(HAND_CONVERTED_CONTENT_DIR);
  // Tests run outside production, where the loaders show drafts; all of this tree is reviewed.
  return {
    ...actual,
    ...createContentStore(tree, { includeDrafts: true }),
    publishedContent: createContentStore(tree, { includeDrafts: false }),
  };
}
