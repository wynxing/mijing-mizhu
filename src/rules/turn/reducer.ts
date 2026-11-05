import { Rng32 } from '../../core/rng';
import { areAdjacent, axialKey, hexDistance, neighbor, type Axial, type AxialKey } from '../grid/geometry';
import { isWalkableAtLevel } from '../generation/generator';
import { markVisited, mergeListenResults } from '../fog/fog';
import { LISTEN_MOVEMENT_COST, LISTEN_PER_TURN, resolveListen } from '../fog/listen';
import { addScent, clearScentAround, decayScent } from '../fog/scent';
import { findDie, movementPoints, reserveDie, rollDice, unreserveDie } from '../dice/dice';
import { actMonster, rollIntent, updatePerception, type Monster } from '../monsters/brain';
import { expireAtTurnEnd, mergeBuff, tickBuffs, type Buff } from '../buffs/buffs';
import { damageDealt, hitPlayer, playerAttack } from '../combat/combat';
import { cardDef, type CardDef } from '../cards/content';
import type { GameIntent, GameState, LogEntry } from './types';
import { createGame } from '../game/createGame';

export interface ActionCheck {
  ok: boolean;
  reason: string | null;
}

const OK: ActionCheck = { ok: true, reason: null };

export function movementPointsOf(state: GameState): number {
  return movementPoints(state.dice, state.spentPoints);
}

function pushLog(log: LogEntry[], text: string, turn: number): LogEntry[] {
  return [...log, { text, turn }].slice(-5);
}

function reject(state: GameState, reason: string): GameState {
  return { ...state, notice: reason };
}

export function canMove(state: GameState, target: { q: number; r: number }): ActionCheck {
  if (state.status !== 'playing') return { ok: false, reason: '本局已结束' };
  if (state.phase !== 'player') return { ok: false, reason: '当前不在玩家回合' };
  if (movementPointsOf(state) < 1) return { ok: false, reason: '移动点不足' };
  if (!areAdjacent(state.player.pos, target)) return { ok: false, reason: '只能移动到相邻格' };
  const monster = monsterAt(state, target);
  if (!monster) {
    if (!isWalkableAtLevel(state.level, target)) return { ok: false, reason: '该方向有墙' };
    return OK;
  }
  // 近战：消耗 1 移动点造成基础攻击力伤害
  return OK;
}

export function canListen(state: GameState): ActionCheck {
  if (state.status !== 'playing') return { ok: false, reason: '本局已结束' };
  if (state.phase !== 'player') return { ok: false, reason: '当前不在玩家回合' };
  if (movementPointsOf(state) < LISTEN_MOVEMENT_COST) {
    return { ok: false, reason: '移动点不足' };
  }
  if (state.listenUsed >= listenLimit(state)) {
    return { ok: false, reason: `本回合探听次数已用尽（上限 ${listenLimit(state)}）` };
  }
  return OK;
}

export function listenLimit(state: GameState): number {
  return LISTEN_PER_TURN + state.listenBonus;
}

/** 还有没有可执行的动作：能动、能探听、能出牌，或能取消预留。 */
export function hasLegalAction(state: GameState): boolean {
  if (state.status !== 'playing') return false;
  if (movementPointsOf(state) >= 1) return true;
  if (state.dice.some((die) => die.reserved)) return true;
  return state.hand.some((card) =>
    state.dice.some((die) => !die.reserved && die.value >= card.def.cost),
  );
}

function monsterAt(state: GameState, cell: Axial): Monster | undefined {
  const key = axialKey(cell);
  return state.monsters.find((monster) => axialKey(monster.pos) === key);
}

/** 是否在同一条直线上（投石这类远程直线卡）。 */
function inStraightLine(from: Axial, to: Axial): boolean {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  return dq === 0 || dr === 0 || dq + dr === 0;
}

/** 找一张攻击卡的合法目标：范围内、同一直线上的最近怪物。 */
function findAttackTarget(state: GameState, range: number): Monster | null {
  const candidates = state.monsters
    .filter((monster) => {
      const distance = hexDistance(state.player.pos, monster.pos);
      if (distance > range) return false;
      return range === 1 || inStraightLine(state.player.pos, monster.pos);
    })
    .sort(
      (a, b) =>
        hexDistance(state.player.pos, a.pos) - hexDistance(state.player.pos, b.pos),
    );
  return candidates[0] ?? null;
}

