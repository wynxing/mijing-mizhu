import {
  axialEquals,
  axialKey,
  axialToOffset,
  hexDistance,
  isInBounds,
  neighbors,
  offsetToAxial,
  parseAxialKey,
  type Axial,
} from '../rules/grid/geometry';
import { CELL_FLOOR, CELL_WALL, bfsDistances, cellIndex, findPath, type CellGrid } from '../rules/grid/path';
import { createGame } from '../rules/game/createGame';
import { isWalkableAtLevel, levelAsCellGrid, type LevelGenParams } from '../rules/generation/generator';
import { countDeadEnds, countFloorCells, countFloorEdges } from '../rules/generation/validate';
import {
  canListen,
  canMove,
  movementPointsOf,
  reduceGame,
  resolveCardTarget,
} from '../rules/turn/reducer';
import type { GameIntent, GameState, GameStatus } from '../rules/turn/types';
import type { CardDef } from '../rules/cards/content';
import type { Monster } from '../rules/monsters/brain';
import { MONSTER_SIGHT } from '../render/model';

/** run/fight/escape 是全图视野的 oracle 下界；explore 只走玩家真能看到的格。 */
export type Policy = 'run' | 'fight' | 'escape' | 'explore';

export interface SimOptions {
  maxTurns?: number;
  /** 覆盖关卡生成参数；怪物数量扫描必须走 monsterBudget，而不是截断布点。 */
  params?: Partial<LevelGenParams>;
  /** 守卫单挑：只留守卫、玩家满血并站在守卫相邻格，用于测 §15 的守卫战失败率。 */
  duel?: boolean;
}

/** 46×30 地图最短路 60–104 步，60 回合的上限会把正常局判成超时。 */
export const DEFAULT_MAX_TURNS = 160;

export interface RunResult {
  /** 有效种子：校验失败会重试到 seed + attempt，复现以此为准。 */
  seed: number;
  policy: Policy;
  status: GameStatus;
  reachedExit: boolean;
  turns: number;
  turnsInChase: number;
  damageTaken: number;
  monsterDamage: number;
  chaseEndedByEscape: boolean;
  minDistance: number;
  avgDistance: number;
  /** 与怪物交战过的次数。 */
  engagements: number;
  /** 击杀的怪物数。 */
  kills: number;
  cardsPlayed: number;
  cardUsage: Record<string, number>;
  /** 按怪物原型拆分的承伤，用来定位该调谁。 */
  damageByMonster: Record<string, number>;
  /** 地图指标（同一种子三个策略共用，便于报告读到生成质量）。 */
  fill: number;
  cycles: number;
  deadEnds: number;
  pathLength: number;
  /** 踩中的陷阱数与陷阱总承伤（含流血/中毒）。 */
  trapTriggers: number;
  trapDamage: number;
}

export interface BalanceReport {
  policy: Policy;
  runs: number;
  reachedExitRate: number;
  deathRate: number;
  timeoutRate: number;
  avgTurns: number;
  avgDamage: number;
  avgMonsterDamage: number;
  avgChaseTurns: number;
  chaseEndRate: number;
  avgMinDistance: number;
  avgEngagements: number;
  avgKills: number;
  avgCardsPlayed: number;
  /** 整批局里每张卡被打出的总次数。 */
  cardUsage: Record<string, number>;
  /** 整批局里按怪物原型拆分的总承伤。 */
  damageByMonster: Record<string, number>;
  avgFill: number;
  avgCycles: number;
  avgDeadEnds: number;
  avgPathLength: number;
  avgTrapTriggers: number;
  avgTrapDamage: number;
}

/** 守卫单挑的初始局面：只留守卫，玩家满血站在它相邻的可走格上。 */
function setUpDuel(state: GameState): GameState {
  const guardian = state.monsters.find((monster) => monster.def.id === 'guardian');
  if (!guardian) return state;
  const spot =
    neighbors(guardian.pos).find((cell) => isWalkableAtLevel(state.level, cell)) ??
    guardian.pos;
  return {
    ...state,
    player: { ...state.player, pos: spot, hp: state.player.maxHp },
    monsters: [guardian],
    phase: 'player',
  };
}

