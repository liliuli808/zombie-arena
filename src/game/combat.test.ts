import { describe, it, expect } from 'vitest';
import { World, dealDamage, tickStatuses, elementReaction } from './combat';
import { ZOMBIE_BY_ID } from '../data/zombies';
import { createRunState, resolveLoadout } from './state';
import { EventBus } from '../engine/events';
import { newDamageOp, newSlotResource, type Entity } from '../core/types';

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
  it('a backup star-2 weapon does not buff damage from another slot', () => {
    const { w, run } = world();
    run.slots[0] = { weaponId: 'pistol', star: 2, res: newSlotResource() };
    run.slots[1] = { weaponId: 'katana', star: 1, res: newSlotResource() };
    w.setRules(resolveLoadout(run).rules);
    w.stats.critChance = 0; // 排除随机暴击，只看星级规则
    const e = mkEntity(20, 'walker', 1000); w.entities.push(e);
    // 刀（slot 1）打出伤害：备用栏的 ★2 手枪不应该 +3.5
    const knifeHit = dealDamage(w, e, newDamageOp(10, 'blade', 20, ['melee'], 1));
    expect(knifeHit).toBe(10);
    // 手枪（slot 0）自己打出伤害：★2 规则生效
    const gunHit = dealDamage(w, e, newDamageOp(10, 'gun', 20, ['bullet'], 0));
    expect(gunHit).toBe(13.5);
  });
});

describe('death visuals', () => {
  it('records one death record per killed enemy and clears it after 0.8s', () => {
    const { w } = world();
    const e = mkEntity(9);
    w.entities.push(e);
    w.kill(e, false);
    expect(w.deaths).toHaveLength(1);
    expect(w.deaths[0]!.kind).toBe('walker');
    w.kill(e, false);
    expect(w.deaths).toHaveLength(1);
    w.tickDeaths(0.79);
    expect(w.deaths).toHaveLength(1);
    w.tickDeaths(0.02);
    expect(w.deaths).toHaveLength(0);
  });

  it('does not record player or deployable deaths', () => {
    const { w } = world();
    const p = mkEntity(1, 'veteran');
    const d = mkEntity(10, 'turret');
    d.tags.push('deployable');
    w.entities.push(p, d);
    w.kill(p, false);
    w.kill(d, false);
    expect(w.deaths).toHaveLength(0);
  });
});

describe('DoT kills go through the same kill accounting', () => {
  it('burn/poison deaths award gold, kills, boss kills, explosions and onKill', () => {
    const { w, run, bus } = world();
    let killed = 0;
    bus.on('onKill', () => { killed++; });
    const e = mkEntity(10, 'fatty', 3); // 胖子死亡会爆炸
    e.tags = ZOMBIE_BY_ID['fatty'].tags.slice();
    w.entities.push(e);
    e.statuses.push({ id: 'burn', stacks: 1, time: 2 });
    tickStatuses(w, e, 1); // 3 * 1 * 1 = 3 伤害，刚好致死
    expect(e.dead).toBe(true);
    expect(run.kills).toBe(1);
    expect(run.gold).toBe(15 + 1);
    expect(killed).toBe(1);
    expect(w.spawned.some(s => s.what === 'explosion' && s.hostile)).toBe(true);
    tickStatuses(w, e, 1); // 已死的实体不能重复结算
    expect(run.kills).toBe(1);
    expect(run.gold).toBe(16);
  });
  it('boss killed by DoT increments bossKills and pays boss gold', () => {
    const { w, run } = world();
    const e = mkEntity(11, 'butcher', 2);
    w.entities.push(e);
    e.statuses.push({ id: 'poison', stacks: 1, time: 2 });
    tickStatuses(w, e, 1);
    expect(e.dead).toBe(true);
    expect(run.bossKills).toBe(1);
    expect(run.gold).toBe(15 + 15);
  });
  it('elementCapAdd lowers the reaction cap', () => {
    const e = mkEntity(12);
    e.statuses = [{ id: 'chill', stacks: 2, time: 2 }];
    expect(elementReaction(e, 'chill', 1)).toBe('freeze');
    expect(elementReaction(e, 'chill', 0)).toBeNull();
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
