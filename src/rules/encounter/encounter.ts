import { Rng32 } from '../../core/rng';
import { mergeBuff, type Buff } from '../buffs/buffs';
import { cardDef } from '../cards/content';
import { drawCard } from '../cards/drop';
import type { GameEvent } from '../turn/events';
import type { GameState } from '../turn/types';
import type { Question } from './questions';

/** 答对回血（§8.2 初值）。 */
export const ENCOUNTER_HEAL = 20;
/** 答错扣血 = 15% 最大 HP（向下取整）。 */
export const WRONG_HP_RATIO = 0.15;
/** 手牌 ≤ 3 张时不再扣卡，惩罚强制改为扣血。 */
export const MIN_HAND_FOR_CARD_PENALTY = 3;
/** 连答 3 题额外抽 2 张普通卡。 */
export const STREAK_TARGET = 3;
export const STREAK_CARDS = 2;
/** 答对奖励的临时 buff 与宝箱同池（§8.1 / §8.2）。 */
const REWARD_BUFF_CARDS = ['battlecry', 'stance', 'swift'] as const;

export interface EncounterResult {
  state: GameState;
  events: GameEvent[];
  /** 规则层不拼装日志文案数组，交给 reducer 统一 pushLog。 */
  log: string[];
}

function buffFrom(cardId: string): Buff | null {
  const card = cardDef(cardId);
  if (card.effect.kind !== 'buff') return null;
  return {
    id: card.id,
    kind: card.effect.buff,
    name: card.name,
    turns: card.effect.turns,
    amount: card.effect.amount,
  };
}

/** 首次交互固定题目：随机取一道，之后存进 GameState.encounter 不再变（§8.2）。 */
export function pickQuestion(
  bank: readonly Question[],
  rngState: number,
): { question: Question; rngState: number } {
  const rng = new Rng32(rngState);
  return { question: bank[rng.int(0, bank.length - 1)], rngState: rng.state };
}

/** 回答一道题并结算奖惩。调用方负责先过 canAnswerEncounter。 */
export function settleAnswer(state: GameState, choice: boolean): EncounterResult {
  const encounter = state.encounter!;
  const resolvedEncounter = { ...encounter, resolved: true, correct: choice === encounter.question.answer };
  const settledRooms = state.roomStates.map((room, index) =>
    index === encounter.roomIndex ? { settled: true } : room,
  );
  const base: GameState = {
    ...state,
    roomStates: settledRooms,
    encounter: resolvedEncounter,
    notice: null,
  };
  const events: GameEvent[] = [];
  const log: string[] = [];

  if (choice !== encounter.question.answer) {
    const rng = new Rng32(state.rngState);
    let next: GameState = { ...base, answerStreak: 0, rngState: rng.state };
    const penalizedByCard = rng.next() < 0.5;
    if (penalizedByCard && next.hand.length > MIN_HAND_FOR_CARD_PENALTY) {
      const candidates = next.hand.filter((card) => card.uid !== next.restLockUid);
      if (candidates.length > 0) {
        const lost = candidates[rng.int(0, candidates.length - 1)];
        next = {
          ...next,
          hand: next.hand.filter((card) => card.uid !== lost.uid),
          rngState: rng.state,
        };
        log.push(`你答错了，失去了「${lost.def.name}」`);
        return { state: next, events, log };
      }
    }
    const damage = Math.floor(state.player.maxHp * WRONG_HP_RATIO);
    const hp = Math.max(0, state.player.hp - damage);
    next = {
      ...next,
      player: { ...next.player, hp },
      status: hp <= 0 ? 'lost' : next.status,
    };
    log.push(`你答错了，失去 ${damage} 点体力`);
    return { state: next, events, log };
  }

  const rng = new Rng32(state.rngState);
  let next: GameState = { ...base, rngState: rng.state };
  const reward = rng.int(0, 2);
  if (reward === 1) {
    const hp = Math.min(next.player.maxHp, next.player.hp + ENCOUNTER_HEAL);
    const healed = hp - next.player.hp;
    if (healed > 0) events.push({ type: 'playerHealed', amount: healed });
    next = { ...next, player: { ...next.player, hp } };
    log.push(`你答对了，回复 ${healed} 点体力`);
  } else if (reward === 2) {
    const buff = buffFrom(REWARD_BUFF_CARDS[rng.int(0, REWARD_BUFF_CARDS.length - 1)]);
    if (buff) {
      events.push({ type: 'playerBuffed', name: buff.name });
      next = { ...next, buffs: mergeBuff(next.buffs, buff) };
      log.push(`你答对了，获得「${buff.name}」`);
    }
  } else {
    const drop = drawCard(next.hand, rng.state, next.turn);
    if (drop) {
      next = { ...next, hand: [...next.hand, drop.card], rngState: drop.rngState };
      log.push(`你答对了，获得「${drop.card.def.name}」`);
    } else {
      next = { ...next, rngState: rng.state };
      log.push('你答对了，但手牌已满');
    }
  }

  const streak = state.answerStreak + 1;
  if (streak < STREAK_TARGET) {
    return { state: { ...next, answerStreak: streak }, events, log };
  }

  // 连答 3 题：额外抽 2 张普通卡，计数归零。
  let hand = next.hand;
  let rngState = next.rngState;
  const gained: string[] = [];
  for (let i = 0; i < STREAK_CARDS; i++) {
    const drop = drawCard(hand, rngState, next.turn);
    if (!drop) break;
    hand = [...hand, drop.card];
    rngState = drop.rngState;
    gained.push(drop.card.def.name);
  }
  if (gained.length > 0) log.push(`连答三题！额外获得「${gained.join('」「')}」`);
  return {
    state: { ...next, hand, rngState, answerStreak: 0 },
    events,
    log,
  };
}

/** 消耗一张手牌换线索；每题限一次（§8.2）。 */
export function useHint(state: GameState, cardUid: string): EncounterResult | null {
  const encounter = state.encounter;
  if (!encounter || encounter.hintUsed) return null;
  const card = state.hand.find((item) => item.uid === cardUid);
  if (!card) return null;
  return {
    state: {
      ...state,
      hand: state.hand.filter((item) => item.uid !== cardUid),
      encounter: { ...encounter, hintUsed: true },
      notice: null,
    },
    events: [],
    log: ['你撕下一张卡，换来一条线索'],
  };
}
