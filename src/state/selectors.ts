import { LISTEN_PER_TURN } from '../rules/fog/listen';
import { canListen, movementPointsOf, type ActionCheck } from '../rules/turn/reducer';
import type { GameState, LogEntry } from '../rules/turn/types';

export function movementPointsOfView(game: GameState | null): number {
  return game ? movementPointsOf(game) : 0;
}

export function listenRemaining(game: GameState | null): number {
  return game ? Math.max(0, LISTEN_PER_TURN - game.listenUsed) : 0;
}

export function canListenIn(game: GameState | null): ActionCheck {
  if (!game) return { ok: false, reason: '本局尚未开始' };
  return canListen(game);
}

export function recentLog(game: GameState | null): LogEntry[] {
  return game ? game.log.slice(-3).reverse() : [];
}
