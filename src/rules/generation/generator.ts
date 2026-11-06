import { Rng32 } from '../../core/rng';
import {
  axialKey,
  axialToOffset,
  hexDistance,
  neighbor,
  offsetToAxial,
  type Axial,
  type AxialKey,
  type DirIndex,
} from '../grid/geometry';
import { CELL_FLOOR, CELL_WALL, cellIndex, findPath, type CellGrid } from '../grid/path';

export interface LevelGenParams {
  width: number;
  height: number;
  /** 目标房间数（设计文档 §9.1：6–9）。 */
  roomCount: number;
  /** 怪物数量预算：阶段 1 定为 8（见 docs/balance/phase1-mobility.md）。 */
  monsterBudget: number;
  /** 陷阱密度：占地面格的比例。 */
  trapDensity: number;
  /** 起点到出口最短路径的下限（格数，含端点）。 */
  minPath: number;
  /** 拆墙造环比例：占候选墙的比例。 */
  loopRatio: number;
  seed: number;
}

export const DEFAULT_GEN_PARAMS: LevelGenParams = {
  width: 34,
  height: 24,
  roomCount: 7,
  monsterBudget: 8,
  trapDensity: 0.06,
  minPath: 20,
  loopRatio: 0.18,
  seed: 1,
};

export interface MonsterPlacement {
  defId: string;
  pos: Axial;
}

