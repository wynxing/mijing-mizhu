import { describe, expect, it } from 'vitest';
import {
  BASE_HEX_SIZE,
  DIRECTIONS,
  axialEquals,
  axialKey,
  axialToOffset,
  axialToPixel,
  areAdjacent,
  cubeRound,
  hexCorners,
  hexDistance,
  hexDistanceSq,
  hexEdgeEndpoints,
  hexEdgeIndex,
  isInBounds,
  neighbor,
  neighbors,
  offsetToAxial,
  parseAxialKey,
  pixelToAxial,
  type Axial,
  type DirIndex,
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

describe('六边形边几何', () => {
  it('六边形六个顶点等半径且顶点朝上', () => {
    const center = { x: 100, y: 80 };
    const corners = hexCorners(center, 20);
    expect(corners).toHaveLength(6);
    for (const corner of corners) {
      expect(Math.hypot(corner.x - center.x, corner.y - center.y)).toBeCloseTo(20, 6);
    }
    const top = Math.min(...corners.map((c) => c.y));
    expect(corners.filter((c) => c.y === top)).toHaveLength(1);
  });

  it('边 d 的中点落在「本格中心 → d 方向邻格中心」连线的中点', () => {
    for (const cell of allCells()) {
      const center = axialToPixel(cell, BASE_HEX_SIZE);
      for (let d = 0 as DirIndex; d < 6; d = (d + 1) as DirIndex) {
        const neighborCenter = axialToPixel(neighbor(cell, d), BASE_HEX_SIZE);
        const { a, b } = hexEdgeEndpoints(center, BASE_HEX_SIZE, d);
        expect((a.x + b.x) / 2).toBeCloseTo((center.x + neighborCenter.x) / 2, 6);
        expect((a.y + b.y) / 2).toBeCloseTo((center.y + neighborCenter.y) / 2, 6);
        expect(Math.hypot(neighborCenter.x - center.x, neighborCenter.y - center.y)).toBeCloseTo(
          Math.sqrt(3) * BASE_HEX_SIZE,
          6,
        );
      }
    }
  });

  it('E 方向边是右侧竖直边，NE 方向边位于上半部', () => {
    const east = hexEdgeEndpoints({ x: 0, y: 0 }, BASE_HEX_SIZE, 0);
    expect(east.a.x).toBeCloseTo(east.b.x, 6);
    expect(east.a.x).toBeCloseTo((Math.sqrt(3) / 2) * BASE_HEX_SIZE, 6);

    const northEast = hexEdgeEndpoints({ x: 0, y: 0 }, BASE_HEX_SIZE, 1);
    expect(Math.max(northEast.a.y, northEast.b.y)).toBeLessThanOrEqual(
      -0.5 * BASE_HEX_SIZE + 1e-9,
    );
  });

  it('反向的边在邻格坐标系下是同一条线段', () => {
    const cell = offsetToAxial(3, 2);
    const center = axialToPixel(cell, BASE_HEX_SIZE);
    const neighborCenter = axialToPixel(neighbor(cell, 0), BASE_HEX_SIZE);
    const here = hexEdgeEndpoints(center, BASE_HEX_SIZE, 0);
    const there = hexEdgeEndpoints(neighborCenter, BASE_HEX_SIZE, 3);
    expect(here.a.x).toBeCloseTo(there.b.x, 6);
    expect(here.a.y).toBeCloseTo(there.b.y, 6);
    expect(here.b.x).toBeCloseTo(there.a.x, 6);
    expect(here.b.y).toBeCloseTo(there.a.y, 6);
  });

  it('六个方向各对应一条互不相同的边', () => {
    const center = { x: 0, y: 0 };
    const mids = new Set<string>();
    for (let d = 0 as DirIndex; d < 6; d = (d + 1) as DirIndex) {
      expect(hexEdgeIndex(d)).toBe((7 - d) % 6);
      const { a } = hexEdgeEndpoints(center, BASE_HEX_SIZE, d);
      mids.add(`${a.x.toFixed(3)},${a.y.toFixed(3)}`);
      expect(Math.hypot(a.x - center.x, a.y - center.y)).toBeCloseTo(BASE_HEX_SIZE, 6);
    }
    expect(mids.size).toBe(6);
  });
});

