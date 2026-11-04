import { Rng32 } from '../../core/rng';
import { areAdjacent, axialKey } from '../grid/geometry';
import { isWalkableAtLevel } from '../generation/generator';
import { markVisited, mergeListenResults } from '../fog/fog';
import { LISTEN_MOVEMENT_COST, LISTEN_PER_TURN, resolveListen } from '../fog/listen';
import { findDie, movementPoints, reserveDie, rollDice, unreserveDie } from '../dice/dice';
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
  if (!isWalkableAtLevel(state.level, target)) return { ok: false, reason: '该方向有墙' };
  return OK;
}

export function canListen(state: GameState): ActionCheck {
  if (state.status !== 'playing') return { ok: false, reason: '本局已结束' };
  if (state.phase !== 'player') return { ok: false, reason: '当前不在玩家回合' };
  if (movementPointsOf(state) < LISTEN_MOVEMENT_COST) {
    return { ok: false, reason: '移动点不足' };
  }
  if (state.listenUsed >= LISTEN_PER_TURN) {
    return { ok: false, reason: `本回合探听次数已用尽（上限 ${LISTEN_PER_TURN}）` };
  }
  return OK;
}

/** 还有没有可执行的动作：能动、能探听，或能取消预留。 */
export function hasLegalAction(state: GameState): boolean {
  if (state.status !== 'playing') return false;
  if (movementPointsOf(state) >= 1) return true;
  return state.dice.some((die) => die.reserved);
}

function endTurn(state: GameState): GameState {
  const rng = new Rng32(state.rngState);
  const dice = rollDice(rng);
  const turn = state.turn + 1;
  return {
    ...state,
    turn,
    phase: 'player',
    dice,
    spentPoints: 0,
    listenUsed: 0,
    rngState: rng.state,
    log: pushLog(state.log, '回合结束', state.turn),
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
      const won = axialKey(target) === axialKey(state.level.exit);
      next = {
        ...state,
        player: { ...state.player, pos: target },
        fog: markVisited(state.fog, target),
        spentPoints: state.spentPoints + 1,
        status: won ? 'won' : state.status,
        log: pushLog(
          state.log,
          won ? '你找到了出口' : `你移动到 (${target.q},${target.r})`,
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
