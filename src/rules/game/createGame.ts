import { Rng32 } from '../../core/rng';
import { DEFAULT_GEN_PARAMS, type LevelGenParams } from '../generation/generator';
import { generateValidLevel } from '../generation/validate';
import { rollDice } from '../dice/dice';
import { createFog, markVisited } from '../fog/fog';
import type { GameState } from '../turn/types';

export const PLAYER_MAX_HP = 100;

export function createGame(seed: number, params?: Partial<LevelGenParams>): GameState {
  const level = generateValidLevel({ ...DEFAULT_GEN_PARAMS, ...params, seed });
  const rng = new Rng32(level.seed);
  const dice = rollDice(rng);

  return {
    level,
    player: { pos: level.start, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP },
    turn: 1,
    phase: 'player',
    status: 'playing',
    dice,
    spentPoints: 0,
    listenUsed: 0,
    fog: markVisited(createFog(), level.start),
    log: [{ text: '你踏入漆黑的迷宫', turn: 1 }],
    notice: null,
    rngState: rng.state,
    seed: level.seed,
  };
}
