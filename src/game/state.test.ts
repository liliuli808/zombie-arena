import { describe, it, expect } from 'vitest';
import { createRunState, resolveLoadout } from './state';
import { WEAPON_BY_ID } from '../data/weapons';
import { RNG } from '../engine/rng';
import { newSlotResource, type EquipSlot } from '../core/types';

function run() { return createRunState(42, 'veteran', 'yard'); }
function equip(r: ReturnType<typeof run>, ids: (string | null)[], stars: (1|2|3)[] = [1,1,1]) {
  r.slots = ids.map((id, i) => id ? { weaponId: id, star: stars[i], res: r.slots[i]?.res ?? newSlotResource() } : null);
}

describe('createRunState', () => {
  it('starts at wave 1 in shop with 3 empty slots and seeded RNG', () => {
    const r = run();
    expect(r.wave).toBe(1); expect(r.phase).toBe('shop');
    expect(r.slots).toEqual([null, null, null]);
    expect(r.rng).toBeDefined();
    expect(createRunState(42, 'veteran', 'yard').rng.next()).toBe(new RNG(42).next());
  });
});

describe('resolveLoadout', () => {
  it('applies 2-piece gun set (mag +2) but not 3-piece (reload)', () => {
    const r = run(); equip(r, ['pistol', 'shotgun', null]);
    const l = resolveLoadout(r);
    expect(l.setBonuses).toContainEqual({ school: 'gun', count: 2, tier: 2 });
    expect(l.stats.magSizeAdd).toBe(2);
    expect(l.stats.reloadMult).toBeCloseTo(0.9); // 仅来自老兵
  });
  it('applies 3-piece gun set: reload 0.9 * 0.7', () => {
    const r = run(); equip(r, ['pistol', 'shotgun', 'sniper']);
    const l = resolveLoadout(r);
    expect(l.setBonuses).toContainEqual({ school: 'gun', count: 3, tier: 3 });
    expect(l.stats.reloadMult).toBeCloseTo(0.63);
    expect(l.stats.magSizeAdd).toBe(2);
  });
  it('detects cross-school combos and exposes their ids', () => {
    const r = run(); equip(r, ['pistol', 'firestaff', null]);
    const l = resolveLoadout(r);
    expect(l.combos).toContain('enchanted-bullets');
    expect(l.stats.enchantedBullets).toBe(true);
  });
  it('star 3 weapon contributes a x1.25 multiplier rule', () => {
    const r = run(); equip(r, ['pistol', null, null], [3, 1, 1]);
    const l = resolveLoadout(r);
    expect(l.rules.some(x => x.id === 'pistol-s3')).toBe(true);
  });
  it('weather + talents + curses + passives fold into one flat deterministic list', () => {
    const r = run(); equip(r, ['ring', null, null]);
    r.weather = 'rain'; r.talents = ['crit', 'mana']; r.curses = ['haste']; r.passives = ['boots', 'scope'];
    const a = resolveLoadout(r), b = resolveLoadout(r);
    expect(a.rules.map(x => x.id)).toEqual(b.rules.map(x => x.id));
    expect(a.rules.some(x => x.id === 'w-rain-lightning')).toBe(true);
    expect(a.stats.critChance).toBeCloseTo(0.25); // 基础 0.05 + 天赋 crit 0.10 + 被动 scope 0.10
    expect(a.stats.zombieSpeedMult).toBeCloseTo(1.2);
    expect(a.stats.moveSpeed).toBeCloseTo(190 * 1.12);
  });
  it('binds star rules to the slot that actually produced the damage', () => {
    const r = run(); equip(r, ['pistol', 'katana', null], [2, 1, 1]);
    const l = resolveLoadout(r);
    const s2 = l.rules.find(x => x.id === 'pistol-s2')!;
    expect(s2.when).toEqual({ kind: 'sourceSlot', slot: 0, star: 2 });
    const own = resolveLoadout(r).rules;
    expect(own.some(x => x.id === 'pistol-s3')).toBe(false);
    const r3 = run(); equip(r3, ['pistol', 'katana', null], [3, 1, 1]);
    const s3 = resolveLoadout(r3).rules.find(x => x.id === 'pistol-s3')!;
    expect(s3.when).toEqual({ kind: 'sourceSlot', slot: 0, star: 3 });
  });
  it('includes the 5th-cast rule only for a 3-piece magic loadout', () => {
    const r = run(); equip(r, ['firestaff', 'frosttome', 'ring']);
    expect(resolveLoadout(r).rules.some(x => x.id === 'magic-nth-cast')).toBe(true);
    const r2 = run(); equip(r2, ['firestaff', 'frosttome', 'pistol']);
    expect(resolveLoadout(r2).rules.some(x => x.id === 'magic-nth-cast')).toBe(false);
  });
});
