import { Rng32 } from '../../core/rng';
import {
  DIRECTIONS,
  axialKey,
  hexDistance,
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
  | { kind: 'frozen' };

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
  };
}

/** 感知半径内的所有格（几何距离，忽略墙）。 */
export function cellsWithinRadius(center: Axial, radius: number): Axial[] {
  const out: Axial[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
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

/** 预掷下一回合的意图：相邻就打，否则走 N 格。 */
export function rollIntent(monster: Monster, rng: Rng32, playerPos: Axial): Monster {
  if (monster.frozen) return { ...monster, intent: { kind: 'frozen' } };
  if (monster.spotted) return { ...monster, intent: { kind: 'search' } };
  if (hexDistance(monster.pos, playerPos) <= 1) {
    return { ...monster, intent: { kind: 'attack', damage: monster.def.damage } };
  }
  if (monster.def.move.kind === 'none') {
    return { ...monster, intent: { kind: 'search' } };
  }
  return { ...monster, intent: { kind: 'move', steps: moveStepsFor(monster.def, rng) } };
}

/**
 * 感知更新：采样气味场决定三态。
 * 追击锁定玩家实时位置；只有低气味区静止足够回合才会降级。
 */
export function updatePerception(
  monster: Monster,
  scent: ScentState,
  playerPos: Axial,
  playerStationaryTurns: number,
): Monster {
  if (monster.frozen) return monster;
  if (monster.dazeTurns > 0) return { ...monster, dazeTurns: monster.dazeTurns - 1 };

  if (monster.state === 'chase') {
    if (playerStationaryTurns >= 2 && inLowScentArea(scent, playerPos)) {
      return { ...monster, state: 'alert', spotted: false };
    }
    return { ...monster, state: 'chase', lastKnown: playerPos };
  }

  if (hexDistance(monster.pos, playerPos) <= 2) {
    return { ...monster, state: 'chase', lastKnown: playerPos, spotted: true };
  }

  const range = cellsWithinRadius(monster.pos, monster.def.senseRadius);
  let best: Axial | null = null;
  let bestValue = 0;
  for (const cell of range) {
    const value = scent.cells.get(axialKey(cell)) ?? 0;
    if (value >= 2 && value > bestValue) {
      bestValue = value;
      best = cell;
    }
  }

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

/** 游荡：走向随机可达格。 */
function wanderTarget(monster: Monster, map: CellGrid, rng: Rng32): Axial | null {
  const options = DIRECTIONS.map((delta) => ({
    q: monster.pos.q + delta.q,
    r: monster.pos.r + delta.r,
  })).filter((cell) => isWalkable(map, cell));
  if (options.length === 0) return null;
  return options[rng.int(0, options.length - 1)];
}
