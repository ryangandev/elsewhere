import { openAtlas, panel } from './atlas';
import { getCountry, getStory, storyPath } from './content';
import { expect, test } from './fixtures';

const story = getStory('SGP', 'shipping');
const country = getCountry(story.countryId);

type Copied = { __e2eCopied?: string[] };

/** Replaces the clipboard with one that records what is written, or refuses every write. */
async function stubClipboard(page: import('@playwright/test').Page, allow: boolean) {
  await page.addInitScript((allowWrites) => {
    const copied: string[] = [];
    (window as unknown as Copied).__e2eCopied = copied;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          if (!allowWrites) return Promise.reject(new DOMException('Denied', 'NotAllowedError'));
          copied.push(text);
          return Promise.resolve();
        },
      },
    });
  }, allow);
}

test.describe('share', () => {
  test('copies the link to the current view and says so', async ({ page, baseURL }) => {
    await stubClipboard(page, true);
    await openAtlas(page, storyPath(story));

    await panel(page, country.name).getByRole('button', { name: 'Share this view' }).click();

    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Link copied. A little curiosity, ready to share.' }),
    ).toBeVisible();
    const copied = await page.evaluate(() => (window as unknown as Copied).__e2eCopied);
    expect(copied).toEqual([`${baseURL}${storyPath(story)}`]);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('shows the link to copy by hand when the clipboard is refused', async ({
    page,
    baseURL,
  }) => {
    await stubClipboard(page, false);
    await openAtlas(page, storyPath(story));

    await panel(page, country.name).getByRole('button', { name: 'Share this view' }).click();

    const dialog = page.getByRole('dialog', { name: 'A little curiosity, shared.' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Share link' })).toHaveValue(
      `${baseURL}${storyPath(story)}`,
    );

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
  });
});
