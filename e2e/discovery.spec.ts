import { editions, exampleStory, storyPath } from './content';
import { expect, test } from './fixtures';

// What search engines and link previews read from the built site.
test.describe('discovery files', () => {
  test('robots.txt allows crawling and points at the sitemap', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).toMatch(/^User-Agent: \*$/m);
    expect(text).toMatch(/^Allow: \/$/m);
    expect(text).toMatch(/^Sitemap: https?:\/\/[^/]+\/sitemap\.xml$/m);
  });

  test('the sitemap lists the home page and every published country and question', async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    const paths = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      ([, url]) => new URL(url).pathname,
    );
    const expected = [
      '/',
      ...editions.map(({ country }) => `/${country.slug}`),
      ...editions.flatMap(({ stories }) => stories.map(storyPath)),
    ];
    expect(paths.sort()).toEqual(expected.sort());
  });

  test('pages name their canonical address, and the not-found page names none', async ({
    page,
  }) => {
    const canonical = page.locator('link[rel="canonical"]');
    const story = exampleStory('SGP', 'shipping');

    await page.goto(`${storyPath(story)}?trail=water-connects`);
    expect(new URL((await canonical.getAttribute('href'))!).pathname).toBe(storyPath(story));
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      (await canonical.getAttribute('href'))!,
    );

    await page.goto('/');
    expect(new URL((await canonical.getAttribute('href'))!).pathname).toBe('/');

    await page.goto('/atlantis');
    await expect(canonical).toHaveCount(0);
  });
});
