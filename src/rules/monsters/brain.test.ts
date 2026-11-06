import { describe, expect, it } from 'vitest';
import { Rng32 } from '../../core/rng';
import { offsetToAxial } from '../grid/geometry';
import { addScent, createScent } from '../fog/scent';
import { SNIFFER, STONEWARDEN, WRAITH, GUARDIAN } from './content';
import {
  actMonster,
  createMonster,
  moveStepsFor,
  rollIntent,
  updatePerception,
  type Monster,
} from './brain';

const PLAYER = offsetToAxial(5, 5);

function monsterAt(def = SNIFFER, pos = offsetToAxial(5, 5)): Monster {
  return createMonster(def, pos, 'test-monster');
}

describe('怪物意图', () => {
  it('相邻时意图是攻击', () => {
    const monster = monsterAt(SNIFFER, offsetToAxial(6, 5));
    const intent = rollIntent(monster, new Rng32(1), PLAYER);
    expect(intent.intent).toEqual({ kind: 'attack', damage: SNIFFER.damage });
  });

  it('不相邻时意图是移动，并预掷步数', () => {
    const monster = monsterAt(SNIFFER, offsetToAxial(12, 5));
    const intent = rollIntent(monster, new Rng32(1), PLAYER);
    expect(intent.intent.kind).toBe('move');
    if (intent.intent.kind === 'move') {
      expect(intent.intent.steps).toBeGreaterThanOrEqual(1);
      expect(intent.intent.steps).toBeLessThanOrEqual(6);
    }
  });

  it('蛛巢静止，意图是搜索', () => {
    const monster = monsterAt(
      { ...SNIFFER, id: 'brood', move: { kind: 'none' } },
      offsetToAxial(5, 2),
    );
    expect(rollIntent(monster, new Rng32(1), PLAYER).intent.kind).toBe('search');
  });

  it('被定身时意图是定身', () => {
    const monster = { ...monsterAt(), frozen: true };
    expect(rollIntent(monster, new Rng32(1), PLAYER).intent.kind).toBe('frozen');
  });

  it('石卫走 1–3 格', () => {
    const rng = new Rng32(7);
    for (let i = 0; i < 50; i++) {
      const steps = moveStepsFor(STONEWARDEN, rng);
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(steps).toBeLessThanOrEqual(3);
    }
  });
});

describe('感知与三态', () => {
  it('感知半径内有气味 ≥ 2 的格 → 进入警觉并锁定该格', () => {
    // 怪物与玩家距离 3，不会直接触发追击
    const monster = monsterAt(SNIFFER, offsetToAxial(5, 2));
    const scent = addScent(createScent(), [offsetToAxial(6, 3), offsetToAxial(6, 3)]);
    const perceived = updatePerception(monster, scent, PLAYER, 0);
    expect(perceived.state).toBe('alert');
    expect(perceived.lastKnown).toEqual(offsetToAxial(6, 3));
  });

  it('气味只有 1 时不会警觉', () => {
    const monster = monsterAt(SNIFFER, offsetToAxial(5, 2));
    const scent = addScent(createScent(), [offsetToAxial(6, 3)]);
    expect(updatePerception(monster, scent, PLAYER, 0).state).toBe('wander');
  });

  it('距离 ≤ 2 → 直接进入追击并标记被发现', () => {
    const monster = monsterAt(SNIFFER, offsetToAxial(6, 5));
    const perceived = updatePerception(monster, createScent(), PLAYER, 0);
    expect(perceived.state).toBe('chase');
    expect(perceived.spotted).toBe(true);
    expect(perceived.lastKnown).toEqual(PLAYER);
  });

  it('追击中：低气味区静止 2 回合 → 降级为警觉', () => {
    const chasing = { ...monsterAt(SNIFFER, offsetToAxial(6, 5)), state: 'chase' as const };
    const lowScent = createScent();
    const perceived = updatePerception(chasing, lowScent, PLAYER, 2);
    expect(perceived.state).toBe('alert');
  });

  it('追击中：没有静止够回合 → 仍是追击', () => {
    const chasing = { ...monsterAt(SNIFFER, offsetToAxial(6, 5)), state: 'chase' as const };
    const perceived = updatePerception(chasing, createScent(), PLAYER, 1);
    expect(perceived.state).toBe('chase');
  });

  it('游魂无视墙体移动', () => {
    const wraith = monsterAt(WRAITH, offsetToAxial(5, 5));
    const map = { cells: new Uint8Array(0), grid: { width: 0, height: 0 } };
    const next = actMonster(
      { ...wraith, state: 'chase', intent: { kind: 'move', steps: 1 } },
      map,
      offsetToAxial(5, 4),
      new Rng32(1),
    );
    expect(next.monster.pos).toEqual(offsetToAxial(5, 4));
  });
});

