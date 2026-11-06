import { describe, expect, it } from 'vitest';
import { createGame } from '../game/createGame';
import { reduceGame, movementPointsOf, listenLimit } from '../turn/reducer';
import { LISTEN_PER_TURN } from '../fog/listen';
import { axialKey, neighbor, offsetToAxial, type AxialKey } from '../grid/geometry';
import { CARDS, STARTING_HAND, cardDef } from './content';
import { hitPlayer, damageDealt, playerAttack } from '../combat/combat';
import { addBuff, type Buff } from '../buffs/buffs';

function stateWithCard(cardId: string, dieValue = 6) {
  const state = createGame(9);
  return {
    ...state,
    hand: [{ uid: `${cardId}-0`, def: cardDef(cardId) }],
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
    const next = reduceGame(state, { type: 'playCard', cardUid: 'bandage-0', dieId: 0 });
    expect(next.hand).toHaveLength(0);
    expect(next.dice[0].reserved).toBe(true);
    expect(next.notice).toBeNull();
  });

  it('骰子点数不足时拒绝', () => {
    const state = stateWithCard('maul', 2);
    const next = reduceGame(state, { type: 'playCard', cardUid: 'maul-0', dieId: 0 });
    expect(next.hand).toHaveLength(1);
    expect(next.notice).toContain('不小于 3 点');
  });

  it('挥击对相邻怪物造成伤害', () => {
    const state = createGame(9);
    const monster = state.monsters[0];
    const adjacent = neighbor(state.player.pos, 0);
    const next = reduceGame(
      { ...state, hand: [{ uid: 'strike-0', def: cardDef('strike') }], monsters: [{ ...monster, pos: adjacent }], dice: [{ id: 0, value: 4, reserved: false }] },
      { type: 'playCard', cardUid: 'strike-0', dieId: 0 },
    );
    expect(next.notice).toBeNull();
    expect(next.monsters[0].hp).toBe(monster.hp - 6);
  });

  it('药剂回复体力但不超过上限', () => {
    const state = { ...stateWithCard('potion'), player: { pos: offsetToAxial(0, 0), hp: 90, maxHp: 100 } };
    const next = reduceGame(state, { type: 'playCard', cardUid: 'potion-0', dieId: 0 });
    expect(next.player.hp).toBe(100);
  });

  it('战意给玩家加伤害', () => {
    const state = stateWithCard('battlecry');
    const next = reduceGame(state, { type: 'playCard', cardUid: 'battlecry-0', dieId: 0 });
    expect(next.buffs.some((buff) => buff.kind === 'damageBonus')).toBe(true);
    expect(playerAttack(next.buffs)).toBe(7);
  });

  it('探查术增加本回合探听次数', () => {
    const state = stateWithCard('scout');
    const next = reduceGame(state, { type: 'playCard', cardUid: 'scout-0', dieId: 0 });
    expect(next.listenBonus).toBe(3);
  });

  it('换骰把骰子重掷回未预留池', () => {
    const state = stateWithCard('reroll', 4);
    const next = reduceGame(state, { type: 'playCard', cardUid: 'reroll-0', dieId: 0 });
    expect(next.dice[0].reserved).toBe(false);
    expect(next.dice[0].value).not.toBe(4);
  });

  it('驱散把目标怪物打回游荡', () => {
    const state = createGame(9);
    const monster = { ...state.monsters[0], state: 'chase' as const };
    const next = reduceGame(
      { ...state, hand: [{ uid: 'dispel-0', def: cardDef('dispel') }], monsters: [monster], dice: [{ id: 0, value: 6, reserved: false }] },
      { type: 'playCard', cardUid: 'dispel-0', dieId: 0, targetKey: axialKey(monster.pos) },
    );
    expect(next.monsters[0].state).toBe('wander');
  });

  it('需要目标的卡不指定目标会被拒绝', () => {
    const state = stateWithCard('dispel');
    const next = reduceGame(state, { type: 'playCard', cardUid: 'dispel-0', dieId: 0 });
    expect(next.notice).toBe('需要指定目标');
    expect(next.hand).toHaveLength(1);
  });

  it('同名卡只消耗打出的一张', () => {
    const state = createGame(9);
    const next = reduceGame(
      {
        ...state,
        hand: [
          { uid: 'bandage-a', def: cardDef('bandage') },
          { uid: 'bandage-b', def: cardDef('bandage') },
        ],
        dice: [{ id: 0, value: 6, reserved: false }],
      },
      { type: 'playCard', cardUid: 'bandage-a', dieId: 0 },
    );
    expect(next.hand.map((card) => card.uid)).toEqual(['bandage-b']);
  });

  it('出牌后移动点不增加（骰子被卡牌吃掉）', () => {
    const state = stateWithCard('bandage');
    const before = movementPointsOf(state);
    const next = reduceGame(state, { type: 'playCard', cardUid: 'bandage-0', dieId: 0 });
    expect(movementPointsOf(next)).toBe(before - 6);
  });

  it('疾行让本回合移动点 +1', () => {
    const state = stateWithCard('swift');
    const before = movementPointsOf(state);
    const next = reduceGame(state, { type: 'playCard', cardUid: 'swift-0', dieId: 0 });
    expect(movementPointsOf(next)).toBe(before - 6 + 1);
  });

  it('探查术让本回合探听上限 +3', () => {
    const state = stateWithCard('scout');
    expect(listenLimit(state)).toBe(LISTEN_PER_TURN);
    const next = reduceGame(state, { type: 'playCard', cardUid: 'scout-0', dieId: 0 });
    expect(listenLimit(next)).toBe(LISTEN_PER_TURN + 3);
  });

  it('屏息让身边怪物降级，且不泄露玩家位置', () => {
    const state = createGame(9);
    const monster = state.monsters[0];
    const adjacent = neighbor(state.player.pos, 0);
    const prepared = {
      ...state,
      hand: [{ uid: 'holdbreath-0', def: cardDef('holdbreath') }],
      monsters: [
        { ...monster, pos: adjacent, state: 'chase' as const, lastKnown: state.player.pos },
      ],
      dice: [
        { id: 0, value: 6, reserved: false },
        { id: 1, value: 6, reserved: false },
      ],
    };
    const next = reduceGame(prepared, {
      type: 'playCard',
      cardUid: 'holdbreath-0',
      dieId: 0,
    });
    expect(next.monsters[0].state).toBe('alert');
    expect(next.monsters[0].lastKnown).toEqual(adjacent);
  });

  it('定身让怪物跳过本回合行动，并在回合末解除', () => {
    const state = createGame(9);
    const monster = state.monsters[0];
    const adjacent = neighbor(state.player.pos, 0);
    const prepared = {
      ...state,
      level: { ...state.level, traps: new Set<AxialKey>() },
      hand: [{ uid: 'root-0', def: cardDef('root') }],
      monsters: [
        {
          ...monster,
          pos: adjacent,
          state: 'chase' as const,
          intent: { kind: 'attack' as const, damage: monster.def.damage },
        },
      ],
      dice: [{ id: 0, value: 6, reserved: false }],
    };
    const frozen = reduceGame(prepared, {
      type: 'playCard',
      cardUid: 'root-0',
      dieId: 0,
      targetKey: axialKey(adjacent),
    });
    expect(frozen.monsters[0].intent).toEqual({ kind: 'frozen' });

    const next = reduceGame(frozen, { type: 'endTurn' });
    expect(next.player.hp).toBe(prepared.player.hp);
    expect(next.monsters[0].pos).toEqual(adjacent);
    expect(next.monsters[0].frozen).toBe(false);
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
