import {
  expectAnswer,
  expectNoReload,
  expectPath,
  globeRegion,
  homeHeading,
  markSession,
  openAtlas,
  panel,
  questionInput,
  storyHeading,
} from './atlas';
import { getCountry, getStory, nextStories, storyPath } from './content';
import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';

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

  // The globe's box in CSS pixels, once the panel's glide has finished.
  const settledBox = async (locator: Locator) => {
    let last = '';
    await expect
      .poll(async () => {
        const box = JSON.stringify(await locator.boundingBox());
        const settled = box === last;
        last = box;
        return settled;
      })
      .toBe(true);
    return (await locator.boundingBox())!;
  };

  test('the panel hands its room to the globe and takes it back', async ({ page }) => {
    const story = getStory('SGP', 'shipping');
    await openAtlas(page, storyPath(story));
    const reading = panel(page, getCountry(story.countryId).name);
    const globe = globeRegion(page);
    const makeRoom = reading.getByRole('button', { name: 'Make more room for the map' });

    await expect(makeRoom).toHaveAttribute('aria-expanded', 'true');
    await expect(storyHeading(reading, story.question)).toBeVisible();
    const open = { globe: await settledBox(globe), panel: await settledBox(reading) };

    // Collapsed: the panel is a strip, the story waits behind it and the globe takes the room.
    await makeRoom.tap();
    const expand = reading.getByRole('button', { name: 'Expand story', exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(storyHeading(reading, story.question)).toBeHidden();
    await expect(reading.getByRole('button', { name: /Continue reading/ })).toBeVisible();
    const collapsed = { globe: await settledBox(globe), panel: await settledBox(reading) };
    expect(collapsed.panel.height).toBeLessThan(open.panel.height / 2);
    expect(collapsed.panel.y).toBeGreaterThan(open.panel.y);
    expect(collapsed.globe.height).toBeGreaterThan(open.globe.height + 150);
    // The globe stops where the strip starts, and the page still fits the screen.
    expect(collapsed.globe.y + collapsed.globe.height).toBeLessThanOrEqual(collapsed.panel.y + 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(overflow).toBe(0);

    // Expanded again: everything is back where it was.
    await expand.tap();
    await expect(makeRoom).toHaveAttribute('aria-expanded', 'true');
    await expect(storyHeading(reading, story.question)).toBeVisible();
    const again = { globe: await settledBox(globe), panel: await settledBox(reading) };
    expect(again.globe.height).toBeCloseTo(open.globe.height, 0);
    expect(again.panel.y).toBeCloseTo(open.panel.y, 0);
  });

  test('the strip opens the story again, and a new page always starts open', async ({ page }) => {
    const story = getStory('SGP', 'shipping');
    const country = getCountry(story.countryId);
    await openAtlas(page, storyPath(story));
    const reading = panel(page, country.name);
    const makeRoom = reading.getByRole('button', { name: 'Make more room for the map' });

    await makeRoom.tap();
    await reading.getByRole('button', { name: /Continue reading/ }).tap();
    await expect(makeRoom).toHaveAttribute('aria-expanded', 'true');
    await expect(storyHeading(reading, story.question)).toBeVisible();

    // Leaving a collapsed panel for another page shows that page open, and so does coming back.
    await makeRoom.tap();
    await expect(storyHeading(reading, story.question)).toBeHidden();
    await page
      .getByRole('navigation', { name: 'Current place' })
      .getByRole('button', { name: country.name })
      .tap();
    await expectPath(page, `/${country.slug}`);
    const countryReading = panel(page, country.name);
    await expect(
      countryReading.getByRole('button', { name: 'Make more room for the map' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(
      countryReading.getByRole('heading', { level: 2, name: country.name }),
    ).toBeVisible();

    await page.goBack();
    await expectPath(page, storyPath(story));
    await expect(
      panel(page, country.name).getByRole('button', { name: 'Make more room for the map' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(storyHeading(panel(page, country.name), story.question)).toBeVisible();
  });
});
