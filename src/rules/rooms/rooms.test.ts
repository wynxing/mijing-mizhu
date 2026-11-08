import { describe, expect, it } from 'vitest';
import { DIRECTIONS, axialKey, neighbor, offsetToAxial, type Axial } from '../grid/geometry';
import { CELL_FLOOR } from '../grid/path';
import { createGame } from '../game/createGame';
import { cellAtLevel, type RoomKind } from '../generation/generator';
import { createMonster } from '../monsters/brain';
import { monsterDef } from '../monsters/content';
import { hasLegalAction, reduceGame } from '../turn/reducer';
import type { GameState } from '../turn/types';
import { canInteract, roomIndexAt } from './rooms';

function roomFloorCells(state: GameState, kind: RoomKind): Axial[] {
  const room = state.level.rooms.find((item) => item.kind === kind);
  if (!room) throw new Error(`种子 ${state.seed} 没有 ${kind} 房`);
  const cells: Axial[] = [];
  for (let row = room.row; row < room.row + room.h; row++) {
    for (let col = room.col; col < room.col + room.w; col++) {
      const cell = offsetToAxial(col, row);
      if (cellAtLevel(state.level, cell) === CELL_FLOOR) cells.push(cell);
    }
  }
  return cells;
}

function enter(state: GameState, cell: Axial): GameState {
  return { ...state, player: { ...state.player, pos: cell } };
}

function gameWithRoom(kind: RoomKind): GameState {
  for (let seed = 1; seed < 200; seed++) {
    const state = createGame(seed);
    if (state.level.rooms.some((room) => room.kind === kind)) return state;
  }
  throw new Error(`前 200 个种子都没有 ${kind} 房`);
}

describe('房间系统', () => {
  it('roomIndexAt 能认出房间内的格子', () => {
    const state = gameWithRoom('chest');
    const cell = roomFloorCells(state, 'chest')[0];
    const room = state.level.rooms[roomIndexAt(state.level, cell)];
    expect(room.kind).toBe('chest');
    // 边缘走廊上的起点不属于任何房间：房间矩形只覆盖房体
    expect(roomIndexAt(state.level, state.level.start)).toBe(-1);
  });

  it('宝箱房只结算一次，重复交互被拒绝', () => {
    const state = gameWithRoom('chest');
    const start = enter(state, roomFloorCells(state, 'chest')[0]);
    const index = roomIndexAt(start.level, start.player.pos);
    expect(canInteract(start).ok).toBe(true);

    const after = reduceGame(start, { type: 'interact' });
    expect(after.notice).toBeNull();
    expect(after.roomStates[index].settled).toBe(true);

    const again = reduceGame(after, { type: 'interact' });
    expect(again.notice).toBe('这个房间已经结算过了');
    expect(again.roomStates[index].settled).toBe(true);
  });

  it('宝箱要么给卡，要么给 buff', () => {
    const state = gameWithRoom('chest');
    const after = reduceGame(enter(state, roomFloorCells(state, 'chest')[0]), {
      type: 'interact',
    });
    const gotCard = after.hand.length > state.hand.length;
    const gotBuff = after.buffs.length > 0;
    expect(gotCard !== gotBuff).toBe(true);
  });

  it('休整房回 30 血并锁定一张手牌 uid', () => {
    const state = gameWithRoom('rest');
    const inside = enter(state, roomFloorCells(state, 'rest')[0]);
    const hurt: GameState = { ...inside, player: { ...inside.player, hp: 40 } };
    const after = reduceGame(hurt, { type: 'interact' });
    expect(after.player.hp).toBe(70);
    expect(after.restLockUid).not.toBeNull();
    expect(after.hand.some((card) => card.uid === after.restLockUid)).toBe(true);
    expect(after.events.some((event) => event.type === 'playerHealed')).toBe(true);
  });

  it('房间交互不花移动点，因此移动点耗尽时仍算合法动作', () => {
    const state = gameWithRoom('chest');
    const broke: GameState = {
      ...enter(state, roomFloorCells(state, 'chest')[0]),
      dice: state.dice.map((die) => ({ ...die, value: 0 })),
    };
    expect(hasLegalAction(broke)).toBe(true);
    expect(reduceGame(broke, { type: 'interact' }).notice).toBeNull();
  });

  it('没有可交互内容的房间给出理由', () => {
    const state = createGame(1);
    const inside = enter(state, roomFloorCells(state, 'exit')[0]);
    const check = canInteract(inside);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('这个房间没有可交互的东西');

    const corridor = canInteract({ ...state, player: { ...state.player, pos: state.level.exit } });
    expect(corridor.reason).toBe('你不在房间内');
  });
});

