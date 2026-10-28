import {
  expectAnswer,
  expectPath,
  homeHeading,
  openAtlas,
  panel,
  questionInput,
  storyHeading,
} from './atlas';
import {
  editions,
  exampleCountry,
  exampleStory,
  getCountry,
  nextStories,
  storyPath,
  suggestedStories,
} from './content';
import { expect, test } from './fixtures';

test.describe('routing', () => {
  test('a deep story URL loads directly', async ({ page }) => {
    // The last edited country's last story: not reachable from the home page in one click.
    const edition = editions.filter(({ stories }) => stories.length > 0).at(-1)!;
    test.skip(!edition, 'content/en has no reviewed story');
    const story = edition.stories.at(-1)!;

    const response = await page.goto(storyPath(story));

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(new RegExp(story.question.replace(/[?]/g, '\\$&')));
    await expectAnswer(page, story);
  });

  test('a reload stays on the same story', async ({ page }) => {
    const story = exampleStory('SGP', 'wealth');
    await openAtlas(page, storyPath(story));
    await page.reload();
    await expectAnswer(page, story);
  });

  test('an unknown path shows the not-found page', async ({ page }) => {
    const response = await page.goto('/atlantis');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: /find that place/ })).toBeVisible();
    await expect(questionInput(page)).toBeVisible();

    // The way back works.
    await page.getByRole('link', { name: 'Back to the globe' }).click();
    await expectPath(page, '/');
    await expect(homeHeading(page)).toBeVisible();
  });

  test('an unknown question in a real country is not found either', async ({ page }) => {
    const country = exampleCountry('SGP');
    const response = await page.goto(`/${country.slug}/no-such-question`);

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: /find that place/ })).toBeVisible();
  });

  test('back and forward restore the previous panel', async ({ page }) => {
    const first = suggestedStories().find((story) => nextStories(story).length > 0)!;
    test.skip(!first, 'content/en suggests no reviewed question that leads on to another');
    const second = nextStories(first)[0];
    await openAtlas(page);

    await page
      .getByRole('region', { name: 'OR BEGIN WITH ONE OF THESE' })
      .getByRole('link', { name: first.question })
      .click();
    await expectPath(page, storyPath(first));
    await page
      .getByRole('region', { name: 'WHERE THIS LEADS' })
      .getByRole('link', { name: second.question })
      .click();
    await expectPath(page, storyPath(second));
    await expect(storyHeading(page, second.question)).toBeVisible();

    await page.goBack();
    await expectPath(page, storyPath(first));
    await expect(storyHeading(page, first.question)).toBeVisible();
    await expect(storyHeading(page, second.question)).toBeHidden();

    await page.goBack();
    await expectPath(page, '/');
    await expect(homeHeading(page)).toBeVisible();
    await expect(panel(page, getCountry(first.countryId).name)).toBeHidden();

    await page.goForward();
    await expectPath(page, storyPath(first));
    await expect(storyHeading(page, first.question)).toBeVisible();

    await page.goForward();
    await expectPath(page, storyPath(second));
    await expect(storyHeading(page, second.question)).toBeVisible();
  });
});
