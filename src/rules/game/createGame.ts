import { Rng32 } from '../../core/rng';
import { DEFAULT_GEN_PARAMS, type LevelGenParams } from '../generation/generator';
import { generateValidLevel } from '../generation/validate';
import { rollDice } from '../dice/dice';
import { createFog, markVisited } from '../fog/fog';
import { createScent } from '../fog/scent';
import { createMonster } from '../monsters/brain';
import { monsterDef } from '../monsters/content';
import { STARTING_HAND, cardDef } from '../cards/content';
import { BUILTIN_QUESTIONS } from '../encounter/questions';
import type { GameState } from '../turn/types';

export const PLAYER_MAX_HP = 100;

export function createGame(seed: number, params?: Partial<LevelGenParams>): GameState {
  const level = generateValidLevel({ ...DEFAULT_GEN_PARAMS, ...params, seed });
  const rng = new Rng32(level.seed);
  const dice = rollDice(rng);

  const monsters = level.monsters.map((placement, index) =>
    createMonster(monsterDef(placement.defId), placement.pos, `monster-${index}`),
  );
  const hand = STARTING_HAND.map((id, index) => ({
    uid: `${id}-${index}`,
    def: cardDef(id),
  }));

  return {
    level,
    player: { pos: level.start, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP },
    turn: 1,
    phase: 'player',
    status: 'playing',
    dice,
    spentPoints: 0,
    listenUsed: 0,
    listenBonus: 0,
    fog: markVisited(createFog(), level.start),
    scent: createScent(),
    hand,
    roomStates: level.rooms.map(() => ({ settled: false })),
    restLockUid: null,
    encounter: null,
    questionBank: [...BUILTIN_QUESTIONS],
    answerStreak: 0,
    monsters,
    buffs: [],
    movedThisTurn: false,
    stationaryTurns: 0,
    log: [{ text: '你踏入漆黑的迷宫', turn: 1 }],
    notice: null,
    events: [],
    rngState: rng.state,
    seed: level.seed,
  };
}
