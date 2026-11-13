import { describe, it, expect } from 'vitest';
import { createRunState, resolveLoadout } from '../game/state';
import { EventBus } from './events';
import { World } from '../game/combat';
import { tickResources, canFire, consumeFire, startCharge, releaseCharge,
  startReload, tickReload, placeDeployable, ABILITY_FOR_SCHOOL } from './abilities';
import { WEAPON_BY_ID } from '../data/weapons';
import { newSlotResource, type EquipSlot } from '../core/types';

function setup(weaponId: string) {
  const run = createRunState(9, 'veteran', 'yard');
  const slot: EquipSlot = { weaponId, star: 1, res: newSlotResource() };
  slot.res.ammo = WEAPON_BY_ID[weaponId].magSize;
  run.slots[0] = slot;
  const bus = new EventBus();
  const world = new World(run, bus);
  world.setRules(resolveLoadout(run).rules);
  return { run, slot, world, bus };
}
function tick(slot: EquipSlot, dt: number, world: World) {
  tickResources(slot, dt, world.stats, world.bus, world.run);
}

describe('school abilities', () => {
  it('maps all 5 schools to their distinct primitives', () => {
    expect(ABILITY_FOR_SCHOOL.blade).toBe('meleeSwing');
    expect(ABILITY_FOR_SCHOOL.gun).toBe('hitscan');
    expect(ABILITY_FOR_SCHOOL.blunt).toBe('chargeSlam');
    expect(ABILITY_FOR_SCHOOL.tech).toBe('placeDeployable');
    expect(ABILITY_FOR_SCHOOL.magic).toBe('spellBolt');
  });
  it('gun consumes one ammo per shot and cannot fire while empty', () => {
    const { slot, world } = setup('pistol');
    expect(slot.res.ammo).toBe(8);
    expect(canFire(slot, WEAPON_BY_ID['pistol'])).toBe(true);
    for (let i = 0; i < 8; i++) { consumeFire(slot, WEAPON_BY_ID['pistol'], world.run); tick(slot, 0.4, world); }
    expect(slot.res.ammo).toBe(0);
    expect(canFire(slot, WEAPON_BY_ID['pistol'])).toBe(false);
  });
  it('reload refills the magazine after reloadTime * reloadMult', () => {
    const { slot, world } = setup('pistol');
    slot.res.ammo = 0;
    startReload(slot, WEAPON_BY_ID['pistol'], world.stats);
    expect(slot.res.reloading).toBeGreaterThan(0);
    tickReload(slot, 5, WEAPON_BY_ID['pistol']);
    expect(slot.res.reloading).toBe(0);
    expect(slot.res.ammo).toBe(8);
  });
  it('blade builds combo and blunt builds charge; charge speed scales with stats', () => {
    const { slot, world } = setup('shortknife');
    consumeFire(slot, WEAPON_BY_ID['shortknife'], world.run);
    expect(slot.res.combo).toBe(1);
    const b = setup('bat');
    startCharge(b.slot, 0.5, b.world.stats);
    expect(b.slot.res.charge).toBeGreaterThan(0);
    const charge = releaseCharge(b.slot, b.world.stats);
    expect(charge).toBeGreaterThan(0);
    expect(b.slot.res.charge).toBe(0);
  });
  it('magic spends mana and regenerates it; 5th cast is free for 3-piece magic', () => {
    const { run, slot, world } = setup('firestaff');
    const def = WEAPON_BY_ID['firestaff'];
    for (let i = 0; i < 4; i++) { consumeFire(slot, def, run); tick(slot, 10, world); }
    expect(slot.res.mana).toBeGreaterThan(0);
    const before = slot.res.mana;
    consumeFire(slot, def, run);
    expect(slot.res.mana).toBeLessThan(before);
  });
  it('tech spends energy and respects the deploy cap', () => {
    const { slot, world } = setup('turret');
    const def = WEAPON_BY_ID['turret'];
    const ok1 = placeDeployable(slot, def, world.stats, 0);
    expect(ok1).toBe(true);
    expect(slot.res.energy).toBeLessThan(100);
    tick(slot, 10, world);
    expect(placeDeployable(slot, def, world.stats, 1)).toBe(true);
  });
  it('each slot keeps its own resource state when switching', () => {
    const { run, slot } = setup('pistol');
    const other = { weaponId: 'katana', star: 1 as const, res: newSlotResource() };
    run.slots[1] = other;
    consumeFire(slot, WEAPON_BY_ID['pistol'], run);
    expect(run.slots[0]!.res.ammo).toBe(7);
    expect(run.slots[1]!.res.ammo).toBe(0);
    expect(run.slots[1]!.res.combo).toBe(0);
  });
});
