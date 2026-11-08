import {
  BASE_HEX_SIZE,
  axialToPixel,
  hexDistance,
  type Point,
} from '../rules/grid/geometry';
import type { GameEvent } from '../rules/turn/events';
import type { MonsterState } from '../rules/monsters/brain';
import type { RenderModel } from './model';

/**
 * 演出时长（毫秒）。这些数字只影响观感，不影响任何规则判定。
 */
const DUR = {
  /** 玩家走一格。 */
  playerStep: 150,
  /** 怪物走一格。 */
  monsterStep: 95,
  /** 前冲（出手后收回）总时长。 */
  lunge: 170,
  /** 前冲到命中的延迟。 */
  hitDelay: 110,
  /** 血条变化时长。 */
  hp: 300,
  /** 伤害数字存活时长。 */
  floater: 950,
  /** 命中闪光时长。 */
  flash: 260,
  /** 死亡消散时长。 */
  death: 430,
  /** 淡入淡出时长。 */
  fade: 200,
} as const;

const PLAYER = 'player';

export type FloaterTone = 'damage' | 'block' | 'heal' | 'buff';

export interface PresentationMonster {
  uid: string;
  name: string;
  state: MonsterState;
  /** 世界坐标（未缩放），渲染层再换算成屏幕坐标。 */
  pos: Point;
  hp: number;
  maxHp: number;
  /** 0..1 可见度，死亡时向下淡出。 */
  alpha: number;
  /** 0..1 命中闪白强度。 */
  hit: number;
}

export interface PresentationFloater {
  pos: Point;
  text: string;
  tone: FloaterTone;
  /** 0..1 生命周期进度。 */
  progress: number;
}

export interface PresentationFlash {
  pos: Point;
  progress: number;
  strength: number;
}

export interface PresentationFrame {
  player: {
    pos: Point;
    hp: number;
    maxHp: number;
    hit: number;
    /** 正在位移：此时不画可落脚高亮，避免高亮先于玩家出现。 */
    moving: boolean;
  };
  monsters: PresentationMonster[];
  floaters: PresentationFloater[];
  flashes: PresentationFlash[];
  /** 远程攻击的射线。 */
  streaks: { from: Point; to: Point; progress: number }[];
  /** 镜头抖动偏移。 */
  shake: Point;
}

interface PosTrack {
  from: Point;
  to: Point;
  start: number;
  end: number;
}

interface NumTrack {
  from: number;
  to: number;
  start: number;
  end: number;
}

interface LungeTrack {
  key: string;
  dx: number;
  dy: number;
  start: number;
  end: number;
}

interface StreakTrack {
  from: Point;
  to: Point;
  start: number;
  end: number;
}

interface FloaterTrack {
  pos: Point;
  text: string;
  tone: FloaterTone;
  start: number;
  life: number;
}

interface FlashTrack {
  pos: Point;
  start: number;
  life: number;
  strength: number;
}

interface ShakeTrack {
  power: number;
  start: number;
  life: number;
}

interface UnitInfo {
  uid: string;
  name: string;
  state: MonsterState;
  maxHp: number;
  visible: boolean;
}

function easeOutCubic(k: number): number {
  return 1 - (1 - k) ** 3;
}

function easeOutQuad(k: number): number {
  return 1 - (1 - k) ** 2;
}

function world(pos: { q: number; r: number }): Point {
  return axialToPixel(pos, BASE_HEX_SIZE);
}

/**
 * 把规则层的事件流排成一条时间轴，逐帧产出表现状态。
 *
 * 规则层不知道演出参数，表现层也不碰规则状态：两边只通过
 * GameEvent 与 RenderModel 交换信息。同一批事件里，怪物的行动按
 * 事件顺序排队演出，因此玩家能看清「谁动了、谁打了我」。
 */
export class PresentationDirector {
  private time = 0;
  /** 上一批已消费的事件；引用相同说明这次转移没有产生新事件。 */
  private lastEvents: GameEvent[] | null = null;

  private posTracks = new Map<string, PosTrack[]>();
  private numTracks = new Map<string, NumTrack[]>();
  private lunges: LungeTrack[] = [];
  private streaks: StreakTrack[] = [];
  private floaters: FloaterTrack[] = [];
  private flashes: FlashTrack[] = [];
  private shakes: ShakeTrack[] = [];
  /** 每个单位的命中时刻，用于算闪白强度。 */
  private hits = new Map<string, number>();

  private units = new Map<string, UnitInfo>();
  /** 当前局面里仍在场的怪物 uid。 */
  private present = new Set<string>();
  private basePos = new Map<string, Point>();
  private baseNum = new Map<string, number>();
  private playerMaxHp = 100;
  private seed = -1;