function nearestMonster(state: GameState): Monster | null {
  let best: Monster | null = null;
  let bestDistance = Infinity;
  for (const monster of state.monsters) {
    const distance = hexDistance(state.player.pos, monster.pos);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = monster;
    }
  }
  return best;
}

/** 把怪物格视为墙后的最短路线；被彻底堵死时退回真实地形，此时下一步就是近战。 */
function routeToExit(state: GameState): Axial[] {
  const base = levelAsCellGrid(state.level);
  const cells = new Uint8Array(base.cells);
  for (const monster of state.monsters) {
    cells[cellIndex(base.grid, monster.pos)] = CELL_WALL;
  }
  return (
    findPath({ cells, grid: base.grid }, state.player.pos, state.level.exit) ??
    findPath(base, state.player.pos, state.level.exit) ??
    []
  );
}

/** 玩家眼里的可落脚格：踏足过，或探听到是通路。与 render/model.ts 的 standable 同口径。 */
function standable(state: GameState, cell: Axial): boolean {
  const key = axialKey(cell);
  if (state.fog.visited.has(key)) return true;
  const heard = state.fog.known.get(key);
  return heard === 'passage_quiet' || heard === 'passage_noisy';
}

/** 怪物可见性同 render/model.ts：踏足格上的，或警觉/追击且足够近的。 */
function seen(state: GameState, monster: Monster): boolean {
  return (
    state.fog.visited.has(axialKey(monster.pos)) ||
    ((monster.state === 'alert' || monster.state === 'chase') &&
      hexDistance(state.player.pos, monster.pos) <= MONSTER_SIGHT)
  );
}

function hasUnknownNeighbor(state: GameState, cell: Axial): boolean {
  const grid = { width: state.level.width, height: state.level.height };
  for (const next of neighbors(cell)) {
    if (!isInBounds(grid, next)) continue;
    const key = axialKey(next);
    if (!state.fog.visited.has(key) && !state.fog.known.has(key)) return true;
  }
  return false;
}

/** 迷雾受限的通行图：未知格与已知墙一律不可走；avoidTraps 时连听到的陷阱也绕开。 */
function knownGrid(state: GameState, avoidTraps: boolean): CellGrid {
  const base = levelAsCellGrid(state.level);
  const cells = new Uint8Array(base.cells.length).fill(CELL_WALL);
  for (let row = 0; row < state.level.height; row++) {
    for (let col = 0; col < state.level.width; col++) {
      const cell = offsetToAxial(col, row);
      if (!standable(state, cell)) continue;
      if (avoidTraps && state.fog.known.get(axialKey(cell)) === 'passage_noisy') continue;
      cells[cellIndex(base.grid, cell)] = CELL_FLOOR;
    }
  }
  for (const monster of state.monsters) {
    if (seen(state, monster)) cells[cellIndex(base.grid, monster.pos)] = CELL_WALL;
  }
  // 脚下可能被听到的陷阱或怪物覆盖，但它必须可走，否则 A* 直接返回 null。
  cells[cellIndex(base.grid, state.player.pos)] = CELL_FLOOR;
  return { cells, grid: base.grid };
}

