import { OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { BASE_HEX_SIZE, pixelToAxial, type Axial } from '../../rules/grid/geometry';
import type { Camera, ViewportSize } from '../camera';
import type { RenderModel } from '../model';
import type { PresentationFrame } from '../presentation';
import { applyCamera, screenToLogical } from './embedding';
import { EntityLayer } from './entities';
import { FloorMesh } from './floorMesh';
import { Overlays } from './overlays';
import { buildScenePlan, type ScenePlan } from './plan';
import { loadFloorTextures, type FloorTextures } from './textures';
import { WallMesh } from './wallMesh';

/**
 * three.js 2.5D 棋盘场景。公共面与 BoardRenderer 完全一致，
 * 因此 BoardCanvas 只需换构造函数即可切换。
 *
 * 分工：buildScenePlan 出纯数据 → FloorMesh/WallMesh 实例化 →
 * 每帧只更新提灯 uniform 与覆盖物。model 身份变化时才重写实例属性。
 */
export class BoardScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly ortho = new OrthographicCamera();
  private readonly floorMesh: FloorMesh;
  private readonly wallMesh: WallMesh;
  private readonly overlays: Overlays;
  private readonly entities: EntityLayer;
  private readonly textures: FloorTextures;
  private lastModel: RenderModel | null = null;
  private lastPlan: ScenePlan | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x000000, 1);
    this.textures = loadFloorTextures();
    this.floorMesh = new FloorMesh(this.textures);
    this.wallMesh = new WallMesh();
    this.overlays = new Overlays();
    this.entities = new EntityLayer();
    this.scene.add(
      this.floorMesh.mesh,
      this.wallMesh.mesh,
      this.overlays.group,
      this.entities.group,
    );
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  }

  render(
    model: RenderModel,
    camera: Camera,
    size: ViewportSize,
    frame?: PresentationFrame,
  ): void {
    const shake = frame?.shake ?? { x: 0, y: 0 };
    applyCamera(
      { ...camera, cx: camera.cx + shake.x, cy: camera.cy + shake.y },
      size,
      this.ortho,
    );

    const plan = buildScenePlan(model, frame);
    this.lastPlan = plan;

    if (model !== this.lastModel) {
      this.floorMesh.update(plan);
      this.wallMesh.update(plan);
      this.lastModel = model;
    }
    // 高亮与实体随 moving 标志逐帧变，数量极小，直接每帧刷新
    this.overlays.update(plan, this.ortho);
    this.entities.update(plan, this.ortho);

    this.floorMesh.setLantern(plan.playerLogical);
    this.wallMesh.setLantern(plan.playerLogical);
    this.renderer.render(this.scene, this.ortho);
  }

  screenToCell(camera: Camera, size: ViewportSize, x: number, y: number): Axial {
    return pixelToAxial(screenToLogical(camera, size, { x, y }), BASE_HEX_SIZE);
  }

  /** 最近一帧的场景计划（dev 调试与 E2E 逻辑空间断言用）。 */
  debugPlan(): ScenePlan | null {
    return this.lastPlan;
  }

  /** 立即重画一帧并读回像素，返回非黑像素数（E2E 判活用）。 */
  sampleNonBlack(): number {
    this.renderer.render(this.scene, this.ortho);
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let lit = 0;
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i] > 12 || buf[i + 1] > 12 || buf[i + 2] > 12) lit += 1;
    }
    return lit;
  }

  dispose(): void {
    this.floorMesh.dispose();
    this.wallMesh.dispose();
    this.overlays.dispose();
    this.entities.dispose();
    this.textures.albedo.dispose();
    this.textures.normal.dispose();
    this.renderer.dispose();
  }
}
