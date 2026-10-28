import { expectAnswer, expectPath, openAtlas, panel } from './atlas';
import { editions, starterStories, storyPath } from './content';
import { expect, test } from './fixtures';

test.describe('a country overview', () => {
  for (const edition of editions.filter((candidate) => starterStories(candidate).length > 0)) {
    const { country } = edition;
    const starters = starterStories(edition);
    test(`${country.name} shows its starter questions`, async ({ page }) => {
      await openAtlas(page, `/${country.slug}`);

      const reading = panel(page, country.name);
      await expect(reading.getByRole('heading', { level: 2, name: country.name })).toBeVisible();
      await expect(reading.getByRole('heading', { level: 3, name: country.kicker })).toBeVisible();

      const region = reading.getByRole('region', { name: 'START WITH A QUESTION' });
      await expect(region.getByRole('link')).toHaveCount(starters.length);
      for (const story of starters) {
        const link = region.getByRole('link', { name: story.question });
        await expect(link).toHaveAttribute('href', storyPath(story));
      }
    });
  }

  test('a starter question opens its answer', async ({ page }) => {
    const edition = editions.find((candidate) => starterStories(candidate).length > 0)!;
    test.skip(!edition, 'content/en has no reviewed country with a reviewed starter question');
    const { country } = edition;
    const [story] = starterStories(edition);
    await openAtlas(page, `/${country.slug}`);

    await panel(page, country.name)
      .getByRole('region', { name: 'START WITH A QUESTION' })
      .getByRole('link', { name: story.question })
      .click();

    await expectPath(page, storyPath(story));
    await expectAnswer(page, story);
  });

  test('a country without an edited story shows its map basics', async ({ page }) => {
    const edited = new Set(editions.map(({ country }) => country.slug));
    const slug = ['afghanistan', 'albania', 'algeria'].find((candidate) => !edited.has(candidate))!;
    await openAtlas(page, `/${slug}`);

    const reading = page.getByRole('complementary', { name: /explorer$/ });
    await expect(reading).toBeVisible();
    await expect(reading.getByText('BASIC OVERVIEW')).toBeVisible();
    await expect(reading.getByRole('region', { name: 'START WITH A QUESTION' })).toHaveCount(0);
  });
});
