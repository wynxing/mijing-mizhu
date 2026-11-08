import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type OrthographicCamera,
} from 'three';
import { BASE_HEX_SIZE, hexCorners, type Point } from '../../rules/grid/geometry';
import { logicalToWorld } from './embedding';
import { PALETTE } from '../palette';
import type { FloaterTone } from '../presentation';
import type { ScenePlan } from './plan';
import { paletteColor } from './textures';

/** 覆盖物抬离地面一点，避免与地板顶面 z-fighting。 */
const LIFT = 0.3;
const MAX_HIGHLIGHTS = 6;
const MAX_HEARD = 48;
const RING_SEGMENTS = 48;
const EXIT_RADIUS = BASE_HEX_SIZE * 0.62;
/** 记号 quad 的世界尺寸与离地高度（billboard，浮在格心上方）。 */
const GLYPH_SIZE = BASE_HEX_SIZE * 0.85;
const GLYPH_LIFT = 0.9;
/** 每条六边形边切成的虚线段（[起点, 终点] 比例）。 */
const DASH_SPANS: [number, number][] = [
  [0, 0.35],
  [0.5, 0.85],
];
/** 瞬时特效池上限：同屏飘字/闪光/弹道不会超过这个数。 */
const MAX_FLOATERS = 8;
const MAX_FLASHES = 8;
const MAX_STREAKS = 8;
/** 奇遇房恰好 3 个（§8.1），门冷光池按上限开。 */
const MAX_ENCOUNTER_DOORS = 3;
const FLOATER_W = BASE_HEX_SIZE * 1.7;
const FLOATER_H = BASE_HEX_SIZE * 0.85;
/** 飘字在生命周期里抬升的世界高度。 */
const FLOATER_RISE = BASE_HEX_SIZE * 0.7;
const STREAK_LIFT = 0.6;

const FLOATER_COLOR: Record<FloaterTone, string> = {
  damage: PALETTE.damageNumber,
  block: PALETTE.blockNumber,
  heal: PALETTE.healNumber,
  buff: PALETTE.buffNumber,
};

interface FloaterRig {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  material: MeshBasicMaterial;
  texture: CanvasTexture;
  ctx: CanvasRenderingContext2D;
  lastKey: string;
}

