import { describe, it, expect } from 'vitest';
import { World, dealDamage, tickStatuses, elementReaction } from './combat';
import { createRunState, resolveLoadout } from './state';
import { EventBus } from '../engine/events';
import { newDamageOp, type Entity } from '../core/types';

function mkEntity(id: number, kind = 'walker', hp = 100): Entity {
  return { id, kind, x: 100, y: 100, radius: 12, hp, maxHp: hp,
    speed: 40, facing: 0, tags: [], statuses: [], dead: false, ttl: 0, data: {} };
}
function world() {
  const run = createRunState(3, 'veteran', 'yard');
  const bus = new EventBus();
  const w = new World(run, bus);
  w.setRules(resolveLoadout(run).rules);
  return { w, run, bus };
}

describe('dealDamage pipeline', () => {
  it('applies onHit rules before committing damage', () => {
    const { w } = world();
    const e = mkEntity(1); w.entities.push(e);
    w.extraRules.push({ id: 'x', trigger: 'onHit', stage: 'add', order: 1,
      effects: [{ kind: 'dmgAdd', v: 10 }] });
    const op = newDamageOp(10, 'gun', 1, ['bullet']);
    const dmg = dealDamage(w, e, op);
    expect(dmg).toBe(20);
    expect(e.hp).toBe(80);
  });
  it('shield zombie negates frontal bullets but not back hits or magic', () => {
    const { w } = world();
    const e = mkEntity(2, 'shield'); w.entities.push(e);
    const front = newDamageOp(30, 'gun', 2, ['bullet']);
    expect(dealDamage(w, e, front, true)).toBe(0);
    const back = newDamageOp(30, 'gun', 2, ['bullet']);
    expect(dealDamage(w, e, back, false)).toBeGreaterThan(0);
    const spell = newDamageOp(30, 'magic', 2, ['spell']);
    expect(dealDamage(w, e, spell, true)).toBeGreaterThan(0);
  });
  it('breakArmor tag bypasses the armored damage reduction', () => {
    const { w } = world();
    const e = mkEntity(3, 'armored'); w.entities.push(e);
    const normal = newDamageOp(100, 'gun', 3, ['bullet']);
    const broken = newDamageOp(100, 'blunt', 3, ['heavy', 'breakArmor']);
    expect(dealDamage(w, e, broken)).toBeGreaterThan(dealDamage(w, e, normal));
  });
  it('emits onKill and awards gold once', () => {
    const { w, run, bus } = world();
    const e = mkEntity(4); e.hp = 5; w.entities.push(e);
    let kills = 0; bus.on('onKill', () => { kills++; });
    dealDamage(w, e, newDamageOp(50, 'blade', 4, ['melee']));
    expect(kills).toBe(1);
    expect(run.kills).toBe(1);
    expect(e.dead).toBe(true);
    dealDamage(w, e, newDamageOp(50, 'blade', 4, ['melee']));
    expect(run.kills).toBe(1);
  });
  it('rain weather boosts lightning damage by 30%', () => {
    const { w, run } = world();
    run.weather = 'rain';
    w.setRules(resolveLoadout(run).rules);
    const e = mkEntity(5); w.entities.push(e);
    const op = newDamageOp(100, 'magic', 5, ['spell']); op.element = 'lightning';
    expect(dealDamage(w, e, op)).toBe(130);
  });
});

describe('statuses and element reactions', () => {
  it('burn ticks damage, chill freezes at cap, shock chains', () => {
    const { w } = world();
    const e = mkEntity(6); w.entities.push(e);
    e.statuses.push({ id: 'burn', stacks: 2, time: 1 });
    const hp0 = e.hp; tickStatuses(w, e, 0.5); expect(e.hp).toBeLessThan(hp0);
    e.statuses = [{ id: 'chill', stacks: 3, time: 2 }];
    expect(elementReaction(e, 'chill')).toBe('freeze');
    e.statuses = [{ id: 'shock', stacks: 3, time: 2 }];
    expect(elementReaction(e, 'shock')).toBe('chain');
  });
});
