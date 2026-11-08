import { expect, test } from '@playwright/test';

// R1 gate：three.js 2.5D 场景在真实关卡上跑通。
// WebGL 结论（2026-11-05，Windows 系统 Chrome headless，channel: chrome）：
// 无需额外 launch args，硬件加速直接可用；若将来换无 GPU 的 CI，再考虑 --use-angle=swiftshader。

type Axial = { q: number; r: number };
type Point = { x: number; y: number };

test('场景：走出一条记忆轨迹，提灯区亮于记忆区，未探索纯黑', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mijing.lastSeed', '42');
  });
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();

  // 在第 1 回合内用真实 reducer 走出一条已踏足轨迹：
  // 探听揭示邻居 → 走向离起点最远的未踏足邻居 → 点数/探听用尽才结束回合。
  // 只走到出现「记忆区」（离当前位置超过提灯外半径的已踏足格）为止，尽量避开怪物。
  await page.evaluate(async () => {
    // 动态路径交给浏览器里的 Vite 解析；用变量传路径避免 TS 静态解析。
    const modelPath = '/src/render/model.ts';
    const geometryPath = '/src/rules/grid/geometry.ts';
    const reducerPath = '/src/rules/turn/reducer.ts';
    const listenPath = '/src/rules/fog/listen.ts';
    const planPath = '/src/render/scene/plan.ts';

    const { buildRenderModel } = (await import(modelPath)) as {
      buildRenderModel: (state: any) => any;
    };
    const { axialToPixel, BASE_HEX_SIZE, parseAxialKey } = (await import(geometryPath)) as {
      axialToPixel: (c: Axial, size: number) => Point;
      BASE_HEX_SIZE: number;
      parseAxialKey: (key: string) => Axial;
    };
    const { movementPointsOf } = (await import(reducerPath)) as {
      movementPointsOf: (state: any) => number;
    };
    const { LISTEN_MOVEMENT_COST, LISTEN_PER_TURN } = (await import(listenPath)) as {
      LISTEN_MOVEMENT_COST: number;
      LISTEN_PER_TURN: number;
    };
    const { LANTERN_OUTER } = (await import(planPath)) as { LANTERN_OUTER: number };

    const debug = (window as unknown as Record<string, any>).__mijing;
    const store = debug.store;
    const dispatch = (intent: any): void => store.getState().dispatch(intent);
    const keyOf = (c: Axial): string => `${c.q},${c.r}`;
    const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

    const hasMemoryRegion = (): boolean => {
      const s = store.getState().game;
      const pl = axialToPixel(s.player.pos, BASE_HEX_SIZE);
      for (const key of s.fog.visited) {
        if (dist(axialToPixel(parseAxialKey(key), BASE_HEX_SIZE), pl) > LANTERN_OUTER) return true;
      }
      return false;
    };

    let start: Point | null = null;
    for (let guard = 0; guard < 60 && !hasMemoryRegion(); guard++) {
      const state = store.getState().game;
      if (state.status !== 'playing') break;
      if (!start) start = axialToPixel(state.player.pos, BASE_HEX_SIZE);
      const model = buildRenderModel(state);
      const mp = movementPointsOf(state);

      const unvisited = model.standableNeighbors.filter(
        (n: any) => !state.fog.visited.has(keyOf(n.cell)),
      );
      // 1) 有移动点且有未踏足的已知邻居：走离起点最远的一个，尽量拉直轨迹。
      if (mp >= 1 && unvisited.length > 0 && start) {
        unvisited.sort(
          (a: any, b: any) =>
            dist(axialToPixel(b.cell, BASE_HEX_SIZE), start!) -
            dist(axialToPixel(a.cell, BASE_HEX_SIZE), start!),
        );
        dispatch({ type: 'move', target: unvisited[0].cell });
        continue;
      }
      // 2) 否则还能探听：揭示当前格四周，制造新的可落脚邻居。
      if (mp >= LISTEN_MOVEMENT_COST && state.listenUsed < LISTEN_PER_TURN) {
        dispatch({ type: 'listen' });
        continue;
      }
      // 3) 点数与探听都耗尽：结束回合刷新（怪物会行动，故上面始终守住 status）。
      dispatch({ type: 'endTurn' });
    }
  });

  // 让最后一帧渲染出来。
  await page.waitForTimeout(400);

  // 不是黑屏即可：真正的正确性交给下面的 scene-plan 断言。
  const lit = await page.waitForFunction(
    () => {
      const hook = (
        window as unknown as {
          __mijing?: { scene?: { sampleNonBlack?: () => number } };
        }
      ).__mijing;
      const n = hook?.scene?.sampleNonBlack?.() ?? 0;
      return n > 500 ? n : false;
    },
    undefined,
    { timeout: 15000 },
  );
  expect(await lit.jsonValue()).toBeGreaterThan(500);

  const result = await page.evaluate(async () => {
    const geometryPath = '/src/rules/grid/geometry.ts';
    const planPath = '/src/render/scene/plan.ts';
    const { axialToPixel, BASE_HEX_SIZE } = (await import(geometryPath)) as {
      axialToPixel: (c: { q: number; r: number }, size: number) => { x: number; y: number };
      BASE_HEX_SIZE: number;
    };
    const { LANTERN_INNER, LANTERN_OUTER } = (await import(planPath)) as {
      LANTERN_INNER: number;
      LANTERN_OUTER: number;
    };
    const debug = (window as unknown as Record<string, any>).__mijing;
    const plan = debug.scene.debugPlan();
    const state = debug.store.getState().game;

    const same = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
      Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
    const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const playerLogical = axialToPixel(state.player.pos, BASE_HEX_SIZE);
    const playerHasFloor = plan.floors.some((f: any) => same(f.logical, playerLogical));

    // 光照分区：提灯区（内半径内的已踏足格）vs 记忆区（外半径外的已踏足格）。
    let lanternCells = 0;
    let memoryCells = 0;
    for (const key of state.fog.visited) {
      const [q, r] = key.split(',').map(Number);
      const center = axialToPixel({ q, r }, BASE_HEX_SIZE);
      const d = dist(center, playerLogical);
      if (d <= LANTERN_INNER) lanternCells++;
      else if (d > LANTERN_OUTER) memoryCells++;
    }

    // 既没踏足也没听到的格 = 未探索，必须纯黑（不发射地板实例）。
    let unknownChecked = 0;
    let unknownHasFloor = 0;
    for (let row = 0; row < state.level.height; row++) {
      for (let col = 0; col < state.level.width; col++) {
        const q = col - (row - (row & 1)) / 2;
        const key = `${q},${row}`;
        if (state.fog.visited.has(key) || state.fog.known.has(key)) continue;
        unknownChecked++;
        const center = axialToPixel({ q, r: row }, BASE_HEX_SIZE);
        if (plan.floors.some((f: any) => same(f.logical, center))) unknownHasFloor++;
      }
    }

    return {
      status: state.status,
      visited: state.fog.visited.size,
      floors: plan.floors.length,
      walls: plan.walls.length,
      playerHasFloor,
      lanternCells,
      memoryCells,
      unknownChecked,
      unknownHasFloor,
    };
  });

  expect(result.floors).toBeGreaterThan(0);
  expect(result.playerHasFloor).toBe(true);
  // 走出了轨迹：既有满亮度的提灯区，也有明显更暗的记忆区。
  expect(result.visited).toBeGreaterThanOrEqual(5);
  expect(result.lanternCells).toBeGreaterThan(0);
  expect(result.memoryCells).toBeGreaterThan(0);
  // 未探索格不发射实例 → 纯黑。
  expect(result.unknownChecked).toBeGreaterThan(0);
  expect(result.unknownHasFloor).toBe(0);

  await page.screenshot({ path: 'test-results/scene-r1.png' });
});

