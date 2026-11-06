import type { Axial } from '../grid/geometry';

/**
 * 一次状态转移产生的可演出事件。
 *
 * 规则层只描述「发生了什么」，表现层决定「怎么演出」——
 * 时长、缓动、颜色都不属于规则层。事件进入 GameState.events，
 * 每次转移整体替换（而不是追加），snapshotGame 不哈希该字段，
 * 因此不影响回放与平衡模拟的确定性。
 */
export type GameEvent =
  /** 玩家走了一格。 */
  | { type: 'playerMoved'; from: Axial; to: Axial }
  /** 玩家攻击怪物。damage 是最终伤害，killed 表示这一击致命。 */
  | {
      type: 'playerAttacked';
      monsterUid: string;
      monsterName: string;
      target: Axial;
      damage: number;
      killed: boolean;
    }
  | { type: 'playerHealed'; amount: number }
  | { type: 'playerBuffed'; name: string }
  /** 踩中陷阱：固定伤害，并随机附带流血或中毒。 */
  | { type: 'playerTrapped'; at: Axial; damage: number; debuff: 'bleed' | 'poison' }
  /** 怪物走位（也用于击退）。 */
  | { type: 'monsterMoved'; monsterUid: string; from: Axial; to: Axial }
  /** 怪物攻击玩家。avoided 表示被闪避或免疫，damage 此时为 0。 */
  | {
      type: 'monsterAttacked';
      monsterUid: string;
      monsterName: string;
      target: Axial;
      damage: number;
      avoided: boolean;
    }
  | { type: 'monsterDied'; monsterUid: string; monsterName: string; at: Axial };
