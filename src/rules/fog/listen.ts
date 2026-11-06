import { axialKey, isInBounds, neighbors, type Axial, type AxialKey, type GridBounds } from '../grid/geometry';
import { CELL_WALL } from '../grid/path';
import type { ListenResult } from './fog';

/** 探听消耗 1 移动点。 */
export const LISTEN_MOVEMENT_COST = 1;

/** 每回合最多探听 2 次。 */
export const LISTEN_PER_TURN = 2;

export interface LevelTerrain {
  cells: Uint8Array;
  grid: GridBounds;
  traps: ReadonlySet<AxialKey>;
}

/**
 * 探听结果：玩家所在格的每一个相邻格返回三态之一。
 * 越界一律视为墙；相邻格有陷阱时返回「有异响」。
 */
export function resolveListen(
  terrain: LevelTerrain,
  from: Axial,
): Map<AxialKey, ListenResult> {
  const out = new Map<AxialKey, ListenResult>();
  for (const neighbor of neighbors(from)) {
    const key = axialKey(neighbor);
    if (!isInBounds(terrain.grid, neighbor)) {
      out.set(key, 'wall');
      continue;
    }
    const index = neighbor.r * terrain.grid.width + (neighbor.q + (neighbor.r - (neighbor.r & 1)) / 2);
    if (terrain.cells[index] === CELL_WALL) {
      out.set(key, 'wall');
      continue;
    }
    if (terrain.traps.has(key)) {
      out.set(key, 'passage_noisy');
      continue;
    }
    out.set(key, 'passage_quiet');
  }
  return out;
}
