// What production publishes when part of the content is a draft. The frozen hand-converted tree is
// all reviewed, so on its own a sitemap or search index built from the draft-including loaders
// would look the same as one built from the published ones. Here one story is reopened in the
// mocked tree, so the two differ, and the sitemap, the search index and the pages must show only
// what production publishes.
import { describe, expect, it, vi } from 'vitest';
import type { ContentStore } from '@/content';
import { getHome, getStory, listCountries, listStories, listTrails } from '@/content';
import { createAtlasLookup } from '@/domain/atlas-index';
import { buildAtlasIndex } from '@/domain/client-indexes';
import { searchAtlas } from '@/domain/search';
import { buildSitemap } from '@/domain/site';

// Singapore's shipping question, reopened by review: a draft, which production does not build.
vi.mock('@/content', async () =>
  (await import('./support/hand-converted-content')).loaders({
    reopened: [{ countryId: 'SGP', storyId: 'shipping' }],
  }),
);

const REOPENED = { countryId: 'SGP', storyId: 'shipping' };
const ORIGIN = 'https://elsewhere.example';
const REOPENED_URL = `${ORIGIN}/singapore/shipping`;

/** The same tree read the way development reads content, drafts included. */
async function developmentContent(): Promise<ContentStore> {
  return ((await import('@/content')) as unknown as { developmentContent: ContentStore })
    .developmentContent;
}

describe('a reopened story', () => {
  it('is a draft in the tree, so the draft-including loaders still have it', async () => {
    const development = await developmentContent();
    expect(development.getStory(REOPENED.countryId, REOPENED.storyId)).toMatchObject({
      provenance: { status: 'draft', revision: { reopened: { reviewedBy: expect.any(String) } } },
    });
    expect(development.listStories('SGP').map((story) => story.id)).toContain('shipping');
    expect(
      development
        .listTrails()
        .flatMap((trail) => trail.stops)
        .some((stop) => stop.storyId === 'shipping' && stop.countryId === 'SGP'),
    ).toBe(true);
    // A neighbour of it stays reviewed in both.
    expect(development.getStory('SGP', 'wealth')?.provenance.status).toBe('reviewed');
  });

  it('is left out of the loaders the site is built from, with every link to it', () => {
    expect(getStory('SGP', 'shipping')).toBeUndefined();
    expect(listStories('SGP').map((story) => story.id)).not.toContain('shipping');
    expect(listStories('SGP')).not.toHaveLength(0);
    expect(listCountries().map((country) => country.id)).toContain('SGP');
    const links = [
      ...listStories().flatMap((story) => story.next),
      ...listTrails().flatMap((trail) => trail.stops),
      ...getHome().suggestedQuestions,
    ];
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((ref) => ref.countryId === 'SGP' && ref.storyId === 'shipping')).toBe(false);
  });

  it('is missing from the sitemap, while its country and its neighbours are listed', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'elsewhere.example');
    try {
      const urls = buildSitemap().map((entry) => entry.url);
      expect(urls).not.toContain(REOPENED_URL);
      expect(urls).toContain(`${ORIGIN}/singapore`);
      expect(urls).toContain(`${ORIGIN}/singapore/wealth`);
      // Everything else the draft-including loaders list is there: only the reopened story differs.
      const development = await developmentContent();
      expect(urls).toHaveLength(
        1 + development.listCountries().length + development.listStories().length - 1,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('is missing from the search index and from search, while its neighbours are found', () => {
    // The index exactly as the browser receives it.
    const index = JSON.parse(JSON.stringify(buildAtlasIndex()));
    const lookup = createAtlasLookup(index);
    expect(lookup.story(REOPENED.countryId, REOPENED.storyId)).toBeUndefined();
    expect(lookup.stories('SGP').map((story) => story.id)).not.toContain('shipping');
    expect(index.suggestions).not.toContainEqual(REOPENED);

    for (const query of ['Why is Singapore a shipping crossroads?', 'shipping', 'ship']) {
      const found = searchAtlas(index, query).filter((result) => result.kind === 'story');
      expect(
        found.map((result) => `${result.countryId}/${result.storyId}`),
        query,
      ).not.toContain('SGP/shipping');
    }
    expect(
      searchAtlas(index, 'Why is Singapore so rich?').find((result) => result.kind === 'story')
        ?.storyId,
    ).toBe('wealth');
  });
});
