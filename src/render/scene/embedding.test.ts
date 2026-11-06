import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { worldToScreen, type Camera, type ViewportSize } from '../camera';
import type { Point } from '../../rules/grid/geometry';
import {
  COS_ELEV,
  SIN_ELEV,
  applyCamera,
  logicalToWorld,
  screenToLogical,
  worldToLogical,
} from './embedding';

const SIZE: ViewportSize = { w: 800, h: 600 };
const CAM: Camera = { zoom: 1.3, cx: 40, cy: -25, follow: false };

const POINTS: Point[] = [
  { x: 0, y: 0 },
  { x: 40, y: -25 },
  { x: -512, y: 333 },
  { x: 289.5, y: -77.25 },
];

function toPixel(p: Point, height = 0): Point {
  const ortho = new OrthographicCamera();
  applyCamera(CAM, SIZE, ortho);
  const w = logicalToWorld(p, height);
  const v = new Vector3(w.x, w.y, w.z).project(ortho);
  return { x: (v.x * 0.5 + 0.5) * SIZE.w, y: (-v.y * 0.5 + 0.5) * SIZE.h };
}

describe('拉伸嵌入相机', () => {
  it('地面点的屏幕位置与 2D worldToScreen 精确相等', () => {
    for (const p of POINTS) {
      const via3d = toPixel(p);
      const via2d = worldToScreen(CAM, SIZE, p);
      expect(via3d.x).toBeCloseTo(via2d.x, 6);
      expect(via3d.y).toBeCloseTo(via2d.y, 6);
    }
  });

  it('高度 h 在屏幕上抬 h·cos(ELEV)·zoom', () => {
    const h = 30;
    for (const p of POINTS) {
      const ground = toPixel(p);
      const raised = toPixel(p, h);
      expect(raised.x).toBeCloseTo(ground.x, 6);
      expect(ground.y - raised.y).toBeCloseTo(h * COS_ELEV * CAM.zoom, 6);
    }
  });

  it('逻辑 ↔ 世界 roundtrip', () => {
    for (const p of POINTS) {
      const back = worldToLogical(logicalToWorld(p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
    expect(logicalToWorld({ x: 1, y: SIN_ELEV }).z).toBeCloseTo(1, 9);
  });

  it('screenToLogical 是 worldToScreen 的逆', () => {
    for (const p of POINTS) {
      const screen = worldToScreen(CAM, SIZE, p);
      const back = screenToLogical(CAM, SIZE, screen);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});
