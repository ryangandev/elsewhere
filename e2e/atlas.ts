import { expect, type Locator, type Page } from '@playwright/test';
import { getCountry, type Story } from './content';

/**
 * Helpers that find things the way a reader does: by role and visible text. The globe is only
 * ever identified, never inspected, because WebGL may be missing or slow where the tests run.
 */

type Marked = { __e2eSession?: string; __e2eCanvas?: string };

export const globeRegion = (page: Page) =>
  page.getByRole('region', { name: 'Interactive 3D world globe' });

/** The reading panel for a country or one of its questions. */
export const panel = (page: Page, countryName: string) =>
  page.getByRole('complementary', { name: `${countryName} explorer` });

export const homeHeading = (page: Page) =>
  page.getByRole('heading', { level: 1, name: 'Start with a question.' });

export const questionInput = (page: Page) =>
  page.getByRole('combobox', { name: 'Ask a question or name a country' });

/** Opens a path and waits until the app has hydrated, so clicks go through the atlas router. */
export async function openAtlas(page: Page, path = '/') {
  await page.goto(path);
  // The globe mounts only after hydration, once the country labels have loaded.
  await expect(globeRegion(page)).toBeAttached();
}

/**
 * Marks the page and the globe's elements. After a navigation, `expectNoReload` proves nothing
 * was thrown away: the document is the same, and so are the globe region and its canvas.
 * The canvas is created once WebGL is up, which may be slow or never happen, so this waits
 * briefly for it and marks it only if it came.
 */
export async function markSession(page: Page) {
  await globeRegion(page)
    .locator('canvas')
    .waitFor({ timeout: 5_000 })
    .catch(() => undefined);
  await page.evaluate(() => {
    (window as unknown as Marked).__e2eSession = 'same-document';
    const region = document.querySelector('[aria-label="Interactive 3D world globe"]');
    region?.setAttribute('data-e2e-kept', '');
    const canvas = region?.querySelector('canvas');
    canvas?.setAttribute('data-e2e-kept', '');
    (window as unknown as Marked).__e2eCanvas = canvas ? 'marked' : 'none';
  });
}

export async function expectNoReload(page: Page) {
  const marks = await page.evaluate(() => {
    const { __e2eSession, __e2eCanvas } = window as unknown as Marked;
    return { session: __e2eSession, canvas: __e2eCanvas };
  });
  expect(marks.session).toBe('same-document');
  await expect(globeRegion(page)).toHaveAttribute('data-e2e-kept', '');
  if (marks.canvas === 'marked') {
    await expect(globeRegion(page).locator('canvas')).toHaveAttribute('data-e2e-kept', '');
  }
}

/** The pathname part of the current URL. */
export function pathOf(page: Page): string {
  return new URL(page.url()).pathname;
}

export async function expectPath(page: Page, path: string) {
  await expect.poll(() => pathOf(page)).toBe(path);
}

/** The story heading in the open reading panel. */
export const storyHeading = (scope: Page | Locator, question: string): Locator =>
  scope.getByRole('heading', { level: 2, name: question });

/**
 * The reading panel shows this answer: its question, its sections, and every source it cites,
 * each a link to the original (the full list sits behind "Sources & further reading").
 */
export async function expectAnswer(page: Page, story: Story) {
  const country = getCountry(story.countryId);
  const reading = panel(page, country.name);
  await expect(storyHeading(reading, story.question)).toBeVisible();
  for (const section of story.sections) {
    await expect(reading.getByRole('heading', { level: 3, name: section.title })).toBeVisible();
  }

  const sources = reading.locator('details', { hasText: 'Sources & further reading' });
  await sources.getByText('Sources & further reading').click();
  for (const source of story.sources) {
    const link = sources.getByRole('link', { name: `${source.title} · ${source.publisher}` });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', source.url);
  }
}
