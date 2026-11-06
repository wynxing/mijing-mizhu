import type { Level } from '../rules/generation/generator';
import type { GameState } from '../rules/turn/types';

/**
 * 局面状态的显式快照。刻意不用 JSON.stringify：
 * visited 是 Set、known 是 Map，序列化后会变成 {}，两个不同的局面会被误判为相同。
 */
export function snapshotGame(state: GameState): string {
  const dice = state.dice.map((die) => `${die.id}:${die.value}:${die.reserved ? 1 : 0}`).join(',');
  const visited = Array.from(state.fog.visited).sort().join(',');
  const known = Array.from(state.fog.known.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, result]) => `${key}=${result}`)
    .join(',');
  const log = state.log.map((entry) => `${entry.turn}:${entry.text}`).join(';');
  // 蛛巢会在局内增删陷阱，陷阱集合必须进入逐步哈希，否则回放分叉可能漏检。
  const traps = Array.from(state.level.traps).sort().join(',');

  return [
    `seed=${state.seed}`,
    `turn=${state.turn}`,
    `phase=${state.phase}`,
    `status=${state.status}`,
    `rng=${state.rngState}`,
    `dice=${dice}`,
    `spent=${state.spentPoints}`,
    `listened=${state.listenUsed}`,
    `pos=${state.player.pos.q},${state.player.pos.r}`,
    `hp=${state.player.hp}/${state.player.maxHp}`,
    `exit=${state.level.exit.q},${state.level.exit.r}`,
    `visited=${visited}`,
    `known=${known}`,
    `level=${levelHash(state.level)}`,
    `traps=${traps}`,
    `log=${log}`,
  ].join('\n');
}

/** 关卡内容的校验和，用于确认两局走的是同一张地图。 */
export function levelHash(level: Level): number {
  let hash = 2166136261 >>> 0;
  const parts = `${level.width}x${level.height}:${level.start.q},${level.start.r}:${level.exit.q},${level.exit.r}:${Array.from(level.cells).join('')}`;
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** FNV-1a 32 位哈希，用于逐步比对两个局面是否完全一致。 */
export function hashString(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashGame(state: GameState): number {
  return hashString(snapshotGame(state));
}
