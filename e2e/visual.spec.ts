import { expect, test } from '@playwright/test';

// R2：可见性约束改在逻辑空间对 scene-plan 断言（比 2D 像素启发式更强），
// 截图仅作人眼对比 artifact。坐标一律 axialToPixel 的逻辑空间。

type Axial = { q: number; r: number };
type Point = { x: number; y: number };

test('墙以边脊呈现、高亮只落在可落脚邻居、未探索不发射实例', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mijing.lastSeed', '42');
  });
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.getByTestId('listen').click();
  await page.waitForTimeout(400);

  const result = await page.evaluate(async () => {
    const geometryPath = '/src/rules/grid/geometry.ts';
    const modelPath = '/src/render/model.ts';
    const { axialToPixel, BASE_HEX_SIZE, neighbors, hexEdgeEndpoints } = (await import(
      geometryPath
    )) as {
      axialToPixel: (c: Axial, size: number) => Point;
      BASE_HEX_SIZE: number;
      neighbors: (c: Axial) => Axial[];
      hexEdgeEndpoints: (c: Point, size: number, dir: number) => { a: Point; b: Point };
    };
    const { buildRenderModel } = (await import(modelPath)) as {
      buildRenderModel: (state: any) => any;
    };

    const debug = (window as unknown as Record<string, any>).__mijing;
    const state = debug.store.getState().game;
    const plan = debug.scene.debugPlan();
    const model = buildRenderModel(state);
    const keyOf = (c: Axial): string => `${c.q},${c.r}`;
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    const ptKey = (p: Point): string => `${round2(p.x)},${round2(p.y)}`;
    const segKey = (a: Point, b: Point): string => {
      const first = ptKey(a);
      const second = ptKey(b);
      return first < second ? `${first}|${second}` : `${second}|${first}`;
    };

    // 期望墙脊：model 的 wallEdges + hexEdgeEndpoints，每条共享边只计一次
    const expectedWalls = new Set<string>();
    for (const [key, cell] of model.cells as Map<string, any>) {
      const [q, r] = key.split(',').map(Number);
      const logical = axialToPixel({ q, r }, BASE_HEX_SIZE);
      for (let dir = 0; dir < 6; dir += 1) {
        if (!cell.wallEdges[dir]) continue;
        const edge = hexEdgeEndpoints(logical, BASE_HEX_SIZE, dir);
        expectedWalls.add(segKey(edge.a, edge.b));
      }
    }
    const actualWalls = new Set<string>(plan.walls.map((w: any) => segKey(w.a, w.b)));

    // 期望高亮：玩家六邻格里已知非墙（可落脚）
    const expectedHighlights = new Set<string>();
    for (const next of neighbors(state.player.pos)) {
      const known = state.fog.known.get(keyOf(next));
      if (known && known !== 'wall') {
        expectedHighlights.add(ptKey(axialToPixel(next, BASE_HEX_SIZE)));
      }
    }
    const actualHighlights = new Set<string>(plan.highlights.map((h: any) => ptKey(h.logical)));

    // 地板实例按格心归类
    const floorKeys = new Set<string>(plan.floors.map((f: any) => ptKey(f.logical)));
    const playerKey = ptKey(axialToPixel(state.player.pos, BASE_HEX_SIZE));

    let unknownChecked = 0;
    let unknownHasFloor = 0;
    let unknownHasHighlight = 0;
    let knownWallHasFloor = 0;
    let visitedHasFloor = 0;
    for (let row = 0; row < state.level.height; row += 1) {
      for (let col = 0; col < state.level.width; col += 1) {
        const q = col - (row - (row & 1)) / 2;
        const cell: Axial = { q, r: row };
        const key = keyOf(cell);
        const ck = ptKey(axialToPixel(cell, BASE_HEX_SIZE));
        if (state.fog.visited.has(key)) {
          if (floorKeys.has(ck)) visitedHasFloor += 1;
          continue;
        }
        if (state.fog.known.has(key)) {
          if (state.fog.known.get(key) === 'wall' && floorKeys.has(ck)) knownWallHasFloor += 1;
          continue;
        }
        unknownChecked += 1;
        if (floorKeys.has(ck)) unknownHasFloor += 1;
        if (actualHighlights.has(ck)) unknownHasHighlight += 1;
      }
    }

    return {
      wallsExpected: expectedWalls.size,
      wallsMatch:
        expectedWalls.size === actualWalls.size &&
        [...expectedWalls].every((k) => actualWalls.has(k)),
      highlightsExpected: expectedHighlights.size,
      highlightsMatch:
        expectedHighlights.size === actualHighlights.size &&
        [...expectedHighlights].every((k) => actualHighlights.has(k)),
      playerHasFloor: floorKeys.has(playerKey),
      visitedHasFloor,
      visited: state.fog.visited.size,
      unknownChecked,
      unknownHasFloor,
      unknownHasHighlight,
      knownWallHasFloor,
    };
  });

  // 墙脊集合与 wallEdges+hexEdgeEndpoints 推出的线段完全一致
  expect(result.wallsExpected).toBeGreaterThan(0);
  expect(result.wallsMatch).toBe(true);
  // 高亮集合 == 可落脚邻居，且一个都没跑到未探索格上
  expect(result.highlightsExpected).toBeGreaterThan(0);
  expect(result.highlightsMatch).toBe(true);
  expect(result.unknownHasHighlight).toBe(0);
  // 玩家脚下与所有已踏足格都有地板；已知墙与未探索格不发射实例
  expect(result.playerHasFloor).toBe(true);
  expect(result.visitedHasFloor).toBe(result.visited);
  expect(result.unknownChecked).toBeGreaterThan(0);
  expect(result.unknownHasFloor).toBe(0);
  expect(result.knownWallHasFloor).toBe(0);

  await page.screenshot({ path: 'test-results/visual-scene.png' });
});

test('zoom 0.35 / 1 / 2.5 三档截图可读', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mijing.lastSeed', '42');
  });
  await page.goto('/');
  await page.waitForTimeout(600);

  for (const zoom of [0.35, 1, 2.5]) {
    await page.evaluate((z) => {
      const debug = (window as unknown as Record<string, any>).__mijing;
      debug.store.setState((s: any) => ({ view: { ...s.view, zoom: z, follow: true } }));
    }, zoom);
    await page.waitForTimeout(300);
    const lit = await page.evaluate(() => {
      const hook = (
        window as unknown as { __mijing?: { scene?: { sampleNonBlack?: () => number } } }
      ).__mijing;
      return hook?.scene?.sampleNonBlack?.() ?? 0;
    });
    expect(lit).toBeGreaterThan(0);
    await page.screenshot({ path: `test-results/zoom-${zoom}.png` });
  }
});