export interface CardTarget {
  monster: Monster | null;
  error: string | null;
}

export function resolveCardTarget(
  state: GameState,
  card: CardDef,
  targetKey?: AxialKey,
): CardTarget {
  if (card.needsTarget) {
    if (!targetKey) return { monster: null, error: '需要指定目标' };
    const monster = state.monsters.find((item) => axialKey(item.pos) === targetKey);
    if (!monster) return { monster: null, error: '目标不存在' };
    return { monster, error: null };
  }
  if (card.effect.kind === 'damage') {
    const monster = findAttackTarget(state, card.effect.range);
    if (!monster) return { monster: null, error: '射程内没有目标' };
    return { monster, error: null };
  }
  return { monster: null, error: null };
}

/** 出牌：消耗一颗骰子与一张卡，执行效果。 */
export function applyCard(
  state: GameState,
  card: CardDef,
  cardUid: string,
  dieId: number,
  targetKey?: AxialKey,
): { state: GameState; error: string | null } {
  const die = findDie(state.dice, dieId);
  if (!die) return { state, error: '没有这颗骰子' };
  if (die.reserved) return { state, error: '这颗骰子已经用掉了' };
  if (die.value < card.cost) return { state, error: `需要一颗不小于 ${card.cost} 点的骰子` };

  const { monster, error } = resolveCardTarget(state, card, targetKey);
  if (error) return { state, error };

  let next: GameState = {
    ...state,
    hand: state.hand.filter((item) => item.uid !== cardUid),
    dice: state.dice.map((item) => (item.id === dieId ? { ...item, reserved: true } : item)),
    notice: null,
  };

  switch (card.effect.kind) {
    case 'damage': {
      if (!monster) return { state, error: '射程内没有目标' };
      const amount = damageDealt(card.effect.amount + damageBonus(state.buffs));
      const struck = applyDamageToMonster(next, monster, amount);
      const survived = struck.monsters.some(
        (item) => axialKey(item.pos) === axialKey(monster.pos),
      );
      // 击退只对活着的目标有意义
      const pushed =
        survived && card.effect.knockback > 0
          ? knockback(struck, monster, card.effect.knockback)
          : struck;
      next = {
        ...pushed,
        log: pushLog(pushed.log, `你用「${card.name}」造成 ${amount} 点伤害`, pushed.turn),
      };
      break;
    }
    case 'heal': {
      const hp = Math.min(state.player.maxHp, state.player.hp + card.effect.amount);
      next = {
        ...next,
        player: { ...next.player, hp },
        log: pushLog(next.log, `你用「${card.name}」回复 ${hp - state.player.hp} 点体力`, next.turn),
      };
      break;
    }
    case 'buff': {
      const buff: Buff = {
        id: card.id,
        kind: card.effect.buff,
        name: card.name,
        turns: card.effect.turns,
        amount: card.effect.amount,
      };
      next = {
        ...next,
        buffs: mergeBuff(next.buffs, buff),
        log: pushLog(next.log, `你获得「${card.name}」`, next.turn),
      };
      break;
    }
    case 'removeDebuff': {
      next = {
        ...next,
        log: pushLog(next.log, `你用「${card.name}」清除了负面状态`, next.turn),
      };
      break;
    }
    case 'clearScentAround': {
      const scent = clearScentAround(next.scent, next.player.pos);
      const monsters = next.monsters.map((item) =>
        areAdjacent(item.pos, next.player.pos) && item.state !== 'wander'
          ? { ...item, state: 'alert' as const, lastKnown: next.player.pos }
          : item,
      );
      next = {
        ...next,
        scent,
        monsters,
        log: pushLog(next.log, '你屏住呼吸，气味被抹去', next.turn),
      };
      break;
    }
    case 'downgradeMonster': {
      if (!monster) return { state, error: '目标不存在' };
      next = {
        ...next,
        monsters: next.monsters.map((item) =>
          axialKey(item.pos) === axialKey(monster.pos)
            ? { ...item, state: 'wander' as const, lastKnown: null }
            : item,
        ),
        log: pushLog(next.log, `「${card.name}」让一只怪物失去了方向`, next.turn),
      };
      break;
    }
    case 'freezeMonster': {
      if (!monster) return { state, error: '目标不存在' };
      next = {
        ...next,
        monsters: next.monsters.map((item) =>
          axialKey(item.pos) === axialKey(monster.pos)
            ? { ...item, frozen: true }
            : item,
        ),
        log: pushLog(next.log, `「${card.name}」定住了一只怪物`, next.turn),
      };
      break;
    }
    case 'extraListen': {
      next = {
        ...next,
        listenBonus: next.listenBonus + card.effect.amount,
        log: pushLog(next.log, `「${card.name}」让你听得更远`, next.turn),
      };
      break;
    }
    case 'rerollDie': {
      const rng = new Rng32(state.rngState);
      const value = rng.int(1, 6);
      next = {
        ...next,
        dice: next.dice.map((item) =>
          item.id === dieId ? { ...item, value, reserved: false } : item,
        ),
        rngState: rng.state,
        log: pushLog(next.log, `你换了一颗骰子（${value} 点）`, next.turn),
      };
      break;
    }
    default:
      break;
  }

  return { state: next, error: null };
}

