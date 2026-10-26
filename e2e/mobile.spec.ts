import {
  expectAnswer,
  expectNoReload,
  expectPath,
  homeHeading,
  markSession,
  openAtlas,
  panel,
  questionInput,
  storyHeading,
} from './atlas';
import { getCountry, getStory, nextStories, storyPath } from './content';
import { expect, test } from './fixtures';

// Runs only in the phone project (playwright.config.ts): the core loop by touch on a narrow screen.
test.describe('on a phone', () => {
  test('home, ask, read and follow a question', async ({ page }) => {
    const story = getStory('SGP', 'wealth');
    const [next] = nextStories(story);
    await openAtlas(page);
    await expect(homeHeading(page)).toBeVisible();

    // Nothing is wider than the screen.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await questionInput(page).tap();
    await questionInput(page).fill('What makes Singapore wealthy?');
    await expect(page.getByRole('option', { name: new RegExp(story.question) })).toBeVisible();
    await page.getByRole('option', { name: new RegExp(story.question) }).tap();

    await expectPath(page, storyPath(story));
    await expectAnswer(page, story);
    await markSession(page);

    await page
      .getByRole('region', { name: 'WHERE THIS LEADS' })
      .getByRole('link', { name: next.question })
      .tap();

    await expectPath(page, storyPath(next));
    await expect(
      storyHeading(panel(page, getCountry(next.countryId).name), next.question),
    ).toBeVisible();
    await expectNoReload(page);
  });

  test('the controls a thumb reaches for are at least 44 points', async ({ page }) => {
    const story = getStory('SGP', 'shipping');
    await openAtlas(page, storyPath(story));
    const reading = panel(page, getCountry(story.countryId).name);

    const controls = [
      page.getByRole('button', { name: 'Explore trails' }),
      page.getByRole('button', { name: 'Open your atlas' }),
      page.getByRole('button', { name: 'Ask a question or find a country' }),
      reading.getByRole('button', { name: 'Save this story' }),
      reading.getByRole('button', { name: 'Share this view' }),
      reading.getByRole('button', { name: 'Close country' }),
    ];
    for (const control of controls) {
      const box = await control.boundingBox();
      const name = String(await control.getAttribute('aria-label'));
      expect(box, name).not.toBeNull();
      expect(box!.width, name).toBeGreaterThanOrEqual(44);
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
  });
});
