import { expect, test } from '@playwright/test';

// M3 验收：房间交互与特殊地形都要走真实 UI → reducer → 场景计划这条链。
// 走位用浏览器里的真实 reducer（A* 只用来决定按下哪个方向），不直接改状态。

type WalkResult = { ok: boolean; reason?: string; seed?: number; kind?: string; hp?: number; hand?: number; buffs?: number };

async function walkTo(page: import('@playwright/test').Page, target: 'room' | 'terrain'): Promise<WalkResult> {
  return page.evaluate(async (which) => {
    // 路径交给浏览器里的 Vite 解析；用变量传路径避免 TS 静态解析。
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
      const grid = { width: state.level.width, height: state.level.height };
      const map = { cells: state.level.cells, grid };
      const monsterKeys = new Set<string>(state.monsters.map((m: any) => axialKey(m.pos)));

      let best: { path: any[]; cell: any; kind: string } | null = null;
      if (which === 'room') {
        for (const room of state.level.rooms) {
          if (room.kind !== 'chest' && room.kind !== 'rest') continue;
          for (let row = room.row; row < room.row + room.h; row++) {
            for (let col = room.col; col < room.col + room.w; col++) {
              const cell = offsetToAxial(col, row);
              if (cellAtLevel(state.level, cell) !== 0) continue;
              const path = findPath(map, state.player.pos, cell);
              if (!path || path.length - 1 > 12) continue;
              if (path.slice(1).some((step: any) => monsterKeys.has(axialKey(step)))) continue;
              if (!best || path.length < best.path.length) best = { path, cell, kind: room.kind };
            }
          }
        }
      } else {
        for (const key of state.level.terrain.keys()) {
          const [q, r] = key.split(',').map(Number);
          const cell = { q, r };
          const path = findPath(map, state.player.pos, cell);
          if (!path || path.length - 1 > 12) continue;
          if (path.slice(1).some((step: any) => monsterKeys.has(axialKey(step)))) continue;
          if (!best || path.length < best.path.length) best = { path, cell, kind: 'terrain' };
        }
      }
      if (!best) continue;

      let failed = false;
      for (const step of best.path.slice(1)) {
        state = store.getState().game;
        if (movementPointsOf(state) < 1) store.getState().dispatch({ type: 'endTurn' });
        store.getState().dispatch({ type: 'move', target: step });
        const after = store.getState().game;
        if (after.notice !== null) {
          failed = true;
          break;
        }
        if (after.status !== 'playing') return { ok: false, reason: 'died' };
      }
      if (failed) continue;

      const now = store.getState().game;
      if (which === 'terrain') {
        if (axialKey(now.player.pos) === axialKey(best.cell)) {
          return { ok: true, seed, kind: 'terrain' };
        }
        continue;
      }
      const index = roomIndexAt(now.level, now.player.pos);
      if (index >= 0 && !now.roomStates[index].settled) {
        return {
          ok: true,
          seed,
          kind: now.level.rooms[index].kind,
          hp: now.player.hp,
          hand: now.hand.length,
          buffs: now.buffs.length,
        };
      }
    }
    return { ok: false, reason: '没有找到可达的目标' };
  }, target);
}

test('走进宝箱房 / 休整房并用 E 键结算一次', async ({ page }) => {
  await page.goto('/');
  const reached = await walkTo(page, 'room');
  expect(reached.ok, reached.reason ?? '').toBe(true);

  // 房间例外：踏入房体后整间可见
  const revealed = await page.evaluate(async () => {
    const geometryPath = '/src/rules/grid/geometry.ts';
    const generatorPath = '/src/rules/generation/generator.ts';
    const roomsPath = '/src/rules/rooms/rooms.ts';
    const { axialKey, offsetToAxial } = (await import(geometryPath)) as any;
    const { cellAtLevel } = (await import(generatorPath)) as any;
    const game = (window as unknown as Record<string, any>).__mijing.store.getState().game;
    const { roomIndexAt } = (await import(roomsPath)) as any;
    const index = roomIndexAt(game.level, game.player.pos);
    if (index < 0) return { index, missing: 1 };
    const room = game.level.rooms[index];
    let missing = 0;
    for (let row = room.row; row < room.row + room.h; row++) {
      for (let col = room.col; col < room.col + room.w; col++) {
        const cell = offsetToAxial(col, row);
        if (cellAtLevel(game.level, cell) !== 0) continue;
        if (!game.fog.visited.has(axialKey(cell))) missing++;
      }
    }
    return { index, missing };
  });
  expect(revealed.index).toBeGreaterThanOrEqual(0);
  expect(revealed.missing).toBe(0);

  const button = page.getByTestId('interact');
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await page.keyboard.press('KeyE');

  const after = await page.evaluate(() => {
    const store = (window as unknown as Record<string, any>).__mijing.store;
    const game = store.getState().game;
    return {
      settled: game.roomStates.filter((room: any) => room.settled).length,
      notice: game.notice,
      hand: game.hand.length,
      buffs: game.buffs.length,
      hp: game.player.hp,
    };
  });
  expect(after.notice).toBeNull();
  expect(after.settled).toBe(1);
  if (reached.kind === 'chest') {
    expect(after.hand > (reached.hand ?? 0) || after.buffs > (reached.buffs ?? 0)).toBe(true);
  } else {
    expect(after.hp).toBe(Math.min(100, (reached.hp ?? 0) + 30));
  }

  // 再按一次：已结算的房间被拒绝，状态不变
  await page.keyboard.press('KeyE');
  const again = await page.evaluate(() => {
    const game = (window as unknown as Record<string, any>).__mijing.store.getState().game;
    return game.notice;
  });
  expect(again).toBe('这个房间已经结算过了');
});

test('特殊地形进入地板实例属性，奇遇房门冷光在计划里', async ({ page }) => {
  await page.goto('/');
  const reached = await walkTo(page, 'terrain');
  expect(reached.ok, reached.reason ?? '').toBe(true);
  await page.waitForTimeout(300);

  const result = await page.evaluate(async () => {
    const geometryPath = '/src/rules/grid/geometry.ts';
    const debug = (window as unknown as Record<string, any>).__mijing;
    const { axialToPixel, BASE_HEX_SIZE } = (await import(geometryPath)) as any;
    const game = debug.store.getState().game;
    const plan = debug.scene.debugPlan();
    const pos = axialToPixel(game.player.pos, BASE_HEX_SIZE);
    const floor = plan.floors.find(
      (item: any) => Math.hypot(item.logical.x - pos.x, item.logical.y - pos.y) < 0.01,
    );
    return { terrain: floor?.terrain ?? 0, doors: plan.encounterDoors.length };
  });
  expect(result.terrain).toBeGreaterThan(0);
  expect(result.doors).toBeGreaterThanOrEqual(0);
  expect(result.doors).toBeLessThanOrEqual(3);

  // 开局时三间奇遇房的门都应该在未探索区发光
  const fresh = await page.evaluate(async () => {
    const debug = (window as unknown as Record<string, any>).__mijing;
    debug.store.getState().startGame(55);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return debug.scene.debugPlan().encounterDoors.length;
  });
  expect(fresh).toBe(3);
});
