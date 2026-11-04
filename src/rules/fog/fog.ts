import { axialKey, type Axial, type AxialKey } from '../grid/geometry';

/**
 * 探听返回的三态。
 * 阶段 0 没有陷阱，因此 'passage_noisy' 在数学上不可能出现 ——
 * 规则层不会编造不存在的异常。
 */
export type ListenResult = 'wall' | 'passage_quiet' | 'passage_noisy';

export interface FogState {
  /** 踏足过的格子，永久可见。 */
  visited: ReadonlySet<AxialKey>;
  /** 通过探听得知的格子，永久保留。 */
  known: ReadonlyMap<AxialKey, ListenResult>;
}

export function createFog(): FogState {
  return { visited: new Set<AxialKey>(), known: new Map<AxialKey, ListenResult>() };
}

export function markVisited(fog: FogState, cell: Axial): FogState {
  const visited = new Set(fog.visited);
  visited.add(axialKey(cell));
  return { visited, known: fog.known };
}

export function mergeListenResults(
  fog: FogState,
  results: ReadonlyMap<AxialKey, ListenResult>,
): FogState {
  const known = new Map(fog.known);
  for (const [key, result] of results) {
    if (fog.visited.has(key)) continue;
    known.set(key, result);
  }
  return { visited: fog.visited, known };
}

/** 是否亲眼见过（踏足过）。 */
export function isVisible(fog: FogState, cell: Axial): boolean {
  return fog.visited.has(axialKey(cell));
}

/** 是否已知（踏足过或听到过）。 */
export function isKnown(fog: FogState, cell: Axial): boolean {
  const key = axialKey(cell);
  return fog.visited.has(key) || fog.known.has(key);
}

export function knownResult(fog: FogState, cell: Axial): ListenResult | null {
  const key = axialKey(cell);
  if (fog.visited.has(key)) return null;
  return fog.known.get(key) ?? null;
}
