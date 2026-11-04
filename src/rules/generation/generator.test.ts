import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEN_PARAMS,
  cellAtLevel,
  generateLevel,
  isWalkableAtLevel,
} from './generator';
import {
  countFloorCells,
  countFloorEdges,
  generateValidLevel,
  validateLevel,
} from './validate';
import { areAdjacent, axialToOffset, hexDistance, offsetToAxial } from '../grid/geometry';
import { findPath, reachableCells } from '../grid/path';
import { levelAsCellGrid } from './generator';

describe('关卡生成', () => {
  it('同种子完全可复现', () => {
    const a = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 42 });
    const b = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 42 });
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.start).toEqual(b.start);
    expect(a.exit).toEqual(b.exit);
  });

  it('不同种子产出不同关卡', () => {
    const a = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 1 });
    const b = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 2 });
    expect(Array.from(a.cells)).not.toEqual(Array.from(b.cells));
  });

  it('主路径连续、全部可走', () => {
    for (const seed of [1, 7, 99, 1234]) {
      const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed });
      for (let i = 1; i < level.mainPath.length; i++) {
        expect(areAdjacent(level.mainPath[i - 1], level.mainPath[i])).toBe(true);
        expect(isWalkableAtLevel(level, level.mainPath[i])).toBe(true);
      }
      expect(isWalkableAtLevel(level, level.start)).toBe(true);
      expect(isWalkableAtLevel(level, level.exit)).toBe(true);
    }
  });

  it('起点在左、出口在右且相距足够远', () => {
    for (const seed of [3, 11, 55]) {
      const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed });
      expect(axialToOffset(level.start).col).toBe(1);
      expect(axialToOffset(level.exit).col).toBe(level.width - 2);
      expect(areAdjacent(level.start, level.exit)).toBe(false);
      expect(hexDistance(level.start, level.exit)).toBeGreaterThanOrEqual(12);
    }
  });

  it('全部地面格从起点可达，且存在环路', () => {
    for (const seed of [5, 21, 77]) {
      const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed });
      const map = levelAsCellGrid(level);
      const reachable = reachableCells(map, level.start);
      expect(reachable.size).toBe(countFloorCells(level));
      const cycles = countFloorEdges(level) - countFloorCells(level) + 1;
      expect(cycles).toBeGreaterThanOrEqual(2);
    }
  });

  it('起点到出口的最短路径足够长', () => {
    for (const seed of [2, 13, 404]) {
      const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed });
      const path = findPath(levelAsCellGrid(level), level.start, level.exit);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThanOrEqual(18);
    }
  });

  it('边框一圈全是墙', () => {
    const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 9 });
    for (let col = 0; col < level.width; col++) {
      expect(cellAtLevel(level, offsetToAxial(col, 0))).toBe(1);
      expect(cellAtLevel(level, offsetToAxial(col, level.height - 1))).toBe(1);
    }
    for (let row = 0; row < level.height; row++) {
      expect(cellAtLevel(level, offsetToAxial(0, row))).toBe(1);
      expect(cellAtLevel(level, offsetToAxial(level.width - 1, row))).toBe(1);
    }
  });

  it('阶段 0 不放置陷阱', () => {
    const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed: 31 });
    expect(level.traps.size).toBe(0);
  });

  it('200 个随机种子全部通过校验', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const level = generateLevel({ ...DEFAULT_GEN_PARAMS, seed });
      const errors = validateLevel(level, { ...DEFAULT_GEN_PARAMS, seed });
      if (errors.length > 0) failures.push(`seed ${seed}: ${errors.join('、')}`);
    }
    expect(failures).toEqual([]);
  });

  it('带重试的生成总能产出合法关卡', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const level = generateValidLevel({ ...DEFAULT_GEN_PARAMS, seed });
      expect(validateLevel(level, { ...DEFAULT_GEN_PARAMS, seed: level.seed })).toEqual([]);
    }
  });
});
