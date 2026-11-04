import type { Point } from '../rules/grid/geometry';

export interface Camera {
  zoom: number;
  /** 画布中心对应的世界坐标。 */
  cx: number;
  cy: number;
  follow: boolean;
}

export interface ViewportSize {
  w: number;
  h: number;
}

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function worldToScreen(camera: Camera, size: ViewportSize, point: Point): Point {
  return {
    x: (point.x - camera.cx) * camera.zoom + size.w / 2,
    y: (point.y - camera.cy) * camera.zoom + size.h / 2,
  };
}

export function screenToWorld(camera: Camera, size: ViewportSize, point: Point): Point {
  return {
    x: (point.x - size.w / 2) / camera.zoom + camera.cx,
    y: (point.y - size.h / 2) / camera.zoom + camera.cy,
  };
}

/** 以光标位置为锚点缩放：光标下的世界坐标保持不动。 */
export function zoomAt(
  camera: Camera,
  size: ViewportSize,
  factor: number,
  at: Point,
): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const anchor = screenToWorld(camera, size, at);
  return {
    ...camera,
    zoom,
    cx: anchor.x - (at.x - size.w / 2) / zoom,
    cy: anchor.y - (at.y - size.h / 2) / zoom,
  };
}

/** 拖拽平移：画面跟手移动，视图中心反向移动。 */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return {
    ...camera,
    cx: camera.cx - dx / camera.zoom,
    cy: camera.cy - dy / camera.zoom,
  };
}
