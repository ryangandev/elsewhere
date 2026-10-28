import type { Page } from '@playwright/test';
import { openAtlas, panel } from './atlas';
import { exampleStory, getCountry, storyPath, type Country, type Story } from './content';
import { expect, test } from './fixtures';

let story: Story;
let country: Country;

test.beforeEach(() => {
  story = exampleStory('SGP', 'shipping');
  country = getCountry(story.countryId);
});

type Recorded = { __e2eCopied?: string[]; __e2eShared?: { title: string; url: string }[] };

/** Replaces the clipboard with one that records what is written, or refuses every write. */
async function stubClipboard(page: Page, allow: boolean) {
  await page.addInitScript((allowWrites) => {
    const copied: string[] = [];
    (window as unknown as Recorded).__e2eCopied = copied;
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

/** Gives the page a share sheet that records what it is offered, then ends as asked. */
async function stubShareSheet(page: Page, outcome: 'completes' | 'is closed' | 'is refused') {
  await page.addInitScript((how) => {
    const shared: { title: string; url: string }[] = [];
    (window as unknown as Recorded).__e2eShared = shared;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: { title: string; url: string }) => {
        shared.push(data);
        if (how === 'is closed') return Promise.reject(new DOMException('Closed', 'AbortError'));
        if (how === 'is refused') return Promise.reject(new DOMException('No', 'NotAllowedError'));
        return Promise.resolve();
      },
    });
  }, outcome);
}

const recorded = (page: Page) =>
  page.evaluate(() => {
    const { __e2eCopied, __e2eShared } = window as unknown as Recorded;
    return { copied: __e2eCopied ?? [], shared: __e2eShared ?? [] };
  });

const shareButton = (page: Page) =>
  panel(page, country.name).getByRole('button', { name: 'Share this view' });

const linkCopied = (page: Page) =>
  page.getByRole('status').filter({ hasText: 'Link copied. A little curiosity, ready to share.' });

test.describe('share on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'the phone has its own tests below');

  test('copies the link to the current view and says so', async ({ page, baseURL }) => {
    await stubClipboard(page, true);
    await openAtlas(page, storyPath(story));

    await shareButton(page).click();

    await expect(linkCopied(page)).toBeVisible();
    expect((await recorded(page)).copied).toEqual([`${baseURL}${storyPath(story)}`]);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('copies the link even when the browser offers a share sheet', async ({ page, baseURL }) => {
    await stubClipboard(page, true);
    await stubShareSheet(page, 'completes');
    await openAtlas(page, storyPath(story));

    await shareButton(page).click();

    await expect(linkCopied(page)).toBeVisible();
    const { copied, shared } = await recorded(page);
    expect(copied).toEqual([`${baseURL}${storyPath(story)}`]);
    expect(shared).toEqual([]);
  });

  test('shows the link to copy by hand when the clipboard is refused', async ({
    page,
    baseURL,
  }) => {
    await stubClipboard(page, false);
    await openAtlas(page, storyPath(story));

    await shareButton(page).click();

    const dialog = page.getByRole('dialog', { name: 'A little curiosity, shared.' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Share link' })).toHaveValue(
      `${baseURL}${storyPath(story)}`,
    );

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
  });
});

// Runs only in the phone project (playwright.config.ts).
test.describe('share on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'the desktop has its own tests above');

  test('opens the system share sheet with the page title and link', async ({ page, baseURL }) => {
    await stubClipboard(page, true);
    await stubShareSheet(page, 'completes');
    await openAtlas(page, storyPath(story));

    await shareButton(page).tap();

    await expect.poll(async () => (await recorded(page)).shared).toHaveLength(1);
    const { copied, shared } = await recorded(page);
    expect(shared[0].url).toBe(`${baseURL}${storyPath(story)}`);
    expect(shared[0].title).toBe(await page.title());
    expect(shared[0].title).toContain(story.question);
    expect(copied).toEqual([]);
    await expect(linkCopied(page)).toBeHidden();
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('closing the share sheet changes nothing', async ({ page }) => {
    await stubClipboard(page, true);
    await stubShareSheet(page, 'is closed');
    await openAtlas(page, storyPath(story));

    await shareButton(page).tap();
    await expect.poll(async () => (await recorded(page)).shared).toHaveLength(1);

    await expect(linkCopied(page)).toBeHidden();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect((await recorded(page)).copied).toEqual([]);
  });

  test('copies the link when the share sheet is refused', async ({ page, baseURL }) => {
    await stubClipboard(page, true);
    await stubShareSheet(page, 'is refused');
    await openAtlas(page, storyPath(story));

    await shareButton(page).tap();

    await expect(linkCopied(page)).toBeVisible();
    expect((await recorded(page)).copied).toEqual([`${baseURL}${storyPath(story)}`]);
  });

  test('shows the link to copy by hand when the sheet and the clipboard both fail', async ({
    page,
    baseURL,
  }) => {
    await stubClipboard(page, false);
    await stubShareSheet(page, 'is refused');
    await openAtlas(page, storyPath(story));

    await shareButton(page).tap();

    const dialog = page.getByRole('dialog', { name: 'A little curiosity, shared.' });
    await expect(dialog.getByRole('textbox', { name: 'Share link' })).toHaveValue(
      `${baseURL}${storyPath(story)}`,
    );
  });
});
