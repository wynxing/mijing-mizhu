import { describe, expect, it } from 'vitest';
import {
  BASE_HEX_SIZE,
  axialToPixel,
  hexCorners,
  hexEdgeEndpoints,
  parseAxialKey,
  type Axial,
  type DirIndex,
  type Point,
} from '../../rules/grid/geometry';
import { createGame } from '../../rules/game/createGame';
import { reduceGame } from '../../rules/turn/reducer';
import { buildRenderModel } from '../model';
import {
  LANTERN_INNER,
  LANTERN_OUTER,
  MEMORY_LEVEL,
  buildScenePlan,
  lanternAt,
} from './plan';

function segmentKey(a: Point, b: Point): string {
  const round = (v: number): number => Math.round(v * 100) / 100;
  const first = `${round(a.x)},${round(a.y)}`;
  const second = `${round(b.x)},${round(b.y)}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function near(a: Point, b: Point, tol = 1): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

describe('场景计划（逻辑空间）', () => {
  it('玩家格有地板实例，顶面是六边形', () => {
    const model = buildRenderModel(createGame(55));
    const plan = buildScenePlan(model);
    const playerLogical = axialToPixel(model.player, BASE_HEX_SIZE);

    const own = plan.floors.find((f) => near(f.logical, playerLogical, 0.001));
    expect(own, '玩家脚下必须有一格地板实例').toBeDefined();
    expect(own!.kind).toBe(0);
    expect(own!.cliffMask).toBeGreaterThanOrEqual(0);
    expect(own!.cliffMask).toBeLessThan(64);

    // 地板网格实例化的顶面就是这六个角
    expect(hexCorners(playerLogical, BASE_HEX_SIZE)).toHaveLength(6);
  });

  it('墙脊线段集合 == wallEdges + hexEdgeEndpoints 推出的线段', () => {
    const model = buildRenderModel(createGame(55));
    const plan = buildScenePlan(model);

    const expected = new Set<string>();
    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind !== 'floor') continue;
      const world = axialToPixel(parseAxialKey(key), BASE_HEX_SIZE);
      for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
        if (!cell.wallEdges[dir]) continue;
        const edge = hexEdgeEndpoints(world, BASE_HEX_SIZE, dir);
        expected.add(segmentKey(edge.a, edge.b));
      }
    }
    expect(expected.size).toBeGreaterThan(0);

    const actual = new Set(plan.walls.map((w) => segmentKey(w.a, w.b)));
    expect(actual.size).toBe(expected.size);
    for (const seg of actual) expect(expected.has(seg)).toBe(true);
  });

  it('knownWall / unknown 格没有地板实例', () => {
    const model = buildRenderModel(createGame(55));
    const plan = buildScenePlan(model);

    const blocked: Axial[] = [];
    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind === 'unknown' || cell.appearance.kind === 'knownWall') {
        blocked.push(parseAxialKey(key));
      }
    }
    expect(blocked.length).toBeGreaterThan(0);

    for (const cell of blocked) {
      const center = axialToPixel(cell, BASE_HEX_SIZE);
      const hit = plan.floors.find((f) => near(f.logical, center, 0.001));
      expect(hit, `未知/已知墙格 ${cell.q},${cell.r} 不应有地板实例`).toBeUndefined();
    }
  });

  it('高亮集合 == 已知可落脚邻居', () => {
    const model = buildRenderModel(reduceGame(createGame(55), { type: 'listen' }));
    const plan = buildScenePlan(model);

    expect(plan.highlights).toHaveLength(model.standableNeighbors.length);
    const expected = model.standableNeighbors.map((n) =>
      axialToPixel(n.cell, BASE_HEX_SIZE),
    );
    for (const highlight of plan.highlights) {
      expect(expected.some((c) => near(c, highlight.logical, 0.001))).toBe(true);
    }
  });

  it('未知格中心 1px 内没有高亮', () => {
    const model = buildRenderModel(createGame(55));
    const plan = buildScenePlan(model);

    const unknownCenters: Point[] = [];
    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind !== 'unknown') continue;
      unknownCenters.push(axialToPixel(parseAxialKey(key), BASE_HEX_SIZE));
    }
    expect(unknownCenters.length).toBeGreaterThan(0);

    for (const highlight of plan.highlights) {
      for (const center of unknownCenters) {
        expect(Math.hypot(center.x - highlight.logical.x, center.y - highlight.logical.y))
          .toBeGreaterThan(1);
      }
    }
  });

  it('提灯中心最亮、远处衰减到 0，记忆区恒暗于提灯区', () => {
    const player: Point = { x: 0, y: 0 };
    const at = (d: number): number => lanternAt({ x: d, y: 0 }, player);

    // 中心与内半径内是满亮度
    expect(at(0)).toBe(1);
    expect(at(LANTERN_INNER * 0.5)).toBe(1);
    // 外半径外彻底衰减：片元里 lit 退回 MEMORY_LEVEL
    expect(at(LANTERN_OUTER)).toBe(0);
    expect(at(LANTERN_OUTER * 2)).toBe(0);
    // 中间地带严格落在 (0,1) 且随距离单调递减
    const near = at(LANTERN_INNER + (LANTERN_OUTER - LANTERN_INNER) * 0.25);
    const far = at(LANTERN_INNER + (LANTERN_OUTER - LANTERN_INNER) * 0.75);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
    // 记忆区亮度：暗于满提灯（1），又不至于全黑（0）
    expect(MEMORY_LEVEL).toBeGreaterThan(0);
    expect(MEMORY_LEVEL).toBeLessThan(1);
  });
});
