import {
  axialKey,
  axialToOffset,
  hexDistance,
  neighbors,
  parseAxialKey,
  type Axial,
  type AxialKey,
  type GridBounds,
} from './geometry';

export const CELL_FLOOR = 0;
export const CELL_WALL = 1;

export interface CellGrid {
  cells: Uint8Array;
  grid: GridBounds;
}

export function cellIndex(bounds: GridBounds, a: Axial): number {
  const { col, row } = axialToOffset(a);
  return row * bounds.width + col;
}

export function cellAt(map: CellGrid, a: Axial): number {
  const { col, row } = axialToOffset(a);
  if (col < 0 || col >= map.grid.width || row < 0 || row >= map.grid.height) {
    return CELL_WALL;
  }
  return map.cells[row * map.grid.width + col];
}

export function isWalkable(map: CellGrid, a: Axial): boolean {
  return cellAt(map, a) === CELL_FLOOR;
}

/** 简单二叉最小堆，A* 用。 */
class MinHeap {
  private items: { key: number; value: Axial }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, value: Axial): void {
    this.items.push({ key, value });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].key <= this.items[i].key) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): Axial | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop() as { key: number; value: Axial };
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left].key < this.items[smallest].key) {
          smallest = left;
        }
        if (right < this.items.length && this.items[right].key < this.items[smallest].key) {
          smallest = right;
        }
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
}

/** A* 寻路，返回含终点在内的格序列；不可达返回 null。 */
export function findPath(map: CellGrid, from: Axial, to: Axial): Axial[] | null {
  if (!isWalkable(map, from) || !isWalkable(map, to)) return null;

  const open = new MinHeap();
  const cameFrom = new Map<AxialKey, AxialKey>();
  const gScore = new Map<AxialKey, number>();
  const startKey = axialKey(from);
  const goalKey = axialKey(to);

  gScore.set(startKey, 0);
  open.push(hexDistance(from, to), from);

  while (open.size > 0) {
    const current = open.pop() as Axial;
    const currentKey = axialKey(current);
    if (currentKey === goalKey) {
      const path: Axial[] = [];
      let key: AxialKey | undefined = goalKey;
      while (key !== undefined) {
        path.push(parseAxialKey(key));
        key = cameFrom.get(key);
      }
      return path.reverse();
    }

    const currentG = gScore.get(currentKey) ?? Infinity;
    for (const next of neighbors(current)) {
      if (!isWalkable(map, next)) continue;
      const nextKey = axialKey(next);
      const tentative = currentG + 1;
      if (tentative < (gScore.get(nextKey) ?? Infinity)) {
        gScore.set(nextKey, tentative);
        cameFrom.set(nextKey, currentKey);
        open.push(tentative + hexDistance(next, to), next);
      }
    }
  }

  return null;
}

/** 从起点出发的 BFS 距离表；不可达为 -1。 */
export function bfsDistances(map: CellGrid, from: Axial): Map<AxialKey, number> {
  const dist = new Map<AxialKey, number>();
  if (!isWalkable(map, from)) return dist;

  const startKey = axialKey(from);
  dist.set(startKey, 0);
  const queue: Axial[] = [from];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = dist.get(axialKey(current)) ?? 0;
    for (const next of neighbors(current)) {
      if (!isWalkable(map, next)) continue;
      const key = axialKey(next);
      if (dist.has(key)) continue;
      dist.set(key, currentDist + 1);
      queue.push(next);
    }
  }
  return dist;
}

/** 从起点可达的全部地面格。 */
export function reachableCells(map: CellGrid, from: Axial): Set<AxialKey> {
  const dist = bfsDistances(map, from);
  const out = new Set<AxialKey>();
  for (const [key, value] of dist) {
    if (value >= 0) out.add(key);
  }
  return out;
}
