import { describe, it, expect } from 'vitest';
import { RuleEngine } from './rules';
import { EventBus } from './events';
import { RNG } from '../engine/rng';
import { newDamageOp, defaultStats, rule, finalDamage, type Ctx, type Rule, type Effect } from '../core/types';

function ctx(): Ctx {
  return {
    run: { seed: 1, rng: new RNG(1), phase: 'combat', wave: 1, gold: 0, hp: 100,
      characterId: 'veteran', mapId: 'yard', slots: [null, null, null], passives: [],
      consumables: {}, talents: [], curses: [], activeSlot: 0,
      shop: { items: [], freeRefresh: true, refreshCost: 2 }, weather: 'clear',
      nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0 },
    stats: defaultStats(), schools: ['gun'], stars: [1, 0, 0], activeStar: 1, sourceSlot: 0,
    activeSlot: 0, combo: 0, castCount: 0, wave: 1, weather: 'clear',
    targetId: 1, target: null, op: null, frontFacing: false,
  };
}

function runRules(rules: Rule[], base = 10): number {
  const bus = new EventBus();
  const engine = new RuleEngine(bus);
  engine.setRules(rules);
  const c = ctx();
  const op = newDamageOp(base, 'gun', 1, ['bullet']);
  c.op = op;
  engine.setSink({ op, heal() {}, gold() {}, status() {}, spawn() {}, stat() {}, vfx() {} });
  engine.dispatchFor('onHit', c); // onHit 由 dealDamage 独占派发，测试直接调 dispatchFor
  return finalDamage(op);
}

describe('RuleEngine', () => {
  it('applies add before mult regardless of registration order', () => {
    const out = runRules([
      rule('late-mult', 'onHit', [{ kind: 'dmgMult', v: 2 } as Effect], undefined, 'mult'),
      rule('early-add', 'onHit', [{ kind: 'dmgAdd', v: 5 } as Effect], undefined, 'add'),
    ]);
    expect(out).toBe(30); // (10 + 5) * 2
  });
  it('orders rules by stage then by order within stage', () => {
    const out = runRules([
      rule('b', 'onHit', [{ kind: 'dmgAdd', v: 3 } as Effect], undefined, 'add', 200),
      rule('a', 'onHit', [{ kind: 'dmgBase', v: 20 } as Effect], undefined, 'base', 1),
    ]);
    expect(out).toBe(23);
  });
  it('skips rules whose predicate is false', () => {
    const out = runRules([
      rule('weather-only', 'onHit', [{ kind: 'dmgAdd', v: 100 } as Effect], { kind: 'weather', id: 'rain' }, 'add'),
    ]);
    expect(out).toBe(10);
  });
  it('lets a later override stage negate after big multipliers', () => {
    const out = runRules([
      rule('big', 'onHit', [{ kind: 'dmgMult', v: 50 } as Effect], undefined, 'mult'),
      rule('shield', 'onHit', [{ kind: 'negate' } as Effect], undefined, 'override'),
    ]);
    expect(out).toBe(0);
  });
  it('only dispatches rules on their own trigger', () => {
    const out = runRules([
      rule('on-kill', 'onKill', [{ kind: 'dmgAdd', v: 999 } as Effect]),
    ]);
    expect(out).toBe(10);
  });
  it('replacing the rule set takes effect immediately', () => {
    const bus = new EventBus();
    const engine = new RuleEngine(bus);
    engine.setRules([rule('a', 'onHit', [{ kind: 'dmgAdd', v: 1 } as Effect])]);
    engine.setRules([rule('b', 'onHit', [{ kind: 'dmgAdd', v: 7 } as Effect])]);
    const c = ctx(); const op = newDamageOp(10, 'gun', 1); c.op = op;
    engine.setSink({ op, heal() {}, gold() {}, status() {}, spawn() {}, stat() {}, vfx() {} });
    engine.dispatchFor('onHit', c);
    expect(finalDamage(op)).toBe(17);
  });
});
