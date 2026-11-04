import { Rng32 } from '../../core/rng';

export const DICE_COUNT = 3;
export const DICE_FACES = 6;

export interface Die {
  id: number;
  value: number;
  /** 是否已从移动点池中预留出来（阶段 0 的预留槽暂无用途）。 */
  reserved: boolean;
}

export function rollDice(rng: Rng32): Die[] {
  const dice: Die[] = [];
  for (let i = 0; i < DICE_COUNT; i++) {
    dice.push({ id: i, value: rng.int(1, DICE_FACES), reserved: false });
  }
  return dice;
}

/** 移动点 = 未预留骰子的面值之和 − 已花点。派生值不单独存储。 */
export function movementPoints(dice: readonly Die[], spentPoints: number): number {
  let sum = 0;
  for (const die of dice) {
    if (!die.reserved) sum += die.value;
  }
  return sum - spentPoints;
}

export function findDie(dice: readonly Die[], id: number): Die | undefined {
  return dice.find((die) => die.id === id);
}

export function reserveDie(dice: readonly Die[], id: number): Die[] {
  return dice.map((die) => (die.id === id ? { ...die, reserved: true } : die));
}

export function unreserveDie(dice: readonly Die[], id: number): Die[] {
  return dice.map((die) => (die.id === id ? { ...die, reserved: false } : die));
}
