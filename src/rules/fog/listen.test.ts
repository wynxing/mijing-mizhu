import { describe, expect, it } from 'vitest';
import { axialKey, neighbors, offsetToAxial } from '../grid/geometry';
import { CELL_WALL } from '../grid/path';
import { DEFAULT_GEN_PARAMS, cellAtLevel, generateLevel } from '../generation/generator';
import { createFog, isKnown, isVisible, knownResult, markVisited, mergeListenResults } from './fog';
import { LISTEN_MOVEMENT_COST, LISTEN_PER_TURN, resolveListen } from './listen';
import { createGame } from '../game/createGame';
import { canListen, movementPointsOf, reduceGame } from '../turn/reducer';

function terrainOf(level: ReturnType<typeof generateLevel>) {
  return {
    cells: level.cells,
    grid: { width: level.width, height: level.height },
    traps: level.traps,
  };
}

describe('迷雾状态', () => {
  it('初始为空，踏足后永久可见', () => {
    const fog = createFog();
    expect(isVisible(fog, offsetToAxial(1, 1))).toBe(false);
    const visited = markVisited(fog, offsetToAxial(1, 1));
    expect(isVisible(visited, offsetToAxial(1, 1))).toBe(true);
    expect(isKnown(visited, offsetToAxial(1, 1))).toBe(true);
  });

  it('探听结果合并后不覆盖已踏足的格子', () => {
    const cell = offsetToAxial(2, 2);
    const fog = markVisited(createFog(), cell);
    const merged = mergeListenResults(fog, new Map([[axialKey(cell), 'wall' as const]]));
    expect(knownResult(merged, cell)).toBeNull();
  });
});

describe('探听结果与真实地形一致', () => {
  it('每个地面格的相邻格探听结果 100% 匹配地形', () => {
    for (const seed of [1, 2, 3, 17, 88]) {
      const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed });
      const terrain = terrainOf(level);
      for (let row = 0; row < level.height; row++) {
        for (let col = 0; col < level.width; col++) {
          const cell = offsetToAxial(col, row);
          if (cellAtLevel(level, cell) === CELL_WALL) continue;
          const results = resolveListen(terrain, cell);
          for (const neighbor of neighbors(cell)) {
            const actual = cellAtLevel(level, neighbor) === CELL_WALL ? 'wall' : 'passage_quiet';
            expect(results.get(axialKey(neighbor))).toBe(actual);
          }
        }
      }
    }
  });

  it('阶段 0 不会出现「有异响」', () => {
    const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 5 });
    const terrain = terrainOf(level);
    let noisy = 0;
    for (let row = 0; row < level.height; row++) {
      for (let col = 0; col < level.width; col++) {
        const cell = offsetToAxial(col, row);
        if (cellAtLevel(level, cell) === CELL_WALL) continue;
        for (const result of resolveListen(terrain, cell).values()) {
          if (result === 'passage_noisy') noisy++;
        }
      }
    }
    expect(noisy).toBe(0);
  });

  it('返回六个方向的完整结果，越界方向为墙', () => {
    const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 6 });
    const terrain = terrainOf(level);
    const results = resolveListen(terrain, offsetToAxial(1, 1));
    expect(results.size).toBe(6);
    expect(results.get(axialKey(offsetToAxial(0, 1)))).toBe('wall');
    expect(results.get(axialKey(offsetToAxial(1, 0)))).toBe('wall');
  });
});

describe('探听的成本与次数上限', () => {
  it('移动点不足时拒绝', () => {
    const state = createGame(3);
    const drained = { ...state, spentPoints: state.dice.reduce((sum, d) => sum + d.value, 0) };
    const check = canListen(drained);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('移动点不足');
  });

  it('每回合最多探听两次', () => {
    expect(LISTEN_PER_TURN).toBe(2);
    expect(LISTEN_MOVEMENT_COST).toBe(1);
    let state = createGame(4);
    state = reduceGame(state, { type: 'listen' });
    state = reduceGame(state, { type: 'listen' });
    expect(state.listenUsed).toBe(2);
    const check = canListen(state);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('探听次数已用尽');
  });

  it('探听消耗 1 移动点并留下记录', () => {
    const state = createGame(4);
    const before = movementPointsOf(state);
    const next = reduceGame(state, { type: 'listen' });
    expect(movementPointsOf(next)).toBe(before - 1);
    expect(next.listenUsed).toBe(1);
  });

  it('探听后相邻格变为已知', () => {
    const state = createGame(6);
    const next = reduceGame(state, { type: 'listen' });
    const neighbor = neighbors(state.player.pos)[0];
    expect(isKnown(next.fog, neighbor)).toBe(true);
  });
});