  /** 新开局：清空时间轴，直接落到终态。 */
  reset(model: RenderModel): void {
    this.lastEvents = null;
    this.seed = model.seed;
    this.posTracks.clear();
    this.numTracks.clear();
    this.lunges = [];
    this.streaks = [];
    this.floaters = [];
    this.flashes = [];
    this.shakes = [];
    this.hits.clear();
    this.units.clear();
    this.present.clear();
    this.basePos.clear();
    this.baseNum.clear();

    this.playerMaxHp = model.playerMaxHp;
    this.basePos.set(PLAYER, world(model.player));
    this.baseNum.set('hp:player', model.playerHp);
    this.baseNum.set('alpha:player', 1);

    for (const monster of model.monsters) {
      this.units.set(monster.uid, {
        uid: monster.uid,
        name: monster.name,
        state: monster.state,
        maxHp: monster.maxHp,
        visible: monster.visible,
      });
      this.basePos.set(monster.uid, world(monster.pos));
      this.baseNum.set(`hp:${monster.uid}`, monster.hp);
      this.baseNum.set(`alpha:${monster.uid}`, monster.visible ? 1 : 0);
    }
  }

  /**
   * 消费一次状态转移。events 是该次转移产出的全部事件，按顺序演出。
   */
  push(model: RenderModel, events: GameEvent[], now: number): void {
    this.time = now;
    if (model.seed !== this.seed) {
      this.reset(model);
    } else if (events === this.lastEvents) {
      return;
    }
    this.lastEvents = events;

    // 这一批里要演出的位移：这些单位的落点不能被新局面的位置覆盖，
    // 否则动画会从终点开始，等于没动。
    const animated = new Set<string>();
    for (const event of events) {
      if (event.type === 'playerMoved') animated.add(PLAYER);
      if (event.type === 'monsterMoved') animated.add(event.monsterUid);
    }

    this.reconcile(model, now, animated);

    let cursor = now;
    for (const event of events) cursor = this.schedule(event, cursor);

    this.settlePlayerHp(model, cursor);
  }

  /** 推进到指定时刻，产出当前应绘制的一帧。 */
  tick(now: number): PresentationFrame {
    this.time = now;
    this.prune(now);

    const monsters: PresentationMonster[] = [];
    for (const [uid, info] of this.units) {
      const alpha = this.currentNum(`alpha:${uid}`);
      if (alpha <= 0.005 && !this.present.has(uid)) {
        this.forget(uid);
        continue;
      }
      monsters.push({
        uid,
        name: info.name,
        state: info.state,
        pos: this.renderPos(uid),
        hp: this.currentNum(`hp:${uid}`),
        maxHp: info.maxHp,
        alpha,
        hit: this.hitStrength(uid, now),
      });
    }

    const floaters: PresentationFloater[] = this.floaters
      .filter((f) => now >= f.start && now <= f.start + f.life)
      .map((f) => ({
        pos: f.pos,
        text: f.text,
        tone: f.tone,
        progress: (now - f.start) / f.life,
      }));

    const flashes: PresentationFlash[] = this.flashes
      .filter((f) => now >= f.start && now <= f.start + f.life)
      .map((f) => ({
        pos: f.pos,
        progress: (now - f.start) / f.life,
        strength: f.strength,
      }));

    const streaks = this.streaks
      .filter((s) => now >= s.start && now <= s.end)
      .map((s) => ({
        from: s.from,
        to: s.to,
        progress: (now - s.start) / (s.end - s.start),
      }));

    let shakeX = 0;
    let shakeY = 0;
    for (const shake of this.shakes) {
      if (now < shake.start || now > shake.start + shake.life) continue;
      const k = (now - shake.start) / shake.life;
      const decay = 1 - k;
      shakeX += Math.sin(k * 47) * shake.power * decay;
      shakeY += Math.cos(k * 39) * shake.power * decay * 0.7;
    }

    return {
      player: {
        pos: this.renderPos(PLAYER),
        hp: this.currentNum('hp:player'),
        maxHp: this.playerMaxHp,
        hit: this.hitStrength(PLAYER, now),
        moving: this.hasActivePosTrack(PLAYER),
      },
      monsters,
      floaters,
      flashes,
      streaks,
      shake: { x: shakeX, y: shakeY },
    };
  }

  // ---------- 排期 ----------

