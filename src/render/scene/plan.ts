import {
  BASE_HEX_SIZE,
  axialToPixel,
  hexEdgeEndpoints,
  parseAxialKey,
  type DirIndex,
  type Point,
} from '../../rules/grid/geometry';
import type { MonsterIntent, MonsterState } from '../../rules/monsters/brain';
import type { TerrainKind } from '../../rules/generation/generator';
import type { RenderModel } from '../model';
import type {
  PresentationFlash,
  PresentationFloater,
  PresentationFrame,
} from '../presentation';

/**
 * 场景计划：状态/表现帧 → 纯数据，不含任何 three 对象。
 *
 * 这是 3D 渲染层可测的核心，取代 2D 时代的 RecordingContext：
 * 所有「画什么、画在哪」的判定都收敛到 buildScenePlan，网格层只负责
 * 把这些数据实例化。坐标一律是逻辑空间（axialToPixel 的产物），
 * 与屏幕精确相等，因此提灯光斑在屏幕上保持圆形。
 */

/** 记忆区亮度：已踏足但走出提灯的格子恒暗于提灯区，又不至于全黑。 */
export const MEMORY_LEVEL = 0.28;
/** 提灯半径（逻辑单位 = 一格六边形外接圆）。 */
export const LANTERN_RADIUS = BASE_HEX_SIZE;
/** 提灯衰减的内/外半径（逻辑单位）；与 2D 径向渐变的 0.3R→6.5R 对齐。 */
export const LANTERN_INNER = LANTERN_RADIUS * 0.3;
export const LANTERN_OUTER = LANTERN_RADIUS * 6.5;

/** 地块种类：0 = 已踏足实地，1 = 只探听到的通路。 */
export type FloorKind = 0 | 1;
/** 特殊地形实例值：0 = 无，与 FloorInstance.kind 一样走数值属性。 */
export type FloorTerrain = 0 | 1 | 2 | 3;

export interface FloorInstance {
  /** 格心的逻辑坐标。 */
  logical: Point;
  kind: FloorKind;
  /** hash01(key)：给每格一点固定色差，避免整片石面死板。 */
  tone: number;
  /** 6 位掩码：第 dir 位为 1 表示该边邻格不是实地，需要画断崖/侧棱。 */
  cliffMask: number;
  /** 特殊地形：0 无 / 1 乱石 / 2 水渍 / 3 风口。着色器据此换程序化纹理（§5.3）。 */
  terrain: FloorTerrain;
}

export interface WallRidge {
  /** 共享边的两个端点（逻辑坐标）。 */
  a: Point;
  b: Point;
}

export interface HighlightInstance {
  logical: Point;
  /** 只探听到的邻居：高亮但不画中心点（与 2D 一致）。 */
  heard: boolean;
}

export interface EntityPlan {
  id: string;
  /** 怪物原型 id：守卫要画得更大、重绘 key 也要认它。 */
  defId: string;
  /** 脚锚的逻辑坐标（位移中取插值后的位置）。 */
  logical: Point;
  /** CPU 侧算好的提灯项，暗区不发光。 */
  lantern: number;
  kind: 'player' | MonsterState;
  hp: number;
  maxHp: number;
  /** 0..1 可见度，死亡时向下淡出。 */
  alpha: number;
  /** 0..1 命中闪白强度。 */
  hit: number;
  targeted: boolean;
  /** 首次发现的预警回合：头顶画「!」。 */
  spotted: boolean;
  intent: MonsterIntent | null;
}

export interface ScenePlan {
  /** 提灯中心的逻辑坐标（玩家插值后的位置）。 */
  playerLogical: Point;
  floors: FloorInstance[];
  walls: WallRidge[];
  highlights: HighlightInstance[];
  /** 只探听到的通路格心：压暗 + 虚线轮廓 + 记号。 */
  heardOutlines: { logical: Point; noisy: boolean }[];
  /** 出口格心，仅当出口已被踏足为实地时存在。 */
  exit: Point | null;
  /** 未探明奇遇房的门：纯黑里唯一自发光的几何。 */
  encounterDoors: Point[];
  entities: EntityPlan[];
  /** 演出帧直传的瞬时特效，进度已在 director 里算好。 */
  floaters: PresentationFloater[];
  flashes: PresentationFlash[];
  streaks: { from: Point; to: Point; progress: number }[];
}

