import { expectAnswer, expectPath, homeHeading, openAtlas, questionInput } from './atlas';
import { storyPath, suggestedStories } from './content';
import { expect, test } from './fixtures';

test.describe('home', () => {
  test('leads with the question input and the suggested questions', async ({ page }) => {
    await openAtlas(page);

    await expect(homeHeading(page)).toBeVisible();
    await expect(questionInput(page)).toBeVisible();
    await expect(questionInput(page)).toHaveAttribute('placeholder', 'What are you curious about?');

    const suggestions = page.getByRole('region', { name: 'OR BEGIN WITH ONE OF THESE' });
    for (const story of suggestedStories()) {
      const link = suggestions.getByRole('link', { name: story.question });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', storyPath(story));
    }
    await expect(suggestions.getByRole('link')).toHaveCount(suggestedStories().length);
  });

  test('a suggested question opens its sourced answer', async ({ page }) => {
    const [story] = suggestedStories();
    test.skip(!story, 'content/en suggests no reviewed question on the home page');
    await openAtlas(page);

    await page
      .getByRole('region', { name: 'OR BEGIN WITH ONE OF THESE' })
      .getByRole('link', { name: story.question })
      .click();

    await expectPath(page, storyPath(story));
    await expectAnswer(page, story);
    await expect(homeHeading(page)).toBeHidden();
  });
});
