import {
  IntentTimeline,
  intentTimelineFromScript,
  type IntentLog,
  type IntentStep,
} from '../core/intentTimeline';
import { createGame } from '../rules/game/createGame';
import { reduceGame } from '../rules/turn/reducer';
import type { GameIntent } from '../rules/turn/types';
import { hashGame } from './snapshot';

export interface RunTrace {
  hashes: number[];
  finalStatus: string;
  finalTurn: number;
}

/** 用一份操作日志跑完一局，逐步记录哈希。 */
export function runWithLog(
  seed: number,
  log: IntentLog<GameIntent>,
  maxSteps: number,
): RunTrace {
  const timeline = IntentTimeline.import(log);
  let state = createGame(seed);
  const hashes: number[] = [];

  for (let step = 1; step <= maxSteps && state.status === 'playing'; step++) {
    for (const intent of timeline.fold(step)) {
      state = reduceGame(state, intent);
    }
    hashes.push(hashGame(state));
  }

  return { hashes, finalStatus: state.status, finalTurn: state.turn };
}

export function runScript(seed: number, steps: IntentStep<GameIntent>[]): RunTrace {
  const maxStep = steps.reduce((max, step) => Math.max(max, step.step), 0);
  return runWithLog(seed, intentTimelineFromScript(steps).export(), maxStep + 1);
}

export interface DeterminismReport {
  identical: boolean;
  firstDivergence: number;
  statusA: string;
  statusB: string;
  hashesA: number[];
  hashesB: number[];
}

/**
 * 同种子同操作两次独立运行必须逐步完全一致。
 * 改了操作则必须在某一步分叉 —— 否则说明操作没被记录，验证就是空转。
 */
export function compareRuns(seed: number, steps: IntentStep<GameIntent>[]): DeterminismReport {
  const a = runScript(seed, steps);
  const b = runScript(seed, steps);
  const length = Math.min(a.hashes.length, b.hashes.length);

  let firstDivergence = -1;
  for (let i = 0; i < length; i++) {
    if (a.hashes[i] !== b.hashes[i]) {
      firstDivergence = i;
      break;
    }
  }
  if (firstDivergence < 0 && a.hashes.length !== b.hashes.length) {
    firstDivergence = length;
  }

  return {
    identical: firstDivergence < 0 && a.finalStatus === b.finalStatus,
    firstDivergence,
    statusA: a.finalStatus,
    statusB: b.finalStatus,
    hashesA: a.hashes,
    hashesB: b.hashes,
  };
}
