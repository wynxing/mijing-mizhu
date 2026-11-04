import type { Axial } from '../grid/geometry';
import type { Level } from '../generation/generator';
import type { Die } from '../dice/dice';
import type { FogState } from '../fog/fog';

export type GameStatus = 'playing' | 'won' | 'lost';

/** 阶段 0 只有玩家回合；'resolving' 为阶段 1 的怪物结算预留。 */
export type TurnPhase = 'player' | 'resolving';

export interface LogEntry {
  text: string;
  turn: number;
}

export interface PlayerState {
  pos: Axial;
  hp: number;
  maxHp: number;
}

export interface GameState {
  level: Level;
  player: PlayerState;
  turn: number;
  phase: TurnPhase;
  status: GameStatus;
  dice: Die[];
  spentPoints: number;
  listenUsed: number;
  fog: FogState;
  log: LogEntry[];
  notice: string | null;
  rngState: number;
  seed: number;
}

export type GameIntent =
  | { type: 'move'; target: Axial }
  | { type: 'listen' }
  | { type: 'reserveDie'; dieId: number }
  | { type: 'unreserveDie'; dieId: number }
  | { type: 'endTurn' }
  | { type: 'restart'; seed?: number };
