import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GEN_PARAMS,
  cellAtLevel,
  generateLevel,
  isWalkableAtLevel,
  levelAsCellGrid,
  roomQuadrant,
} from './generator';
import {
  countDeadEnds,
  countFloorCells,
  countFloorEdges,
  generateValidLevel,
  validateLevel,
} from './validate';
import { areAdjacent, axialKey, axialToOffset, hexDistance, offsetToAxial } from '../grid/geometry';
import { findPath, reachableCells } from '../grid/path';

const params = (seed: number) => ({ ...DEFAULT_GEN_PARAMS, seed });

describe('关卡生成', () => {
  it('同种子完全可复现', () => {
    const a = generateLevel(params(42));
    const b = generateLevel(params(42));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    expect(a.rooms).toEqual(b.rooms);
    expect(a.start).toEqual(b.start);
    expect(a.exit).toEqual(b.exit);
    expect([...a.traps].sort()).toEqual([...b.traps].sort());
    expect([...a.terrain].sort()).toEqual([...b.terrain].sort());
    expect(a.monsters).toEqual(b.monsters);
  });

  it('不同种子产出不同关卡', () => {
    const a = generateLevel(params(1));
    const b = generateLevel(params(2));
    expect(Array.from(a.cells)).not.toEqual(Array.from(b.cells));
  });

  it('mainPath 是起点到出口的 A* 最短路', () => {
    for (const seed of [1, 7, 99, 1234]) {
      const level = generateLevel(params(seed));
      const shortest = findPath(levelAsCellGrid(level), level.start, level.exit);
      expect(shortest).not.toBeNull();
      expect(level.mainPath.length).toBe(shortest!.length);
      expect(level.mainPath[0]).toEqual(level.start);
      expect(level.mainPath[level.mainPath.length - 1]).toEqual(level.exit);
      for (let i = 0; i < level.mainPath.length; i++) {
        if (i > 0) expect(areAdjacent(level.mainPath[i - 1], level.mainPath[i])).toBe(true);
        expect(isWalkableAtLevel(level, level.mainPath[i])).toBe(true);
      }
    }
  });

  it('起点在左、出口在右且相距足够远', () => {
    for (const seed of [3, 11, 55]) {
      const level = generateLevel(params(seed));
      expect(axialToOffset(level.start).col).toBe(1);
      expect(axialToOffset(level.exit).col).toBe(level.width - 2);
      expect(areAdjacent(level.start, level.exit)).toBe(false);
      expect(hexDistance(level.start, level.exit)).toBeGreaterThanOrEqual(12);
    }
  });

  it('全部地面格从起点可达，且存在环路', () => {
    for (const seed of [5, 21, 77]) {
      const level = generateLevel(params(seed));
      const map = levelAsCellGrid(level);
      const reachable = reachableCells(map, level.start);
      expect(reachable.size).toBe(countFloorCells(level));
      const cycles = countFloorEdges(level) - countFloorCells(level) + 1;
      expect(cycles).toBeGreaterThanOrEqual(2);
    }
  });

  it('起点到出口的最短路径不短于 minPath', () => {
    for (const seed of [2, 13, 404]) {
      const level = generateValidLevel(params(seed));
      const path = findPath(levelAsCellGrid(level), level.start, level.exit);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThanOrEqual(DEFAULT_GEN_PARAMS.minPath);
    }
  });

  it('边框一圈全是墙', () => {
    const level = generateLevel(params(9));
    for (let col = 0; col < level.width; col++) {
      expect(cellAtLevel(level, offsetToAxial(col, 0))).toBe(1);
      expect(cellAtLevel(level, offsetToAxial(col, level.height - 1))).toBe(1);
    }
    for (let row = 0; row < level.height; row++) {
      expect(cellAtLevel(level, offsetToAxial(0, row))).toBe(1);
      expect(cellAtLevel(level, offsetToAxial(level.width - 1, row))).toBe(1);
    }
  });

  it('房间数量与位置符合 BSP 约束', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const level = generateLevel(params(seed));
      expect(level.rooms.length).toBe(DEFAULT_GEN_PARAMS.roomCount);
      for (const room of level.rooms) {
        expect(room.w).toBeGreaterThanOrEqual(3);
        expect(room.h).toBeGreaterThanOrEqual(3);
        expect(room.col).toBeGreaterThanOrEqual(1);
        expect(room.row).toBeGreaterThanOrEqual(1);
        expect(room.col + room.w).toBeLessThanOrEqual(level.width - 1);
        expect(room.row + room.h).toBeLessThanOrEqual(level.height - 1);
      }
    }
  });

  it('陷阱避开起点与出口，且全部封锁后仍可到达出口', () => {
    for (const seed of [10, 31, 88]) {
      const level = generateValidLevel(params(seed));
      expect(level.traps.size).toBeGreaterThan(0);
      for (const key of level.traps) {
        expect(key).not.toBe(axialKey(level.start));
        expect(key).not.toBe(axialKey(level.exit));
      }
      expect(validateLevel(level, params(level.seed))).toEqual([]);
    }
  });

  it('怪物远离起点、避开出口与陷阱，守卫守在出口房内', () => {
    const level = generateValidLevel(params(31));
    expect(level.monsters).toHaveLength(DEFAULT_GEN_PARAMS.monsterBudget);
    for (const placement of level.monsters) {
      expect(isWalkableAtLevel(level, placement.pos)).toBe(true);
      expect(hexDistance(placement.pos, level.start)).toBeGreaterThanOrEqual(8);
      expect(axialKey(placement.pos)).not.toBe(axialKey(level.exit));
      expect(level.traps.has(axialKey(placement.pos))).toBe(false);
    }
    const guardians = level.monsters.filter((placement) => placement.defId === 'guardian');
    expect(guardians).toHaveLength(1);
    expect(hexDistance(guardians[0].pos, level.exit)).toBeLessThanOrEqual(2);
    const exitRoom = level.rooms.find((room) => room.kind === 'exit')!;
    const offset = axialToOffset(guardians[0].pos);
    expect(offset.col).toBeGreaterThanOrEqual(exitRoom.col);
    expect(offset.col).toBeLessThan(exitRoom.col + exitRoom.w);
    expect(offset.row).toBeGreaterThanOrEqual(exitRoom.row);
    expect(offset.row).toBeLessThan(exitRoom.row + exitRoom.h);
  });

  it('游荡怪物覆盖四种原型', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const placement of generateValidLevel(params(seed)).monsters) {
        kinds.add(placement.defId);
      }
    }
    expect([...kinds].sort()).toEqual(['brood', 'guardian', 'sniffer', 'stonewarden', 'wraith']);
  });

  it('死路剪除至 0', () => {
    for (const seed of [31, 77, 404]) {
      expect(countDeadEnds(generateValidLevel(params(seed)))).toBe(0);
    }
  });

  it('房间类型：起终点各 1、奇遇 3 个异象限、四类功能房齐全', () => {
    for (const seed of [1, 8, 64]) {
      const level = generateValidLevel(params(seed));
      const count = (kind: string) => level.rooms.filter((room) => room.kind === kind).length;
      expect(count('start')).toBe(1);
      expect(count('exit')).toBe(1);
      expect(count('encounter')).toBe(3);
      for (const kind of ['chest', 'rest', 'battle', 'trap']) {
        expect(count(kind)).toBeGreaterThanOrEqual(1);
      }
      const quadrants = new Set(
        level.rooms
          .filter((room) => room.kind === 'encounter')
          .map((room) => roomQuadrant(room, level.width, level.height)),
      );
      expect(quadrants.size).toBe(3);
      for (const room of level.rooms) {
        expect(isWalkableAtLevel(level, room.door)).toBe(true);
      }
    }
  });

  it('特殊地形约为地面格 / 80，且避开起点、出口、陷阱与怪物', () => {
    const level = generateValidLevel(params(12));
    expect(level.terrain.size).toBe(Math.floor(countFloorCells(level) / 80));
    const occupied = new Set(level.monsters.map((placement) => axialKey(placement.pos)));
    for (const [key, kind] of level.terrain) {
      expect(['rubble', 'water', 'vent']).toContain(kind);
      expect(key).not.toBe(axialKey(level.start));
      expect(key).not.toBe(axialKey(level.exit));
      expect(level.traps.has(key)).toBe(false);
      expect(occupied.has(key)).toBe(false);
      const [q, r] = key.split(',');
      expect(cellAtLevel(level, { q: Number(q), r: Number(r) })).toBe(0);
    }
  });

  it('200 个随机种子全部通过校验', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const level = generateValidLevel(params(seed));
      const errors = validateLevel(level, params(level.seed));
      if (errors.length > 0) failures.push(`seed ${seed}: ${errors.join('、')}`);
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('带重试的生成总能产出合法关卡', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const level = generateValidLevel(params(seed));
      expect(validateLevel(level, params(level.seed))).toEqual([]);
    }
  });
});
