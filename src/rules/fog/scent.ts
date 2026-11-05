import { axialKey, neighbors, type Axial, type AxialKey } from '../grid/geometry';

/**
 * 气味场：记录玩家近期活动强度，怪物循此移动。
 * 玩家每移动一格，在途经的每一格（含落点）留下 +1；每回合结束全图 -1，下限 0。
 */
export interface ScentState {
  cells: Map<AxialKey, number>;
}

export function createScent(): ScentState {
  return { cells: new Map<AxialKey, number>() };
}

/** 玩家途经的每一格气味 +1。 */
export function addScent(scent: ScentState, cells: readonly Axial[]): ScentState {
  const next = new Map(scent.cells);
  for (const cell of cells) {
    const key = axialKey(cell);
    next.set(key, (next.get(key) ?? 0) + 1);
  }
  return { cells: next };
}

/** 全图气味衰减 1，下限 0；强度归零的格子移出表。 */
export function decayScent(scent: ScentState): ScentState {
  const next = new Map<AxialKey, number>();
  for (const [key, value] of scent.cells) {
    const decayed = value - 1;
    if (decayed > 0) next.set(key, decayed);
  }
  return { cells: next };
}

export function scentAt(scent: ScentState, cell: Axial): number {
  return scent.cells.get(axialKey(cell)) ?? 0;
}

/** 指定范围内气味最高的格子；并列时取最先遇到的。 */
export function highestScentWithin(
  scent: ScentState,
  candidates: readonly Axial[],
): Axial | null {
  let best: Axial | null = null;
  let bestValue = 0;
  for (const cell of candidates) {
    const value = scentAt(scent, cell);
    if (value > bestValue) {
      bestValue = value;
      best = cell;
    }
  }
  return best;
}

/**
 * 玩家是否处在低气味区：相邻格气味均 ≤ 1。
 * 满足这个条件并静止 2 个回合，追击才会降级为警觉。
 */
export function inLowScentArea(scent: ScentState, player: Axial): boolean {
  for (const cell of neighbors(player)) {
    if (scentAt(scent, cell) > 1) return false;
  }
  return true;
}

/** 特殊地形：该格与相邻格气味归零。 */
export function clearScentAround(scent: ScentState, cell: Axial): ScentState {
  const next = new Map(scent.cells);
  for (const target of [cell, ...neighbors(cell)]) {
    next.delete(axialKey(target));
  }
  return { cells: next };
}
