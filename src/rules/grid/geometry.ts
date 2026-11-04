/**
 * 网格几何：逻辑用六边形轴向坐标（axial），视觉用正五边形。
 * 正五边形无法铺满平面，而设计文档要求六向邻接，因此拓扑取六边形，
 * 每格在屏幕上画成内切于六边形足迹的正五边形。
 */

export interface Axial {
  q: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 网格尺寸以偏移坐标（col,row）计。 */
export interface GridBounds {
  width: number;
  height: number;
}

/** 六向邻接，索引即屏幕方位序（pointy-top）。 */
export const DIRECTIONS: readonly Axial[] = Object.freeze([
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]);

export type DirIndex = 0 | 1 | 2 | 3 | 4 | 5;

export const DIR_LABELS: readonly string[] = Object.freeze([
  'E',
  'NE',
  'NW',
  'W',
  'SW',
  'SE',
]);

export type AxialKey = string;

/** 五边形外接圆半径与六边形外接圆半径之比，保证五边形互不重叠。 */
export const PENTAGON_RATIO = 0.85;

/** 缩放为 1 时六边形外接圆半径（像素）。 */
export const BASE_HEX_SIZE = 34;

export function axialKey(a: Axial): AxialKey {
  return `${a.q},${a.r}`;
}

export function parseAxialKey(key: AxialKey): Axial {
  const [q, r] = key.split(',');
  return { q: Number(q), r: Number(r) };
}

export function axialEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function neighbors(a: Axial): Axial[] {
  return DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}

export function neighbor(a: Axial, d: DirIndex): Axial {
  const dir = DIRECTIONS[d];
  return { q: a.q + dir.q, r: a.r + dir.r };
}

export function areAdjacent(a: Axial, b: Axial): boolean {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  if (dq === 0 && dr === 0) return false;
  return (
    (dq === 1 && dr === 0) ||
    (dq === 1 && dr === -1) ||
    (dq === 0 && dr === -1) ||
    (dq === -1 && dr === 0) ||
    (dq === -1 && dr === 1) ||
    (dq === 0 && dr === 1)
  );
}

export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function hexDistanceSq(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return dq * dq + dr * dr + dq * dr;
}

// ---------- 偏移坐标（odd-r）↔ 轴向坐标 ----------

export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(a: Axial): { col: number; row: number } {
  return { col: a.q + (a.r - (a.r & 1)) / 2, row: a.r };
}

export function isInBounds(grid: GridBounds, a: Axial): boolean {
  const { col, row } = axialToOffset(a);
  return col >= 0 && col < grid.width && row >= 0 && row < grid.height;
}

// ---------- 像素 ↔ 轴向坐标 ----------

export function axialToPixel(a: Axial, size: number): Point {
  return {
    x: size * Math.sqrt(3) * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  };
}

export function cubeRound(x: number, y: number, z: number): Axial {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return { q: rx, r: rz };
}

export function pixelToAxial(p: Point, size: number): Axial {
  const q = ((Math.sqrt(3) / 3) * p.x - p.y / 3) / size;
  const r = ((2 / 3) * p.y) / size;
  return cubeRound(q, -q - r, r);
}

// ---------- 多边形 ----------

/** 尖角朝上的正五边形顶点（Canvas 坐标 y 向下）。 */
export function pentagonVertices(center: Point, radius: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = ((-90 - 72 * i) * Math.PI) / 180;
    out.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    });
  }
  return out;
}

/** 尖角朝上的正六边形顶点。 */
export function hexCorners(center: Point, size: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((-90 + 60 * i) * Math.PI) / 180;
    out.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    });
  }
  return out;
}

export function layoutBounds(cells: readonly Axial[], size: number): Rect {
  if (cells.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    const p = axialToPixel(cell, size);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const radius = size * PENTAGON_RATIO;
  return {
    x: minX - radius,
    y: minY - radius,
    w: maxX - minX + radius * 2,
    h: maxY - minY + radius * 2,
  };
}
