import type { Ctx, Trigger } from '../core/types';

export interface EventPayloads {
  passive: { ctx: Ctx };
  onHit: { ctx: Ctx };
  onDamage: { ctx: Ctx; amount: number };
  onKill: { ctx: Ctx; byMelee: boolean };
  onCast: { ctx: Ctx };
  onReload: { ctx: Ctx };
  onHeavy: { ctx: Ctx };
  onWaveStart: { ctx: Ctx; wave: number };
  onWaveEnd: { ctx: Ctx; wave: number };
  onPurchase: { ctx: Ctx; itemId: string };
  onPlace: { ctx: Ctx };
}
export type EventName = Trigger;
type Handler<K extends EventName> = (p: EventPayloads[K]) => void;

export class EventBus {
  private handlers = new Map<EventName, ((p: unknown) => void)[]>();
  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(fn as (p: unknown) => void);
    this.handlers.set(name, list);
    return () => {
      const l = this.handlers.get(name);
      if (l) { const i = l.indexOf(fn as (p: unknown) => void); if (i >= 0) l.splice(i, 1); }
    };
  }
  emit<K extends EventName>(name: K, payload: EventPayloads[K]): void {
    for (const fn of (this.handlers.get(name) ?? []).slice()) fn(payload);
  }
  clear(): void { this.handlers.clear(); }
}
