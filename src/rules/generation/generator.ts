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
  /** 怪物数量预算：阶段 2 定为 10 = 1 守卫 + 2 战斗房嗅犬 + 7 游荡（§9.4）。 */
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
  width: 46,
  height: 30,
  roomCount: 9,
  monsterBudget: 10,
  trapDensity: 0.06,
  minPath: 60,
  loopRatio: 0.18,
  seed: 1,
};

export interface MonsterPlacement {
  defId: string;
  pos: Axial;
}

/** 房间矩形，偏移坐标（odd-r）。BSP 内部只用几何，不带类型。 */
export interface RoomRect {
  col: number;
  row: number;
  w: number;
  h: number;
}

export type RoomKind = 'start' | 'exit' | 'encounter' | 'chest' | 'rest' | 'battle' | 'trap';

/** 房间：几何 + 类型 + 门位置（§8.1）。 */
export interface Room extends RoomRect {
  kind: RoomKind;
  door: Axial;
}

/** 特殊地形三类，效果统一为清除周围气味（§5.3）。 */
export type TerrainKind = 'rubble' | 'water' | 'vent';

export interface Level {
  width: number;
  height: number;
  cells: Uint8Array;
  start: Axial;
  exit: Axial;
  /** 语义为 start→exit 的 A* 最短路。 */
  mainPath: Axial[];
  rooms: Room[];
  traps: Set<AxialKey>;
  /** 特殊地形：只影响气味，不改变通行性，因此不新增 cell 值。 */
  terrain: Map<AxialKey, TerrainKind>;
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
/** 特殊地形密度：每 80 个地面格 1 个（§14）。 */
const TERRAIN_PER_CELLS = 80;
/** 战斗房额外布 2 只嗅犬，计入预算（§8.1）。 */
const BATTLE_ROOM_SNIFFERS = 2;
/** 陷阱房内陷阱权重 ×3，全局密度不变（§8.1）。 */
const TRAP_ROOM_WEIGHT = 3;
const TERRAIN_KINDS: readonly TerrainKind[] = ['rubble', 'water', 'vent'];
const ROOM_KINDS: readonly RoomKind[] = ['chest', 'rest', 'battle', 'trap'];

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

/**
 * 剪死路：迭代剥掉地面邻居 ≤1 的格子至不动点（§9.4）。
 * 剥叶子不会断连，剩下的 2-核仍连通；在接边缘走廊与布点之前做，起点/出口因此不受影响。
 */
function pruneDeadEnds(canvas: Canvas): void {
  for (;;) {
    let removed = 0;
    for (let row = 1; row < canvas.height - 1; row++) {
      for (let col = 1; col < canvas.width - 1; col++) {
        const cell = offsetToAxial(col, row);
        if (!canvas.isFloor(cell)) continue;
        let floorNeighbors = 0;
        for (let dir = 0; dir < 6; dir++) {
          if (canvas.isFloor(neighbor(cell, dir as DirIndex))) floorNeighbors++;
        }
        if (floorNeighbors > 1) continue;
        canvas.setWall(cell);
        removed++;
      }
    }
    if (removed === 0) return;
  }
}

function roomContains(room: RoomRect, cell: Axial): boolean {
  const { col, row } = axialToOffset(cell);
  return (
    col >= room.col && col < room.col + room.w && row >= room.row && row < room.row + room.h
  );
}

/** 门 = 房间边界上接到走廊的格；没有外接口时退回房间内任一格。 */
function roomDoor(canvas: Canvas, room: RoomRect, rng: Rng32): Axial {
  const doors: Axial[] = [];
  const floors: Axial[] = [];
  for (const cell of roomCells(room)) {
    if (!canvas.isFloor(cell)) continue;
    floors.push(cell);
    const { col, row } = axialToOffset(cell);
    const onEdge =
      col === room.col ||
      col === room.col + room.w - 1 ||
      row === room.row ||
      row === room.row + room.h - 1;
    if (!onEdge) continue;
    for (let dir = 0; dir < 6; dir++) {
      const next = neighbor(cell, dir as DirIndex);
      if (canvas.isFloor(next) && !roomContains(room, next)) {
        doors.push(cell);
        break;
      }
    }
  }
  const pool = doors.length > 0 ? doors : floors;
  return pool[rng.int(0, pool.length - 1)];
}

/** 以地图中心划分四象限，用于「奇遇房分散」约束（§9.2）。 */
export function roomQuadrant(room: RoomRect, width: number, height: number): number {
  const right = room.col + room.w / 2 >= width / 2 ? 1 : 0;
  const bottom = room.row + room.h / 2 >= height / 2 ? 2 : 0;
  return right + bottom;
}

/** 奇遇房数量（§8.1）：一局 3 间，保证「连答 3 题」可在单局内达成。 */
const ENCOUNTER_ROOM_COUNT = 3;

/** 房间标签分配（§8.1）：起终点房固定，奇遇 3 间异象限，其余按顺序。 */
function assignRoomKinds(
  canvas: Canvas,
  rng: Rng32,
  rects: readonly RoomRect[],
  startRoom: RoomRect,
  exitRoom: RoomRect,
  width: number,
  height: number,
): Room[] {
  const kinds = new Map<RoomRect, RoomKind>([
    [startRoom, 'start'],
    [exitRoom, 'exit'],
  ]);

  const rest = shuffleWithRng(
    rng,
    rects.filter((room) => room !== startRoom && room !== exitRoom),
  );
  const quadrants = new Set<number>();
  for (const room of rest) {
    if (quadrants.size >= ENCOUNTER_ROOM_COUNT) break;
    const quadrant = roomQuadrant(room, width, height);
    if (quadrants.has(quadrant)) continue;
    quadrants.add(quadrant);
    kinds.set(room, 'encounter');
  }

  let index = 0;
  for (const room of rest) {
    if (kinds.has(room)) continue;
    kinds.set(room, index < ROOM_KINDS.length ? ROOM_KINDS[index] : ROOM_KINDS[rng.int(0, ROOM_KINDS.length - 1)]);
    index++;
  }

  return rects.map((rect) => ({
    ...rect,
    kind: kinds.get(rect)!,
    door: roomDoor(canvas, rect, rng),
  }));
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
 * 布点（§9.4）：守卫守出口、战斗房 2 只嗅犬、其余按 50% 嗅犬 / 20% 石卫 / 15% 游魂 / 15% 蛛巢。
 * 全部距起点 ≥8，避开出口、陷阱与已占格；凑不满预算时由校验拦下并重试。
 */
function placeMonsters(
  canvas: Canvas,
  rng: Rng32,
  start: Axial,
  exit: Axial,
  traps: Set<AxialKey>,
  rooms: readonly Room[],
  budget: number,
): MonsterPlacement[] {
  const floors: Axial[] = [];
  for (let row = 1; row < canvas.height - 1; row++) {
    for (let col = 1; col < canvas.width - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (canvas.isFloor(cell)) floors.push(cell);
    }
  }

  const taken = new Set<AxialKey>();
  const placements: MonsterPlacement[] = [];
  const exitKey = axialKey(exit);
  const take = (pool: readonly Axial[], defId: string): void => {
    for (const cell of pool) {
      const key = axialKey(cell);
      if (!canvas.isFloor(cell) || taken.has(key) || traps.has(key) || key === exitKey) continue;
      if (hexDistance(cell, start) < 8) continue;
      taken.add(key);
      placements.push({ defId, pos: cell });
      return;
    }
  };

  const exitRoom = rooms.find((room) => room.kind === 'exit');
  const guardianPool = shuffleWithRng(rng, exitRoom ? roomCells(exitRoom) : [])
    .filter((cell) => hexDistance(cell, exit) >= 1 && hexDistance(cell, exit) <= 2)
    .sort((a, b) => hexDistance(a, exit) - hexDistance(b, exit));
  take(guardianPool, 'guardian');

  for (const room of rooms) {
    if (room.kind !== 'battle') continue;
    const pool = shuffleWithRng(rng, roomCells(room));
    for (let i = 0; i < BATTLE_ROOM_SNIFFERS; i++) take(pool, 'sniffer');
  }

  const roaming = Math.max(0, budget - placements.length);
  const pool = shuffleWithRng(rng, floors);
  for (let i = 0; i < roaming; i++) {
    const ratio = i / Math.max(1, roaming);
    const defId =
      ratio < 0.5 ? 'sniffer' : ratio < 0.7 ? 'stonewarden' : ratio < 0.85 ? 'wraith' : 'brood';
    take(pool, defId);
  }

  return placements;
}

/** 把全部陷阱视为墙后，起点到出口的一条通路；无解返回 null。 */
function escapePathWithTrapsBlocked(
  canvas: Canvas,
  start: Axial,
  exit: Axial,
  traps: Set<AxialKey>,
): Axial[] | null {
  const cells = new Uint8Array(canvas.cells);
  for (const key of traps) {
    const [q, r] = key.split(',');
    cells[cellIndex(canvas.grid, { q: Number(q), r: Number(r) })] = CELL_WALL;
  }
  return findPath({ cells, grid: canvas.grid }, start, exit);
}

/** 陷阱：非起点/出口、距起点 ≥3 的地面格；陷阱房内权重 ×3；每放一个都验证仍可绕开。 */
function placeTraps(
  canvas: Canvas,
  rng: Rng32,
  start: Axial,
  exit: Axial,
  density: number,
  rooms: readonly Room[],
): Set<AxialKey> {
  const trapRooms = rooms.filter((room) => room.kind === 'trap');
  const candidates: Axial[] = [];
  const weighted: Axial[] = [];
  for (let row = 1; row < canvas.height - 1; row++) {
    for (let col = 1; col < canvas.width - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (!canvas.isFloor(cell)) continue;
      if (hexDistance(cell, start) < 3) continue;
      if (axialKey(cell) === axialKey(exit)) continue;
      candidates.push(cell);
      const weight = trapRooms.some((room) => roomContains(room, cell)) ? TRAP_ROOM_WEIGHT : 1;
      for (let i = 0; i < weight; i++) weighted.push(cell);
    }
  }

  const traps = new Set<AxialKey>();
  const target = Math.round(candidates.length * density);
  // 不在当前通路上的陷阱不可能堵死出口，直接收下；只有踩断通路时才重算一次 A*。
  const initial = escapePathWithTrapsBlocked(canvas, start, exit, traps) ?? [];
  let onPath = new Set<AxialKey>(initial.map(axialKey));
  for (const cell of shuffleWithRng(rng, weighted)) {
    if (traps.size >= target) break;
    const key = axialKey(cell);
    if (traps.has(key)) continue;
    traps.add(key);
    if (!onPath.has(key)) continue;
    const next = escapePathWithTrapsBlocked(canvas, start, exit, traps);
    if (!next) {
      traps.delete(key);
      continue;
    }
    onPath = new Set(next.map(axialKey));
  }
  return traps;
}

/** 特殊地形：地面格 / 80，三类等概率，避开起点 / 出口 / 陷阱 / 怪物（§5.3）。 */
function placeTerrain(
  canvas: Canvas,
  rng: Rng32,
  start: Axial,
  exit: Axial,
  traps: Set<AxialKey>,
  monsters: readonly MonsterPlacement[],
): Map<AxialKey, TerrainKind> {
  const blocked = new Set<AxialKey>([axialKey(start), axialKey(exit), ...traps]);
  for (const monster of monsters) blocked.add(axialKey(monster.pos));

  let floorCount = 0;
  const candidates: Axial[] = [];
  for (let row = 1; row < canvas.height - 1; row++) {
    for (let col = 1; col < canvas.width - 1; col++) {
      const cell = offsetToAxial(col, row);
      if (!canvas.isFloor(cell)) continue;
      floorCount++;
      if (!blocked.has(axialKey(cell))) candidates.push(cell);
    }
  }

  const terrain = new Map<AxialKey, TerrainKind>();
  const target = Math.floor(floorCount / TERRAIN_PER_CELLS);
  for (const cell of shuffleWithRng(rng, candidates).slice(0, target)) {
    terrain.set(axialKey(cell), TERRAIN_KINDS[rng.int(0, TERRAIN_KINDS.length - 1)]);
  }
  return terrain;
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
  pruneDeadEnds(canvas);

  const leftRoom = rooms.reduce((best, room) => (room.col < best.col ? room : best), rooms[0]);
  const rightRoom = rooms.reduce(
    (best, room) => (room.col + room.w > best.col + best.w ? room : best),
    rooms[0],
  );
  const start = attachEdgeCorridor(canvas, rng, leftRoom, 'left', protectedCells);
  const exit = attachEdgeCorridor(canvas, rng, rightRoom, 'right', protectedCells);

  const typedRooms = assignRoomKinds(
    canvas,
    rng,
    rooms,
    leftRoom,
    rightRoom,
    params.width,
    params.height,
  );

  const map: CellGrid = { cells: canvas.cells, grid: canvas.grid };
  const mainPath = findPath(map, start, exit) ?? [start];

  const traps = placeTraps(canvas, rng, start, exit, params.trapDensity, typedRooms);
  const monsters = placeMonsters(
    canvas,
    rng,
    start,
    exit,
    traps,
    typedRooms,
    params.monsterBudget,
  );
  const terrain = placeTerrain(canvas, rng, start, exit, traps, monsters);

  return {
    width: params.width,
    height: params.height,
    cells: canvas.cells,
    start,
    exit,
    mainPath,
    rooms: typedRooms,
    traps,
    terrain,
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
