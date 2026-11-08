import { Rng32 } from '../../core/rng';
import {
  DIRECTIONS,
  axialKey,
  hexDistance,
  parseAxialKey,
  type Axial,
  type DirIndex,
} from '../grid/geometry';
import { findPath, isWalkable, type CellGrid } from '../grid/path';
import { inLowScentArea, type ScentState } from '../fog/scent';
import type { MonsterDef } from './content';

/** 三态：游荡 / 警觉 / 追击。 */
export type MonsterState = 'wander' | 'alert' | 'chase';

/** 意图：预掷并公开，图标与数字都要能预告下一步。 */
export type MonsterIntent =
  | { kind: 'move'; steps: number }
  | { kind: 'attack'; damage: number }
  | { kind: 'search' }
  | { kind: 'frozen' }
  /** 守卫阶段 3：范围爆发，提前一回合公开，玩家可走出半径（§6.4）。 */
  | { kind: 'aoe'; radius: number; damage: number };

export interface Monster {
  /** 实例唯一标识：同种怪物可以有多只，表现层靠它跟踪血量与位置。 */
  uid: string;
  def: MonsterDef;
  pos: Axial;
  hp: number;
  maxHp: number;
  state: MonsterState;
  /** 警觉时锁定的最后已知位置。 */
  lastKnown: Axial | null;
  intent: MonsterIntent;
  /** 刚发现玩家，还没扑上来——玩家有一个回合的反应窗口。 */
  spotted: boolean;
  /** 本回合被定身。 */
  frozen: boolean;
  /** 被驱散后的失智回合数：期间不感知。 */
  dazeTurns: number;
  /**
   * 守卫三阶段（§6.4）：0 = 尚未激活（守在自己的位置），1–3 = 已进入战斗。
   * 非守卫恒为 0。
   */
  bossPhase: 0 | 1 | 2 | 3;
  /** 阶段 2 的一次性召唤是否已经用掉。 */
  summoned: boolean;
}

export function createMonster(def: MonsterDef, pos: Axial, uid: string): Monster {
  return {
    uid,
    def,
    pos,
    hp: def.hp,
    maxHp: def.hp,
    state: 'wander',
    lastKnown: null,
    intent: { kind: 'search' },
    spotted: false,
    frozen: false,
    dazeTurns: 0,
    bossPhase: 0,
    summoned: false,
  };
}

export function moveStepsFor(def: MonsterDef, rng: Rng32): number {
  switch (def.move.kind) {
    case 'fixed':
      return def.move.steps ?? 0;
    case 'dice':
      return rng.int(1, def.move.sides ?? 6);
    case 'range':
      return rng.int(def.move.min ?? 1, def.move.max ?? 3);
    default:
      return 0;
  }
}

/** 守卫阶段 3 的爆发参数（§6.4）。 */
export const BOSS_AOE_RADIUS = 2;
export const BOSS_AOE_DAMAGE = 12;
/** 进入阶段 2 时的自愈量。 */
export const BOSS_PHASE_HEAL = 15;

const isGuardian = (monster: Monster): boolean => monster.def.id === 'guardian';

/** 预掷下一回合的意图：相邻就打，否则走 N 格；守卫按阶段改意图。 */
export function rollIntent(monster: Monster, rng: Rng32, playerPos: Axial): Monster {
  if (monster.frozen) return { ...monster, intent: { kind: 'frozen' } };
  // 未激活的守卫守在原位，不游荡也不循气味（§6.4 落地口径）。
  if (isGuardian(monster) && monster.bossPhase === 0) {
    return { ...monster, intent: { kind: 'search' } };
  }
  // 阶段 3：每回合都是范围爆发，意图提前一回合公开。
  if (monster.bossPhase === 3) {
    return {
      ...monster,
      intent: { kind: 'aoe', radius: BOSS_AOE_RADIUS, damage: BOSS_AOE_DAMAGE },
    };
  }
  if (monster.spotted) return { ...monster, intent: { kind: 'search' } };
  if (hexDistance(monster.pos, playerPos) <= 1) {
    return { ...monster, intent: { kind: 'attack', damage: monster.def.damage } };
  }
  if (monster.def.move.kind === 'none') {
    return { ...monster, intent: { kind: 'search' } };
  }
  return { ...monster, intent: { kind: 'move', steps: moveStepsFor(monster.def, rng) } };
}

