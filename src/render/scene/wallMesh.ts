import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { BASE_HEX_SIZE } from '../../rules/grid/geometry';
import { SIN_ELEV, logicalToWorld } from './embedding';
import { LANTERN_INNER, LANTERN_OUTER, type ScenePlan } from './plan';
import { WALL_FRAG, WALL_VERT } from './shaders';
import { paletteColor } from './textures';

/** 边脊：高到能夹住通道，仍低于 sprite 头顶，避免遮挡怪物。 */
const WALL_HEIGHT = BASE_HEX_SIZE * 0.32;
const WALL_THICKNESS = BASE_HEX_SIZE * 0.18;
const WALL_CAPACITY = 4096;

export class WallMesh {
  readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly geometry: BoxGeometry;
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly scale = new Vector3();
  private readonly pos = new Vector3();
  private readonly dir = new Vector3();

  constructor() {
    this.geometry = new BoxGeometry(1, 1, 1);
    this.material = new ShaderMaterial({
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      uniforms: {
        uPlayerLogical: { value: new Vector2(0, 0) },
        uLanternInner: { value: LANTERN_INNER },
        uLanternOuter: { value: LANTERN_OUTER },
        uWallLine: { value: paletteColor('wallLine') },
        uWallLit: { value: paletteColor('wallLit') },
        uSinElev: { value: SIN_ELEV },
      },
    });
    this.mesh = new InstancedMesh(this.geometry, this.material, WALL_CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(plan: ScenePlan): void {
    const count = Math.min(plan.walls.length, WALL_CAPACITY);
    for (let i = 0; i < count; i += 1) {
      const wall = plan.walls[i];
      const aw = logicalToWorld(wall.a);
      const bw = logicalToWorld(wall.b);
      this.dir.set(bw.x - aw.x, 0, bw.z - aw.z);
      const len = this.dir.length() || 1;
      const mw = logicalToWorld({
        x: (wall.a.x + wall.b.x) / 2,
        y: (wall.a.y + wall.b.y) / 2,
      });
      this.pos.set(mw.x, WALL_HEIGHT / 2, mw.z);
      this.quat.setFromAxisAngle(this.yAxis, Math.atan2(-this.dir.z, this.dir.x));
      this.scale.set(len, WALL_HEIGHT, WALL_THICKNESS);
      this.matrix.compose(this.pos, this.quat, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setLantern(playerLogical: { x: number; y: number }): void {
    (this.material.uniforms.uPlayerLogical.value as Vector2).set(
      playerLogical.x,
      playerLogical.y,
    );
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
