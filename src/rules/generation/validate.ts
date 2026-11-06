import {
  areAdjacent,
  axialKey,
  axialToOffset,
  hexDistance,
  neighbor,
  offsetToAxial,
  type DirIndex,
} from '../grid/geometry';
import {
  CELL_FLOOR,
  CELL_WALL,
  cellIndex,
  findPath,
  reachableCells,
} from '../grid/path';
import {
  DEFAULT_GEN_PARAMS,
  LevelGenerationError,
  cellAtLevel,
  generateLevel,
  levelAsCellGrid,
  type Level,
  type LevelGenParams,
} from './generator';

/**
 * 统计地面格之间的无向边数；环路数 = 边数 - 格数 + 1。
 * 只遍历 E/NE/NW 三个方向，避免每条边被两个端点各数一次。
 */
export function countFloorEdges(level: Level): number {
  let edges = 0;
  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      const axial = offsetToAxial(col, row);
      if (cellAtLevel(level, axial) !== CELL_FLOOR) continue;
      for (let dir = 0; dir <= 2; dir++) {
        if (cellAtLevel(level, neighbor(axial, dir as DirIndex)) === CELL_FLOOR) edges++;
      }
    }
  }
  return edges;
}

export function countFloorCells(level: Level): number {
  let count = 0;
  for (let i = 0; i < level.cells.length; i++) {
    if (level.cells[i] === CELL_FLOOR) count++;
  }
  return count;
}

/** 死路：只有 1 个地面邻居且不是起终点的格子。阶段 1 只统计、不拦截。 */
export function countDeadEnds(level: Level): number {
  let deadEnds = 0;
  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      const axial = offsetToAxial(col, row);
      if (cellAtLevel(level, axial) !== CELL_FLOOR) continue;
      if (axialKey(axial) === axialKey(level.start) || axialKey(axial) === axialKey(level.exit)) {
        continue;
      }
      let floorNeighbors = 0;
      for (let dir = 0; dir < 6; dir++) {
        if (cellAtLevel(level, neighbor(axial, dir as DirIndex)) === CELL_FLOOR) {
          floorNeighbors++;
        }
      }
      if (floorNeighbors === 1) deadEnds++;
    }
  }
  return deadEnds;
}

/** 把所有陷阱当作不可通行后，起点是否仍能到达出口。 */
function escapeWithoutTraps(level: Level): boolean {
  const blocked = new Uint8Array(level.cells);
  const grid = { width: level.width, height: level.height };
  for (const key of level.traps) {
    const [q, r] = key.split(',');
    blocked[cellIndex(grid, { q: Number(q), r: Number(r) })] = CELL_WALL;
  }
  return findPath({ cells: blocked, grid }, level.start, level.exit) !== null;
}

/** 返回被违反的不变量描述，空数组代表关卡合法。 */
export function validateLevel(level: Level, params?: LevelGenParams): string[] {
  const rules = params ?? { ...DEFAULT_GEN_PARAMS, seed: level.seed };
  const errors: string[] = [];
  const map = levelAsCellGrid(level);

  const startCol = axialToOffset(level.start).col;
  const exitCol = axialToOffset(level.exit).col;

  if (startCol !== 1) errors.push('起点不在左边缘');
  if (exitCol !== level.width - 2) errors.push('出口不在右边缘');
  if (areAdjacent(level.start, level.exit)) errors.push('出口与起点相邻');
  if (hexDistance(level.start, level.exit) < 12) errors.push('起点与出口距离过近');

  if (level.mainPath.length < rules.minPath) errors.push('最短路径长度不足');

  for (let i = 1; i < level.mainPath.length; i++) {
    if (!areAdjacent(level.mainPath[i - 1], level.mainPath[i])) {
      errors.push('主路径不连续');
      break;
    }
  }
  for (const cell of level.mainPath) {
    if (cellAtLevel(level, cell) !== CELL_FLOOR) {
      errors.push('主路径存在非地面格');
      break;
    }
  }

  const shortest = findPath(map, level.start, level.exit);
  if (!shortest) errors.push('起点到出口无路径');
  else if (shortest.length < rules.minPath) errors.push('起点到出口的最短路径过短');

  if (level.rooms.length < 6 || level.rooms.length > 9) errors.push('房间数量不在 6–9');
  for (const room of level.rooms) {
    if (room.w < 3 || room.h < 3) {
      errors.push('存在过小的房间');
      break;
    }
    if (
      room.col < 1 ||
      room.row < 1 ||
      room.col + room.w > level.width - 1 ||
      room.row + room.h > level.height - 1
    ) {
      errors.push('房间越界');
      break;
    }
  }

  const floorCells = countFloorCells(level);
  const fill = floorCells / (level.width * level.height);
  if (fill < 0.25 || fill > 0.55) errors.push('地面填充率不在 25%–55%');

  const reachable = reachableCells(map, level.start);
  if (reachable.size !== floorCells) errors.push('存在不可达的孤立区域');
  if (!reachable.has(axialKey(level.exit))) errors.push('出口不可达');

  const cycles = countFloorEdges(level) - floorCells + 1;
  if (cycles < 2) errors.push('迷宫缺少环路');

  for (let col = 0; col < level.width; col++) {
    if (cellAtLevel(level, offsetToAxial(col, 0)) === CELL_FLOOR) {
      errors.push('上边框存在地面格');
      break;
    }
  }
  for (let row = 0; row < level.height; row++) {
    if (cellAtLevel(level, offsetToAxial(0, row)) === CELL_FLOOR) {
      errors.push('左边框存在地面格');
      break;
    }
    if (cellAtLevel(level, offsetToAxial(level.width - 1, row)) === CELL_FLOOR) {
      errors.push('右边框存在地面格');
      break;
    }
  }
  for (let col = 0; col < level.width; col++) {
    if (cellAtLevel(level, offsetToAxial(col, level.height - 1)) === CELL_FLOOR) {
      errors.push('下边框存在地面格');
      break;
    }
  }

  for (const key of level.traps) {
    const [q, r] = key.split(',');
    const cell = { q: Number(q), r: Number(r) };
    if (cellAtLevel(level, cell) !== CELL_FLOOR) {
      errors.push('陷阱不在可走格上');
      break;
    }
    if (key === axialKey(level.start) || key === axialKey(level.exit)) {
      errors.push('陷阱位于起点或出口');
      break;
    }
  }
  if (level.traps.size > 0 && !escapeWithoutTraps(level)) errors.push('陷阱堵死了唯一通路');

  if (level.monsters.length !== rules.monsterBudget) errors.push('怪物数量与预算不符');
  for (const placement of level.monsters) {
    if (cellAtLevel(level, placement.pos) !== CELL_FLOOR) {
      errors.push('怪物不在可走格上');
      break;
    }
    if (hexDistance(placement.pos, level.start) < 8) {
      errors.push('怪物距起点过近');
      break;
    }
    if (
      axialKey(placement.pos) === axialKey(level.exit) ||
      level.traps.has(axialKey(placement.pos))
    ) {
      errors.push('怪物与出口或陷阱重叠');
      break;
    }
  }

  return errors;
}

/** 生成并校验；失败时换种子重试。 */
export function generateValidLevel(params: LevelGenParams): Level {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 16; attempt++) {
    const seed = params.seed + attempt;
    const level = generateLevel({ ...params, seed });
    lastErrors = validateLevel(level, { ...params, seed });
    if (lastErrors.length === 0) return level;
  }
  throw new LevelGenerationError(
    `关卡生成失败（种子 ${params.seed}）：${lastErrors.join('、')}`,
  );
}
