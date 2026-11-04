import { expect, test } from '@playwright/test';

test('开局 → 探听 → 结束回合', async ({ page }) => {
  await page.goto('/');

  const board = page.getByTestId('board');
  await expect(board).toBeVisible();
  await expect(page.getByTestId('turn')).toContainText('回合');
  await expect(page.getByTestId('hp')).toContainText('100/100');
  await expect(page.getByTestId('die-0')).toBeVisible();
  await expect(page.getByTestId('die-2')).toBeVisible();

  const points = await page.getByTestId('mp').innerText();
  await page.getByTestId('listen').click();
  await expect(page.getByTestId('mp')).not.toHaveText(points);

  await page.keyboard.press('Space');
  await expect(page.getByTestId('turn')).toContainText('2');
});
