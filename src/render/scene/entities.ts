import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  type OrthographicCamera,
} from 'three';
import { BASE_HEX_SIZE } from '../../rules/grid/geometry';
import type { MonsterIntent, MonsterState } from '../../rules/monsters/brain';
import { PALETTE } from '../palette';
import { footAnchor, logicalToWorld } from './embedding';
import type { EntityPlan, ScenePlan } from './plan';
import { SPRITE_FRAG, SPRITE_VERT } from './shaders';
import { paletteColor } from './textures';

/**
 * 实体层：玩家与怪物走 billboard sprite（每帧朝向相机），脚锚落在格心地面。
 * 身体 / 血条 / 意图 / 选中环画在同一张 canvas 纹理里（离散变化才重绘），
 * 提灯、淡出、命中闪白走 uniform 每帧更新，避免逐帧重绘 canvas。
 * 脚下另贴一张径向渐变的接触阴影，代替 v1 明确不做的阴影贴图。
 *
 * 身体目前全部走程序化几何（菱形=怪物、圆盘=玩家），与 2D 的「形状+状态色」
 * 双编码一致；手绘贴图（sniffer.png 等）在角色齐备后的打磨轮替换。
 */

const SPRITE_W = 96;
const SPRITE_H = 160;
const BODY_RADIUS = 34;
const BODY_CY = SPRITE_H - 40;
const SPRITE_WORLD_H = BASE_HEX_SIZE * 2.0;
const SPRITE_WORLD_W = SPRITE_WORLD_H * (SPRITE_W / SPRITE_H);
const SHADOW_SIZE = BASE_HEX_SIZE * 0.95;
const SHADOW_LIFT = 0.05;

interface SpriteRig {
  mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  key: string;
}

function intentGlyph(intent: MonsterIntent): { text: string; color: string } {
  switch (intent.kind) {
    case 'move':
      return { text: `→${intent.steps}`, color: PALETTE.intentMove };
    case 'attack':
      return { text: `✕${intent.damage}`, color: PALETTE.intentAttack };
    case 'aoe':
      return { text: `◎${intent.damage}`, color: PALETTE.intentAttack };
    case 'search':
      return { text: '?', color: PALETTE.intentSearch };
    default:
      return { text: '≡', color: PALETTE.intentFrozen };
  }
}

function intentKey(intent: MonsterIntent): string {
  const value =
    intent.kind === 'move'
      ? intent.steps
      : intent.kind === 'attack' || intent.kind === 'aoe'
        ? intent.damage
        : 0;
  return `${intent.kind}:${value}`;
}

function stateColor(state: MonsterState): string {
  if (state === 'chase') return PALETTE.monsterChase;
  if (state === 'alert') return PALETTE.monsterAlert;
  return PALETTE.monster;
}

function makeShadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** 把单个实体画进 canvas：意图在上、血条其次、身体在脚锚上方。 */
function drawEntity(ctx: CanvasRenderingContext2D, e: EntityPlan): void {
  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  const cx = SPRITE_W / 2;

  if (e.spotted) {
    ctx.fillStyle = PALETTE.monsterChase;
    ctx.font = 'bold 26px "SFMono-Regular", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', cx, 16);
  } else if (e.intent) {
    const glyph = intentGlyph(e.intent);
    ctx.fillStyle = glyph.color;
    ctx.font = 'bold 22px "SFMono-Regular", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph.text, cx, 16);
  }

  if (e.kind !== 'player' && e.maxHp > 0) {
    const w = 64;
    const x = cx - w / 2;
    ctx.fillStyle = PALETTE.hpBarTrack;
    ctx.fillRect(x, 28, w, 8);
    const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
    ctx.fillStyle = PALETTE.hpBarFill;
    ctx.fillRect(x, 28, w * ratio, 8);
  }

  if (e.kind === 'player') {
    ctx.beginPath();
    ctx.arc(cx, BODY_CY, BODY_RADIUS * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.playerFill;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = PALETTE.playerRing;
    ctx.stroke();
  } else {
    const boss = e.defId === 'guardian';
    ctx.save();
    ctx.translate(cx, BODY_CY);
    ctx.rotate(Math.PI / 4);
    const s = BODY_RADIUS * (boss ? 1.15 : 0.85);
    ctx.fillStyle = stateColor(e.kind);
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.lineWidth = e.targeted ? 6 : boss ? 5 : 2;
    ctx.strokeStyle = e.targeted
      ? PALETTE.highlight
      : boss
        ? PALETTE.exitMark
        : PALETTE.playerRing;
    ctx.strokeRect(-s, -s, s * 2, s * 2);
    ctx.restore();
  }
}

