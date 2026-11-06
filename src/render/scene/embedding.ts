import { OrthographicCamera, Vector3 } from 'three';
import type { Point } from '../../rules/grid/geometry';
import type { Camera, ViewportSize } from '../camera';

/**
 * 拉伸嵌入：地面在 3D 里沿 z 被拉长 1/sin(ELEV)，于是固定俯角的正交相机
 * 把地面压回 sin(ELEV) 后，屏幕 x/y 与逻辑坐标精确相等——
 * 现有 worldToScreen / pixelToAxial / 拾取数学全部继续成立。
 * 高度为 h 的元素在屏幕上额外抬 h·cos(ELEV)，即 2.5D 的视差来源。
 */
export const ELEV_DEG = 55;
export const SIN_ELEV = Math.sin((ELEV_DEG * Math.PI) / 180);
export const COS_ELEV = Math.cos((ELEV_DEG * Math.PI) / 180);

/** 相机到目标点的距离；正交投影下只影响 near/far 裁剪。 */
const RIG_DISTANCE = 4000;

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export function logicalToWorld(p: Point, height = 0): WorldPoint {
  return { x: p.x, y: height, z: p.y / SIN_ELEV };
}

export function worldToLogical(w: WorldPoint): Point {
  return { x: w.x, y: w.z * SIN_ELEV };
}

/** 把逻辑相机（zoom / cx / cy）摆成 3D 正交 rig。 */
export function applyCamera(
  camera: Camera,
  size: ViewportSize,
  ortho: OrthographicCamera,
): void {
  const halfW = size.w / (2 * camera.zoom);
  const halfH = size.h / (2 * camera.zoom);
  ortho.left = -halfW;
  ortho.right = halfW;
  ortho.top = halfH;
  ortho.bottom = -halfH;
  ortho.near = 1;
  ortho.far = RIG_DISTANCE * 2;

  const targetZ = camera.cy / SIN_ELEV;
  ortho.position.set(
    camera.cx,
    RIG_DISTANCE * SIN_ELEV,
    targetZ + RIG_DISTANCE * COS_ELEV,
  );
  ortho.lookAt(camera.cx, 0, targetZ);
  ortho.updateProjectionMatrix();
  ortho.updateMatrixWorld();
}

/** 屏幕像素 → 地面上的逻辑坐标（applyCamera 的逆，地面元素精确成立）。 */
export function screenToLogical(
  camera: Camera,
  size: ViewportSize,
  screen: Point,
): Point {
  return {
    x: (screen.x - size.w / 2) / camera.zoom + camera.cx,
    y: (screen.y - size.h / 2) / camera.zoom + camera.cy,
  };
}

/** 实体脚锚的世界位置：格心地面 + 朝相机方向的微小偏移，避免与地形共面闪烁。 */
export function footAnchor(p: Point, epsilon = 0.5): Vector3 {
  const w = logicalToWorld(p);
  return new Vector3(w.x, w.y + epsilon * SIN_ELEV, w.z + epsilon * COS_ELEV);
}
