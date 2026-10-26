import {
  expectAnswer,
  expectNoReload,
  expectPath,
  markSession,
  openAtlas,
  panel,
  storyHeading,
} from './atlas';
import { getCountry, getStory, nextStories, storyPath } from './content';
import { expect, test } from './fixtures';

const story = getStory('SGP', 'wealth');

test.describe('a story', () => {
  test('cites its sources as links', async ({ page }) => {
    await openAtlas(page, storyPath(story));
    await expectAnswer(page, story);

    // Each section also names who it relies on, linking straight to the source.
    const reading = panel(page, getCountry(story.countryId).name);
    for (const section of story.sections) {
      for (const id of section.sourceIds) {
        const source = story.sources.find((candidate) => candidate.id === id)!;
        const cited = reading.getByRole('link', { name: source.publisher, exact: true });
        await expect(cited.first()).toHaveAttribute('href', source.url);
      }
    }
  });

  test('offers the next questions, each saying where it goes', async ({ page }) => {
    const next = nextStories(story);
    await openAtlas(page, storyPath(story));

    const onward = page.getByRole('region', { name: 'WHERE THIS LEADS' });
    await expect(onward.getByRole('link')).toHaveCount(Math.min(next.length, 3));
    for (const target of next) {
      const country = getCountry(target.countryId);
      const link = onward.getByRole('link', { name: target.question });
      await expect(link).toHaveAttribute('href', storyPath(target));
      await expect(link).toContainText(
        target.countryId === story.countryId
          ? `Deeper in ${country.name}`
          : `Elsewhere · ${country.name}`,
      );
    }
  });

  test('following a next question swaps the panel and keeps the globe', async ({ page }) => {
    const [target] = nextStories(story);
    await openAtlas(page, storyPath(story));
    await markSession(page);

    await page
      .getByRole('region', { name: 'WHERE THIS LEADS' })
      .getByRole('link', {
        name: target.question,
      })
      .click();

    await expectPath(page, storyPath(target));
    await expectAnswer(page, target);
    await expect(storyHeading(page, story.question)).toBeHidden();
    // Same document, same globe: nothing was reloaded or recreated.
    await expectNoReload(page);
  });

  test("following a question elsewhere opens the other country's panel", async ({ page }) => {
    const elsewhere = nextStories(story).find((target) => target.countryId !== story.countryId)!;
    await openAtlas(page, storyPath(story));
    await markSession(page);

    await page
      .getByRole('region', { name: 'WHERE THIS LEADS' })
      .getByRole('link', { name: elsewhere.question })
      .click();

    await expectPath(page, storyPath(elsewhere));
    await expect(panel(page, getCountry(elsewhere.countryId).name)).toBeVisible();
    await expectNoReload(page);
  });
});
