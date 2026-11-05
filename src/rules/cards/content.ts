import type { BuffKind } from '../buffs/buffs';

export type CardType = 'attack' | 'defense' | 'heal' | 'buff' | 'utility';
export type CardRarity = 'common' | 'fine' | 'epic';

export type CardEffect =
  | { kind: 'damage'; amount: number; range: number; knockback: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'buff'; buff: BuffKind; amount: number; turns: number }
  | { kind: 'removeDebuff' }
  | { kind: 'clearScentAround' }
  | { kind: 'downgradeMonster' }
  | { kind: 'freezeMonster' }
  | { kind: 'extraListen'; amount: number }
  | { kind: 'rerollDie' };

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  cost: number;
  rarity: CardRarity;
  /** 需要玩家指定目标（怪物）。 */
  needsTarget: boolean;
  effect: CardEffect;
}

/** 普通卡池，数值来自设计文档 §7.2。 */
export const CARDS: readonly CardDef[] = [
  {
    id: 'strike',
    name: '挥击',
    type: 'attack',
    cost: 1,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'damage', amount: 6, range: 1, knockback: 0 },
  },
  {
    id: 'sling',
    name: '投石',
    type: 'attack',
    cost: 2,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'damage', amount: 8, range: 4, knockback: 0 },
  },
  {
    id: 'maul',
    name: '重锤',
    type: 'attack',
    cost: 3,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'damage', amount: 14, range: 1, knockback: 1 },
  },
  {
    id: 'ironwall',
    name: '铁壁',
    type: 'defense',
    cost: 2,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'buff', buff: 'damageReduction', amount: 4, turns: 1 },
  },
  {
    id: 'dodge',
    name: '闪避',
    type: 'defense',
    cost: 1,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'buff', buff: 'evadeOnce', amount: 1, turns: 1 },
  },
  {
    id: 'potion',
    name: '药剂',
    type: 'heal',
    cost: 2,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'heal', amount: 20 },
  },
  {
    id: 'bandage',
    name: '止血',
    type: 'heal',
    cost: 1,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'removeDebuff' },
  },
  {
    id: 'battlecry',
    name: '战意',
    type: 'buff',
    cost: 2,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'buff', buff: 'damageBonus', amount: 2, turns: 3 },
  },
  {
    id: 'stance',
    name: '铁壁姿态',
    type: 'buff',
    cost: 1,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'buff', buff: 'immunity', amount: 1, turns: 1 },
  },
  {
    id: 'swift',
    name: '疾行',
    type: 'buff',
    cost: 1,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'buff', buff: 'extraMove', amount: 1, turns: 2 },
  },
  {
    id: 'holdbreath',
    name: '屏息',
    type: 'utility',
    cost: 2,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'clearScentAround' },
  },
  {
    id: 'dispel',
    name: '驱散',
    type: 'utility',
    cost: 3,
    rarity: 'common',
    needsTarget: true,
    effect: { kind: 'downgradeMonster' },
  },
  {
    id: 'root',
    name: '定身',
    type: 'utility',
    cost: 2,
    rarity: 'common',
    needsTarget: true,
    effect: { kind: 'freezeMonster' },
  },
  {
    id: 'scout',
    name: '探查术',
    type: 'utility',
    cost: 1,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'extraListen', amount: 3 },
  },
  {
    id: 'reroll',
    name: '换骰',
    type: 'utility',
    cost: 1,
    rarity: 'common',
    needsTarget: false,
    effect: { kind: 'rerollDie' },
  },
];

export function cardDef(id: string): CardDef {
  const found = CARDS.find((card) => card.id === id);
  if (!found) throw new Error(`未知卡牌：${id}`);
  return found;
}

/** 阶段 1 的固定初始牌组（10 张）。 */
export const STARTING_HAND: readonly string[] = [
  'strike',
  'strike',
  'strike',
  'strike',
  'sling',
  'sling',
  'ironwall',
  'potion',
  'scout',
  'bandage',
];
