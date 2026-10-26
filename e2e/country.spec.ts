import { expectAnswer, expectPath, openAtlas, panel } from './atlas';
import { editions, getStory, storyPath } from './content';
import { expect, test } from './fixtures';

test.describe('a country overview', () => {
  for (const { country, stories } of editions) {
    test(`${country.name} shows its starter questions`, async ({ page }) => {
      await openAtlas(page, `/${country.slug}`);

      const reading = panel(page, country.name);
      await expect(reading.getByRole('heading', { level: 2, name: country.name })).toBeVisible();
      await expect(reading.getByRole('heading', { level: 3, name: country.kicker })).toBeVisible();

      const starters = reading.getByRole('region', { name: 'START WITH A QUESTION' });
      await expect(starters.getByRole('link')).toHaveCount(country.starterStoryIds.length);
      for (const id of country.starterStoryIds) {
        const story = stories.find((candidate) => candidate.id === id)!;
        const link = starters.getByRole('link', { name: story.question });
        await expect(link).toHaveAttribute('href', storyPath(story));
      }
    });
  }

  test('a starter question opens its answer', async ({ page }) => {
    const { country } = editions[0];
    const story = getStory(country.id, country.starterStoryIds[0]);
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
