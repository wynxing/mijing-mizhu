/**
 * 意图时间线：所有操作都带 step 编号（回合内的步序），
 * 于是「同一段操作序列」成为可回放、可比较的确定量。
 * 折叠（fold）是幂等的：同一个 target 折叠两次，第二次不会重复吐出已消费的事件。
 */
export interface IntentEvent<T> {
  step: number;
  seq: number;
  intent: T;
}

export interface IntentLog<T> {
  seq: number;
  events: IntentEvent<T>[];
}

export interface IntentStep<T> {
  step: number;
  intent: T;
}

export class IntentTimeline<T> {
  private events: IntentEvent<T>[] = [];
  private seq = 0;
  private cursor = 0;

  pushIntent(intent: T, step: number): void {
    this.events.push({ step, seq: this.seq++, intent });
  }

  /** 折叠出 step ≤ target 且尚未被取走的意图。 */
  fold(target: number): T[] {
    const out: T[] = [];
    while (this.cursor < this.events.length && this.events[this.cursor].step <= target) {
      out.push(this.events[this.cursor++].intent);
    }
    return out;
  }

  reset(): void {
    this.events.length = 0;
    this.seq = 0;
    this.cursor = 0;
  }

  export(): IntentLog<T> {
    return {
      seq: this.seq,
      events: this.events.slice().sort((a, b) => a.step - b.step || a.seq - b.seq),
    };
  }

  static import<T>(log: IntentLog<T>): IntentTimeline<T> {
    const timeline = new IntentTimeline<T>();
    timeline.events = log.events.slice().sort((a, b) => a.step - b.step || a.seq - b.seq);
    timeline.seq = log.seq;
    return timeline;
  }
}

/** 把脚本转成时间线。 */
export function intentTimelineFromScript<T>(steps: IntentStep<T>[]): IntentTimeline<T> {
  const timeline = new IntentTimeline<T>();
  const ordered = steps.slice().sort((a, b) => a.step - b.step);
  for (const step of ordered) {
    timeline.pushIntent(step.intent, step.step);
  }
  return timeline;
}
