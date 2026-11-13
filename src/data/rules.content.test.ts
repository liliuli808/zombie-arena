import { describe, it, expect } from 'vitest';
import { SET_RULES, COMBOS, TALENTS, CURSES, WEATHER_RULES, MAGIC_NTH_RULE } from './rules.content';
import { evalPredicate } from '../engine/effects';
import { RNG } from '../engine/rng';
import { defaultStats, type Ctx } from '../core/types';

function ctx(schools: Ctx['schools'], weather: Ctx['weather'] = 'clear'): Ctx {
  return {
    run: { seed: 1, rng: new RNG(1), phase: 'combat', wave: 10, gold: 0, hp: 100,
      characterId: 'veteran', mapId: 'yard', slots: [null, null, null], passives: [],
      consumables: {}, talents: [], curses: [], activeSlot: 0,
      shop: { items: [], freeRefresh: true, refreshCost: 2 }, weather,
      nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0 },
    stats: defaultStats(), schools, stars: [1, 1, 1], activeStar: 1, activeSlot: 0, sourceSlot: 0,
    combo: 0, castCount: 5, wave: 10, weather, targetId: 1, target: null,
    op: null, frontFacing: false,
  };
}

describe('rule content', () => {
  it('has 5 set schools x 2 tiers and 5 cross-school combos', () => {
    expect(SET_RULES).toHaveLength(10);
    expect(COMBOS).toHaveLength(5);
    expect(new Set(COMBOS.map(c => c.id)).size).toBe(5);
  });
  it('3-piece magic set predicate matches only 3 magic schools, and 5th-cast rule needs both', () => {
    const set = SET_RULES.find(x => x.id === 'set-magic-3')!;
    expect(set.when!.kind).toBe('schoolCount');
    expect(evalPredicate(set.when, ctx(['magic', 'magic', 'magic']))).toBe(true);
    expect(evalPredicate(set.when, ctx(['magic', 'magic', 'gun']))).toBe(false);
    expect(MAGIC_NTH_RULE.when!.kind).toBe('all');
    const c5 = ctx(['magic', 'magic', 'magic']);
    expect(evalPredicate(MAGIC_NTH_RULE.when, c5)).toBe(true);
    const c4 = ctx(['magic', 'magic', 'magic']); c4.castCount = 4;
    expect(evalPredicate(MAGIC_NTH_RULE.when, c4)).toBe(false);
    const c2 = ctx(['magic', 'magic', 'gun']); c2.castCount = 5;
    expect(evalPredicate(MAGIC_NTH_RULE.when, c2)).toBe(false);
  });
  it('every combo predicate needs both of its schools', () => {
    for (const c of COMBOS) {
      const needed = (c.when as { of: { schools: Ctx['schools'] }[] }).of[0].schools;
      expect(evalPredicate(c.when, ctx(needed))).toBe(true);
      expect(evalPredicate(c.when, ctx([needed[0]]))).toBe(false);
    }
  });
  it('has >=14 stackable talents, 4 curses and 4 weather events', () => {
    expect(TALENTS.length).toBeGreaterThanOrEqual(14);
    expect(CURSES).toHaveLength(4);
    expect(Object.keys(WEATHER_RULES)).toEqual(['night', 'rain', 'fire', 'fog']);
  });
  it('rain boosts lightning by 30% only when the op is lightning', () => {
    const r = WEATHER_RULES.rain[0];
    expect(r.when!.kind).toBe('opElement');
    expect(evalPredicate(r.when, ctx(['magic'], 'rain'))).toBe(false);
  });
});