/** 感知半径内气味最高的格子；遍历稀疏气味场而非枚举半径（守卫半径 99 会枚举出三万格）。 */
function strongestScentInRange(monster: Monster, scent: ScentState): Axial | null {
  const candidates: { cell: Axial; value: number; dq: number; dr: number }[] = [];
  for (const [key, value] of scent.cells) {
    if (value < 2) continue;
    const cell = parseAxialKey(key);
    if (hexDistance(monster.pos, cell) > monster.def.senseRadius) continue;
    candidates.push({
      cell,
      value,
      dq: cell.q - monster.pos.q,
      dr: cell.r - monster.pos.r,
    });
  }
  // 并列取 dq/dr 最小者，与按半径枚举的顺序一致。
  candidates.sort((a, b) => a.dq - b.dq || a.dr - b.dr);
  let best: Axial | null = null;
  let bestValue = 0;
  for (const candidate of candidates) {
    if (candidate.value > bestValue) {
      bestValue = candidate.value;
      best = candidate.cell;
    }
  }
  return best;
}

/**
 * 感知更新：采样气味场决定三态。
 * 追击锁定玩家实时位置；只有低气味区静止足够回合才会降级。
 * `playerInExitRoom` 用于守卫的激活判定（§6.4）。
 */
export function updatePerception(
  monster: Monster,
  scent: ScentState,
  playerPos: Axial,
  playerStationaryTurns: number,
  playerInExitRoom = false,
): Monster {
  if (monster.frozen) return monster;
  if (monster.dazeTurns > 0) return { ...monster, dazeTurns: monster.dazeTurns - 1 };

  if (isGuardian(monster) && monster.bossPhase === 0) {
    if (!playerInExitRoom) return { ...monster, state: 'wander', lastKnown: null };
    return { ...monster, bossPhase: 1, state: 'chase', lastKnown: playerPos, spotted: false };
  }

  if (monster.state === 'chase') {
    if (playerStationaryTurns >= 2 && inLowScentArea(scent, playerPos)) {
      return { ...monster, state: 'alert', spotted: false };
    }
    return { ...monster, state: 'chase', lastKnown: playerPos };
  }

  if (hexDistance(monster.pos, playerPos) <= 2) {
    return { ...monster, state: 'chase', lastKnown: playerPos, spotted: true };
  }

  const best = strongestScentInRange(monster, scent);
  if (best) return { ...monster, state: 'alert', lastKnown: best };
  return { ...monster, state: 'wander', lastKnown: null };
}

/** 朝目标走一步：无视墙的怪物走直线，会走路的怪物走最短路。 */
export function stepToward(
  monster: Monster,
  map: CellGrid,
  target: Axial,
): Axial | null {
  if (monster.def.ignoresWalls) {
    return straightStep(monster.pos, target);
  }
  const path = findPath(map, monster.pos, target);
  if (path && path.length >= 2) return path[1];
  return null;
}

