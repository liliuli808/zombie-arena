import type { ActiveRule, Ctx, EffectStage, Trigger } from '../core/types';
import { STAGE_ORDER } from '../core/types';
import { EventBus, type EventPayloads } from './events';
import { evalPredicate, applyEffect, type EffectSink } from './effects';

export class RuleEngine {
  private rules: ActiveRule[] = [];
  private unsubs: (() => void)[] = [];
  private sink: EffectSink;

  constructor(private bus: EventBus, sink?: EffectSink) {
    this.sink = sink ?? {
      op: null, heal() {}, gold() {}, status() {}, spawn() {}, stat() {}, vfx() {},
    };
    // onHit 由 dealDamage() 独占派发（需要在派发前注入目标僵尸的特性规则），
    // 引擎只订阅其余事件，避免同一条 onHit 规则被应用两次。
    const triggers: Trigger[] = ['onDamage', 'onKill', 'onCast', 'onReload',
      'onHeavy', 'onWaveStart', 'onWaveEnd', 'onPurchase', 'onPlace'];
    for (const t of triggers) {
      this.unsubs.push(this.bus.on(t, ((p: { ctx: Ctx }) => this.dispatch(t, p.ctx)) as never));
    }
  }

  setSink(sink: EffectSink): void { this.sink = sink; }

  setRules(rules: ActiveRule[]): void {
    this.rules = rules
      .filter(r => r.trigger !== 'passive')
      .slice()
      .sort((a, b) => STAGE_ORDER[a.stage as EffectStage] - STAGE_ORDER[b.stage as EffectStage]
        || a.order - b.order);
  }

  private dispatch(trigger: Trigger, ctx: Ctx): void {
    this.dispatchFor(trigger, ctx);
  }

  /** 唯一的规则求值入口。dealDamage() 传入 extraRules 注入目标僵尸特性，
   *  事件订阅不传。sorted() 保证 stage/order 顺序。 */
  dispatchFor(trigger: Trigger, ctx: Ctx, extraRules: ActiveRule[] = []): void {
    const all = extraRules.length === 0 ? this.rules
      : [...this.rules, ...extraRules].sort((a, b) =>
          STAGE_ORDER[a.stage as EffectStage] - STAGE_ORDER[b.stage as EffectStage] || a.order - b.order);
    for (const r of all) {
      if (r.trigger !== trigger) continue;
      if (!evalPredicate(r.when, ctx)) continue;
      for (const e of r.effects) applyEffect(e, this.sink, ctx);
    }
  }

  dispose(): void { for (const u of this.unsubs) u(); this.unsubs = []; }
}
export type { EventPayloads };