function damageBonus(buffs: readonly Buff[]): number {
  return buffs
    .filter((buff) => buff.kind === 'damageBonus')
    .reduce((sum, buff) => sum + buff.amount, 0);
}

function applyDamageToMonster(state: GameState, monster: Monster, amount: number): GameState {
  const hp = monster.hp - amount;
  if (hp > 0) {
    return {
      ...state,
      monsters: state.monsters.map((item) =>
        axialKey(item.pos) === axialKey(monster.pos) ? { ...item, hp } : item,
      ),
    };
  }
  return {
    ...state,
    monsters: state.monsters.filter((item) => axialKey(item.pos) !== axialKey(monster.pos)),
  };
}

function knockback(state: GameState, monster: Monster, cells: number): GameState {
  let pos = monster.pos;
  for (let i = 0; i < cells; i++) {
    const options = [0, 1, 2, 3, 4, 5]
      .map((dir) => neighbor(pos, dir as 0 | 1 | 2 | 3 | 4 | 5))
      .filter(
        (cell) =>
          isWalkableAtLevel(state.level, cell) &&
          !state.monsters.some((item) => axialKey(item.pos) === axialKey(cell)),
      );
    if (options.length === 0) break;
    options.sort(
      (a, b) =>
        hexDistance(state.player.pos, b) - hexDistance(state.player.pos, a),
    );
    pos = options[0];
  }
  return {
    ...state,
    monsters: state.monsters.map((item) =>
      axialKey(item.pos) === axialKey(monster.pos) ? { ...item, pos } : item,
    ),
  };
}

/** 玩家回合结束 → 结算：怪物行动 → 感知更新 → 预掷意图 → 气味衰减。 */
function endTurn(state: GameState): GameState {
  const rng = new Rng32(state.rngState);
  const map = { cells: state.level.cells, grid: { width: state.level.width, height: state.level.height } };

  let monsters = state.monsters;
  let hp = state.player.hp;
  let log = state.log;

  for (const monster of monsters) {
    const action = actMonster(monster, map, state.player.pos, rng);
    monsters = monsters.map((item) => (item === monster ? action.monster : item));
    if (action.damage > 0) {
      const hit = hitPlayer(action.damage, state.buffs);
      hp -= hit.damage;
      log = pushLog(
        log,
        hit.damage === 0
          ? `${monster.def.name} 的攻击被挡下了`
          : `${monster.def.name} 造成 ${hit.damage} 点伤害`,
        state.turn,
      );
    }
  }

  const stationaryTurns = state.movedThisTurn ? 0 : state.stationaryTurns + 1;
  monsters = monsters.map((monster) =>
    rollIntent(
      updatePerception(monster, state.scent, state.player.pos, stationaryTurns),
      rng,
      state.player.pos,
    ),
  );

  const turn = state.turn + 1;
  const buffs = tickBuffs(expireAtTurnEnd(state.buffs));

  return {
    ...state,
    player: { ...state.player, hp },
    turn,
    phase: 'player',
    status: hp <= 0 ? 'lost' : state.status,
    dice: rollDice(rng),
    spentPoints: 0,
    listenUsed: 0,
    listenBonus: 0,
    movedThisTurn: false,
    stationaryTurns,
    monsters,
    buffs,
    scent: decayScent(state.scent),
    rngState: rng.state,
    log: pushLog(log, '回合结束', state.turn),
    notice: null,
  };
}