/** 稳定的字符串散列，给每格一点固定的色差。 */
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function segmentKey(a: Point, b: Point): string {
  const round = (v: number): number => Math.round(v * 100) / 100;
  const first = `${round(a.x)},${round(a.y)}`;
  const second = `${round(b.x)},${round(b.y)}`;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

/**
 * 提灯项的 CPU 镜像：与地板片元里的 `1 - smoothstep(inner, outer, d)` 同款，
 * 给 sprite/墙用，保证暗区里的实体不会自发光。
 */
export function lanternAt(p: Point, player: Point): number {
  const d = Math.hypot(p.x - player.x, p.y - player.y);
  if (d <= LANTERN_INNER) return 1;
  if (d >= LANTERN_OUTER) return 0;
  const t = (d - LANTERN_INNER) / (LANTERN_OUTER - LANTERN_INNER);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * 断崖掩码：只有朝向观察者的两条边（西南 dir4、东南 dir5）会露出侧面。
 * 相机在正南上方 55°，东/西边恰好侧对镜头（投影面积为零）、北面背对，
 * 因此侧壁只在 4、5 两位上有意义；其余位恒为 0。
 */
const CLIFF_DIRS = new Set<number>([4, 5]);

function cliffMaskOf(views: readonly string[]): number {
  let mask = 0;
  for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
    if (CLIFF_DIRS.has(dir) && views[dir] !== 'floor') mask |= 1 << dir;
  }
  return mask;
}

const TERRAIN_INDEX: Record<TerrainKind, FloorTerrain> = {
  rubble: 1,
  water: 2,
  vent: 3,
};

function terrainIndex(kind: TerrainKind | null): FloorTerrain {
  return kind === null ? 0 : TERRAIN_INDEX[kind];
}

export function buildScenePlan(model: RenderModel, frame?: PresentationFrame): ScenePlan {
  const playerLogical = frame?.player.pos ?? axialToPixel(model.player, BASE_HEX_SIZE);

  const floors: FloorInstance[] = [];
  const heardOutlines: { logical: Point; noisy: boolean }[] = [];
  const wallSeen = new Set<string>();
  const walls: WallRidge[] = [];

  for (const [key, cell] of model.cells) {
    const appearance = cell.appearance;
    if (appearance.kind === 'unknown' || appearance.kind === 'knownWall') continue;
    const axial = parseAxialKey(key);
    const logical = axialToPixel(axial, BASE_HEX_SIZE);

    if (appearance.kind === 'heardPassage') {
      floors.push({ logical, kind: 1, tone: hash01(key), cliffMask: 0, terrain: 0 });
      heardOutlines.push({ logical, noisy: appearance.result === 'passage_noisy' });
      continue;
    }

    // 已踏足实地
    floors.push({
      logical,
      kind: 0,
      tone: hash01(key),
      cliffMask: cliffMaskOf(cell.views),
      terrain: terrainIndex(cell.terrain),
    });

    // 墙脊：贴在与墙格共享的边上，每条边只放一次
    for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
      if (!cell.wallEdges[dir]) continue;
      const edge = hexEdgeEndpoints(logical, BASE_HEX_SIZE, dir);
      const segKey = segmentKey(edge.a, edge.b);
      if (wallSeen.has(segKey)) continue;
      wallSeen.add(segKey);
      walls.push({ a: edge.a, b: edge.b });
    }
  }

  // 可落脚高亮：玩家正在位移时不画，否则高亮会先于玩家出现
  const highlights: HighlightInstance[] = [];
  if (!frame?.player.moving) {
    for (const next of model.standableNeighbors) {
      const cell = model.cells.get(`${next.cell.q},${next.cell.r}`);
      highlights.push({
        logical: axialToPixel(next.cell, BASE_HEX_SIZE),
        heard: cell?.appearance.kind === 'heardPassage',
      });
    }
  }

  const exitCell = model.cells.get(`${model.exit.q},${model.exit.r}`);
  const exit =
    exitCell?.appearance.kind === 'floor'
      ? axialToPixel(model.exit, BASE_HEX_SIZE)
      : null;

  return {
    playerLogical,
    floors,
    walls,
    highlights,
    heardOutlines,
    exit,
    encounterDoors: model.encounterDoors.map((door) => axialToPixel(door, BASE_HEX_SIZE)),
    entities: buildEntities(model, frame, playerLogical),
    floaters: frame?.floaters ?? [],
    flashes: frame?.flashes ?? [],
    streaks: frame?.streaks ?? [],
  };
}

function buildEntities(
  model: RenderModel,
  frame: PresentationFrame | undefined,
  playerLogical: Point,
): EntityPlan[] {
  const entities: EntityPlan[] = [];

  entities.push({
    id: 'player',
    defId: 'player',
    logical: playerLogical,
    lantern: lanternAt(playerLogical, playerLogical),
    kind: 'player',
    hp: frame?.player.hp ?? model.playerHp,
    maxHp: frame?.player.maxHp ?? model.playerMaxHp,
    alpha: 1,
    hit: frame?.player.hit ?? 0,
    targeted: false,
    spotted: false,
    intent: null,
  });

  if (!frame) {
    for (const monster of model.monsters) {
      if (!monster.visible) continue;
      const logical = axialToPixel(monster.pos, BASE_HEX_SIZE);
      entities.push({
        id: monster.uid,
        defId: monster.defId,
        logical,
        lantern: lanternAt(logical, playerLogical),
        kind: monster.state,
        hp: monster.hp,
        maxHp: monster.maxHp,
        alpha: 1,
        hit: 0,
        targeted: monster.targeted,
        spotted: monster.spotted,
        intent: monster.intent,
      });
    }
    return entities;
  }

  for (const monster of frame.monsters) {
    const info = model.monsters.find((item) => item.uid === monster.uid);
    entities.push({
      id: monster.uid,
      defId: info?.defId ?? '',
      logical: monster.pos,
      lantern: lanternAt(monster.pos, playerLogical),
      kind: monster.state,
      hp: monster.hp,
      maxHp: monster.maxHp,
      alpha: monster.alpha,
      hit: monster.hit,
      targeted: info?.targeted ?? false,
      spotted: info?.spotted ?? false,
      intent: info?.intent ?? null,
    });
  }
  return entities;
}
