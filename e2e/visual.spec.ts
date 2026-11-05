import { expect, test } from '@playwright/test';

test('墙以边线呈现，高亮只落在可落脚邻居上', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mijing.lastSeed', '42');
  });
  await page.goto('/');
  await page.waitForTimeout(600);
  await page.getByTestId('listen').click();
  await page.waitForTimeout(400);

  const result = await page.evaluate(async () => {
    // 动态路径交给浏览器里的 Vite 解析；用变量传路径避免 TS 静态解析
    const geometryPath = '/src/rules/grid/geometry.ts';
    const { axialToPixel, BASE_HEX_SIZE, neighbors: hexNeighbors } = (await import(
      geometryPath
    )) as {
      axialToPixel: (cell: { q: number; r: number }, size: number) => {
        x: number;
        y: number;
      };
      BASE_HEX_SIZE: number;
      neighbors: (cell: { q: number; r: number }) => { q: number; r: number }[];
    };

    const debug = (window as unknown as Record<string, any>).__mijing;
    const state = debug.store.getState().game;

    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const rect = canvas.getBoundingClientRect();
    const dpr = canvas.width / rect.width;

    const at = (x: number, y: number): [number, number, number] => {
      const index = (Math.round(y) * canvas.width + Math.round(x)) * 4;
      return [data[index], data[index + 1], data[index + 2]];
    };

    // 跟随模式下玩家在画布中心：屏幕坐标 = (世界坐标 - 玩家世界坐标) * zoom + 画布中心
    const zoom = 1;
    const playerWorld = axialToPixel(state.player.pos, BASE_HEX_SIZE);
    const toCanvas = (world: { x: number; y: number }) => ({
      x: (canvas.width / 2 + (world.x - playerWorld.x) * zoom * dpr),
      y: (canvas.height / 2 + (world.y - playerWorld.y) * zoom * dpr),
    });

    // 灯光会给颜色加暖，所以用「色相倾向」而不是精确色值来判别
    const isWallLine = (r: number, g: number, b: number) =>
      r > 110 && r > g && g > b && b > 35;
    const isHighlight = (r: number, g: number, b: number) =>
      g > 140 && g > r + 40 && g > b + 20;
    const isFloor = (r: number, _g: number, b: number) => b > r;

    // 找一格与玩家相邻的墙
    const level = state.level;
    let wallCell: { q: number; r: number } | null = null;
    for (const next of hexNeighbors(state.player.pos)) {
      const index = next.r * level.width + (next.q + (next.r - (next.r & 1)) / 2);
      if (level.cells[index] !== 0) {
        wallCell = next;
        break;
      }
    }
    if (!wallCell) return { error: '玩家旁边没有墙，无法验证' };

    const wallWorld = axialToPixel(wallCell, BASE_HEX_SIZE);
    const wallCenter = toCanvas(wallWorld);
    const edgeMid = toCanvas({
      x: (playerWorld.x + wallWorld.x) / 2,
      y: (playerWorld.y + wallWorld.y) / 2,
    });

    const wallCenterPixel = at(wallCenter.x, wallCenter.y);
    const edgePixel = at(edgeMid.x, edgeMid.y);
    const floorPixel = at(canvas.width / 2 + 20 * dpr, canvas.height / 2);

    // 可落脚 = 玩家六邻格里已知是通路的那几个
    const standable = new Set<string>();
    for (const next of hexNeighbors(state.player.pos)) {
      const key = `${next.q},${next.r}`;
      const heard = state.fog.known.get(key);
      if (heard && heard !== 'wall') standable.add(key);
    }

    const neighborCenters: { x: number; y: number }[] = [];
    for (const key of standable) {
      const [q, r] = key.split(',').map(Number);
      neighborCenters.push(toCanvas(axialToPixel({ q, r }, BASE_HEX_SIZE)));
    }

    let highlight = 0;
    let highlightOutside = 0;
    const radius = BASE_HEX_SIZE * dpr;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isHighlight(r, g, b)) continue;
      highlight++;
      const px = (i / 4) % canvas.width;
      const py = Math.floor(i / 4 / canvas.width);
      const inside = neighborCenters.some(
        (n) => Math.hypot(n.x - px, n.y - py) <= radius * 1.05,
      );
      if (!inside) highlightOutside++;
    }

    return {
      wallCellFound: true,
      wallCenterIsWallLine: isWallLine(...wallCenterPixel),
      wallCenterIsFloor: isFloor(...wallCenterPixel),
      edgeIsWallLine: isWallLine(...edgePixel),
      floorIsFloor: isFloor(...floorPixel),
      highlight,
      highlightOutside,
      neighbors: neighborCenters.length,
    };
  });

  expect((result as { error?: string }).error).toBeUndefined();
  const r = result as {
    wallCenterIsWallLine: boolean;
    wallCenterIsFloor: boolean;
    edgeIsWallLine: boolean;
    floorIsFloor: boolean;
    highlight: number;
    highlightOutside: number;
    neighbors: number;
  };

  // 墙格本身不是一格实体：中心既不是墙线也不是地板
  expect(r.wallCenterIsWallLine).toBe(false);
  expect(r.wallCenterIsFloor).toBe(false);
  // 墙线正好画在与玩家共享的那条边上
  expect(r.edgeIsWallLine).toBe(true);
  // 脚下是地板
  expect(r.floorIsFloor).toBe(true);
  // 高亮存在且没有跑到未知邻居上
  expect(r.neighbors).toBeGreaterThan(0);
  expect(r.highlight).toBeGreaterThan(0);
  expect(r.highlightOutside).toBe(0);
});
