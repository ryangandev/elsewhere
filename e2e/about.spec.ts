import { openAtlas } from './atlas';
import { expect, test } from './fixtures';

test.describe('about', () => {
  test('the footer opens the About sheet, which credits its sources and closes', async ({
    page,
  }) => {
    await openAtlas(page);

    await page.getByRole('button', { name: /About this atlas/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Curiosity is enough.' });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole('heading', { name: 'A whole map. Ten edited profiles.' }),
    ).toBeVisible();
    await expect(sheet).toContainText('Boundaries: Natural Earth.');
    await expect(sheet).toContainText('Nothing is generated while you ask');
    await expect(sheet).toContainText('AI-assisted or written by hand');
    await expect(sheet).toContainText('lists its sources');
    await expect(sheet).toContainText('No account is needed');

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: /About this atlas/ })).toBeFocused();
  });
});