/** 房间矩形，偏移坐标（odd-r）。 */
export interface RoomRect {
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface Level {
  width: number;
  height: number;
  cells: Uint8Array;
  start: Axial;
  exit: Axial;
  /** 语义为 start→exit 的 A* 最短路。 */
  mainPath: Axial[];
  rooms: RoomRect[];
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

const MIN_LEAF = 5;
const ROOM_MAX_W = 9;
const ROOM_MAX_H = 7;
const WALL_AUGMENT_CHANCE = 0.2;

interface BspNode {
  rect: RoomRect;
  left: BspNode | null;
  right: BspNode | null;
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
    const { col, row } = axialToOffset(a);
    return col >= 1 && col <= this.width - 2 && row >= 1 && row <= this.height - 2;
  }

  carve(a: Axial): void {
    if (!this.isInterior(a)) return;
    this.cells[cellIndex(this.grid, a)] = CELL_FLOOR;
  }

  setWall(a: Axial): void {
    if (!this.isInterior(a)) return;
    this.cells[cellIndex(this.grid, a)] = CELL_WALL;
  }

  isFloor(a: Axial): boolean {
    if (!this.isInterior(a)) return false;
    return this.cells[cellIndex(this.grid, a)] === CELL_FLOOR;
  }
}

function roomCells(room: RoomRect): Axial[] {
  const cells: Axial[] = [];
  for (let row = room.row; row < room.row + room.h; row++) {
    for (let col = room.col; col < room.col + room.w; col++) {
      cells.push(offsetToAxial(col, row));
    }
  }
  return cells;
}

function shuffleWithRng<T>(rng: Rng32, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function leafNode(rect: RoomRect): BspNode {
  return { rect, left: null, right: null };
}

function canSplit(rect: RoomRect): boolean {
  return rect.w >= MIN_LEAF * 2 || rect.h >= MIN_LEAF * 2;
}

/** 中段切分：避免切出无法继续细分的窄叶。 */
function balancedCut(rng: Rng32, size: number): number {
  const low = Math.max(MIN_LEAF, Math.floor(size * 0.4));
  const high = Math.min(size - MIN_LEAF, Math.ceil(size * 0.6));
  return rng.int(low, high);
}

function splitNode(rng: Rng32, node: BspNode): void {
  const { rect } = node;
  const canHorizontal = rect.w >= MIN_LEAF * 2;
  const canVertical = rect.h >= MIN_LEAF * 2;
  const horizontal = rect.w >= rect.h ? canHorizontal : !canVertical;

  if (horizontal && canHorizontal) {
    const leftW = balancedCut(rng, rect.w);
    node.left = leafNode({ col: rect.col, row: rect.row, w: leftW, h: rect.h });
    node.right = leafNode({
      col: rect.col + leftW,
      row: rect.row,
      w: rect.w - leftW,
      h: rect.h,
    });
  } else if (canVertical) {
    const topH = balancedCut(rng, rect.h);
    node.left = leafNode({ col: rect.col, row: rect.row, w: rect.w, h: topH });
    node.right = leafNode({
      col: rect.col,
      row: rect.row + topH,
      w: rect.w,
      h: rect.h - topH,
    });
  }
}

/** BSP 切分：每次都切面积最大的可切叶子，保证叶子大小均匀。 */
function buildBsp(rng: Rng32, width: number, height: number, roomCount: number): BspNode {
  const root = leafNode({ col: 1, row: 1, w: width - 2, h: height - 2 });
  const leaves: BspNode[] = [root];

  while (leaves.length < roomCount) {
    let bestIndex = -1;
    let bestArea = -1;
    for (let i = 0; i < leaves.length; i++) {
      if (!canSplit(leaves[i].rect)) continue;
      const area = leaves[i].rect.w * leaves[i].rect.h;
      if (area > bestArea) {
        bestArea = area;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;

    const node = leaves[bestIndex];
    splitNode(rng, node);
    if (!node.left || !node.right) break;
    leaves.splice(bestIndex, 1, node.left, node.right);
  }

  return root;
}

function collectRooms(node: BspNode, roomOfLeaf: Map<BspNode, RoomRect>): RoomRect[] {
  const room = roomOfLeaf.get(node);
  if (room) return [room];
  return [
    ...(node.left ? collectRooms(node.left, roomOfLeaf) : []),
    ...(node.right ? collectRooms(node.right, roomOfLeaf) : []),
  ];
}

/** 后序遍历：按兄弟关系连接左右子树的房间，形成生成树。 */
function connectSiblings(
  node: BspNode,
  canvas: Canvas,
  rng: Rng32,
  roomOfLeaf: Map<BspNode, RoomRect>,
  protectedCells: Set<AxialKey>,
): void {
  if (!node.left || !node.right) return;
  connectSiblings(node.left, canvas, rng, roomOfLeaf, protectedCells);
  connectSiblings(node.right, canvas, rng, roomOfLeaf, protectedCells);

  const leftRooms = collectRooms(node.left, roomOfLeaf);
  const rightRooms = collectRooms(node.right, roomOfLeaf);
  if (leftRooms.length === 0 || rightRooms.length === 0) return;

  const from = roomCells(leftRooms[rng.int(0, leftRooms.length - 1)]);
  const to = roomCells(rightRooms[rng.int(0, rightRooms.length - 1)]);
  carveCorridor(
    canvas,
    rng,
    from[rng.int(0, from.length - 1)],
    to[rng.int(0, to.length - 1)],
    protectedCells,
  );
}

/** 轴向贪心走廊：每步选六边形距离更小的邻格，平局随机。 */
function carveCorridor(
  canvas: Canvas,
  rng: Rng32,
  from: Axial,
  to: Axial,
  protectedCells: Set<AxialKey>,
): Axial[] {
  let current = from;
  canvas.carve(current);
  protectedCells.add(axialKey(current));
  const path: Axial[] = [current];

  for (let step = 0; step < 256; step++) {
    const goalDistance = hexDistance(current, to);
    if (goalDistance === 0) break;

    const candidates: { cell: Axial; distance: number }[] = [];
    for (let dir = 0; dir < 6; dir++) {
      const next = neighbor(current, dir as DirIndex);
      if (!canvas.isInterior(next)) continue;
      const distance = hexDistance(next, to);
      if (distance >= goalDistance) continue;
      candidates.push({ cell: next, distance });
    }
    if (candidates.length === 0) break;

    let bestDistance = Infinity;
    for (const candidate of candidates) {
      if (candidate.distance < bestDistance) bestDistance = candidate.distance;
    }
    const best = candidates.filter((candidate) => candidate.distance === bestDistance);
    current = best[rng.int(0, best.length - 1)].cell;
    canvas.carve(current);
    protectedCells.add(axialKey(current));
    path.push(current);
  }

  return path;
}

function roomConnected(canvas: Canvas, room: RoomRect): boolean {
  const floors: Axial[] = [];
  for (const cell of roomCells(room)) {
    if (canvas.isFloor(cell)) floors.push(cell);
  }
  if (floors.length === 0) return true;

  const inRoom = (a: Axial): boolean => {
    const { col, row } = axialToOffset(a);
    return (
      col >= room.col &&
      col < room.col + room.w &&
      row >= room.row &&
      row < room.row + room.h
    );
  };
  const seen = new Set<AxialKey>([axialKey(floors[0])]);
  const queue: Axial[] = [floors[0]];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (let dir = 0; dir < 6; dir++) {
      const next = neighbor(current, dir as DirIndex);
      if (!inRoom(next) || !canvas.isFloor(next)) continue;
      const key = axialKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen.size === floors.length;
}

/** 墙增广：在房间内部随机立墙，断连就回滚。 */
function augmentWalls(
  canvas: Canvas,
  rng: Rng32,
  room: RoomRect,
  protectedCells: Set<AxialKey>,
): void {
  for (let row = room.row + 1; row < room.row + room.h - 1; row++) {
    for (let col = room.col + 1; col < room.col + room.w - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (!canvas.isFloor(cell)) continue;
      if (protectedCells.has(axialKey(cell))) continue;
      if (rng.next() >= WALL_AUGMENT_CHANCE) continue;
      canvas.setWall(cell);
      if (!roomConnected(canvas, room)) canvas.carve(cell);
    }
  }
}

/** 造环：拆掉地面邻居 ≥2 的墙格，按比例取。 */
function carveLoops(canvas: Canvas, rng: Rng32, loopRatio: number): void {
  const candidates: Axial[] = [];
  for (let row = 1; row < canvas.height - 1; row++) {
    for (let col = 1; col < canvas.width - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (canvas.isFloor(cell)) continue;
      let floorNeighbors = 0;
      for (let dir = 0; dir < 6; dir++) {
        if (canvas.isFloor(neighbor(cell, dir as DirIndex))) floorNeighbors++;
      }
      if (floorNeighbors >= 2) candidates.push(cell);
    }
  }

  const shuffled = shuffleWithRng(rng, candidates);
  const targets = Math.floor(shuffled.length * loopRatio);
  for (let i = 0; i < targets; i++) canvas.carve(shuffled[i]);
}

/** 从左侧/右侧边缘接一条走廊进指定房间，返回边缘格作为起点/出口。 */
function attachEdgeCorridor(
  canvas: Canvas,
  rng: Rng32,
  room: RoomRect,
  side: 'left' | 'right',
  protectedCells: Set<AxialKey>,
): Axial {
  const pool = roomCells(room).filter((cell) => canvas.isFloor(cell));
  const candidates = pool.length > 0 ? pool : roomCells(room);
  let anchor = candidates[0];
  for (const cell of candidates) {
    const offset = axialToOffset(cell);
    const bestOffset = axialToOffset(anchor);
    const better = side === 'left' ? offset.col < bestOffset.col : offset.col > bestOffset.col;
    if (better) anchor = cell;
  }

  const edgeCol = side === 'left' ? 1 : canvas.width - 2;
  const edge = offsetToAxial(edgeCol, axialToOffset(anchor).row);
  carveCorridor(canvas, rng, edge, anchor, protectedCells);
  return edge;
}

/**
 * 布点：怪物散布在离起点 ≥ 8 格的地面格上（设计文档 §9.1 的安全期）。
 * 组合 50% 嗅犬 / 20% 石卫 / 15% 游魂 / 15% 蛛巢（§6.4）。
 */
function placeMonsters(
  canvas: Canvas,
  rng: Rng32,
  start: Axial,
  exit: Axial,
  traps: Set<AxialKey>,
  budget: number,
): MonsterPlacement[] {
  const candidates: Axial[] = [];
  for (let row = 1; row < canvas.height - 1; row++) {
    for (let col = 1; col < canvas.width - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (!canvas.isFloor(cell)) continue;
      if (hexDistance(cell, start) < 8) continue;
      const key = axialKey(cell);
      if (key === axialKey(exit) || traps.has(key)) continue;
      candidates.push(cell);
    }
  }

  return shuffleWithRng(rng, candidates)
    .slice(0, budget)
    .map((pos, index) => {
      const ratio = index / Math.max(1, budget);
      const defId =
        ratio < 0.5
          ? 'sniffer'
          : ratio < 0.7
            ? 'stonewarden'
            : ratio < 0.85
              ? 'wraith'
              : 'brood';
      return { defId, pos };
    });
}

/** 起点/出口都可达（把全部陷阱视为墙）。 */
function escapeWithTrapsBlocked(
  canvas: Canvas,
  start: Axial,
  exit: Axial,
  traps: Set<AxialKey>,
): boolean {
  const cells = new Uint8Array(canvas.cells);
  for (const key of traps) {
    const [q, r] = key.split(',');
    cells[cellIndex(canvas.grid, { q: Number(q), r: Number(r) })] = CELL_WALL;
  }
  return findPath({ cells, grid: canvas.grid }, start, exit) !== null;
}

/** 陷阱：非起点/出口、距起点 ≥3 的地面格；每放一个都验证仍可绕开。 */
function placeTraps(
  canvas: Canvas,
  rng: Rng32,
  start: Axial,
  exit: Axial,
  density: number,
): Set<AxialKey> {
  const candidates: Axial[] = [];
  for (let row = 1; row < canvas.height - 1; row++) {
    for (let col = 1; col < canvas.width - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (!canvas.isFloor(cell)) continue;
      if (hexDistance(cell, start) < 3) continue;
      const key = axialKey(cell);
      if (key === axialKey(exit)) continue;
      candidates.push(cell);
    }
  }

  const traps = new Set<AxialKey>();
  const target = Math.round(candidates.length * density);
  for (const cell of shuffleWithRng(rng, candidates)) {
    if (traps.size >= target) break;
    const key = axialKey(cell);
    traps.add(key);
    if (!escapeWithTrapsBlocked(canvas, start, exit, traps)) traps.delete(key);
  }
  return traps;
}

export function generateLevel(params: LevelGenParams): Level {
  const rng = new Rng32(params.seed);
  const canvas = new Canvas(params.width, params.height);
  const protectedCells = new Set<AxialKey>();

  const bsp = buildBsp(rng, params.width, params.height, params.roomCount);
  const leaves: BspNode[] = [];
  const collectLeaves = (node: BspNode) => {
    if (!node.left || !node.right) {
      leaves.push(node);
      return;
    }
    collectLeaves(node.left);
    collectLeaves(node.right);
  };
  collectLeaves(bsp);

  const rooms: RoomRect[] = [];
  const roomOfLeaf = new Map<BspNode, RoomRect>();
  for (const leaf of leaves) {
    const { rect } = leaf;
    const maxW = Math.min(rect.w - 2, ROOM_MAX_W);
    const maxH = Math.min(rect.h - 2, ROOM_MAX_H);
    if (maxW < 3 || maxH < 3) continue;
    const w = rng.int(Math.min(5, maxW), maxW);
    const h = rng.int(Math.min(5, maxH), maxH);
    const col = rect.col + 1 + rng.int(0, rect.w - 2 - w);
    const row = rect.row + 1 + rng.int(0, rect.h - 2 - h);
    const room: RoomRect = { col, row, w, h };
    rooms.push(room);
    roomOfLeaf.set(leaf, room);
    for (const cell of roomCells(room)) canvas.carve(cell);
  }

  connectSiblings(bsp, canvas, rng, roomOfLeaf, protectedCells);

  for (const room of rooms) augmentWalls(canvas, rng, room, protectedCells);
  carveLoops(canvas, rng, params.loopRatio);

  const leftRoom = rooms.reduce((best, room) => (room.col < best.col ? room : best), rooms[0]);
  const rightRoom = rooms.reduce(
    (best, room) => (room.col + room.w > best.col + best.w ? room : best),
    rooms[0],
  );
  const start = attachEdgeCorridor(canvas, rng, leftRoom, 'left', protectedCells);
  const exit = attachEdgeCorridor(canvas, rng, rightRoom, 'right', protectedCells);

  const map: CellGrid = { cells: canvas.cells, grid: canvas.grid };
  const mainPath = findPath(map, start, exit) ?? [start];

  const traps = placeTraps(canvas, rng, start, exit, params.trapDensity);
  const monsters = placeMonsters(canvas, rng, start, exit, traps, params.monsterBudget);

  return {
    width: params.width,
    height: params.height,
    cells: canvas.cells,
    start,
    exit,
    mainPath,
    rooms,
    traps,
    monsters,
    seed: params.seed,
  };
}

export function levelFromSeed(seed: number, overrides?: Partial<LevelGenParams>): Level {
  return generateLevel({ ...DEFAULT_GEN_PARAMS, ...overrides, seed });
}

export function levelAsCellGrid(level: Level): CellGrid {
  return { cells: level.cells, grid: { width: level.width, height: level.height } };
}

export function cellAtLevel(level: Level, a: Axial): number {
  const col = axialToOffset(a).col;
  if (col < 0 || col >= level.width || a.r < 0 || a.r >= level.height) {
    return CELL_WALL;
  }
  return level.cells[a.r * level.width + col];
}

export function isWalkableAtLevel(level: Level, a: Axial): boolean {
  return cellAtLevel(level, a) === CELL_FLOOR;
}
