import { axialToOffset, type Axial } from '../grid/geometry';
import type { Level, Room, RoomKind } from '../generation/generator';
import type { ActionCheck } from '../turn/reducer';
import type { GameState } from '../turn/types';

/** 玩家脚下的房间下标；不在任何房间内返回 -1。 */
export function roomIndexAt(level: Level, cell: Axial): number {
  const { col, row } = axialToOffset(cell);
  return level.rooms.findIndex(
    (room) =>
      col >= room.col && col < room.col + room.w && row >= room.row && row < room.row + room.h,
  );
}

export function roomAt(level: Level, cell: Axial): Room | null {
  const index = roomIndexAt(level, cell);
  return index < 0 ? null : level.rooms[index];
}

/** 阶段 2 可交互的房间：宝箱、休整与奇遇。 */
export type InteractKind = 'chest' | 'rest' | 'encounter' | null;

export interface InteractCheck extends ActionCheck {
  roomIndex: number;
  kind: InteractKind;
}

export function canInteract(state: GameState): InteractCheck {
  if (state.status !== 'playing') {
    return { ok: false, reason: '本局已结束', roomIndex: -1, kind: null };
  }
  if (state.phase !== 'player') {
    return { ok: false, reason: '当前不在玩家回合', roomIndex: -1, kind: null };
  }
  const roomIndex = roomIndexAt(state.level, state.player.pos);
  if (roomIndex < 0) {
    return { ok: false, reason: '你不在房间内', roomIndex: -1, kind: null };
  }
  const kind = state.level.rooms[roomIndex].kind;
  if (kind !== 'chest' && kind !== 'rest' && kind !== 'encounter') {
    return { ok: false, reason: '这个房间没有可交互的东西', roomIndex, kind: null };
  }
  if (state.roomStates[roomIndex].settled) {
    return { ok: false, reason: '这个房间已经结算过了', roomIndex, kind };
  }
  return { ok: true, reason: null, roomIndex, kind };
}

/** 有一道未结算的题目，且玩家还站在那间奇遇房里。 */
export function canAnswerEncounter(state: GameState): ActionCheck {
  if (state.status !== 'playing') return { ok: false, reason: '本局已结束' };
  const encounter = state.encounter;
  if (!encounter || encounter.resolved) return { ok: false, reason: '没有进行中的奇遇' };
  if (roomIndexAt(state.level, state.player.pos) !== encounter.roomIndex) {
    return { ok: false, reason: '你离开了奇遇房' };
  }
  return { ok: true, reason: null };
}

/** 房间类型 → 玩家能读到的名字（UI 与日志共用）。 */
export function roomKindLabel(kind: RoomKind): string {
  switch (kind) {
    case 'start':
      return '起点房';
    case 'exit':
      return '出口房';
    case 'encounter':
      return '奇遇房';
    case 'chest':
      return '宝箱房';
    case 'rest':
      return '休整房';
    case 'battle':
      return '战斗房';
    case 'trap':
      return '陷阱房';
  }
}
