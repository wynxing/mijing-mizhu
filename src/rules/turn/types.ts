import type { Axial, AxialKey } from '../grid/geometry';
import type { Level } from '../generation/generator';
import type { Die } from '../dice/dice';
import type { FogState } from '../fog/fog';
import type { ScentState } from '../fog/scent';
import type { Monster } from '../monsters/brain';
import type { Buff } from '../buffs/buffs';
import type { CardDef } from '../cards/content';

/** 手牌实例：同名卡有多张，每张都要有唯一标识。 */
export interface HandCard {
  uid: string;
  def: CardDef;
}

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
  /** 本回合的额外探听次数（探查术）。 */
  listenBonus: number;
  fog: FogState;
  /** 气味场：怪物循此移动。 */
  scent: ScentState;
  /** 手牌，打出即消耗。 */
  hand: HandCard[];
  monsters: Monster[];
  buffs: Buff[];
  /** 本回合有没有移动过（静止是甩开追击的关键）。 */
  movedThisTurn: boolean;
  /** 连续未移动的回合数。 */
  stationaryTurns: number;
  log: LogEntry[];
  notice: string | null;
  rngState: number;
  seed: number;
}

export type GameIntent =
  | { type: 'move'; target: Axial }
  | { type: 'listen' }
  | { type: 'playCard'; cardUid: string; dieId: number; targetKey?: AxialKey }
  | { type: 'reserveDie'; dieId: number }
  | { type: 'unreserveDie'; dieId: number }
  | { type: 'endTurn' }
  | { type: 'restart'; seed?: number };