/** 轴向直线上的一步（无视墙）。 */
function straightStep(from: Axial, to: Axial): Axial | null {
  let best: DirIndex | null = null;
  let bestScore = Infinity;
  for (let dir = 0 as DirIndex; dir < 6; dir = (dir + 1) as DirIndex) {
    const delta = DIRECTIONS[dir];
    const next = { q: from.q + delta.q, r: from.r + delta.r };
    const score = hexDistance(next, to);
    if (score < bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  if (best === null) return null;
  const delta = DIRECTIONS[best];
  return { q: from.q + delta.q, r: from.r + delta.r };
}

export interface MonsterAction {
  monster: Monster;
  /** 本回合对玩家造成的伤害。 */
  damage: number;
  /** 蛛巢新布下的陷阱格。 */
  traps: Axial[];
}

/** 怪物行动：按预掷的意图执行。 */
export function actMonster(
  monster: Monster,
  map: CellGrid,
  playerPos: Axial,
  rng: Rng32,
): MonsterAction {
  // 冻结只持续一个怪物结算：不行动、不感知，由回合末统一解除。
  if (monster.frozen) {
    return { monster, damage: 0, traps: [] };
  }

  // 未激活的守卫不行动。
  if (isGuardian(monster) && monster.bossPhase === 0) {
    return { monster, damage: 0, traps: [] };
  }

  const next: Monster = { ...monster, spotted: false };

  // 首次发现的预警回合：不移动、不攻击，只把「!」留给玩家看见。
  if (monster.spotted && !monster.def.eager) {
    return { monster: next, damage: 0, traps: [] };
  }

  const traps: Axial[] = [];

  if (monster.def.laysTraps) {
    for (const delta of DIRECTIONS) {
      const cell = { q: monster.pos.q + delta.q, r: monster.pos.r + delta.r };
      if (isWalkable(map, cell)) traps.push(cell);
    }
  }

  if (monster.intent.kind === 'attack') {
    // 意图结算前复查距离：玩家退开则攻击落空，不临时改成移动。
    const adjacent = hexDistance(monster.pos, playerPos) <= 1;
    return { monster: next, damage: adjacent ? monster.def.damage : 0, traps };
  }

  if (monster.intent.kind === 'aoe') {
    // 同样复查范围：走出半径即免伤（闪避/免疫/减伤由 reducer 的伤害管线处理）。
    const inside = hexDistance(monster.pos, playerPos) <= monster.intent.radius;
    return { monster: next, damage: inside ? monster.intent.damage : 0, traps };
  }

  if (monster.intent.kind === 'search' || monster.intent.kind === 'frozen') {
    return { monster: next, damage: 0, traps };
  }

  const target =
    monster.state === 'chase'
      ? playerPos
      : monster.state === 'alert'
        ? monster.lastKnown
        : wanderTarget(monster, map, rng);

  let pos = monster.pos;
  let damage = 0;
  for (let step = 0; step < monster.intent.steps; step++) {
    if (!target) break;
    const candidate = stepToward({ ...monster, pos }, map, target);
    if (!candidate) break;
    if (axialKey(candidate) === axialKey(playerPos)) {
      pos = candidate;
      damage = monster.def.damage;
      break;
    }
    if (!monster.def.ignoresWalls && !isWalkable(map, candidate)) break;
    pos = candidate;
  }

  return { monster: { ...next, pos }, damage, traps };
}

/** 守卫阶段推进（§6.4）：HP ≤ 2/3 进阶段 2、≤ 1/3 进阶段 3，只进不退。 */
export function advanceBossPhase(monster: Monster): Monster {
  if (!isGuardian(monster) || monster.bossPhase === 0) return monster;
  const ratio = monster.hp / monster.maxHp;
  const target = ratio <= 1 / 3 ? 3 : ratio <= 2 / 3 ? 2 : 1;
  if (target <= monster.bossPhase) return monster;
  const phase = target as 2 | 3;
  return {
    ...monster,
    bossPhase: phase,
    hp: phase === 2 ? Math.min(monster.maxHp, monster.hp + BOSS_PHASE_HEAL) : monster.hp,
    state: 'chase',
  };
}

/** 游荡：走向随机可达格。 */
function wanderTarget(monster: Monster, map: CellGrid, rng: Rng32): Axial | null {
  const options = DIRECTIONS.map((delta) => ({
    q: monster.pos.q + delta.q,
    r: monster.pos.r + delta.r,
  })).filter((cell) => isWalkable(map, cell));
  if (options.length === 0) return null;
  return options[rng.int(0, options.length - 1)];
}
