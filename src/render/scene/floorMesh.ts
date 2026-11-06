import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { BASE_HEX_SIZE, hexEdgeIndex, type DirIndex } from '../../rules/grid/geometry';
import { SIN_ELEV, logicalToWorld } from './embedding';
import { LANTERN_INNER, LANTERN_OUTER, MEMORY_LEVEL, type ScenePlan } from './plan';
import { FLOOR_FRAG, FLOOR_VERT } from './shaders';
import { paletteColor, type FloorTextures } from './textures';

/** 只有朝向观察者的西南(4)、东南(5)两条边露出断崖；其余边侧对或背对镜头，不建侧面。 */
const CLIFF_SIDE_DIRS: readonly DirIndex[] = [4, 5];
const CLIFF_DEPTH = BASE_HEX_SIZE * 0.28;
/** 关卡固定 24×18=432 格，留足余量，免去动态扩容。 */
const FLOOR_CAPACITY = 1024;

/** 一个六棱柱：顶面 6 三角 + 朝向观察者的断崖侧壁，全部烘进局部坐标。 */
function buildPrismGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const dir: number[] = [];
  const shade: number[] = [];

  const corners: Vector3[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = ((-90 + 60 * i) * Math.PI) / 180;
    const lx = BASE_HEX_SIZE * Math.cos(angle);
    const ly = BASE_HEX_SIZE * Math.sin(angle);
    corners.push(new Vector3(lx, 0, ly / SIN_ELEV));
  }

  const up = new Vector3(0, 1, 0);
  const push = (v: Vector3, n: Vector3, d: number, s: number): void => {
    pos.push(v.x, v.y, v.z);
    nor.push(n.x, n.y, n.z);
    dir.push(d);
    shade.push(s);
  };

  const center = new Vector3(0, 0, 0);
  for (let i = 0; i < 6; i += 1) {
    push(center, up, -1, 1);
    push(corners[i], up, -1, 1);
    push(corners[(i + 1) % 6], up, -1, 1);
  }

  for (const d of CLIFF_SIDE_DIRS) {
    const edge = hexEdgeIndex(d);
    const a = corners[edge];
    const b = corners[(edge + 1) % 6];
    const depth = CLIFF_DEPTH;
    const ad = a.clone().setY(-depth);
    const bd = b.clone().setY(-depth);
    const e = b.clone().sub(a);
    const n = new Vector3(e.z, 0, -e.x).normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    if (n.dot(mid) < 0) n.negate();
    push(a, n, d, 1);
    push(b, n, d, 1);
    push(bd, n, d, 0.35);
    push(a, n, d, 1);
    push(bd, n, d, 0.35);
    push(ad, n, d, 0.35);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geo.setAttribute('aDir', new BufferAttribute(new Float32Array(dir), 1));
  geo.setAttribute('aShade', new BufferAttribute(new Float32Array(shade), 1));
  geo.setAttribute('aLogical', new InstancedBufferAttribute(new Float32Array(FLOOR_CAPACITY * 2), 2));
  geo.setAttribute('aKind', new InstancedBufferAttribute(new Float32Array(FLOOR_CAPACITY), 1));
  geo.setAttribute('aTone', new InstancedBufferAttribute(new Float32Array(FLOOR_CAPACITY), 1));
  geo.setAttribute('aCliffMask', new InstancedBufferAttribute(new Float32Array(FLOOR_CAPACITY), 1));
  return geo;
}

/** 地板实例化网格：只在 model 变化时重写实例属性，提灯 uniform 每帧更新。 */
export class FloorMesh {
  readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly geometry: BufferGeometry;
  private readonly matrix = new Matrix4();

  constructor(textures: FloorTextures) {
    this.geometry = buildPrismGeometry();
    this.material = new ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      side: DoubleSide,
      uniforms: {
        uAlbedo: { value: textures.albedo },
        uNormalMap: { value: textures.normal },
        uTile: { value: BASE_HEX_SIZE * 6 },
        uPlayerLogical: { value: new Vector2(0, 0) },
        uLanternInner: { value: LANTERN_INNER },
        uLanternOuter: { value: LANTERN_OUTER },
        uMemory: { value: MEMORY_LEVEL },
        uLightDir: { value: new Vector3(0.3, 1, 0.2) },
        uHeardTint: { value: paletteColor('heardFill') },
        uSinElev: { value: SIN_ELEV },
      },
    });
    this.mesh = new InstancedMesh(this.geometry, this.material, FLOOR_CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(plan: ScenePlan): void {
    const logical = this.geometry.getAttribute('aLogical') as InstancedBufferAttribute;
    const kind = this.geometry.getAttribute('aKind') as InstancedBufferAttribute;
    const tone = this.geometry.getAttribute('aTone') as InstancedBufferAttribute;
    const mask = this.geometry.getAttribute('aCliffMask') as InstancedBufferAttribute;

    const count = Math.min(plan.floors.length, FLOOR_CAPACITY);
    for (let i = 0; i < count; i += 1) {
      const f = plan.floors[i];
      const w = logicalToWorld(f.logical);
      this.matrix.makeTranslation(w.x, w.y, w.z);
      this.mesh.setMatrixAt(i, this.matrix);
      logical.setXY(i, f.logical.x, f.logical.y);
      kind.setX(i, f.kind);
      tone.setX(i, f.tone);
      mask.setX(i, f.cliffMask);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    logical.needsUpdate = true;
    kind.needsUpdate = true;
    tone.needsUpdate = true;
    mask.needsUpdate = true;
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
