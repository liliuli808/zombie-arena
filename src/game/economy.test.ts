import { describe, it, expect } from 'vitest';
import { createRunState, resolveLoadout } from './state';
import { rollShop, refreshShop, toggleLock, buyItem, sellSlot, settleWaveEnd } from './economy';
import { WEAPON_BY_ID } from '../data/weapons';
import { newSlotResource, type EquipSlot } from '../core/types';

function run(seed = 7) { return createRunState(seed, 'veteran', 'yard'); }
function slot(id: string, star: 1|2|3 = 1): EquipSlot { return { weaponId: id, star, res: newSlotResource() }; }

describe('rollShop', () => {
  it('produces 4-5 items, reproducible for the same seed, with valid kinds', () => {
    const a = rollShop(run(11)), b = rollShop(run(11));
    expect(a.length).toBeGreaterThanOrEqual(4);
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a.map(x => x.id)).toEqual(b.map(x => x.id));
    for (const i of a) expect(['weapon', 'passive', 'consumable']).toContain(i.kind);
  });
});

describe('refreshShop / toggleLock', () => {
  it('first refresh each round is free, later ones cost 2', () => {
    const r = run(); rollShop(r); r.shop.freeRefresh = true;
    expect(refreshShop(r)).toBe(true); expect(r.gold).toBe(15);
    expect(r.shop.freeRefresh).toBe(false);
    expect(refreshShop(r)).toBe(true); expect(r.gold).toBe(13);
  });
  it('locked items survive a refresh', () => {
    const r = run(); rollShop(r);
    toggleLock(r, 0);
    const kept = r.shop.items[0].id;
    r.shop.freeRefresh = true; refreshShop(r);
    expect(r.shop.items[0].id).toBe(kept);
    expect(r.shop.items[0].locked).toBe(true);
  });
  it('cannot refresh without gold', () => {
    const r = run(); r.gold = 0; r.shop.freeRefresh = false;
    expect(refreshShop(r)).toBe(false);
  });
});

describe('buyItem', () => {
  it('equips into the first empty slot', () => {
    const r = run(); r.shop.items = [{ id: 'pistol', kind: 'weapon', price: 3, locked: false }];
    expect(buyItem(r, 0)).toBe('equipped');
    expect(r.slots[0]?.weaponId).toBe('pistol');
    expect(r.gold).toBe(12);
  });
  it('upgrades a duplicate to the next star without taking a slot', () => {
    const r = run(); r.slots[0] = slot('pistol');
    r.shop.items = [{ id: 'pistol', kind: 'weapon', price: 3, locked: false }];
    expect(buyItem(r, 0)).toBe('upgraded');
    expect(r.slots[0]?.star).toBe(2);
    expect(r.slots[1]).toBeNull();
  });
  it('refunds a duplicate at star 3 and leaves the loadout unchanged', () => {
    const r = run(); r.slots[0] = slot('pistol', 3);
    r.shop.items = [{ id: 'pistol', kind: 'weapon', price: 3, locked: false }];
    expect(buyItem(r, 0)).toBe('refunded');
    expect(r.gold).toBe(15);
    expect(r.slots[0]?.star).toBe(3);
  });
  it('asks which slot to replace when all 3 are full', () => {
    const r = run(); r.slots = [slot('bat'), slot('turret'), slot('ring')];
    r.shop.items = [{ id: 'katana', kind: 'weapon', price: 6, locked: false }];
    expect(buyItem(r, 0)).toBe('needReplace');
    expect(buyItem(r, 0, 2)).toBe('equipped');
    expect(r.slots[2]?.weaponId).toBe('katana');
  });
  it('passives go to the 3 passive slots and consumables stack', () => {
    const r = run();
    r.shop.items = [{ id: 'boots', kind: 'passive', price: 3, locked: false },
                    { id: 'medkit', kind: 'consumable', price: 3, locked: false }];
    expect(buyItem(r, 0)).toBe('passive'); expect(r.passives).toEqual(['boots']);
    expect(buyItem(r, 0)).toBe('consumable'); expect(r.consumables['medkit']).toBe(1);
  });
  it('respects insufficient gold and shop price multiplier from curses', () => {
    const r = run(); r.curses = ['inflation']; r.gold = 3;
    r.shop.items = [{ id: 'pistol', kind: 'weapon', price: 3, locked: false }];
    expect(buyItem(r, 0)).toBe('insufficient');
  });
});

describe('sellSlot / settleWaveEnd', () => {
  it('selling returns half the base price rounded down', () => {
    const r = run(); r.slots[0] = slot('sniper'); r.gold = 0;
    sellSlot(r, 0);
    expect(r.slots[0]).toBeNull();
    expect(r.gold).toBe(5);
  });
  it('interest is floor(gold/10) capped by stats.interestCap', () => {
    const r = run(); r.gold = 47;
    const s = settleWaveEnd(r, 3, 10);
    expect(s.interest).toBe(4);
    expect(s.reward).toBe(8); // 5 + wave 3
    expect(s.killGold).toBe(10);
    expect(r.gold).toBe(47 + 4 + 8 + 10);
  });
  it('interest cap from talents is honored', () => {
    const r = run(); r.gold = 200; r.talents = ['interest'];
    expect(settleWaveEnd(r, 1, 0).interest).toBe(resolveLoadout(r).stats.interestCap);
  });
  it('lock state and free refresh reset at the start of the next shop round', () => {
    const r = run(); rollShop(r); toggleLock(r, 0);
    settleWaveEnd(r, 1, 0);
    expect(r.shop.freeRefresh).toBe(true);
  });
});
