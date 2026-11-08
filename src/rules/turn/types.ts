import type { Axial, AxialKey } from '../grid/geometry';
import type { Level } from '../generation/generator';
import type { Die } from '../dice/dice';
import type { FogState } from '../fog/fog';
import type { ScentState } from '../fog/scent';
import type { Monster } from '../monsters/brain';
import type { Buff } from '../buffs/buffs';
import type { CardDef } from '../cards/content';
import type { Question } from '../encounter/questions';
import type { GameEvent } from './events';

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

/** 房间的局内状态。交互与奖励只结算一次（§8.1）。 */
export interface RoomState {
  settled: boolean;
}

/** 奇遇房正在进行的问答（§8.2）。每房首次交互固定题目，只结算一次。 */
export interface EncounterState {
  roomIndex: number;
  question: Question;
  /** 提示每题限一次。 */
  hintUsed: boolean;
  resolved: boolean;
  /** 结算结果；未结算为 null。面板据此显示奖励还是惩罚。 */
  correct: boolean | null;
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
  /** 与 level.rooms 同序的房间结算状态。 */
  roomStates: RoomState[];
  /** 休整房锁定的卡牌 uid（扣卡时豁免）。存 uid 而不是下标：扣卡后下标会错位。 */
  restLockUid: string | null;
  /** 奇遇房当前题目；离开房间也不丢，回到房间继续答。 */
  encounter: EncounterState | null;
  /** 当前可用的题库（内置或注入后的合法子集）。 */
  questionBank: Question[];
  /** 奇遇连答计数：连续答对 3 题给额外奖励后归零。 */
  answerStreak: number;
  monsters: Monster[];
  buffs: Buff[];
  /** 本回合有没有移动过（静止是甩开追击的关键）。 */
  movedThisTurn: boolean;
  /** 本回合是否已经近战过（每回合最多 1 次，§6.5）。 */
  meleeUsed: boolean;
  /** 连续未移动的回合数。 */
  stationaryTurns: number;
  log: LogEntry[];
  notice: string | null;
  /**
   * 最近一次状态转移产生的演出事件，每次转移整体替换。
   * 表现层据此播放动画；规则层自身不读它。
   */
  events: GameEvent[];
  rngState: number;
  seed: number;
}

export type GameIntent =
  | { type: 'move'; target: Axial }
  | { type: 'listen' }
  /** 结算脚下房间的交互（宝箱 / 休整 / 奇遇）。 */
  | { type: 'interact' }
  /** 替换题库（store 的注入缝）；规则层做 schema 过滤（§8.3）。 */
  | { type: 'setQuestionBank'; questions: unknown }
  | { type: 'answerQuestion'; choice: boolean }
  /** 消耗一张手牌换该题的线索；每题一次。 */
  | { type: 'useHint'; cardUid: string }
  | { type: 'playCard'; cardUid: string; dieId: number; targetKey?: AxialKey }
  | { type: 'reserveDie'; dieId: number }
  | { type: 'unreserveDie'; dieId: number }
  | { type: 'endTurn' }
  | { type: 'restart'; seed?: number };