/** 纯函数 reducer：所有规则判定都在这里，store 只负责调用。 */
export function reduceGame(state: GameState, intent: GameIntent): GameState {
  if (intent.type === 'restart') {
    return createGame(intent.seed ?? state.seed);
  }

  if (state.status !== 'playing') {
    return reject(state, '本局已结束');
  }

  let next: GameState;

  switch (intent.type) {
    case 'move': {
      const check = canMove(state, intent.target);
      if (!check.ok) return reject(state, check.reason as string);
      const target = intent.target;
      const blocker = monsterAt(state, target);
      const reachedExit = axialKey(target) === axialKey(state.level.exit);

      if (blocker) {
        // 近战：消耗 1 移动点，怪没死就被拦住
        const amount = damageDealt(playerAttack(state.buffs));
        const struck = applyDamageToMonster(state, blocker, amount);
        const survived = struck.monsters.some(
          (item) => axialKey(item.pos) === axialKey(blocker.pos),
        );
        next = {
          ...struck,
          spentPoints: state.spentPoints + 1,
          status: reachedExit && !survived ? 'won' : state.status,
          log: pushLog(
            state.log,
            survived
              ? `你攻击了${blocker.def.name}，造成 ${amount} 点伤害`
              : `你击杀了${blocker.def.name}`,
            state.turn,
          ),
          notice: null,
        };
        if (!survived) {
          next = {
            ...next,
            player: { ...next.player, pos: target },
            fog: markVisited(next.fog, target),
            scent: addScent(next.scent, [target]),
            movedThisTurn: true,
            log: reachedExit
              ? pushLog(next.log, '你找到了出口', next.turn)
              : next.log,
          };
        }
        break;
      }

      next = {
        ...state,
        player: { ...state.player, pos: target },
        fog: markVisited(state.fog, target),
        scent: addScent(state.scent, [target]),
        spentPoints: state.spentPoints + 1,
        movedThisTurn: true,
        status: reachedExit ? 'won' : state.status,
        log: pushLog(
          state.log,
          reachedExit ? '你找到了出口' : `你移动到 (${target.q},${target.r})`,
          state.turn,
        ),
        notice: null,
      };
      break;
    }

    case 'listen': {
      const check = canListen(state);
      if (!check.ok) return reject(state, check.reason as string);
      const terrain = {
        cells: state.level.cells,
        grid: { width: state.level.width, height: state.level.height },
        traps: state.level.traps,
      };
      const results = resolveListen(terrain, state.player.pos);
      next = {
        ...state,
        fog: mergeListenResults(state.fog, results),
        spentPoints: state.spentPoints + LISTEN_MOVEMENT_COST,
        listenUsed: state.listenUsed + 1,
        log: pushLog(state.log, '你屏息探听四周', state.turn),
        notice: null,
      };
      break;
    }

    case 'playCard': {
      const held = state.hand.find((item) => item.uid === intent.cardUid);
      if (!held) return reject(state, '没有这张卡');
      const result = applyCard(state, held.def, held.uid, intent.dieId, intent.targetKey);
      if (result.error) return reject(state, result.error);
      next = result.state;
      break;
    }

    case 'reserveDie': {
      const die = findDie(state.dice, intent.dieId);
      if (!die) return reject(state, '没有这颗骰子');
      if (die.reserved) return reject(state, '这颗骰子已经预留');
      // 预留只是把骰子移出移动点池，未预留面值之和自然减少，无需另记花费。
      next = {
        ...state,
        dice: reserveDie(state.dice, intent.dieId),
        notice: null,
      };
      break;
    }

    case 'unreserveDie': {
      const die = findDie(state.dice, intent.dieId);
      if (!die) return reject(state, '没有这颗骰子');
      if (!die.reserved) return reject(state, '这颗骰子没有预留');
      next = {
        ...state,
        dice: unreserveDie(state.dice, intent.dieId),
        notice: null,
      };
      break;
    }

    case 'endTurn': {
      if (state.phase !== 'player') return reject(state, '当前不在玩家回合');
      next = endTurn(state);
      break;
    }

    default: {
      return state;
    }
  }

  // 真正无路可走时自动结束回合；存在预留骰子时不触发，取消预留始终可用。
  if (next.status === 'playing' && !hasLegalAction(next)) {
    next = endTurn(next);
  }

  return next;
}

export { cardDef };
