import type { Ctx, Effect, Predicate, DamageOp, PlayerStats, StatusId } from '../core/types';

export function evalPredicate(p: Predicate | undefined, c: Ctx): boolean {
  if (!p) return true;
  switch (p.kind) {
    case 'always': return true;
    case 'all': return p.of.every(x => evalPredicate(x, c));
    case 'any': return p.of.some(x => evalPredicate(x, c));
    case 'not': return !evalPredicate(p.of, c);
    case 'schoolCount': return c.schools.filter(s => s === p.school).length >= p.min;
    case 'hasSchools': return p.schools.every(s => c.schools.includes(s));
    case 'minStar': return c.activeStar >= p.min;
    case 'comboAtLeast': return c.combo >= p.n;
    case 'castMod': return c.castCount > 0 && c.castCount % p.n === p.rem;
    case 'sourceSlot': return c.sourceSlot === p.slot && c.stars[p.slot] >= p.star;
    case 'waveMod': return c.wave % p.n === p.rem;
    case 'weather': return c.weather === p.id;
    case 'opTag': return c.op !== null && c.op.tags.includes(p.tag);
    case 'opElement': return c.op !== null && c.op.element === p.element;
    case 'targetTag': return c.target !== null && c.target.tags.includes(p.tag);
    case 'frontFacing': return c.frontFacing === p.v;
  }
}

export interface EffectSink {
  op: DamageOp | null;
  heal(v: number): void;
  gold(v: number): void;
  status(s: StatusId, stacks: number): void;
  spawn(what: string, n: number): void;
  stat(key: keyof PlayerStats, add?: number, mult?: number, set?: number | boolean): void;
  vfx(name: string): void;
}

export function makeOpSink(op: DamageOp | null, stats?: PlayerStats): EffectSink {
  return {
    op,
    heal() {}, gold() {}, status() {}, spawn() {}, vfx() {},
    stat(key, add, mult, set) {
      if (!stats) return;
      const cur = stats[key];
      if (typeof set === 'boolean') { (stats[key] as boolean) = set; return; }
      if (typeof set === 'number') { (stats[key] as number) = set; return; }
      if (typeof cur !== 'number') return;
      let v = cur;
      if (add !== undefined) v += add;
      if (mult !== undefined) v *= mult;
      (stats[key] as number) = v;
    },
  };
}

export function applyEffect(e: Effect, sink: EffectSink, c: Ctx): void {
  const op = sink.op;
  switch (e.kind) {
    case 'dmgBase': if (op) op.base = e.v; break;
    case 'dmgAdd': if (op) op.add += e.v; break;
    case 'dmgMult': if (op) op.mult *= e.v; break;
    case 'critAdd': if (op) { if (e.v >= 1 || c.run.rng.chance(e.v)) op.crit = true; } break;
    case 'setElement': if (op) op.element = e.e; break;
    case 'addTag': if (op && !op.tags.includes(e.t)) op.tags.push(e.t); break;
    case 'negate': if (op) op.negated = true; break;
    case 'heal': sink.heal(e.v); break;
    case 'gold': sink.gold(e.v); break;
    case 'status': sink.status(e.s, e.stacks); break;
    case 'spawn': sink.spawn(e.what, e.n); break;
    case 'stat': sink.stat(e.key, e.add, e.mult, e.set); break;
    case 'vfx': sink.vfx(e.name); break;
  }
}
