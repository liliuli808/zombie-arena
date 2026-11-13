import { describe, it, expect } from 'vitest';
import { evalPredicate, applyEffect, makeOpSink, type EffectSink } from './effects';
import { newDamageOp, defaultStats, type Ctx, type PlayerStats } from '../core/types';
import { RNG } from './rng';

function ctx(over: Partial<Ctx> = {}): Ctx {
  return {
    run: { seed: 1, rng: new RNG(1), phase: 'combat', wave: 3, gold: 20, hp: 100,
      characterId: 'veteran', mapId: 'yard', slots: [null, null, null], passives: [],
      consumables: {}, talents: [], curses: [], activeSlot: 0,
      shop: { items: [], freeRefresh: true, refreshCost: 2 }, weather: 'clear',
      nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0 },
    stats: defaultStats(), schools: ['gun', 'magic'], stars: [1, 1, 0], activeStar: 1,
    activeSlot: 0, combo: 4, castCount: 5, wave: 3, weather: 'clear',
    targetId: 9, target: null, op: newDamageOp(10, 'gun', 9, ['bullet']), frontFacing: false, ...over,
  };
}
function sink(ctxVal: Ctx): EffectSink & { healed: number; earned: number } {
  const op = newDamageOp(10, 'gun', 9, ['bullet']);
  ctxVal.op = op;
  const s = makeOpSink(op);
  return Object.assign(s, { healed: 0, earned: 0,
    heal(v: number) { (this as { healed: number }).healed += v; },
    gold(v: number) { (this as { earned: number }).earned += v; },
  });
}

describe('evalPredicate', () => {
  const c = ctx();
  it('combines all/any/not', () => {
    expect(evalPredicate({ kind: 'all', of: [{ kind: 'schoolCount', school: 'gun', min: 1 }, { kind: 'comboAtLeast', n: 3 }] }, c)).toBe(true);
    expect(evalPredicate({ kind: 'any', of: [{ kind: 'weather', id: 'night' }, { kind: 'comboAtLeast', n: 3 }] }, c)).toBe(true);
    expect(evalPredicate({ kind: 'not', of: { kind: 'weather', id: 'clear' } }, c)).toBe(false);
  });
  it('matches schools, wave/cast modulo, weather, op tags and facing', () => {
    expect(evalPredicate({ kind: 'hasSchools', schools: ['gun', 'magic'] }, c)).toBe(true);
    expect(evalPredicate({ kind: 'castMod', n: 5, rem: 0 }, c)).toBe(true);
    expect(evalPredicate({ kind: 'waveMod', n: 5, rem: 0 }, c)).toBe(false);
    expect(evalPredicate({ kind: 'opTag', tag: 'bullet' }, c)).toBe(true);
    expect(evalPredicate({ kind: 'frontFacing', v: false }, c)).toBe(true);
    expect(evalPredicate({ kind: 'minStar', min: 2 }, c)).toBe(false);
  });
  it('returns false for op predicates when no op exists', () => {
    expect(evalPredicate({ kind: 'opTag', tag: 'bullet' }, ctx({ op: null }))).toBe(false);
  });
});

describe('applyEffect', () => {
  it('mutates DamageOp numbers, element, tags and negation', () => {
    const c = ctx(), s = sink(c);
    for (const e of [
      { kind: 'dmgAdd', v: 5 }, { kind: 'dmgMult', v: 2 }, { kind: 'critAdd', v: 1 },
      { kind: 'setElement', e: 'fire' }, { kind: 'addTag', t: 'elemental' },
    ] as const) applyEffect(e as never, s, c);
    expect(s.op!.add).toBe(5); expect(s.op!.mult).toBe(2);
    expect(s.op!.crit).toBe(true); expect(s.op!.element).toBe('fire');
    expect(s.op!.tags).toContain('elemental');
  });
  it('negate wins regardless of other effects', async () => {
    const { finalDamage } = await import('../core/types');
    const c = ctx(), s = sink(c);
    applyEffect({ kind: 'dmgMult', v: 99 } as never, s, c);
    applyEffect({ kind: 'negate' } as never, s, c);
    expect(finalDamage(s.op!)).toBe(0);
  });
  it('stat patches add, multiply and set', () => {
    const stats: PlayerStats = defaultStats();
    const s = makeOpSink(null, stats);
    applyEffect({ kind: 'stat', key: 'reloadMult', mult: 0.7 } as never, s, ctx());
    applyEffect({ kind: 'stat', key: 'comboCap', add: 4 } as never, s, ctx());
    applyEffect({ kind: 'stat', key: 'comboKeepOnHit', set: true } as never, s, ctx());
    expect(stats.reloadMult).toBeCloseTo(0.7);
    expect(stats.comboCap).toBe(14);
    expect(stats.comboKeepOnHit).toBe(true);
  });
});
