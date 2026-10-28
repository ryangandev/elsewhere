import { expectAnswer, expectPath, openAtlas, panel } from './atlas';
import { getCountry, getStory, storyPath, trails, type Story, type Trail } from './content';
import { expect, test } from './fixtures';

let trail: Trail;
let first: Story;
let second: Story;

// The first trail the drawer lists, with the stops that production publishes.
test.beforeEach(() => {
  [trail] = trails();
  test.skip(!trail, 'content/en has no trail with two reviewed stories');
  [first, second] = trail.stops.map((stop) => getStory(stop.countryId, stop.storyId));
});

test.describe('trails', () => {
  test('the drawer lists every trail and follows one from its first stop', async ({ page }) => {
    await openAtlas(page);

    await page.getByRole('button', { name: 'Explore trails' }).click();
    const drawer = page.getByRole('dialog', { name: /One question\./ });
    await expect(drawer).toBeVisible();
    for (const { title } of trails()) {
      await expect(drawer.getByRole('heading', { level: 3, name: title })).toBeVisible();
    }

    await drawer
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: trail.title }) })
      .getByRole('button', { name: /Follow this trail/ })
      .click();

    await expect(drawer).toBeHidden();
    await expectPath(page, storyPath(first));
    await expect(page).toHaveURL(new RegExp(`\\?trail=${trail.id}$`));
    await expectAnswer(page, first);

    // The panel shows where the reader is on the trail.
    const stops = panel(page, getCountry(first.countryId).name).getByRole('navigation', {
      name: 'Trail stops',
    });
    await expect(stops.getByRole('button')).toHaveCount(trail.stops.length);
    await expect(
      stops.getByRole('button', { name: getCountry(first.countryId).name }),
    ).toHaveAttribute('aria-current', 'step');
  });

  test('a reader can move along a trail and leave it', async ({ page }) => {
    await openAtlas(page, `${storyPath(first)}?trail=${trail.id}`);

    const reading = panel(page, getCountry(first.countryId).name);
    await reading.getByText('NEXT ON YOUR TRAIL').scrollIntoViewIfNeeded();
    await reading.getByRole('link', { name: new RegExp(second.question) }).click();

    await expectPath(page, storyPath(second));
    await expect(page).toHaveURL(new RegExp(`\\?trail=${trail.id}$`));
    const next = panel(page, getCountry(second.countryId).name);
    await expect(
      next
        .getByRole('navigation', { name: 'Trail stops' })
        .getByRole('button', { name: getCountry(second.countryId).name }),
    ).toHaveAttribute('aria-current', 'step');

    await next.getByRole('button', { name: 'Leave this trail' }).click();
    await expect(page).not.toHaveURL(/trail=/);
    await expectPath(page, storyPath(second));
    await expect(next.getByRole('navigation', { name: 'Trail stops' })).toBeHidden();
  });
});