/** 前沿 = 已知可走、且还挨着未知格的格子。多走一步换一列右进都值得（§9.2 出口在入口对边）。 */
function pickFrontier(state: GameState, grid: CellGrid): Axial | null {
  const distances = bfsDistances(grid, state.player.pos);
  let best: Axial | null = null;
  let bestScore = Infinity;
  for (const [key, distance] of distances) {
    if (distance === 0) continue;
    const cell = parseAxialKey(key);
    if (!hasUnknownNeighbor(state, cell)) continue;
    const score = distance - axialToOffset(cell).col;
    if (score < bestScore) {
      best = cell;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 出口还没探明就朝前沿推进；探明了就直接过去。
 * 先绕开听到的陷阱，绕不过去就认赔踩上去——否则唯一通路是陷阱时会永久卡死。
 */
function exploreRoute(state: GameState): Axial[] {
  for (const avoidTraps of [true, false]) {
    const grid = knownGrid(state, avoidTraps);
    if (standable(state, state.level.exit)) {
      const path = findPath(grid, state.player.pos, state.level.exit);
      if (path && path.length > 1) return path;
    }
    const frontier = pickFrontier(state, grid);
    if (!frontier) continue;
    const path = findPath(grid, state.player.pos, frontier);
    if (path && path.length > 1) return path;
  }
  return [];
}

interface RouteCache {
  turn: number;
  path: Axial[];
  index: number;
}

/**
 * 怪物只在回合末移动，所以同一回合内复用一条路线。
 * 位置对不上、或路线已走完（explore 沿途探听出了新格）就重算。
 */
function stepAlong(state: GameState, route: RouteCache, policy: Policy): Axial | null {
  const current = route.path[route.index];
  const exhausted = route.index >= route.path.length - 1;
  if (route.turn !== state.turn || !current || exhausted || !axialEquals(current, state.player.pos)) {
    route.turn = state.turn;
    route.path = policy === 'explore' ? exploreRoute(state) : routeToExit(state);
    route.index = 0;
  }
  const next = route.path[route.index + 1];
  if (!next) return null;
  route.index++;
  return next;
}

/** 策略层判断「这张卡此刻值不值得打」，不是规则。 */
function worthPlaying(state: GameState, card: CardDef, policy: Policy): boolean {
  const nearest = nearestMonster(state);
  const distance = nearest ? hexDistance(state.player.pos, nearest.pos) : Infinity;
  switch (card.effect.kind) {
    case 'damage':
      return resolveCardTarget(state, card).monster !== null;
    case 'heal':
      return state.player.hp < 40;
    case 'removeDebuff':
      return state.buffs.some((buff) => buff.kind === 'bleed' || buff.kind === 'poison');
    case 'buff':
      return distance <= 2;
    case 'clearScentAround':
      return policy === 'escape' && state.monsters.some((monster) => monster.state === 'chase');
    case 'downgradeMonster':
    case 'freezeMonster':
      return policy === 'escape' && distance <= 3;
    // 探听与换骰只改变信息与骰面，模拟不消费这些信息，打了纯亏移动点。
    case 'extraListen':
    case 'rerollDie':
      return false;
    default:
      return false;
  }
}

function cardIntent(state: GameState, policy: Policy): GameIntent | null {
  const nearest = nearestMonster(state);
  const targetKey = nearest ? axialKey(nearest.pos) : undefined;
  const candidates = state.hand
    .filter((held) => worthPlaying(state, held.def, policy))
    .sort((a, b) => a.def.cost - b.def.cost);

  for (const held of candidates) {
    // 出牌把整颗骰子移出移动点池，所以取最小够用的骰子，损失最小。
    const die = state.dice
      .filter((item) => !item.reserved && item.value >= held.def.cost)
      .sort((a, b) => a.value - b.value)[0];
    if (!die) continue;
    const key = held.def.needsTarget ? targetKey : undefined;
    if (resolveCardTarget(state, held.def, key).error) continue;
    return { type: 'playCard', cardUid: held.uid, dieId: die.id, targetKey: key };
  }
  return null;
}

/** 策略只产意图，所有判定与结算都交给 reduceGame。返回 null 表示本回合不再动作。 */
function nextIntent(state: GameState, policy: Policy, route: RouteCache): GameIntent | null {
  if (policy !== 'run') {
    const card = cardIntent(state, policy);
    if (card) return card;
  }

  if (policy === 'escape') {
    const nearest = nearestMonster(state);
    const distance = nearest ? hexDistance(state.player.pos, nearest.pos) : Infinity;
    // 静止两回合 + 低气味区才会让追击降级（brain.updatePerception）。
    if (distance <= 3 && state.stationaryTurns < 2) return null;
  }

  // 探听只揭示六邻格：同一位置听第二次没有新信息，别白扔移动点。
  if (canListen(state).ok && hasUnknownNeighbor(state, state.player.pos)) {
    return { type: 'listen' };
  }
  if (movementPointsOf(state) < 1) return null;

  if (policy === 'fight' || policy === 'explore') {
    // 近战每回合限 1 次（§6.5），用完就不再往怪格里撞。
    const adjacent = state.meleeUsed
      ? undefined
      : state.monsters.find(
          (monster) =>
            hexDistance(state.player.pos, monster.pos) <= 1 &&
            (policy === 'fight' || seen(state, monster)),
        );
    if (adjacent) return { type: 'move', target: adjacent.pos };
  }

  const step = stepAlong(state, route, policy);
  if (!step || !canMove(state, step).ok) return null;
  return { type: 'move', target: step };
}

/**
 * 单局模拟：驱动正式的 createGame + reduceGame，不另写一套近似规则，
 * 所以卡牌、掉落、buff、自动结束回合全都真实生效，结论对游戏本身有效。
 */
export function simulateRun(
  seed: number,
  policy: Policy,
  options: SimOptions = {},
): RunResult {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  let state = createGame(seed, options.params);
  if (options.duel) state = setUpDuel(state);
  const level = state.level;
  const route: RouteCache = { turn: 0, path: [], index: 0 };

  let monsterDamage = 0;
  let trapInstant = 0;
  let trapTriggers = 0;
  let dotDamage = 0;
  let engagements = 0;
  let kills = 0;
  let cardsPlayed = 0;
  const cardUsage: Record<string, number> = {};
  const damageByMonster: Record<string, number> = {};
  let turnsInChase = 0;
  let wasChasing = false;
  let chaseEndedByEscape = false;
  let minDistance = Infinity;
  let distanceSum = 0;
  let distanceSamples = 0;

  const record = (next: GameState, before: GameState, intent: GameIntent): void => {
    let eventDamage = 0;
    let eventHeal = 0;
    for (const event of next.events) {
      switch (event.type) {
        case 'monsterAttacked':
          monsterDamage += event.damage;
          eventDamage += event.damage;
          damageByMonster[event.monsterName] =
            (damageByMonster[event.monsterName] ?? 0) + event.damage;
          break;
        case 'bossAoE':
          monsterDamage += event.damage;
          eventDamage += event.damage;
          damageByMonster['守卫'] = (damageByMonster['守卫'] ?? 0) + event.damage;
          break;
        case 'playerTrapped':
          trapTriggers++;
          trapInstant += event.damage;
          eventDamage += event.damage;
          break;
        case 'playerHealed':
          eventHeal += event.amount;
          break;
        case 'playerAttacked':
          engagements++;
          break;
        case 'monsterDied':
          kills++;
          break;
        default:
          break;
      }
    }
    // 流血/中毒在回合末扣血但不发事件（§4.2），用血量残差还原；负残差是过量击杀。
    dotDamage += Math.max(0, before.player.hp - next.player.hp + eventHeal - eventDamage);

    if (intent.type === 'playCard') {
      cardsPlayed++;
      const held = before.hand.find((item) => item.uid === intent.cardUid);
      if (held) cardUsage[held.def.id] = (cardUsage[held.def.id] ?? 0) + 1;
    }
  };

  while (state.status === 'playing' && state.turn <= maxTurns) {
    const turn = state.turn;
    for (;;) {
      const intent = nextIntent(state, policy, route);
      if (!intent) break;
      const before = state;
      const next = reduceGame(state, intent);
      // reject 会原样带上一次转移的 events，读了就会重复计数。
      if (next.notice !== null) break;
      state = next;
      record(next, before, intent);
      if (state.status !== 'playing') break;
    }

    // 点数耗尽时 reduceGame 已自动结束回合，不要再补一次。
    if (state.status === 'playing' && state.turn === turn) {
      const before = state;
      state = reduceGame(state, { type: 'endTurn' });
      record(state, before, { type: 'endTurn' });
    }

    const chasing = state.monsters.some((monster) => monster.state === 'chase');
    if (chasing) turnsInChase++;
    else if (wasChasing) chaseEndedByEscape = true;
    wasChasing = chasing;

    const nearest = nearestMonster(state);
    const distance = nearest ? hexDistance(state.player.pos, nearest.pos) : Infinity;
    if (distance < minDistance) minDistance = distance;
    if (Number.isFinite(distance)) {
      distanceSum += distance;
      distanceSamples++;
    }
  }

  const floorCells = countFloorCells(level);
  const trapDamage = trapInstant + dotDamage;
  return {
    seed: level.seed,
    policy,
    status: state.status,
    reachedExit: state.status === 'won',
    turns: Math.min(state.turn, maxTurns),
    turnsInChase,
    damageTaken: monsterDamage + trapDamage,
    monsterDamage,
    chaseEndedByEscape,
    minDistance: Number.isFinite(minDistance) ? minDistance : 0,
    avgDistance: distanceSamples > 0 ? distanceSum / distanceSamples : 0,
    engagements,
    kills,
    cardsPlayed,
    cardUsage,
    damageByMonster,
    fill: floorCells / (level.width * level.height),
    cycles: countFloorEdges(level) - floorCells + 1,
    deadEnds: countDeadEnds(level),
    pathLength: level.mainPath.length - 1,
    trapTriggers,
    trapDamage,
  };
}

export function runBalance(
  policy: Policy,
  seeds: number,
  options: SimOptions = {},
): BalanceReport {
  const results: RunResult[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    results.push(simulateRun(seed, policy, options));
  }
  const avg = (pick: (result: RunResult) => number) =>
    results.reduce((sum, result) => sum + pick(result), 0) / results.length;
  const rate = (test: (result: RunResult) => boolean) =>
    results.filter(test).length / results.length;

  const cardUsage: Record<string, number> = {};
  const damageByMonster: Record<string, number> = {};
  for (const result of results) {
    for (const [id, count] of Object.entries(result.cardUsage)) {
      cardUsage[id] = (cardUsage[id] ?? 0) + count;
    }
    for (const [name, damage] of Object.entries(result.damageByMonster)) {
      damageByMonster[name] = (damageByMonster[name] ?? 0) + damage;
    }
  }

  return {
    policy,
    runs: results.length,
    reachedExitRate: rate((r) => r.reachedExit),
    deathRate: rate((r) => r.status === 'lost'),
    timeoutRate: rate((r) => r.status === 'playing'),
    avgTurns: avg((r) => r.turns),
    avgDamage: avg((r) => r.damageTaken),
    avgMonsterDamage: avg((r) => r.monsterDamage),
    avgChaseTurns: avg((r) => r.turnsInChase),
    chaseEndRate: rate((r) => r.chaseEndedByEscape),
    avgMinDistance: avg((r) => r.minDistance),
    avgEngagements: avg((r) => r.engagements),
    avgKills: avg((r) => r.kills),
    avgCardsPlayed: avg((r) => r.cardsPlayed),
    cardUsage,
    damageByMonster,
    avgFill: avg((r) => r.fill),
    avgCycles: avg((r) => r.cycles),
    avgDeadEnds: avg((r) => r.deadEnds),
    avgPathLength: avg((r) => r.pathLength),
    avgTrapTriggers: avg((r) => r.trapTriggers),
    avgTrapDamage: avg((r) => r.trapDamage),
  };
}

export interface DuelReport {
  runs: number;
  /** 守卫战失败率（§15 目标 30%–50%）。 */
  failureRate: number;
  avgTurns: number;
  avgDamage: number;
}

/** 守卫单挑：满血玩家 vs 守卫，用来单独校准 Boss 数值，不被地图与游荡怪干扰。 */
export function runBossDuel(seeds: number, policy: Policy = 'fight'): DuelReport {
  const results: RunResult[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    results.push(simulateRun(seed, policy, { duel: true }));
  }
  const avg = (pick: (result: RunResult) => number) =>
    results.reduce((sum, result) => sum + pick(result), 0) / results.length;
  return {
    runs: results.length,
    failureRate: results.filter((result) => result.status !== 'won').length / results.length,
    avgTurns: avg((result) => result.turns),
    avgDamage: avg((result) => result.damageTaken),
  };
}
