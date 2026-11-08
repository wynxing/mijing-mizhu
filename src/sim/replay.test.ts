import { describe, expect, it } from 'vitest';
import type { IntentStep } from '../core/intentTimeline';
import type { GameIntent } from '../rules/turn/types';
import { compareRuns, compareTraces, runScript, runWithLog } from './replay';

const SCRIPT: IntentStep<GameIntent>[] = [
  { step: 1, intent: { type: 'listen' } },
  { step: 2, intent: { type: 'listen' } },
  { step: 3, intent: { type: 'endTurn' } },
  { step: 4, intent: { type: 'listen' } },
];

describe('回放确定性', () => {
  it('同种子同脚本两次运行完全一致', () => {
    const report = compareRuns(41, SCRIPT);
    expect(report.identical).toBe(true);
    expect(report.firstDivergence).toBe(-1);
    expect(report.hashesA).toEqual(report.hashesB);
  });

  it('脚本不同则必然分叉', () => {
    const other: IntentStep<GameIntent>[] = [
      { step: 1, intent: { type: 'listen' } },
      { step: 2, intent: { type: 'endTurn' } },
    ];
    const a = runScript(41, SCRIPT);
    const b = runScript(41, other);
    expect(a.hashes).not.toEqual(b.hashes);
  });

  it('只改一个 intent 就必须在那一步分叉', () => {
    const mutated = SCRIPT.map((step) => ({ ...step }));
    mutated[1] = { step: 2, intent: { type: 'endTurn' } };
    const report = compareTraces(runScript(41, SCRIPT), runScript(41, mutated));
    expect(report.identical).toBe(false);
    expect(report.firstDivergence).toBe(1);
  });

  it('运行会记录每一步的哈希', () => {
    const trace = runScript(41, SCRIPT);
    expect(trace.hashes.length).toBeGreaterThan(0);
    expect(trace.finalStatus).toBe('playing');
    expect(trace.finalTurn).toBeGreaterThan(0);
  });

  it('操作日志形式与脚本形式等价', () => {
    const log = {
      seq: SCRIPT.length,
      events: SCRIPT.map((step, index) => ({ step: step.step, seq: index, intent: step.intent })),
    };
    const fromScript = runScript(41, SCRIPT);
    const fromLog = runWithLog(41, log, 5);
    expect(fromLog.hashes).toEqual(fromScript.hashes);
  });
});