  private schedule(event: GameEvent, cursor: number): number {
    switch (event.type) {
      case 'playerMoved': {
        const to = world(event.to);
        this.pushPos(PLAYER, this.currentPos(PLAYER), to, cursor, cursor + DUR.playerStep);
        return cursor + DUR.playerStep;
      }

      case 'monsterMoved': {
        const info = this.units.get(event.monsterUid);
        // 看不见的怪不演出：画出来等于泄露它的位置。
        if (!info || !info.visible) {
          this.basePos.set(event.monsterUid, world(event.to));
          return cursor;
        }
        const from = this.currentPos(event.monsterUid);
        const to = world(event.to);
        const steps = Math.max(1, hexDistance(event.from, event.to));
        const duration = DUR.monsterStep * steps;
        this.pushPos(event.monsterUid, from, to, cursor, cursor + duration);
        return cursor + duration;
      }

      case 'playerAttacked': {
        const target = world(event.target);
        const attacker = this.currentPos(PLAYER);
        const distance = Math.hypot(target.x - attacker.x, target.y - attacker.y);
        const ranged = distance > BASE_HEX_SIZE * 1.5;
        const hitAt = cursor + DUR.hitDelay;

        if (ranged) {
          this.streaks.push({ from: attacker, to: target, start: cursor, end: hitAt + 90 });
        } else {
          this.pushLunge(PLAYER, attacker, target, cursor, cursor + DUR.lunge);
        }

        const info = this.units.get(event.monsterUid);
        const seen = info?.visible ?? false;
        // 看不见的目标只在玩家脚下报数，避免把它的位置暴露出来。
        const at = seen ? target : attacker;
        this.flashes.push({ pos: at, start: hitAt, life: DUR.flash, strength: seen ? 1 : 0.45 });
        this.floaters.push({
          pos: at,
          text: `-${event.damage}`,
          tone: 'damage',
          start: hitAt,
          life: DUR.floater,
        });
        if (seen) this.hits.set(event.monsterUid, hitAt);

        const hpKey = `hp:${event.monsterUid}`;
        if (this.baseNum.has(hpKey)) {
          this.pushNum(hpKey, this.currentNum(hpKey) - event.damage, hitAt, hitAt + DUR.hp);
        }
        return cursor + (ranged ? DUR.hitDelay + 90 : DUR.lunge);
      }

      case 'monsterAttacked': {
        const target = world(event.target);
        const attacker = this.currentPos(event.monsterUid);
        const hitAt = cursor + DUR.hitDelay;
        const info = this.units.get(event.monsterUid);

        if (info?.visible) {
          this.pushLunge(event.monsterUid, attacker, target, cursor, cursor + DUR.lunge);
        }

        this.flashes.push({ pos: target, start: hitAt, life: DUR.flash, strength: 1 });
        this.floaters.push({
          pos: target,
          text: event.avoided ? '格挡' : `-${event.damage}`,
          tone: event.avoided ? 'block' : 'damage',
          start: hitAt,
          life: DUR.floater,
        });
        this.hits.set(PLAYER, hitAt);
        this.shakes.push({
          power: event.avoided ? 2 : 5,
          start: hitAt,
          life: 260,
        });

        this.pushNum(
          'hp:player',
          this.currentNum('hp:player') - event.damage,
          hitAt,
          hitAt + DUR.hp,
        );
        return cursor + (info?.visible ? DUR.lunge : DUR.hitDelay);
      }

      case 'monsterDied': {
        const at = world(event.at);
        this.flashes.push({ pos: at, start: cursor, life: DUR.flash * 1.5, strength: 1.4 });
        this.pushNum(`alpha:${event.monsterUid}`, 0, cursor, cursor + DUR.death);
        return cursor;
      }

      case 'playerHealed': {
        const at = this.currentPos(PLAYER);
        this.floaters.push({
          pos: at,
          text: `+${event.amount}`,
          tone: 'heal',
          start: cursor,
          life: DUR.floater,
        });
        this.pushNum(
          'hp:player',
          this.currentNum('hp:player') + event.amount,
          cursor,
          cursor + DUR.hp,
        );
        return cursor + DUR.hp;
      }

      case 'playerBuffed': {
        const at = this.currentPos(PLAYER);
        this.floaters.push({
          pos: at,
          text: event.name,
          tone: 'buff',
          start: cursor,
          life: DUR.floater,
        });
        return cursor;
      }

      case 'playerTrapped': {
        const at = world(event.at);
        const label = event.debuff === 'bleed' ? '流血' : '中毒';
        this.flashes.push({ pos: at, start: cursor, life: DUR.flash, strength: 0.9 });
        this.floaters.push({
          pos: at,
          text: `-${event.damage} ${label}`,
          tone: 'damage',
          start: cursor,
          life: DUR.floater,
        });
        this.shakes.push({ power: 3, start: cursor, life: 220 });
        this.pushNum(
          'hp:player',
          this.currentNum('hp:player') - event.damage,
          cursor,
          cursor + DUR.hp,
        );
        return cursor + DUR.flash;
      }

      case 'bossPhase': {
        const at = this.currentPos(event.monsterUid);
        const info = this.units.get(event.monsterUid);
        if (info?.visible) {
          this.flashes.push({ pos: at, start: cursor, life: DUR.flash * 1.8, strength: 1.2 });
          this.floaters.push({
            pos: at,
            text: `阶段 ${event.phase}`,
            tone: 'buff',
            start: cursor,
            life: DUR.floater,
          });
          this.shakes.push({ power: 4, start: cursor, life: 300 });
        }
        return cursor + DUR.flash * 0.6;
      }

      case 'monsterSummoned': {
        const at = world(event.at);
        this.flashes.push({ pos: at, start: cursor, life: DUR.flash, strength: 0.9 });
        this.floaters.push({
          pos: at,
          text: event.monsterName,
          tone: 'buff',
          start: cursor,
          life: DUR.floater,
        });
        return cursor + DUR.flash * 0.6;
      }

      case 'bossAoE': {
        // AOE 的伤害数字由这里统一报，不再有 monsterAttacked 的重复飘字。
        const at = world(event.at);
        this.flashes.push({ pos: at, start: cursor, life: DUR.flash * 2, strength: 1.5 });
        this.floaters.push({
          pos: at,
          text: event.damage > 0 ? `-${event.damage}` : '躲开',
          tone: event.damage > 0 ? 'damage' : 'block',
          start: cursor,
          life: DUR.floater,
        });
        this.hits.set(PLAYER, cursor);
        this.shakes.push({ power: event.damage > 0 ? 7 : 2, start: cursor, life: 320 });
        if (event.damage > 0) {
          this.pushNum(
            'hp:player',
            this.currentNum('hp:player') - event.damage,
            cursor,
            cursor + DUR.hp,
          );
        }
        return cursor + DUR.flash;
      }

      default:
        return cursor;
    }
  }

