import { expectAnswer, expectPath, openAtlas, pathOf, questionInput } from './atlas';
import { getStory, storyPath } from './content';
import { expect, test } from './fixtures';

test.describe('asking a question', () => {
  test('a question the atlas answers leads to its story', async ({ page }) => {
    const story = getStory('SGP', 'wealth');
    await openAtlas(page);

    await questionInput(page).fill('What makes Singapore wealthy?');
    // The atlas index loads on first focus; Enter opens the top result once it is listed.
    await expect(page.getByRole('option', { name: new RegExp(story.question) })).toBeVisible();
    await questionInput(page).press('Enter');

    await expectPath(page, storyPath(story));
    await expectAnswer(page, story);
  });

  test('a question the atlas cannot answer says so instead of failing', async ({ page }) => {
    await openAtlas(page);

    await questionInput(page).fill('Why is the sky blue?');

    const notice = page
      .getByRole('status')
      .filter({ hasText: 'The atlas has not answered that yet.' });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('drawn from sources and reviewed');
    // It offers real stories to begin with, and nothing was invented or opened.
    await expect(page.getByRole('group', { name: 'BEGIN WITH ONE OF THESE' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);

    // Enter does not open a near miss in place of an answer.
    await questionInput(page).press('Enter');
    await expect(notice).toBeVisible();
    expect(pathOf(page)).toBe('/');

    // Moving to a row first makes Enter open it, starting from the top one.
    const first = page.getByRole('option').first();
    await questionInput(page).press('ArrowDown');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await questionInput(page).press('Enter');
    await expect(page).not.toHaveURL(/\/$/);
  });
});