function makeGlyphTexture(char: string, color: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.font = 'bold 44px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, 32, 36);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** 飘字 rig：自带 canvas，文字变化时才重画（同 entities 的做法）。 */
function makeFloaterRig(geo: PlaneGeometry): FloaterRig {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 24;
  mesh.visible = false;
  return { mesh, material, texture, ctx, lastKey: '' };
}

function drawFloater(rig: FloaterRig, text: string, color: string): void {
  const { ctx } = rig;
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = 'bold 40px "SFMono-Regular", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.strokeText(text, 64, 34);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 34);
}

/** 奇遇房门冷光：冷色径向光晕 + 一圈细环，不画字（视觉规格 v2.0）。 */
function makeEncounterGlowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(190, 234, 255, 0.95)');
  grad.addColorStop(0.35, 'rgba(127, 200, 232, 0.42)');
  grad.addColorStop(1, 'rgba(127, 200, 232, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = PALETTE.encounterGlow;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 34, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** 命中闪光的径向光斑（additive，贴地）。 */
function makeGlowTexture(): CanvasTexture {  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 243, 214, 1)');
  grad.addColorStop(0.5, 'rgba(255, 217, 160, 0.55)');
  grad.addColorStop(1, 'rgba(255, 217, 160, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * 覆盖物：可落脚高亮（六边形描边）+ 出口环 + heard 格虚线描边与记号。
 * 线宽受 WebGL 限制恒为 1px；记号走 billboard 的 canvas 纹理 quad，
 * 因此 heard（蓝虚线 + ·/!）与 highlight（绿实线）一眼可分。
 */
export class Overlays {
  readonly group = new Group();
  private readonly highlightGeo: BufferGeometry;
  private readonly highlightPos: Float32Array;
  private readonly exitGeo: BufferGeometry;
  private readonly exitPos: Float32Array;
  private readonly exitLine: LineLoop;
  private readonly heardGeo: BufferGeometry;
  private readonly heardPos: Float32Array;
  private readonly glyphGeo = new PlaneGeometry(GLYPH_SIZE, GLYPH_SIZE);
  private readonly glyphs: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly glyphQuiet = makeGlyphTexture('·', PALETTE.glyphQuiet);
  private readonly glyphNoisy = makeGlyphTexture('!', PALETTE.glyphNoisy);
  private readonly glyphExit = makeGlyphTexture('⟩', PALETTE.exitMark);
  private readonly materials: LineBasicMaterial[] = [];
  private readonly floaterGeo = new PlaneGeometry(FLOATER_W, FLOATER_H);
  private readonly floaters: FloaterRig[] = [];
  private readonly flashGeo = new PlaneGeometry(1, 1);
  private readonly glowTex = makeGlowTexture();
  private readonly flashes: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly encounterTex = makeEncounterGlowTexture();
  private readonly encounterGeo = new PlaneGeometry(BASE_HEX_SIZE * 1.15, BASE_HEX_SIZE * 1.15);
  private readonly encounterGlows: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
  private readonly streakGeo: BufferGeometry;
  private readonly streakPos: Float32Array;
  private readonly streakMat: LineBasicMaterial;

  constructor() {
    this.highlightPos = new Float32Array(MAX_HIGHLIGHTS * 6 * 2 * 3);
    this.highlightGeo = new BufferGeometry();
    this.highlightGeo.setAttribute(
      'position',
      new BufferAttribute(this.highlightPos, 3),
    );
    const highlightMat = new LineBasicMaterial({
      color: paletteColor('highlight'),
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    this.materials.push(highlightMat);
    const highlights = new LineSegments(this.highlightGeo, highlightMat);
    highlights.frustumCulled = false;
    highlights.renderOrder = 20;
    this.group.add(highlights);

    this.heardPos = new Float32Array(MAX_HEARD * 6 * DASH_SPANS.length * 2 * 3);
    this.heardGeo = new BufferGeometry();
    this.heardGeo.setAttribute('position', new BufferAttribute(this.heardPos, 3));
    const heardMat = new LineBasicMaterial({
      color: paletteColor('heardStroke'),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    this.materials.push(heardMat);
    const heard = new LineSegments(this.heardGeo, heardMat);
    heard.frustumCulled = false;
    heard.renderOrder = 20;
    this.group.add(heard);

    this.exitPos = new Float32Array(RING_SEGMENTS * 3);
    this.exitGeo = new BufferGeometry();
    this.exitGeo.setAttribute('position', new BufferAttribute(this.exitPos, 3));
    const exitMat = new LineBasicMaterial({
      color: paletteColor('exitMark'),
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    this.materials.push(exitMat);
    this.exitLine = new LineLoop(this.exitGeo, exitMat);
    this.exitLine.frustumCulled = false;
    this.exitLine.renderOrder = 20;
    this.group.add(this.exitLine);

    for (let i = 0; i < MAX_HEARD + 1; i += 1) {
      const mat = new MeshBasicMaterial({
        map: this.glyphQuiet,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const quad = new Mesh(this.glyphGeo, mat);
      quad.frustumCulled = false;
      quad.renderOrder = 21;
      quad.visible = false;
      this.glyphs.push(quad);
      this.group.add(quad);
    }

    for (let i = 0; i < MAX_FLOATERS; i += 1) {
      const rig = makeFloaterRig(this.floaterGeo);
      this.floaters.push(rig);
      this.group.add(rig.mesh);
    }

    for (let i = 0; i < MAX_FLASHES; i += 1) {
      const mat = new MeshBasicMaterial({
        map: this.glowTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      });
      const quad = new Mesh(this.flashGeo, mat);
      quad.frustumCulled = false;
      quad.renderOrder = 23;
      quad.visible = false;
      this.flashes.push(quad);
      this.group.add(quad);
    }

    // 冷光不受提灯衰减：未探索区里它必须自己亮着。
    for (let i = 0; i < MAX_ENCOUNTER_DOORS; i += 1) {
      const mat = new MeshBasicMaterial({
        map: this.encounterTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        opacity: 0.85,
      });
      const quad = new Mesh(this.encounterGeo, mat);
      quad.frustumCulled = false;
      quad.renderOrder = 22;
      quad.visible = false;
      this.encounterGlows.push(quad);
      this.group.add(quad);
    }

    this.streakPos = new Float32Array(MAX_STREAKS * 2 * 3);    this.streakGeo = new BufferGeometry();
    this.streakGeo.setAttribute('position', new BufferAttribute(this.streakPos, 3));
    this.streakMat = new LineBasicMaterial({
      color: paletteColor('streak'),
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.materials.push(this.streakMat);
    const streaks = new LineSegments(this.streakGeo, this.streakMat);
    streaks.frustumCulled = false;
    streaks.renderOrder = 22;
    this.group.add(streaks);
  }

  update(plan: ScenePlan, camera: OrthographicCamera): void {
    let v = 0;
    const write = (logical: Point): void => {
      const w = logicalToWorld(logical, LIFT);
      this.highlightPos[v++] = w.x;
      this.highlightPos[v++] = w.y;
      this.highlightPos[v++] = w.z;
    };
    const count = Math.min(plan.highlights.length, MAX_HIGHLIGHTS);
    for (let i = 0; i < count; i += 1) {
      const corners = hexCorners(plan.highlights[i].logical, BASE_HEX_SIZE);
      for (let c = 0; c < 6; c += 1) {
        write(corners[c]);
        write(corners[(c + 1) % 6]);
      }
    }
    this.highlightGeo.setDrawRange(0, v / 3);
    (this.highlightGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;

    let h = 0;
    const writeDash = (a: Point, b: Point, span: [number, number]): void => {
      for (const t of span) {
        const w = logicalToWorld(
          { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
          LIFT,
        );
        this.heardPos[h++] = w.x;
        this.heardPos[h++] = w.y;
        this.heardPos[h++] = w.z;
      }
    };
    const heardCount = Math.min(plan.heardOutlines.length, MAX_HEARD);
    for (let i = 0; i < heardCount; i += 1) {
      const corners = hexCorners(plan.heardOutlines[i].logical, BASE_HEX_SIZE);
      for (let c = 0; c < 6; c += 1) {
        for (const span of DASH_SPANS) {
          writeDash(corners[c], corners[(c + 1) % 6], span);
        }
      }
    }
    this.heardGeo.setDrawRange(0, h / 3);
    (this.heardGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;

    let g = 0;
    const placeGlyph = (logical: Point, tex: CanvasTexture): void => {
      if (g >= this.glyphs.length) return;
      const quad = this.glyphs[g];
      g += 1;
      quad.visible = true;
      quad.material.map = tex;
      quad.material.needsUpdate = true;
      quad.quaternion.copy(camera.quaternion);
      const w = logicalToWorld(logical, GLYPH_LIFT);
      quad.position.set(w.x, w.y, w.z);
    };
    for (let i = 0; i < heardCount; i += 1) {
      placeGlyph(
        plan.heardOutlines[i].logical,
        plan.heardOutlines[i].noisy ? this.glyphNoisy : this.glyphQuiet,
      );
    }
    if (plan.exit) {
      placeGlyph(plan.exit, this.glyphExit);
      this.exitLine.visible = true;
      for (let i = 0; i < RING_SEGMENTS; i += 1) {
        const angle = (i / RING_SEGMENTS) * Math.PI * 2;
        const w = logicalToWorld(
          {
            x: plan.exit.x + EXIT_RADIUS * Math.cos(angle),
            y: plan.exit.y + EXIT_RADIUS * Math.sin(angle),
          },
          LIFT,
        );
        this.exitPos[i * 3] = w.x;
        this.exitPos[i * 3 + 1] = w.y;
        this.exitPos[i * 3 + 2] = w.z;
      }
      (this.exitGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    } else {
      this.exitLine.visible = false;
    }
    for (let i = g; i < this.glyphs.length; i += 1) this.glyphs[i].visible = false;

    const doorCount = Math.min(plan.encounterDoors.length, this.encounterGlows.length);
    for (let i = 0; i < doorCount; i += 1) {
      const quad = this.encounterGlows[i];
      quad.visible = true;
      quad.quaternion.copy(camera.quaternion);
      const w = logicalToWorld(plan.encounterDoors[i], GLYPH_LIFT);
      quad.position.set(w.x, w.y, w.z);
    }
    for (let i = doorCount; i < this.encounterGlows.length; i += 1) {
      this.encounterGlows[i].visible = false;
    }

    for (let i = 0; i < this.floaters.length; i += 1) {
      const rig = this.floaters[i];
      const f = plan.floaters[i];
      if (!f) {
        rig.mesh.visible = false;
        continue;
      }
      const key = `${f.tone}|${f.text}`;
      if (key !== rig.lastKey) {
        rig.lastKey = key;
        drawFloater(rig, f.text, FLOATER_COLOR[f.tone]);
        rig.texture.needsUpdate = true;
      }
      rig.mesh.visible = true;
      rig.mesh.quaternion.copy(camera.quaternion);
      const w = logicalToWorld(f.pos, GLYPH_LIFT + FLOATER_RISE * f.progress);
      rig.mesh.position.set(w.x, w.y, w.z);
      rig.material.opacity = 1 - f.progress;
    }

    for (let i = 0; i < this.flashes.length; i += 1) {
      const quad = this.flashes[i];
      const f = plan.flashes[i];
      if (!f) {
        quad.visible = false;
        continue;
      }
      quad.visible = true;
      const s = BASE_HEX_SIZE * (0.6 + 1.4 * f.progress);
      quad.scale.set(s, s, 1);
      quad.quaternion.copy(camera.quaternion);
      const w = logicalToWorld(f.pos, GLYPH_LIFT);
      quad.position.set(w.x, w.y, w.z);
      quad.material.opacity = f.strength * (1 - f.progress);
    }

    let sv = 0;
    const writeStreak = (p: Point): void => {
      const w = logicalToWorld(p, STREAK_LIFT);
      this.streakPos[sv++] = w.x;
      this.streakPos[sv++] = w.y;
      this.streakPos[sv++] = w.z;
    };
    const streakCount = Math.min(plan.streaks.length, MAX_STREAKS);
    for (let i = 0; i < streakCount; i += 1) {
      const s = plan.streaks[i];
      const at = (t: number): Point => ({
        x: s.from.x + (s.to.x - s.from.x) * t,
        y: s.from.y + (s.to.y - s.from.y) * t,
      });
      writeStreak(at(Math.max(0, s.progress - 0.35)));
      writeStreak(at(s.progress));
    }
    this.streakGeo.setDrawRange(0, sv / 3);
    (this.streakGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.highlightGeo.dispose();
    this.exitGeo.dispose();
    this.heardGeo.dispose();
    this.glyphGeo.dispose();
    this.glyphQuiet.dispose();
    this.glyphNoisy.dispose();
    this.glyphExit.dispose();
    this.floaterGeo.dispose();
    this.flashGeo.dispose();
    this.glowTex.dispose();
    this.encounterGeo.dispose();
    this.encounterTex.dispose();
    this.streakGeo.dispose();
    for (const rig of this.floaters) {
      rig.texture.dispose();
      rig.material.dispose();
    }
    for (const quad of this.flashes) quad.material.dispose();
    for (const quad of this.glyphs) quad.material.dispose();
    for (const quad of this.encounterGlows) quad.material.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