  /** 局面与事件不一致时（ buff 减伤等），把体力条拉回真值。 */
  private settlePlayerHp(model: RenderModel, cursor: number): void {
    const settled = this.settledNum('hp:player');
    if (Math.abs(settled - model.playerHp) > 0.01) {
      this.pushNum('hp:player', model.playerHp, cursor, cursor + DUR.hp);
    }
  }

  /** 让单位与新局面对齐：新增、淡入淡出、记录在场者。 */
  private reconcile(model: RenderModel, now: number, animated: Set<string>): void {
    this.playerMaxHp = model.playerMaxHp;
    this.present.clear();
    // 位置只在没有正在跑的动画、也不在待演出的位移里时才跟随局面走，
    // 否则会把动画的起点冲掉。
    if (!animated.has(PLAYER) && !this.hasActivePosTrack(PLAYER)) {
      this.basePos.set(PLAYER, world(model.player));
    }

    for (const monster of model.monsters) {
      this.present.add(monster.uid);
      const known = this.units.get(monster.uid);
      if (!known) {
        this.units.set(monster.uid, {
          uid: monster.uid,
          name: monster.name,
          state: monster.state,
          maxHp: monster.maxHp,
          visible: monster.visible,
        });
        this.basePos.set(monster.uid, world(monster.pos));
        this.baseNum.set(`hp:${monster.uid}`, monster.hp);
        this.baseNum.set(`alpha:${monster.uid}`, 0);
        this.pushNum(`alpha:${monster.uid}`, monster.visible ? 1 : 0, now, now + DUR.fade);
        continue;
      }
      known.name = monster.name;
      known.state = monster.state;
      known.maxHp = monster.maxHp;
      known.visible = monster.visible;

      if (!animated.has(monster.uid) && !this.hasActivePosTrack(monster.uid)) {
        this.basePos.set(monster.uid, world(monster.pos));
      }

      const alpha = this.currentNum(`alpha:${monster.uid}`);
      if (monster.visible && alpha < 1) {
        this.pushNum(`alpha:${monster.uid}`, 1, now, now + DUR.fade);
      } else if (!monster.visible && alpha > 0) {
        this.pushNum(`alpha:${monster.uid}`, 0, now, now + DUR.fade);
      }
    }
  }

  private hasActivePosTrack(key: string): boolean {
    const tracks = this.posTracks.get(key);
    if (!tracks) return false;
    return tracks.some((track) => track.start <= this.time && this.time < track.end);
  }

