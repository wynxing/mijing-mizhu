import { expect, test } from '@playwright/test';

// M5 验收：用真实 reducer 走进奇遇房 → 面板出题 → 提示 / 答题 → 只结算一次。

async function walkToEncounter(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const pathPath = '/src/rules/grid/path.ts';
    const reducerPath = '/src/rules/turn/reducer.ts';
    const generatorPath = '/src/rules/generation/generator.ts';
    const geometryPath = '/src/rules/grid/geometry.ts';
    const roomsPath = '/src/rules/rooms/rooms.ts';

    const debug = (window as unknown as Record<string, any>).__mijing;
    const store = debug.store;
    const { findPath } = (await import(pathPath)) as any;
    const { movementPointsOf } = (await import(reducerPath)) as any;
    const { cellAtLevel } = (await import(generatorPath)) as any;
    const { offsetToAxial, axialKey } = (await import(geometryPath)) as any;
    const { roomIndexAt } = (await import(roomsPath)) as any;

    for (let seed = 1; seed <= 400; seed++) {
      store.getState().dispatch({ type: 'restart', seed });
      let state = store.getState().game;
      const map = {
        cells: state.level.cells,
        grid: { width: state.level.width, height: state.level.height },
      };
      const monsterKeys = new Set<string>(state.monsters.map((m: any) => axialKey(m.pos)));

      let best: { path: any[]; cell: any } | null = null;
      for (const room of state.level.rooms) {
        if (room.kind !== 'encounter') continue;
        for (let row = room.row; row < room.row + room.h; row++) {
          for (let col = room.col; col < room.col + room.w; col++) {
            const cell = offsetToAxial(col, row);
            if (cellAtLevel(state.level, cell) !== 0) continue;
            const path = findPath(map, state.player.pos, cell);
            if (!path || path.length - 1 > 12) continue;
            if (path.slice(1).some((step: any) => monsterKeys.has(axialKey(step)))) continue;
            if (!best || path.length < best.path.length) best = { path, cell };
          }
        }
      }
      if (!best) continue;

      let failed = false;
      for (const step of best.path.slice(1)) {
        state = store.getState().game;
        if (movementPointsOf(state) < 1) store.getState().dispatch({ type: 'endTurn' });
        store.getState().dispatch({ type: 'move', target: step });
        const after = store.getState().game;
        if (after.notice !== null || after.status !== 'playing') {
          failed = true;
          break;
        }
      }
      if (failed) continue;

      const now = store.getState().game;
      const index = roomIndexAt(now.level, now.player.pos);
      if (index >= 0 && now.level.rooms[index].kind === 'encounter') {
        return { ok: true, seed, roomIndex: index, hand: now.hand.length };
      }
    }
    return { ok: false };
  });
}

test('奇遇房：出题、提示、答题只结算一次', async ({ page }) => {
  await page.goto('/');
  const reached = await walkToEncounter(page);
  expect(reached.ok).toBe(true);

  await page.getByTestId('interact').click();
  const panel = page.getByTestId('question-panel');
  await expect(panel).toBeVisible();

  // 提示：点一张手牌换线索，手牌 -1 并显示线索
  const handBefore = await page.evaluate(() => {
    const game = (window as unknown as Record<string, any>).__mijing.store.getState().game;
    return { hand: game.hand.length, uid: game.hand[0].uid };
  });
  await page.getByTestId(`hint-card-${handBefore.uid}`).click();
  await expect(panel).toContainText('线索：');
  const handAfter = await page.evaluate(
    () => (window as unknown as Record<string, any>).__mijing.store.getState().game.hand.length,
  );
  expect(handAfter).toBe(handBefore.hand - 1);

  // 面板打开时键盘不能移动：按空格后回合不变
  const turnBefore = await page.evaluate(
    () => (window as unknown as Record<string, any>).__mijing.store.getState().game.turn,
  );
  await page.keyboard.press('Space');
  const turnAfterSpace = await page.evaluate(
    () => (window as unknown as Record<string, any>).__mijing.store.getState().game.turn,
  );
  expect(turnAfterSpace).toBe(turnBefore);

  // 关掉面板后再按 E 能重新打开同一题
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(panel).toBeVisible();

  // 答题（对/错都行），结算后房间标记已结算
  await page.keyboard.press('KeyT');
  await expect(panel).toContainText('答');
  const after = await page.evaluate(() => {
    const game = (window as unknown as Record<string, any>).__mijing.store.getState().game;
    return {
      resolved: game.encounter.resolved,
      correct: game.encounter.correct,
      settled: game.roomStates.filter((room: any) => room.settled).length,
      hand: game.hand.length,
      hp: game.player.hp,
    };
  });
  expect(after.resolved).toBe(true);
  expect(typeof after.correct).toBe('boolean');
  expect(after.settled).toBe(1);

  // Esc 关闭面板，之后可以正常结束回合
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('turn')).toContainText(String(turnBefore + 1));

  // 角标：interact 按钮应显示「已结算」而不可用
  const disabled = await page.getByTestId('interact').isDisabled();
  expect(disabled).toBe(true);
});
