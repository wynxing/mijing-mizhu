import { describe, expect, it } from 'vitest';
import { areAdjacent, offsetToAxial } from './geometry';
import { bfsDistances, findPath, reachableCells } from './path';
import { DEFAULT_GEN_PARAMS, generateLevel, levelAsCellGrid } from '../generation/generator';
import { countFloorCells } from '../generation/validate';

describe('寻路', () => {
  const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 8 });
  const map = levelAsCellGrid(level);

  it('A* 路径长度等于 BFS 最短距离', () => {
    const path = findPath(map, level.start, level.exit);
    expect(path).not.toBeNull();
    const dist = bfsDistances(map, level.start);
    expect(path!.length - 1).toBe(dist.get(`${level.exit.q},${level.exit.r}`));
  });

  it('路径逐格可走且相邻', () => {
    const path = findPath(map, level.start, level.exit)!;
    for (let i = 0; i < path.length; i++) {
      expect(map.cells[path[i].r * level.width + (path[i].q + (path[i].r - (path[i].r & 1)) / 2)]).toBe(0);
      if (i > 0) expect(areAdjacent(path[i - 1], path[i])).toBe(true);
    }
  });

  it('目标为墙时无路径', () => {
    const wall = offsetToAxial(0, 0);
    expect(findPath(map, level.start, wall)).toBeNull();
  });

  it('起点为墙时无路径', () => {
    const wall = offsetToAxial(0, 0);
    expect(findPath(map, wall, level.exit)).toBeNull();
  });

  it('可达集合覆盖全部地面格', () => {
    const reachable = reachableCells(map, level.start);
    expect(reachable.size).toBe(countFloorCells(level));
  });
});
