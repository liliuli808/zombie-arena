import { EventBus } from '../engine/events';
import { RuleEngine } from '../engine/rules';
import { makeOpSink, type EffectSink } from '../engine/effects';
import { finalDamage, newDamageOp,
  type RunState, type Entity, type DamageOp, type Ctx, type Rule,
  type StatusId, type ActiveRule, type PlayerStats } from '../core/types';
import { makeCtx, resolveLoadout } from './state';
import { ZOMBIE_BY_ID } from '../data/zombies';

export class World {
  entities: Entity[] = [];
  private nextId = 1;
  ruleSet: ActiveRule[] = [];
  extraRules: Rule[] = [];
  stats: PlayerStats;
  engine: RuleEngine;
  sink: EffectSink;
  logs: string[] = [];
  spawned: { what: string; n: number; x?: number; y?: number; hostile?: boolean }[] = [];
  floating: { x: number; y: number; text: string; time: number }[] = [];

  constructor(public run: RunState, public bus: EventBus) {
    this.stats = resolveLoadout(run).stats;
    this.sink = {
      op: null,
      heal: v => { this.run.hp = Math.min(this.stats.maxHp, this.run.hp + v); },
      gold: v => { this.run.gold += v; this.run.totalGoldEarned += v; },
      status: (s, stacks) => this.addStatus(this.currentTarget, s, stacks),
      spawn: (what, n) => this.spawned.push({ what, n }),
      stat: () => {},
      vfx: name => this.logs.push(name),
    };
    this.engine = new RuleEngine(bus, this.sink);
    this.bus.on('onKill', (p) => {
      if (p.byMelee && this.stats.meleeKillHeal > 0) this.sink.heal(this.stats.meleeKillHeal);
    });
  }
  currentTarget: Entity | null = null;
  setRules(rules: ActiveRule[]): void {
    this.stats = resolveLoadout(this.run).stats;
    this.ruleSet = rules.slice();
    this.engine.setRules(this.ruleSet); // extraRules 只由 dealDamage 注入 onHit 求值
  }
  ctxFor(target: Entity | null, op: DamageOp | null, frontFacing: boolean): Ctx {
    return makeCtx(this.run, this.stats, {
      targetId: target?.id ?? 0, target, op, frontFacing,
    });
  }
  newId(): number { return this.nextId++; }
  /** 唯一的击杀结算入口：子弹伤害与 DoT（灼烧/中毒）死亡都必须走这里，
   *  否则金币、击杀数、Boss 计数、死亡爆炸、吸血回血会漏发。 */
  kill(e: Entity, byMelee: boolean, ctx?: Ctx): void {
    if (e.dead) return;
    e.dead = true;
    this.run.kills += 1;
    const def = ZOMBIE_BY_ID[e.kind];
    if (def) {
      this.run.gold += def.gold; this.run.totalGoldEarned += def.gold;
      if (def.boss) this.run.bossKills += 1;
      if (e.tags.includes('explodes'))
        this.spawned.push({ what: 'explosion', n: 1, x: e.x, y: e.y, hostile: true });
    }
    const c = ctx ?? this.ctxFor(e, null, false);
    this.bus.emit('onKill', { ctx: c, byMelee });
  }
  addStatus(e: Entity | null, s: StatusId, stacks: number, time = 2): void {
    if (!e) return;
    const cur = e.statuses.find(x => x.id === s);
    if (cur) { cur.stacks += stacks; cur.time = Math.max(cur.time, time); }
    else e.statuses.push({ id: s, stacks, time });
  }
  float(x: number, y: number, text: string): void { this.floating.push({ x, y, text, time: 0.8 }); }
  sweepDead(): void { this.entities = this.entities.filter(e => !e.dead); }
}

export function dealDamage(w: World, target: Entity, op: DamageOp, frontFacing = false): number {
  if (target.dead) return 0;
  w.currentTarget = target;
  const ctx = w.ctxFor(target, op, frontFacing);
  w.sink.op = op;

  // 僵尸自身特性规则（同属声明式规则，按 stage/order 参与求值）。
  // 注入到 dispatchFor 的 extraRules，与 loadout 规则一起排序后**只求值一次**。
  const zombieRules: ActiveRule[] = [
    ...(w.extraRules as ActiveRule[]),
    ...((ZOMBIE_BY_ID[target.kind]?.rules ?? []) as ActiveRule[]),
  ];
  w.engine.dispatchFor('onHit', ctx, zombieRules);
  // 暴击判定（被动规则里 critChance 由 stats 提供）
  if (!op.crit && w.run.rng.chance(w.stats.critChance)) op.crit = true;

  // 三件魔法套装：施法暴击倍率（castCritMult）覆盖默认 2 倍
  if (op.source === 'magic' && op.crit) op.critMult = w.stats.castCritMult;
  const amount = finalDamage(op);
  if (amount > 0) {
    target.hp -= amount;
    w.float(target.x, target.y - 14, String(Math.round(amount)));
    w.bus.emit('onDamage', { ctx, amount });
    if (op.element) {
      const s: StatusId = op.element === 'fire' ? 'burn' : op.element === 'ice' ? 'chill' : 'shock';
      w.addStatus(target, s, 1);
      const reaction = elementReaction(target, s, w.stats.elementCapAdd);
      if (reaction === 'chain') w.spawned.push({ what: 'arc', n: 1, x: target.x, y: target.y, hostile: false });
    }
    if (target.hp <= 0) w.kill(target, op.tags.includes('melee') || op.tags.includes('heavy'), ctx);
  }
  return amount;
}

export function elementReaction(e: Entity, s: StatusId, capAdd = 0): 'freeze' | 'chain' | null {
  const cur = e.statuses.find(x => x.id === s);
  if (!cur) return null;
  const cap = Math.max(1, 3 - capAdd); // 元素亲和：更快叠满，触发冻结/连锁
  if (s === 'chill' && cur.stacks >= cap) {
    if (!e.statuses.some(x => x.id === 'freeze')) e.statuses.push({ id: 'freeze', stacks: 1, time: 1.2 });
    return 'freeze';
  }
  if (s === 'shock' && cur.stacks >= cap) { cur.stacks = 0; return 'chain'; }
  return null;
}

export function tickStatuses(w: World, e: Entity, dt: number): void {
  for (const st of e.statuses) {
    st.time -= dt;
    if (st.id === 'burn') { e.hp -= 3 * st.stacks * dt; w.float(e.x, e.y - 8, '·'); }
    if (st.id === 'poison') e.hp -= 2 * st.stacks * dt;
    if (st.id === 'stun' || st.id === 'freeze') e.data['cc'] = st.time;
    // DoT 致死也要走统一的击杀结算（金币 / 击杀数 / Boss / 胖子爆炸 / 吸血）
    if (e.hp <= 0 && !e.dead) {
      w.kill(e, false);
      break;
    }
  }
  e.statuses = e.statuses.filter(s => s.time > 0);
  if (!e.statuses.some(s => s.id === 'stun' || s.id === 'freeze')) e.data['cc'] = 0;
}
