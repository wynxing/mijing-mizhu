import {
  areAdjacent,
  axialKey,
  axialToOffset,
  hexDistance,
  neighbors,
  offsetToAxial,
} from '../grid/geometry';
import { CELL_FLOOR, findPath, reachableCells } from '../grid/path';
import {
  DEFAULT_GEN_PARAMS,
  LevelGenerationError,
  cellAtLevel,
  generateLevel,
  levelAsCellGrid,
  type Level,
  type LevelGenParams,
} from './generator';

/** 统计地面格之间的无向边数；环路数 = 边数 - 格数 + 1。 */
export function countFloorEdges(level: Level): number {
  let edges = 0;
  for (let row = 0; row < level.height; row++) {
    for (let col = 0; col < level.width; col++) {
      const axial = offsetToAxial(col, row);
      if (cellAtLevel(level, axial) !== CELL_FLOOR) continue;
      for (const next of neighbors(axial)) {
        if (cellAtLevel(level, next) === CELL_FLOOR) edges++;
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
  if (level.mainPath.length < rules.minMainPath) errors.push('主路径长度不足');
  if (level.branches.length !== rules.branchCount) errors.push('支路数量不符');
  if (level.shortcuts.length < rules.shortcutCount) errors.push('捷径数量不足');

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

  for (const branch of level.branches) {
    if (branch.length < 2) {
      errors.push('存在过短支路');
      break;
    }
  }

  const reachable = reachableCells(map, level.start);
  if (reachable.size !== countFloorCells(level)) errors.push('存在不可达的孤立区域');
  if (!reachable.has(axialKey(level.exit))) errors.push('出口不可达');

  const cycles = countFloorEdges(level) - countFloorCells(level) + 1;
  if (cycles < 2) errors.push('迷宫缺少环路');

  const path = findPath(map, level.start, level.exit);
  if (!path) errors.push('起点到出口无路径');
  else if (path.length < 18) errors.push('起点到出口的最短路径过短');

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

  return errors;
}

/** 生成并校验；失败时换种子重试。 */
export function generateValidLevel(params: LevelGenParams): Level {
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const level = generateLevel({ ...params, seed: params.seed + attempt });
    lastErrors = validateLevel(level, { ...params, seed: params.seed + attempt });
    if (lastErrors.length === 0) return level;
  }
  throw new LevelGenerationError(
    `关卡生成失败（种子 ${params.seed}）：${lastErrors.join('、')}`,
  );
}