describe('特殊地形', () => {
  function terrainStep(): { state: GameState; terrain: Axial } {
    for (let seed = 1; seed < 200; seed++) {
      const state = createGame(seed);
      for (const key of state.level.terrain.keys()) {
        const [q, r] = key.split(',').map(Number);
        const terrain = { q, r };
        for (const delta of DIRECTIONS) {
          const from = { q: terrain.q + delta.q, r: terrain.r + delta.r };
          if (cellAtLevel(state.level, from) !== CELL_FLOOR) continue;
          return { state: enter(state, from), terrain };
        }
      }
    }
    throw new Error('前 200 个种子都没有可踏上的特殊地形');
  }

  it('踏上即清除该格与邻居的气味，含本步刚留下的气味', () => {
    const { state, terrain } = terrainStep();
    const after = reduceGame(state, { type: 'move', target: terrain });
    expect(after.notice).toBeNull();
    expect(after.player.pos).toEqual(terrain);
    expect(after.scent.cells.has(axialKey(terrain))).toBe(false);
    for (const delta of DIRECTIONS) {
      const next = { q: terrain.q + delta.q, r: terrain.r + delta.r };
      expect(after.scent.cells.has(axialKey(next))).toBe(false);
    }
    expect(after.log.some((entry) => entry.text.includes('气味'))).toBe(true);
  });

  it('普通格不会清除气味', () => {
    const { state, terrain } = terrainStep();
    const plain = {
      q: terrain.q + DIRECTIONS[0].q,
      r: terrain.r + DIRECTIONS[0].r,
    };
    if (cellAtLevel(state.level, plain) !== CELL_FLOOR) return;
    const after = reduceGame(enter(state, terrain), { type: 'move', target: plain });
    // 从地形格出发这一步在普通格，气味必须留下
    if (state.level.terrain.has(axialKey(plain))) return;
    expect(after.scent.cells.has(axialKey(plain))).toBe(true);
  });
});

describe('战斗房', () => {
  it('踏入房间任一格，房内怪物立即转追击且跳过预警', () => {
    for (let seed = 1; seed < 200; seed++) {
      const state = createGame(seed);
      const roomIndex = state.level.rooms.findIndex((room) => room.kind === 'battle');
      if (roomIndex < 0) continue;
      const cells = roomFloorCells(state, 'battle');
      const monsterPos = cells[0];
      const target = cells.find((cell) => axialKey(cell) !== axialKey(monsterPos));
      if (!target) continue;
      const from = neighbor(target, 0);
      if (cellAtLevel(state.level, from) !== CELL_FLOOR) continue;

      const prepared: GameState = {
        ...enter(state, from),
        monsters: [createMonster(monsterDef('sniffer'), monsterPos, 'test-sniffer')],
      };
      const after = reduceGame(prepared, { type: 'move', target });
      expect(after.notice).toBeNull();
      expect(roomIndexAt(after.level, monsterPos)).toBe(roomIndex);
      const moved = after.monsters[0];
      expect(moved.state).toBe('chase');
      expect(moved.spotted).toBe(false);
      return;
    }
    throw new Error('找不到可用于战斗房测试的布局');
  });
});

describe('房间揭露（§5.1 房间例外）', () => {
  it('踏进房体后整间可走格可见，房外仍是迷雾', () => {
    for (let seed = 1; seed < 200; seed++) {
      const base = createGame(seed);
      const roomIndex = base.level.rooms.findIndex((room) => room.kind === 'chest');
      if (roomIndex < 0) continue;
      const room = base.level.rooms[roomIndex];
      const inside: Axial[] = [];
      for (let row = room.row; row < room.row + room.h; row++) {
        for (let col = room.col; col < room.col + room.w; col++) {
          const cell = offsetToAxial(col, row);
          if (cellAtLevel(base.level, cell) === CELL_FLOOR) inside.push(cell);
        }
      }
      const entry = inside
        .flatMap((target) =>
          DIRECTIONS.map((delta) => ({
            target,
            from: { q: target.q + delta.q, r: target.r + delta.r },
          })),
        )
        .find(
          ({ from }) =>
            cellAtLevel(base.level, from) === CELL_FLOOR &&
            roomIndexAt(base.level, from) !== roomIndex &&
            !base.monsters.some((monster) => axialKey(monster.pos) === axialKey(from)) &&
            !base.monsters.some((monster) => axialKey(monster.pos) === axialKey({ q: from.q, r: from.r })),
        );
      if (!entry) continue;

      const prepared: GameState = { ...base, player: { ...base.player, pos: entry.from } };
      const after = reduceGame(prepared, { type: 'move', target: entry.target });
      if (after.notice !== null) continue;

      for (const cell of inside) {
        expect(after.fog.visited.has(axialKey(cell))).toBe(true);
      }
      // 房外的其他地面格不该被顺带揭露（起点是开局就可见的，单独排除）
      const outside = offsetToAxial(1, 1);
      if (
        cellAtLevel(base.level, outside) === CELL_FLOOR &&
        roomIndexAt(base.level, outside) < 0 &&
        axialKey(outside) !== axialKey(base.level.start)
      ) {
        expect(after.fog.visited.has(axialKey(outside))).toBe(false);
      }
      expect(after.log.some((log) => log.text.includes('你走进了'))).toBe(true);
      return;
    }
    throw new Error('找不到可踏入的宝箱房');
  });
});
