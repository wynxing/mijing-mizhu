import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN_PARAMS, levelAsCellGrid, type Level } from './generator';
import {
  countDeadEnds,
  countFloorCells,
  countFloorEdges,
  generateValidLevel,
  validateLevel,
} from './validate';
import { findPath } from '../grid/path';

const SEED_COUNT = Number(process.env.FUZZ_SEEDS ?? 1000);

describe('关卡生成 fuzz', () => {
  it(`${SEED_COUNT} 个种子全部满足地图不变量`, { timeout: 180_000 }, () => {
    const failures: string[] = [];
    let fillSum = 0;
    let deadEndSum = 0;
    let minPath = Infinity;
    let minFill = Infinity;
    let maxFill = 0;

    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const params = { ...DEFAULT_GEN_PARAMS, seed };
      let level: Level;
      try {
        level = generateValidLevel(params);
      } catch (error) {
        failures.push(`seed ${seed}: ${(error as Error).message}`);
        continue;
      }
      const errors = validateLevel(level, { ...params, seed: level.seed });
      if (errors.length > 0) failures.push(`seed ${seed}: ${errors.join('、')}`);

      const floor = countFloorCells(level);
      const fill = floor / (level.width * level.height);
      fillSum += fill;
      minFill = Math.min(minFill, fill);
      maxFill = Math.max(maxFill, fill);
      deadEndSum += countDeadEnds(level);

      const cycles = countFloorEdges(level) - floor + 1;
      if (cycles < 2) failures.push(`seed ${seed}: 环数 ${cycles}`);

      const path = findPath(levelAsCellGrid(level), level.start, level.exit);
      const length = path ? path.length : 0;
      minPath = Math.min(minPath, length);
      if (length < DEFAULT_GEN_PARAMS.minPath) {
        failures.push(`seed ${seed}: 最短路 ${length}`);
      }
    }

    expect(failures).toEqual([]);
    expect(fillSum / SEED_COUNT).toBeGreaterThan(0.3);
    expect(minFill).toBeGreaterThanOrEqual(0.25);
    expect(maxFill).toBeLessThanOrEqual(0.55);
    expect(minPath).toBeGreaterThanOrEqual(DEFAULT_GEN_PARAMS.minPath);
    expect(deadEndSum).toBe(0);
  });
});
