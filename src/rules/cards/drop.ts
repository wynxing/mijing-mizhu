import { Rng32 } from '../../core/rng';
import type { HandCard } from '../turn/types';
import { CARDS, STARTING_HAND } from './content';

/** 手牌上限：满了就不再掉落。 */
export const HAND_LIMIT = 15;

/** 掉落池 = 不在初始牌组里的普通卡。 */
export const DROP_POOL = CARDS.filter((card) => !STARTING_HAND.includes(card.id));

export interface CardDrop {
  card: HandCard;
  rngState: number;
}

/** 击杀掉落：手牌未满时从池中均匀抽一张，消耗一次随机数。 */
export function drawCard(
  hand: readonly HandCard[],
  rngState: number,
  turn: number,
): CardDrop | null {
  if (hand.length >= HAND_LIMIT) return null;
  const rng = new Rng32(rngState);
  const roll = rng.next();
  const def = DROP_POOL[Math.floor(roll * DROP_POOL.length)];
  const salt = Math.floor(roll * 0x100000000).toString(36);
  return {
    card: { uid: `${def.id}-drop-${turn}-${hand.length}-${salt}`, def },
    rngState: rng.state,
  };
}