describe('追击解除与意图时序', () => {
  const emptyMap = { cells: new Uint8Array(0), grid: { width: 0, height: 0 } };

  it('冻结回合不感知，也不自行解除定身', () => {
    const frozen = {
      ...monsterAt(SNIFFER, offsetToAxial(6, 5)),
      state: 'wander' as const,
      frozen: true,
    };
    const perceived = updatePerception(frozen, createScent(), PLAYER, 0);
    expect(perceived.state).toBe('wander');
    expect(perceived.frozen).toBe(true);

    const acted = actMonster(frozen, emptyMap, PLAYER, new Rng32(1));
    expect(acted.monster.frozen).toBe(true);
    expect(acted.monster.pos).toEqual(frozen.pos);
    expect(acted.damage).toBe(0);
  });

  it('驱散后 2 回合内不再感知', () => {
    const dazed = {
      ...monsterAt(SNIFFER, offsetToAxial(6, 5)),
      state: 'wander' as const,
      dazeTurns: 2,
    };
    const first = updatePerception(dazed, createScent(), PLAYER, 0);
    expect(first.state).toBe('wander');
    expect(first.dazeTurns).toBe(1);

    const second = updatePerception(first, createScent(), PLAYER, 0);
    expect(second.state).toBe('wander');
    expect(second.dazeTurns).toBe(0);

    const third = updatePerception(second, createScent(), PLAYER, 0);
    expect(third.state).toBe('chase');
  });

  it('预警回合不行动，并清除标记', () => {
    const spotted = {
      ...monsterAt(SNIFFER, offsetToAxial(6, 5)),
      state: 'chase' as const,
      spotted: true,
      intent: { kind: 'attack' as const, damage: SNIFFER.damage },
    };
    const acted = actMonster(spotted, emptyMap, PLAYER, new Rng32(1));
    expect(acted.damage).toBe(0);
    expect(acted.monster.pos).toEqual(spotted.pos);
    expect(acted.monster.spotted).toBe(false);
  });

  it('预警中的怪物意图是搜索', () => {
    const monster = { ...monsterAt(SNIFFER, offsetToAxial(6, 5)), spotted: true };
    expect(rollIntent(monster, new Rng32(1), PLAYER).intent).toEqual({ kind: 'search' });
  });

  it('eager 怪物跳过预警直接行动', () => {
    const guardian = {
      ...monsterAt(GUARDIAN, offsetToAxial(6, 5)),
      state: 'chase' as const,
      spotted: true,
      intent: { kind: 'attack' as const, damage: GUARDIAN.damage },
    };
    expect(actMonster(guardian, emptyMap, PLAYER, new Rng32(1)).damage).toBe(
      GUARDIAN.damage,
    );
  });

  it('攻击结算时玩家已离开相邻格则落空', () => {
    const monster = {
      ...monsterAt(SNIFFER, offsetToAxial(6, 5)),
      state: 'chase' as const,
      intent: { kind: 'attack' as const, damage: SNIFFER.damage },
    };
    const acted = actMonster(monster, emptyMap, offsetToAxial(10, 10), new Rng32(1));
    expect(acted.damage).toBe(0);
  });
});