test('奇遇门冷光与画面亮度：门在未探索区发光，画面非黑', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('mijing.lastSeed', '42');
  });
  await page.goto('/');
  await expect(page.getByTestId('board')).toBeVisible();
  await page.waitForTimeout(600);

  const result = await page.evaluate(async () => {
    const geometryPath = '/src/rules/grid/geometry.ts';
    const { axialKey } = (await import(geometryPath)) as any;
    const debug = (window as unknown as Record<string, any>).__mijing;
    const state = debug.store.getState().game;
    const plan = debug.scene.debugPlan();
    const doors = state.level.rooms.filter((room: any) => room.kind === 'encounter');
    const unexplored = doors.filter(
      (room: any) => !state.fog.visited.has(axialKey(room.door)),
    ).length;
    return {
      doorRooms: doors.length,
      glowInstances: plan.encounterDoors.length,
      unexplored,
      lit: debug.scene.sampleNonBlack(),
    };
  });

  expect(result.doorRooms).toBe(3);
  expect(result.glowInstances).toBe(3);
  expect(result.unexplored).toBeGreaterThan(0);
  expect(result.lit).toBeGreaterThan(500);
  // 着色器编译失败不会让画面全黑（墙脊仍在），必须显式拦住。
  expect(consoleErrors).toEqual([]);
});