export class EntityLayer {
  readonly group = new Group();
  private readonly rigs = new Map<string, SpriteRig>();
  private readonly bodyGeo = new PlaneGeometry(SPRITE_WORLD_W, SPRITE_WORLD_H).translate(
    0,
    SPRITE_WORLD_H / 2,
    0,
  );
  private readonly shadowGeo = new PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE).rotateX(
    -Math.PI / 2,
  );
  private readonly shadowTex = makeShadowTexture();
  private readonly hitColor = paletteColor('hitFlash');

  update(plan: ScenePlan, camera: OrthographicCamera): void {
    const seen = new Set<string>();
    for (const e of plan.entities) {
      seen.add(e.id);
      let rig = this.rigs.get(e.id);
      if (!rig) {
        rig = this.createRig();
        this.rigs.set(e.id, rig);
      }
      const key = [
        e.defId,
        e.kind,
        e.hp,
        e.maxHp,
        e.targeted ? 1 : 0,
        e.spotted ? 1 : 0,
        e.intent ? intentKey(e.intent) : '',
      ].join('|');
      if (key !== rig.key) {
        rig.key = key;
        drawEntity(rig.ctx, e);
        rig.texture.needsUpdate = true;
      }

      const foot = footAnchor(e.logical);
      rig.mesh.position.copy(foot);
      rig.mesh.quaternion.copy(camera.quaternion);
      const mat = rig.mesh.material;
      mat.uniforms.uLantern.value = e.lantern;
      mat.uniforms.uAlpha.value = e.alpha;
      mat.uniforms.uHit.value = e.hit;
      rig.mesh.visible = e.alpha > 0.01;

      const w = logicalToWorld(e.logical, SHADOW_LIFT);
      rig.shadow.position.set(w.x, w.y, w.z);
      rig.shadow.material.opacity = 0.9 * e.alpha * (0.4 + 0.6 * e.lantern);
      rig.shadow.visible = e.alpha > 0.01;
    }
    for (const [id, rig] of this.rigs) {
      if (seen.has(id)) continue;
      this.group.remove(rig.mesh, rig.shadow);
      rig.mesh.material.dispose();
      rig.texture.dispose();
      rig.shadow.material.dispose();
      this.rigs.delete(id);
    }
  }

  private createRig(): SpriteRig {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_W;
    canvas.height = SPRITE_H;
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;

    const material = new ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: {
        uMap: { value: texture },
        uLantern: { value: 1 },
        uAlpha: { value: 1 },
        uHit: { value: 0 },
        uHitColor: { value: this.hitColor },
      },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new Mesh(this.bodyGeo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.group.add(mesh);

    const shadow = new Mesh(
      this.shadowGeo,
      new MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.frustumCulled = false;
    shadow.renderOrder = 5;
    this.group.add(shadow);

    return { mesh, shadow, canvas, ctx, texture, key: '' };
  }

  dispose(): void {
    for (const rig of this.rigs.values()) {
      rig.mesh.material.dispose();
      rig.texture.dispose();
      rig.shadow.material.dispose();
    }
    this.rigs.clear();
    this.bodyGeo.dispose();
    this.shadowGeo.dispose();
    this.shadowTex.dispose();
  }
}
