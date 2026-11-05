import { describe, expect, it } from 'vitest';
import {
  BASE_HEX_SIZE,
  axialToPixel,
  hexEdgeEndpoints,
  neighbor,
  type Axial,
  type DirIndex,
  type Point,
} from '../rules/grid/geometry';
import { createGame } from '../rules/game/createGame';
import { reduceGame } from '../rules/turn/reducer';
import { CELL_FLOOR } from '../rules/grid/path';
import { cellAtLevel } from '../rules/generation/generator';
import { worldToScreen, type Camera } from './camera';
import { PALETTE } from './palette';
import { BoardRenderer } from './canvas';
import { buildRenderModel, type RenderModel } from './model';

interface DrawRecord {
  type: 'fill' | 'stroke';
  points: Point[];
  style: string;
  lineWidth?: number;
}

class RecordingContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  lineJoin = '';
  lineCap = '';
  font = '';
  textAlign = '';
  textBaseline = '';

  records: DrawRecord[] = [];
  arcs: { x: number; y: number; r: number; style: string }[] = [];
  private current: Point[] = [];

  beginPath(): void {
    this.current = [];
  }

  moveTo(x: number, y: number): void {
    this.current.push({ x, y });
  }

  lineTo(x: number, y: number): void {
    this.current.push({ x, y });
  }

  closePath(): void {}

  fill(): void {
    this.records.push({
      type: 'fill',
      points: this.current.slice(),
      style: typeof this.fillStyle === 'string' ? this.fillStyle : 'gradient',
    });
  }

  stroke(): void {
    this.records.push({
      type: 'stroke',
      points: this.current.slice(),
      style: this.strokeStyle,
      lineWidth: this.lineWidth,
    });
  }

  fillRect(): void {}

  fillText(): void {}

  arc(x: number, y: number, r: number): void {
    this.arcs.push({ x, y, r, style: this.fillStyle });
  }

  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }

  createRadialGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }

  setTransform(): void {}

  setLineDash(): void {}
}

function makeRenderer(): { renderer: BoardRenderer; ctx: RecordingContext } {
  const ctx = new RecordingContext();
  const canvas = {
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    width: 800,
    height: 600,
  } as unknown as HTMLCanvasElement;
  return { renderer: new BoardRenderer(canvas), ctx };
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
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

const SIZE = { w: 800, h: 600 };
const ZOOM = 1;

function cameraFor(model: RenderModel): Camera {
  const world = axialToPixel(model.player, BASE_HEX_SIZE);
  return { zoom: ZOOM, cx: world.x, cy: world.y, follow: true };
}

function toScreen(camera: Camera, point: Point): Point {
  return worldToScreen(camera, SIZE, point);
}

function parseKey(key: string): Axial {
  const [q, r] = key.split(',');
  return { q: Number(q), r: Number(r) };
}

function segmentKey(a: Point, b: Point): string {
  const round = (v: number) => Math.round(v * 100) / 100;
  const first = `${round(a.x)},${round(a.y)}`;
  const second = `${round(b.x)},${round(b.y)}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

describe('棋盘渲染', () => {
  it('地板是六边形而不是五边形', () => {
    const model = buildRenderModel(createGame(55));
    const camera = cameraFor(model);
    const { renderer, ctx } = makeRenderer();
    renderer.render(model, camera, SIZE);

    const playerScreen = toScreen(camera, axialToPixel(model.player, BASE_HEX_SIZE));
    const floorFills = ctx.records.filter(
      (r) => r.type === 'fill' && r.style === PALETTE.floorFill,
    );
    const own = floorFills.find((r) => pointInPolygon(playerScreen, r.points));
    expect(own).toBeDefined();
    expect(own!.points).toHaveLength(6);
  });

  it('墙画在地板格的边上，且不占整格', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    const camera = cameraFor(model);
    const { renderer, ctx } = makeRenderer();
    renderer.render(model, camera, SIZE);

    const expected = new Set<string>();
    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind !== 'floor') continue;
      const world = axialToPixel(parseKey(key), BASE_HEX_SIZE);
      for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
        if (!cell.wallEdges[dir]) continue;
        const edge = hexEdgeEndpoints(world, BASE_HEX_SIZE, dir);
        expected.add(segmentKey(toScreen(camera, edge.a), toScreen(camera, edge.b)));
      }
    }
    expect(expected.size).toBeGreaterThan(0);

    const wallStrokes = ctx.records.filter(
      (r) => r.type === 'stroke' && r.style === PALETTE.wallLine,
    );
    expect(wallStrokes.length).toBeGreaterThan(0);
    const actual = new Set<string>();
    for (const stroke of wallStrokes) {
      for (let i = 1; i < stroke.points.length; i++) {
        actual.add(segmentKey(stroke.points[i - 1], stroke.points[i]));
      }
    }
    for (const segment of actual) {
      expect(expected.has(segment)).toBe(true);
    }
    expect(actual.size).toBe(expected.size);
  });

  it('墙格本身不被填充', () => {
    const state = createGame(55);
    const model = buildRenderModel(state);
    const camera = cameraFor(model);
    const { renderer, ctx } = makeRenderer();
    renderer.render(model, camera, SIZE);

    const wallCells: Axial[] = [];
    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind !== 'floor') continue;
      const axial = parseKey(key);
      for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
        if (!cell.wallEdges[dir]) continue;
        const next = neighbor(axial, dir);
        if (cellAtLevel(state.level, next) !== CELL_FLOOR) wallCells.push(next);
      }
    }
    expect(wallCells.length).toBeGreaterThan(0);

    const fills = ctx.records.filter((r) => r.type === 'fill' && r.points.length >= 3);
    for (const wall of wallCells) {
      const center = toScreen(camera, axialToPixel(wall, BASE_HEX_SIZE));
      for (const fill of fills) {
        expect(pointInPolygon(center, fill.points)).toBe(false);
      }
    }
  });

  it('高亮只落在已知可落脚的邻居上', () => {
    const state = reduceGame(createGame(55), { type: 'listen' });
    const model = buildRenderModel(state);
    const camera = cameraFor(model);
    const { renderer, ctx } = makeRenderer();
    renderer.render(model, camera, SIZE);

    const highlights = ctx.records.filter(
      (r) => r.type === 'stroke' && r.style === PALETTE.highlight,
    );
    expect(highlights).toHaveLength(model.standableNeighbors.length);

    const expectedCenters = model.standableNeighbors.map((n) =>
      toScreen(camera, axialToPixel(n.cell, BASE_HEX_SIZE)),
    );
    for (const highlight of highlights) {
      const middle = centroid(highlight.points);
      const matched = expectedCenters.some(
        (center) => Math.hypot(center.x - middle.x, center.y - middle.y) < 1,
      );
      expect(matched).toBe(true);
    }
  });

  it('未知邻居不会被高亮', () => {
    const model = buildRenderModel(createGame(55));
    const camera = cameraFor(model);
    const { renderer, ctx } = makeRenderer();
    renderer.render(model, camera, SIZE);

    const highlights = ctx.records.filter(
      (r) => r.type === 'stroke' && r.style === PALETTE.highlight,
    );
    const unknownCenters: Point[] = [];
    for (const [key, cell] of model.cells) {
      if (cell.appearance.kind !== 'unknown') continue;
      unknownCenters.push(toScreen(camera, axialToPixel(parseKey(key), BASE_HEX_SIZE)));
    }
    for (const highlight of highlights) {
      const middle = centroid(highlight.points);
      for (const center of unknownCenters) {
        expect(Math.hypot(center.x - middle.x, center.y - middle.y)).toBeGreaterThan(1);
      }
    }
  });
});
