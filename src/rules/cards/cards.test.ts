import { describe, expect, it } from 'vitest';
import { createGame } from '../game/createGame';
import { reduceGame, movementPointsOf } from '../turn/reducer';
import { axialKey, neighbor, offsetToAxial } from '../grid/geometry';
import { CARDS, STARTING_HAND, cardDef } from './content';
import { hitPlayer, damageDealt, playerAttack } from '../combat/combat';
import { addBuff, type Buff } from '../buffs/buffs';

function stateWithCard(cardId: string, dieValue = 6) {
  const state = createGame(9);
  return {
    ...state,
    hand: [cardDef(cardId)],
    monsters: [],
    dice: [{ id: 0, value: dieValue, reserved: false }],
  };
}

describe('卡池', () => {
  it('普通卡池 15 张，费用在 1–4 之间', () => {
    expect(CARDS).toHaveLength(15);
    for (const card of CARDS) {
      expect(card.cost).toBeGreaterThanOrEqual(1);
      expect(card.cost).toBeLessThanOrEqual(4);
    }
  });

  it('初始牌组是 10 张', () => {
    expect(STARTING_HAND).toHaveLength(10);
  });
});

describe('出牌', () => {
  it('消耗一颗骰子与一张卡', () => {
    const state = stateWithCard('bandage');
    const next = reduceGame(state, { type: 'playCard', cardId: 'bandage', dieId: 0 });
    expect(next.hand).toHaveLength(0);
    expect(next.dice[0].reserved).toBe(true);
    expect(next.notice).toBeNull();
  });

  it('骰子点数不足时拒绝', () => {
    const state = stateWithCard('maul', 2);
    const next = reduceGame(state, { type: 'playCard', cardId: 'maul', dieId: 0 });
    expect(next.hand).toHaveLength(1);
    expect(next.notice).toContain('不小于 3 点');
  });

  it('挥击对相邻怪物造成伤害', () => {
    const state = createGame(9);
    const monster = state.monsters[0];
    const adjacent = neighbor(state.player.pos, 0);
    const next = reduceGame(
      { ...state, hand: [cardDef('strike')], monsters: [{ ...monster, pos: adjacent }], dice: [{ id: 0, value: 4, reserved: false }] },
      { type: 'playCard', cardId: 'strike', dieId: 0 },
    );
    expect(next.notice).toBeNull();
    expect(next.monsters[0].hp).toBe(monster.hp - 6);
  });

  it('药剂回复体力但不超过上限', () => {
    const state = { ...stateWithCard('potion'), player: { pos: offsetToAxial(0, 0), hp: 90, maxHp: 100 } };
    const next = reduceGame(state, { type: 'playCard', cardId: 'potion', dieId: 0 });
    expect(next.player.hp).toBe(100);
  });

  it('战意给玩家加伤害', () => {
    const state = stateWithCard('battlecry');
    const next = reduceGame(state, { type: 'playCard', cardId: 'battlecry', dieId: 0 });
    expect(next.buffs.some((buff) => buff.kind === 'damageBonus')).toBe(true);
    expect(playerAttack(next.buffs)).toBe(7);
  });

  it('探查术增加本回合探听次数', () => {
    const state = stateWithCard('scout');
    const next = reduceGame(state, { type: 'playCard', cardId: 'scout', dieId: 0 });
    expect(next.listenBonus).toBe(3);
  });

  it('换骰把骰子重掷回未预留池', () => {
    const state = stateWithCard('reroll', 4);
    const next = reduceGame(state, { type: 'playCard', cardId: 'reroll', dieId: 0 });
    expect(next.dice[0].reserved).toBe(false);
    expect(next.dice[0].value).not.toBe(4);
  });

  it('驱散把目标怪物打回游荡', () => {
    const state = createGame(9);
    const monster = { ...state.monsters[0], state: 'chase' as const };
    const next = reduceGame(
      { ...state, hand: [cardDef('dispel')], monsters: [monster], dice: [{ id: 0, value: 6, reserved: false }] },
      { type: 'playCard', cardId: 'dispel', dieId: 0, targetKey: axialKey(monster.pos) },
    );
    expect(next.monsters[0].state).toBe('wander');
  });

  it('需要目标的卡不指定目标会被拒绝', () => {
    const state = stateWithCard('dispel');
    const next = reduceGame(state, { type: 'playCard', cardId: 'dispel', dieId: 0 });
    expect(next.notice).toBe('需要指定目标');
    expect(next.hand).toHaveLength(1);
  });

  it('出牌后移动点不增加（骰子被卡牌吃掉）', () => {
    const state = stateWithCard('bandage');
    const before = movementPointsOf(state);
    const next = reduceGame(state, { type: 'playCard', cardId: 'bandage', dieId: 0 });
    expect(movementPointsOf(next)).toBe(before - 6);
  });
});

describe('伤害结算', () => {
  it('闪避让第一次伤害完全免伤', () => {
    const buffs: Buff[] = [{ id: 'dodge', kind: 'evadeOnce', name: '闪避', turns: 1, amount: 1 }];
    const hit = hitPlayer(10, buffs);
    expect(hit.damage).toBe(0);
    expect(hit.dodged).toBe(true);
  });

  it('铁壁姿态免疫伤害', () => {
    const buffs: Buff[] = [{ id: 'stance', kind: 'immunity', name: '铁壁姿态', turns: 1, amount: 1 }];
    const hit = hitPlayer(10, buffs);
    expect(hit.damage).toBe(0);
    expect(hit.immune).toBe(true);
  });

  it('铁壁减少伤害', () => {
    const buffs: Buff[] = addBuff([], {
      id: 'ironwall',
      kind: 'damageReduction',
      name: '铁壁',
      turns: 1,
      amount: 4,
    });
    expect(hitPlayer(10, buffs).damage).toBe(6);
  });

  it('攻击伤害最低为 1', () => {
    expect(damageDealt(3, 5)).toBe(1);
    expect(damageDealt(10, 3, 2)).toBe(5);
  });
});
