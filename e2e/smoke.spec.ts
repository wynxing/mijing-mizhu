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

test('画布不是全黑的', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(600);
  const lit = await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) count++;
    }
    return count;
  });
  expect(lit).toBeGreaterThan(0);
});
