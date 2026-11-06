/**
 * 怪物原型。数值来自设计文档 §6.4。
 */
export interface MoveSpec {
  kind: 'fixed' | 'dice' | 'range' | 'none';
  steps?: number;
  sides?: number;
  min?: number;
  max?: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  hp: number;
  damage: number;
  /** 感知半径：能闻到多远（格）。 */
  senseRadius: number;
  move: MoveSpec;
  /** 游魂无视墙体移动。 */
  ignoresWalls: boolean;
  /** 蛛巢静止不动，靠陷阱代替移动。 */
  laysTraps: boolean;
  /** 追击时更激进（先追后打）。 */
  eager: boolean;
}

export const SNIFFER: MonsterDef = {
  id: 'sniffer',
  name: '嗅犬',
  hp: 20,
  damage: 4,
  senseRadius: 3,
  move: { kind: 'dice', sides: 6 },
  ignoresWalls: false,
  laysTraps: false,
  eager: false,
};

export const STONEWARDEN: MonsterDef = {
  id: 'stonewarden',
  name: '石卫',
  hp: 60,
  damage: 10,
  senseRadius: 2,
  move: { kind: 'range', min: 1, max: 3 },
  ignoresWalls: false,
  laysTraps: false,
  eager: false,
};

export const WRAITH: MonsterDef = {
  id: 'wraith',
  name: '游魂',
  hp: 25,
  damage: 6,
  senseRadius: 4,
  move: { kind: 'dice', sides: 6 },
  ignoresWalls: true,
  laysTraps: false,
  eager: false,
};

export const BROOD: MonsterDef = {
  id: 'brood',
  name: '蛛巢',
  hp: 30,
  damage: 3,
  senseRadius: 2,
  move: { kind: 'none' },
  ignoresWalls: false,
  laysTraps: true,
  eager: false,
};

export const GUARDIAN: MonsterDef = {
  id: 'guardian',
  name: '守卫',
  hp: 200,
  damage: 12,
  senseRadius: 99,
  move: { kind: 'dice', sides: 6 },
  ignoresWalls: false,
  laysTraps: false,
  eager: true,
};

export const MONSTER_DEFS: readonly MonsterDef[] = [
  SNIFFER,
  STONEWARDEN,
  WRAITH,
  BROOD,
  GUARDIAN,
];

export function monsterDef(id: string): MonsterDef {
  const found = MONSTER_DEFS.find((def) => def.id === id);
  if (!found) throw new Error(`未知怪物：${id}`);
  return found;
}