  private forget(uid: string): void {
    this.units.delete(uid);
    this.basePos.delete(uid);
    this.baseNum.delete(`hp:${uid}`);
    this.baseNum.delete(`alpha:${uid}`);
    this.posTracks.delete(uid);
    this.numTracks.delete(`hp:${uid}`);
    this.numTracks.delete(`alpha:${uid}`);
    this.hits.delete(uid);
  }

  private prune(now: number): void {
    for (const [key, tracks] of this.posTracks) {
      const kept = tracks.filter((t) => t.end >= now - 200);
      if (kept.length > 0) this.posTracks.set(key, kept);
      else this.posTracks.delete(key);
    }
    for (const [key, tracks] of this.numTracks) {
      const kept = tracks.filter((t) => t.end >= now - 200);
      if (kept.length > 0) this.numTracks.set(key, kept);
      else this.numTracks.delete(key);
    }
    this.lunges = this.lunges.filter((l) => l.end >= now - 200);
    this.streaks = this.streaks.filter((s) => s.end >= now - 200);
    this.floaters = this.floaters.filter((f) => f.start + f.life >= now - 100);
    this.flashes = this.flashes.filter((f) => f.start + f.life >= now - 100);
    this.shakes = this.shakes.filter((s) => s.start + s.life >= now - 100);
  }

  // ---------- 轨道 ----------

  private pushPos(key: string, from: Point, to: Point, start: number, end: number): void {
    const tracks = this.posTracks.get(key) ?? [];
    tracks.push({ from, to, start, end });
    this.posTracks.set(key, tracks);
    this.basePos.set(key, to);
  }

  private pushNum(key: string, to: number, start: number, end: number): void {
    const from = this.currentNum(key);
    const tracks = this.numTracks.get(key) ?? [];
    tracks.push({ from, to, start, end });
    this.numTracks.set(key, tracks);
    this.baseNum.set(key, to);
  }

  private pushLunge(
    key: string,
    from: Point,
    target: Point,
    start: number,
    end: number,
  ): void {
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    // 前冲要够大才读得出「出手了」：相邻一格大约半个地块的深度
    const reach = Math.min(distance * 0.5, 30);
    this.lunges.push({
      key,
      dx: (dx / distance) * reach,
      dy: (dy / distance) * reach,
      start,
      end,
    });
  }

  private currentPos(key: string): Point {
    const tracks = this.posTracks.get(key);
    if (!tracks || tracks.length === 0) return this.basePos.get(key) ?? { x: 0, y: 0 };
    let active: PosTrack | undefined;
    for (const track of tracks) if (track.start <= this.time) active = track;
    if (!active) return tracks[0].from;
    if (this.time >= active.end) return active.to;
    const k = (this.time - active.start) / (active.end - active.start);
    const e = easeOutCubic(k);
    return {
      x: active.from.x + (active.to.x - active.from.x) * e,
      y: active.from.y + (active.to.y - active.from.y) * e,
    };
  }

  private currentNum(key: string): number {
    const tracks = this.numTracks.get(key);
    if (!tracks || tracks.length === 0) return this.baseNum.get(key) ?? 0;
    let active: NumTrack | undefined;
    for (const track of tracks) if (track.start <= this.time) active = track;
    if (!active) return tracks[0].from;
    if (this.time >= active.end) return active.to;
    const k = (this.time - active.start) / (active.end - active.start);
    return active.from + (active.to - active.from) * easeOutQuad(k);
  }

  /** 轨道走完后应当停下的数值。 */
  private settledNum(key: string): number {
    const tracks = this.numTracks.get(key);
    if (!tracks || tracks.length === 0) return this.baseNum.get(key) ?? 0;
    return tracks[tracks.length - 1].to;
  }

  private renderPos(key: string): Point {
    const base = this.currentPos(key);
    let offsetX = 0;
    let offsetY = 0;
    for (const lunge of this.lunges) {
      if (lunge.key !== key) continue;
      if (this.time < lunge.start || this.time > lunge.end) continue;
      const k = (this.time - lunge.start) / (lunge.end - lunge.start);
      const swing = Math.sin(Math.PI * k);
      offsetX += lunge.dx * swing;
      offsetY += lunge.dy * swing;
    }
    return { x: base.x + offsetX, y: base.y + offsetY };
  }

  private hitStrength(key: string, now: number): number {
    const at = this.hits.get(key);
    if (at === undefined) return 0;
    const elapsed = now - at;
    if (elapsed < 0 || elapsed > 240) return 0;
    return 1 - elapsed / 240;
  }
}
