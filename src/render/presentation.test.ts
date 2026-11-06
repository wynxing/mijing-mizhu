import { describe, expect, it } from 'vitest';
import { BASE_HEX_SIZE, axialToPixel, neighbors, type Axial } from '../rules/grid/geometry';
import { createGame } from '../rules/game/createGame';
import { isWalkableAtLevel } from '../rules/generation/generator';
import { createMonster } from '../rules/monsters/brain';
import { SNIFFER } from '../rules/monsters/content';
import { reduceGame } from '../rules/turn/reducer';
import type { GameState } from '../rules/turn/types';
import type { GameEvent } from '../rules/turn/events';
import { buildRenderModel } from './model';
import { PresentationDirector } from './presentation';

function walkableNeighbor(state: GameState): Axial {
  return neighbors(state.player.pos).find((cell) => isWalkableAtLevel(state.level, cell))!;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('演出层', () => {
  it('玩家走一格是插值的，不会瞬移', () => {
    const state = createGame(55);
    const target = walkableNeighbor(state);
    const next = reduceGame(state, { type: 'move', target });

    const director = new PresentationDirector();
    director.push(buildRenderModel(state), [], 0);
    director.push(buildRenderModel(next), next.events, 0);

    const from = axialToPixel(state.player.pos, BASE_HEX_SIZE);
    const to = axialToPixel(target, BASE_HEX_SIZE);
    expect(director.tick(0).player.pos).toEqual(from);

    const mid = director.tick(75).player.pos;
    expect(distance(mid, from)).toBeGreaterThan(0);
    expect(distance(mid, to)).toBeLessThan(distance(from, to));

    expect(director.tick(200).player.pos).toEqual(to);
  });

  it('怪物的行动排队演出：第二个怪不会和第一个同时打', () => {
    const state = createGame(55);
    const target = walkableNeighbor(state);
    const withMonsters: GameState = {
      ...state,
      monsters: [
        { ...createMonster(SNIFFER, target, 'm1'), state: 'chase', intent: { kind: 'search' } },
        { ...createMonster(SNIFFER, target, 'm2'), state: 'chase', intent: { kind: 'search' } },
      ],
    };
    const events: GameEvent[] = [
      {
        type: 'monsterAttacked',
        monsterUid: 'm1',
        monsterName: '嗅犬',
        target: state.player.pos,
        damage: 4,
        avoided: false,
      },
      {
        type: 'monsterAttacked',
        monsterUid: 'm2',
        monsterName: '嗅犬',
        target: state.player.pos,
        damage: 6,
        avoided: false,
      },
    ];

    const director = new PresentationDirector();
    director.push(buildRenderModel(state), [], 0);
    director.push(buildRenderModel(withMonsters), events, 0);

    expect(director.tick(150).floaters).toHaveLength(1);
    expect(director.tick(300).floaters).toHaveLength(2);
  });

  it('受伤时体力条是慢慢掉下去，不是瞬间归零', () => {
    const state = createGame(55);
    const events: GameEvent[] = [
      {
        type: 'monsterAttacked',
        monsterUid: 'm1',
        monsterName: '嗅犬',
        target: state.player.pos,
        damage: 10,
        avoided: false,
      },
    ];
    const hurt: GameState = { ...state, player: { ...state.player, hp: 90 } };

    const director = new PresentationDirector();
    director.push(buildRenderModel(state), [], 0);
    director.push(buildRenderModel(hurt), events, 0);

    expect(director.tick(0).player.hp).toBe(100);
    expect(director.tick(500).player.hp).toBe(90);
  });

  it('打中的怪会掉血并飘出伤害数字', () => {
    const state = createGame(55);
    const target = walkableNeighbor(state);
    const withMonster: GameState = {
      ...state,
      monsters: [
        { ...createMonster(SNIFFER, target, 'm1'), state: 'chase', intent: { kind: 'search' } },
      ],
    };
    const events: GameEvent[] = [
      {
        type: 'playerAttacked',
        monsterUid: 'm1',
        monsterName: '嗅犬',
        target,
        damage: 6,
        killed: false,
      },
    ];

    const director = new PresentationDirector();
    director.push(buildRenderModel(state), [], 0);
    director.push(buildRenderModel(withMonster), events, 0);

    const frame = director.tick(500);
    const monster = frame.monsters.find((item) => item.uid === 'm1');
    expect(monster?.hp).toBe(SNIFFER.hp - 6);
    expect(frame.floaters.map((floater) => floater.text)).toContain('-6');
  });

  it('看不见的怪不会被演出出来', () => {
    const state = createGame(55);
    const target = walkableNeighbor(state);
    const withMonster: GameState = {
      ...state,
      monsters: [
        { ...createMonster(SNIFFER, target, 'm1'), state: 'wander', intent: { kind: 'search' } },
      ],
    };
    const events: GameEvent[] = [
      {
        type: 'monsterMoved',
        monsterUid: 'm1',
        from: target,
        to: state.player.pos,
      },
    ];

    const director = new PresentationDirector();
    director.push(buildRenderModel(state), [], 0);
    director.push(buildRenderModel(withMonster), events, 0);
    const frame = director.tick(50);
    expect(frame.monsters.find((item) => item.uid === 'm1')?.alpha).toBe(0);
  });
});
