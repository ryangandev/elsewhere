import { expectAnswer, expectPath, globeRegion, openAtlas, questionInput } from './atlas';
import { askedAs, exampleStory, nextStories, storyPath } from './content';
import { expect, test } from './fixtures';

// Headless CI browsers may have no WebGL at all. The atlas says so and keeps working.
test.describe('without WebGL', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
        if (/webgl/i.test(type)) return null;
        // eslint-disable-next-line prefer-rest-params
        return getContext.apply(this, arguments as never);
      } as typeof getContext;
    });
  });

  test('the globe reports that it could not load', async ({ page }) => {
    await openAtlas(page);

    await expect(globeRegion(page).getByText('The globe couldn’t load.')).toBeVisible();
    await expect(globeRegion(page).getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('THE STORIES ARE STILL HERE.')).toBeVisible();
  });

  test('map places are listed but cannot be found on the missing globe', async ({ page }) => {
    const story = exampleStory('SGP', 'shipping', { needs: ['places'] });
    await openAtlas(page, storyPath(story));
    await expect(globeRegion(page).getByText('The globe couldn’t load.')).toBeVisible();

    const connection = page.getByRole('region', { name: 'Explore the geography' });
    const places = connection.locator('.place-chips').getByRole('button');
    await expect(places).toHaveCount(story.scene.placeIds.length);
    for (const place of await places.all()) await expect(place).toBeDisabled();
    await expect(connection.getByText('Tap a place to find it on the globe.')).toHaveCount(0);
  });

  test('asking, reading and following a question still work', async ({ page }) => {
    const story = exampleStory('SGP', 'wealth', { needs: ['next'] });
    const [next] = nextStories(story);
    await openAtlas(page);
    await expect(globeRegion(page).getByText('The globe couldn’t load.')).toBeVisible();

    await questionInput(page).fill(askedAs(story));
    await page.getByRole('option', { name: new RegExp(story.question) }).click();
    await expectPath(page, storyPath(story));
    await expectAnswer(page, story);

    await page
      .getByRole('region', { name: 'WHERE THIS LEADS' })
      .getByRole('link', { name: next.question })
      .click();
    await expectPath(page, storyPath(next));
    await expectAnswer(page, next);
  });
});
