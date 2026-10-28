import { expectAnswer, expectPath, openAtlas, panel } from './atlas';
import { exampleStory, getCountry, storyPath, suggestedStories } from './content';
import { expect, test } from './fixtures';

const dialogName = 'Ask the atlas';

test.describe('search dialog', () => {
  test('Ctrl K opens it and a story can be found from there', async ({ page }) => {
    const suggested = suggestedStories();
    const story = suggested[1] ?? suggested[0];
    test.skip(!story, 'content/en suggests no reviewed question on the home page');
    await openAtlas(page);

    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: dialogName });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('combobox', { name: 'Ask a question or name a country' });
    await expect(input).toBeFocused();

    // Before anything is typed it offers places to begin.
    await expect(dialog.getByRole('group', { name: 'BEGIN WITH ONE OF THESE' })).toBeVisible();

    await input.fill(story.question);
    const result = dialog.getByRole('option', { name: story.question });
    await expect(result).toBeVisible();
    await result.click();

    await expectPath(page, storyPath(story));
    await expect(dialog).toBeHidden();
    await expectAnswer(page, story);
  });

  test('the header button opens it and Escape closes it', async ({ page }) => {
    await openAtlas(page);

    await page.getByRole('button', { name: 'Ask a question or find a country' }).click();
    const dialog = page.getByRole('dialog', { name: dialogName });
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('a reader can ask something else from inside a story', async ({ page }) => {
    const story = exampleStory('SGP', 'wealth');
    const other = exampleStory('TUR', 'straits', { not: story });
    await openAtlas(page, storyPath(story));

    await panel(page, getCountry(story.countryId).name)
      .getByRole('button', { name: 'Something else on your mind?' })
      .click();
    const dialog = page.getByRole('dialog', { name: dialogName });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('combobox').fill(other.question);
    await dialog.getByRole('option', { name: other.question }).click();

    await expectPath(page, storyPath(other));
    await expectAnswer(page, other);
  });
});
