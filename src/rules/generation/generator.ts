import { Rng32 } from '../../core/rng';
import {
  DIRECTIONS,
  axialKey,
  axialToOffset,
  hexDistance,
  offsetToAxial,
  type Axial,
  type AxialKey,
  type DirIndex,
} from '../grid/geometry';
import { CELL_FLOOR, CELL_WALL, cellIndex, type CellGrid } from '../grid/path';

export interface LevelGenParams {
  width: number;
  height: number;
  minMainPath: number;
  maxMainPath: number;
  branchCount: number;
  branchLength: number;
  shortcutCount: number;
  /** 怪物数量预算：阶段 1 定为 8（见 docs/balance/phase1-mobility.md）。 */
  monsterBudget: number;
  seed: number;
}

export const DEFAULT_GEN_PARAMS: LevelGenParams = {
  width: 24,
  height: 18,
  minMainPath: 40,
  maxMainPath: 90,
  branchCount: 3,
  branchLength: 4,
  shortcutCount: 2,
  monsterBudget: 8,
  seed: 1,
};

export interface MonsterPlacement {
  defId: string;
  pos: Axial;
}

export interface Level {
  width: number;
  height: number;
  cells: Uint8Array;
  start: Axial;
  exit: Axial;
  mainPath: Axial[];
  branches: Axial[][];
  shortcuts: Axial[][];
  traps: Set<AxialKey>;
  monsters: MonsterPlacement[];
  seed: number;
}

export class LevelGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelGenerationError';
  }
}

/** 六方向的权重：东向偏置，让走廊总体向右推进但允许上下蜿蜒。 */
const DIR_WEIGHTS: readonly number[] = Object.freeze([1.0, 0.45, 0.25, 0.15, 0.25, 0.45]);

function colOf(a: Axial): number {
  return axialToOffset(a).col;
}

function rowOf(a: Axial): number {
  return a.r;
}

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly cells: Uint8Array;
  readonly grid: { width: number; height: number };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height).fill(CELL_WALL);
    this.grid = { width, height };
  }

  isInterior(a: Axial): boolean {
    const col = colOf(a);
    return col >= 1 && col <= this.width - 2 && rowOf(a) >= 1 && rowOf(a) <= this.height - 2;
  }

  carve(a: Axial): void {
    if (!this.isInterior(a)) return;
    this.cells[cellIndex(this.grid, a)] = CELL_FLOOR;
  }

  isFloor(a: Axial): boolean {
    if (!this.isInterior(a)) return false;
    return this.cells[cellIndex(this.grid, a)] === CELL_FLOOR;
  }
}

function weightedDir(
  rng: Rng32,
  candidates: { dir: DirIndex; target: Axial }[],
  weights: number[],
): DirIndex | null {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i].dir;
  }
  return candidates[candidates.length - 1].dir;
}

function step(from: Axial, dir: DirIndex): Axial {
  const d = DIRECTIONS[dir];
  return { q: from.q + d.q, r: from.r + d.r };
}

/** 在同一条走廊上随机走，必要时直推到底，保证终点落在对侧边缘。 */
function walkMainPath(canvas: Canvas, rng: Rng32, params: LevelGenParams): Axial[] {
  const start: Axial = offsetToAxial(1, 1 + rng.int(0, params.height - 4));
  canvas.carve(start);

  const path: Axial[] = [start];
  const visited = new Set<AxialKey>([axialKey(start)]);
  let current = start;

  while (path.length < params.maxMainPath) {
    const candidates: { dir: DirIndex; target: Axial }[] = [];
    const weights: number[] = [];
    for (let dir = 0; dir < 6; dir++) {
      const target = step(current, dir as DirIndex);
      if (!canvas.isInterior(target)) continue;
      let weight = DIR_WEIGHTS[dir];
      if (!visited.has(axialKey(target))) weight *= 3;
      // 走位已偏东但长度不足时，优先沿东侧上下盘绕，避免提前折返。
      if (path.length < params.minMainPath && colOf(current) >= params.width - 6) {
        if (dir === 1 || dir === 5) weight *= 4;
      }
      candidates.push({ dir: dir as DirIndex, target });
      weights.push(weight);
    }
    if (candidates.length === 0) break;

    const dir = weightedDir(rng, candidates, weights);
    if (dir === null) break;
    const next = step(current, dir);
    current = next;
    canvas.carve(current);
    visited.add(axialKey(current));
    path.push(current);

    if (colOf(current) === params.width - 2 && path.length >= params.minMainPath) break;
  }

  // 兜底：若走到上限仍未抵达东侧边缘，直推一条走廊过去，保证出口在对边。
  if (colOf(current) !== params.width - 2) {
    while (colOf(current) < params.width - 2) {
      const next = step(current, 0);
      current = next;
      canvas.carve(current);
      path.push(current);
    }
  }

  return path;
}

/** 支路：从主路径上长出一条不通向别处的死胡同短枝。 */
function carveBranches(
  canvas: Canvas,
  rng: Rng32,
  params: LevelGenParams,
  mainPath: Axial[],
): Axial[][] {
  const branches: Axial[][] = [];
  const mainKeys = new Set(mainPath.map(axialKey));

  for (let i = 0; i < params.branchCount; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const anchor = mainPath[rng.int(0, mainPath.length - 1)];
      const dir = rng.int(0, 5) as DirIndex;
      const stub: Axial[] = [];
      let current = anchor;
      for (let stepIndex = 0; stepIndex < params.branchLength; stepIndex++) {
        const target = step(current, dir);
        if (!canvas.isInterior(target)) break;
        if (mainKeys.has(axialKey(target))) break;
        canvas.carve(target);
        stub.push(target);
        current = target;
      }
      if (stub.length >= 2) {
        branches.push(stub);
        break;
      }
    }
  }

  return branches;
}

