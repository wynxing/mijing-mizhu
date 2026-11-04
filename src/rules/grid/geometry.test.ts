import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  PENTAGON_RATIO,
  axialEquals,
  axialKey,
  axialToOffset,
  axialToPixel,
  areAdjacent,
  cubeRound,
  hexCorners,
  hexDistance,
  hexDistanceSq,
  isInBounds,
  neighbors,
  offsetToAxial,
  parseAxialKey,
  pentagonVertices,
  pixelToAxial,
  type Axial,
  type Point,
} from './geometry';

const WIDTH = 24;
const HEIGHT = 18;

function allCells(): Axial[] {
  const out: Axial[] = [];
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      out.push(offsetToAxial(col, row));
    }
  }
  return out;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

describe('邻接表', () => {
  it('六个方向互不相同', () => {
    const keys = new Set(DIRECTIONS.map((d) => axialKey(d)));
    expect(keys.size).toBe(6);
  });

  it('邻接对称：a 邻接 b 当且仅当 b 邻接 a', () => {
    for (const a of allCells()) {
      for (const b of neighbors(a)) {
        expect(areAdjacent(a, b)).toBe(true);
        expect(areAdjacent(b, a)).toBe(true);
        expect(neighbors(b).some((n) => axialEquals(n, a))).toBe(true);
      }
    }
  });

  it('不与自身相邻', () => {
    for (const a of allCells()) {
      expect(areAdjacent(a, a)).toBe(false);
      expect(neighbors(a).some((n) => axialEquals(n, a))).toBe(false);
    }
  });
});

describe('距离', () => {
  it('自身距离为 0 且对称', () => {
    for (const a of allCells()) {
      expect(hexDistance(a, a)).toBe(0);
      for (const b of neighbors(a)) {
        expect(hexDistance(a, b)).toBe(1);
        expect(hexDistance(b, a)).toBe(1);
      }
    }
  });

  it('满足三角不等式', () => {
    const cells = allCells();
    for (let i = 0; i < cells.length; i += 37) {
      for (let j = 0; j < cells.length; j += 53) {
        for (let k = 0; k < cells.length; k += 71) {
          const direct = hexDistance(cells[i], cells[k]);
          const via = hexDistance(cells[i], cells[j]) + hexDistance(cells[j], cells[k]);
          expect(direct).toBeLessThanOrEqual(via);
        }
      }
    }
  });

  it('平方距离是合法启发式：不超过真实步数距离', () => {
    const a = offsetToAxial(0, 0);
    const b = offsetToAxial(5, 3);
    expect(hexDistanceSq(a, b)).toBe(37);
    const cells = allCells();
    let violations = 0;
    for (const x of cells) {
      for (const y of cells) {
        if (hexDistanceSq(x, y) > hexDistance(x, y) ** 2) violations++;
      }
    }
    expect(violations).toBe(0);
  });
});

describe('坐标换算', () => {
  it('偏移坐标与轴向坐标互为恒等', () => {
    for (let row = 0; row < HEIGHT; row++) {
      for (let col = 0; col < WIDTH; col++) {
        const axial = offsetToAxial(col, row);
        const back = axialToOffset(axial);
        expect(back.col).toBe(col);
        expect(back.row).toBe(row);
      }
    }
  });

  it('像素与轴向坐标互为恒等', () => {
    for (const cell of allCells()) {
      const pixel = axialToPixel(cell, 34);
      const back = pixelToAxial(pixel, 34);
      expect(back.q).toBe(cell.q);
      expect(back.r).toBe(cell.r);
    }
  });

  it('cube 取整后立方和为零', () => {
    const rounded = cubeRound(0.4, -1.2, 0.8);
    expect(rounded.q + (-rounded.q - rounded.r) + rounded.r).toBe(0);
  });

  it('键解析可还原', () => {
    const a = offsetToAxial(7, 5);
    expect(parseAxialKey(axialKey(a))).toEqual(a);
  });

  it('越界判定正确', () => {
    expect(isInBounds({ width: WIDTH, height: HEIGHT }, offsetToAxial(0, 0))).toBe(true);
    expect(isInBounds({ width: WIDTH, height: HEIGHT }, offsetToAxial(-1, 0))).toBe(false);
    expect(isInBounds({ width: WIDTH, height: HEIGHT }, offsetToAxial(0, HEIGHT))).toBe(false);
  });
});

describe('五边形几何', () => {
  it('五个顶点等半径且凸', () => {
    const center = { x: 100, y: 80 };
    const verts = pentagonVertices(center, 20);
    expect(verts).toHaveLength(5);
    for (const v of verts) {
      expect(Math.hypot(v.x - center.x, v.y - center.y)).toBeCloseTo(20, 6);
    }
    let sign = 0;
    for (let i = 0; i < 5; i++) {
      const c = cross(verts[i], verts[(i + 1) % 5], verts[(i + 2) % 5]);
      if (sign === 0) sign = Math.sign(c);
      expect(Math.sign(c)).toBe(sign);
    }
  });

  it('顶点朝上', () => {
    const verts = pentagonVertices({ x: 0, y: 0 }, 10);
    const top = Math.min(...verts.map((v) => v.y));
    expect(verts.filter((v) => v.y === top)).toHaveLength(1);
  });

  it('按比例缩放后仍完全落在六边形足迹内', () => {
    const center = { x: 50, y: 50 };
    const hex = hexCorners(center, 34);
    const pent = pentagonVertices(center, 34 * PENTAGON_RATIO);
    for (const v of pent) {
      expect(pointInPolygon(v, hex)).toBe(true);
    }
  });
});
