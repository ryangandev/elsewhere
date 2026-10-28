import { openAtlas, panel } from './atlas';
import { exampleStory, getCountry, storyPath, type Country, type Story } from './content';
import { expect, test } from './fixtures';

let story: Story;
let country: Country;

test.describe('your atlas', () => {
  test.beforeEach(() => {
    story = exampleStory('SGP', 'shipping');
    country = getCountry(story.countryId);
  });

  test('a saved story is listed in the drawer, kept across visits, and can be removed', async ({
    page,
  }) => {
    await openAtlas(page, storyPath(story));

    await panel(page, country.name).getByRole('button', { name: 'Save this story' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved to your atlas.' }),
    ).toBeVisible();
    await expect(
      panel(page, country.name).getByRole('button', { name: 'Unsave this story' }),
    ).toBeVisible();

    // It is kept on this browser, so it is still there on a fresh visit to another page.
    await openAtlas(page, `/${country.slug}`);
    await page.getByRole('button', { name: 'Open your atlas' }).click();
    const drawer = page.getByRole('dialog', { name: 'Your little atlas.' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('tab', { name: /Saved/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const saved = drawer.getByRole('tabpanel');
    await expect(saved.getByRole('link', { name: new RegExp(story.question) })).toHaveAttribute(
      'href',
      storyPath(story),
    );

    await saved.getByRole('button', { name: `Remove ${story.question} from saved` }).click();
    await expect(saved.getByRole('link', { name: new RegExp(story.question) })).toBeHidden();
    await expect(saved.getByText('Keep a little curiosity for later.')).toBeVisible();
  });

  test('a saved story opens from the drawer', async ({ page }) => {
    await openAtlas(page, storyPath(story));
    await panel(page, country.name).getByRole('button', { name: 'Save this story' }).click();
    await openAtlas(page);

    await page.getByRole('button', { name: 'Open your atlas' }).click();
    const drawer = page.getByRole('dialog', { name: 'Your little atlas.' });
    await drawer.getByRole('link', { name: new RegExp(story.question) }).click();

    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${storyPath(story)}$`));
    await expect(
      panel(page, country.name).getByRole('heading', { level: 2, name: story.question }),
    ).toBeVisible();
  });
});