/** 捷径：在主路径的两点之间开一条 L 形走廊，制造环路。 */
function carveShortcuts(
  canvas: Canvas,
  rng: Rng32,
  params: LevelGenParams,
  mainPath: Axial[],
): Axial[][] {
  const shortcuts: Axial[][] = [];
  const used = new Set<AxialKey>();

  for (let attempt = 0; attempt < 120 && shortcuts.length < params.shortcutCount; attempt++) {
    const a = mainPath[rng.int(0, mainPath.length - 1)];
    const b = mainPath[rng.int(0, mainPath.length - 1)];
    const distance = hexDistance(a, b);
    if (distance < 4 || distance > 8) continue;
    if (used.has(axialKey(a)) || used.has(axialKey(b))) continue;

    const horizontalFirst = rng.next() < 0.5;
    const corridor: Axial[] = [];
    const seen = new Set<AxialKey>();
    let current = a;
    const walkTo = (target: Axial) => {
      while (!axialEquals(current, target)) {
        const dir = pickAxisDir(current, target, horizontalFirst);
        current = step(current, dir);
        if (!canvas.isInterior(current)) return false;
        canvas.carve(current);
        if (!seen.has(axialKey(current))) {
          seen.add(axialKey(current));
          corridor.push(current);
        }
      }
      return true;
    };

    if (!walkTo(b)) continue;
    used.add(axialKey(a));
    used.add(axialKey(b));
    if (corridor.length >= 2) shortcuts.push(corridor);
  }

  return shortcuts;
}

function axialEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

/** L 形走廊：先沿主轴推进，再沿次轴推进。 */
function pickAxisDir(current: Axial, target: Axial, horizontalFirst: boolean): DirIndex {
  const dq = target.q - current.q;
  const dr = target.r - current.r;
  const horizontal: DirIndex = dq > 0 ? 0 : 3;
  const vertical: DirIndex = dr > 0 ? 5 : 2;
  const first = horizontalFirst ? horizontal : vertical;
  const second = horizontalFirst ? vertical : horizontal;
  const firstDelta = horizontalFirst ? Math.abs(dq) : Math.abs(dr);
  const secondDelta = horizontalFirst ? Math.abs(dr) : Math.abs(dq);
  if (firstDelta > 0) return first;
  if (secondDelta > 0) return second;
  return horizontal;
}

/**
 * 布点：怪物散布在离起点 ≥ 8 格的地面格上（设计文档 §9.1 的安全期）。
 * 怪物种类按预算分配：嗅犬为主，石卫少量，游魂少量。
 */
function placeMonsters(
  canvas: Canvas,
  rng: Rng32,
  start: Axial,
  budget: number,
): MonsterPlacement[] {
  const candidates: Axial[] = [];
  for (let row = 1; row < canvas.height - 1; row++) {
    for (let col = 1; col < canvas.width - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (!canvas.isFloor(cell)) continue;
      if (hexDistance(cell, start) < 8) continue;
      candidates.push(cell);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const mix: string[] = [];
  for (let i = 0; i < budget; i++) {
    const ratio = i / Math.max(1, budget);
    mix.push(ratio < 0.6 ? 'sniffer' : ratio < 0.85 ? 'stonewarden' : 'wraith');
  }

  return candidates.slice(0, budget).map((pos, index) => ({
    defId: mix[index],
    pos,
  }));
}

export function generateLevel(params: LevelGenParams): Level {
  const rng = new Rng32(params.seed);
  const canvas = new Canvas(params.width, params.height);

  const mainPath = walkMainPath(canvas, rng, params);
  const branches = carveBranches(canvas, rng, params, mainPath);
  const shortcuts = carveShortcuts(canvas, rng, params, mainPath);

  const level: Level = {
    width: params.width,
    height: params.height,
    cells: canvas.cells,
    start: mainPath[0],
    exit: mainPath[mainPath.length - 1],
    mainPath,
    branches,
    shortcuts,
    traps: new Set<AxialKey>(),
    monsters: placeMonsters(canvas, rng, mainPath[0], params.monsterBudget),
    seed: params.seed,
  };

  return level;
}

export function levelFromSeed(seed: number, overrides?: Partial<LevelGenParams>): Level {
  return generateLevel({ ...DEFAULT_GEN_PARAMS, ...overrides, seed });
}

export function levelAsCellGrid(level: Level): CellGrid {
  return { cells: level.cells, grid: { width: level.width, height: level.height } };
}

export function cellAtLevel(level: Level, a: Axial): number {
  const col = colOf(a);
  if (col < 0 || col >= level.width || rowOf(a) < 0 || rowOf(a) >= level.height) {
    return CELL_WALL;
  }
  return level.cells[rowOf(a) * level.width + col];
}

export function isWalkableAtLevel(level: Level, a: Axial): boolean {
  return cellAtLevel(level, a) === CELL_FLOOR;
}
