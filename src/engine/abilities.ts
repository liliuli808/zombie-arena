import type { AbilityId, School, WeaponDef, EquipSlot, SlotResource,
  PlayerStats, RunState } from '../core/types';
import type { EventBus } from './events';
import { WEAPON_BY_ID } from '../data/weapons';

export const ABILITY_FOR_SCHOOL: Record<School, AbilityId> = {
  blade: 'meleeSwing', gun: 'hitscan', blunt: 'chargeSlam',
  tech: 'placeDeployable', magic: 'spellBolt',
};
export const ABILITY_IDS: AbilityId[] = ['meleeSwing', 'hitscan', 'projectile',
  'chargeSlam', 'placeDeployable', 'spellBolt', 'aoeBurst', 'reload', 'dash', 'detonate'];

export function tickResources(slot: EquipSlot, dt: number, stats: PlayerStats,
  bus: EventBus, run: RunState): void {
  const r = slot.res, def = WEAPON_BY_ID[slot.weaponId];
  r.cooldown = Math.max(0, r.cooldown - dt);
  if (r.reloading > 0) { tickReload(slot, dt, def, stats); return; }
  if (def.school === 'magic') r.mana = Math.min(100, r.mana + 9 * stats.manaRegenMult * dt);
  if (def.school === 'tech') r.energy = Math.min(100, r.energy + 7 * stats.energyRegenMult * dt);
  if (def.school === 'blade') r.overheat = Math.max(0, r.overheat - 22 * dt);
  void bus; void run;
}
export function canFire(slot: EquipSlot, def: WeaponDef, stats?: PlayerStats): boolean {
  const r = slot.res;
  if (r.cooldown > 0 || r.reloading > 0) return false;
  if (def.school === 'gun') return r.ammo > 0;
  if (def.school === 'magic') {
    const cost = def.manaCost;
    const free = stats?.nthCastFree === 5 && r.castCount > 0 && r.castCount % 5 === 0;
    return free || r.mana >= cost;
  }
  if (def.school === 'tech') return r.energy >= def.energyCost;
  if (def.school === 'blade' && def.id === 'chainsaw') return r.overheat < 100;
  return true;
}
export function consumeFire(slot: EquipSlot, def: WeaponDef, run: RunState,
  stats?: PlayerStats): void {
  const r = slot.res;
  r.cooldown = def.fireInterval;
  if (def.school === 'gun') r.ammo -= 1;
  if (def.school === 'magic') {
    r.castCount += 1;
    const free = stats?.nthCastFree === 5 && r.castCount > 0 && r.castCount % 5 === 0;
    if (!free) r.mana -= def.manaCost;
    r.mana = Math.max(0, r.mana);
  }
  if (def.school === 'blade') {
    r.combo += 1;
    if (def.id === 'chainsaw') r.overheat = Math.min(100, r.overheat + 8);
  }
  void run;
}
export function startReload(slot: EquipSlot, def: WeaponDef, stats: PlayerStats): void {
  if (def.school !== 'gun' || slot.res.reloading > 0) return;
  slot.res.reloading = def.reloadTime * stats.reloadMult;
}
export function tickReload(slot: EquipSlot, dt: number, def: WeaponDef,
  stats?: PlayerStats): void {
  if (slot.res.reloading <= 0) return;
  slot.res.reloading -= dt;
  if (slot.res.reloading <= 0) {
    slot.res.reloading = 0;
    slot.res.ammo = stats ? magSize(def, stats) : def.magSize;
  }
}
export function startCharge(slot: EquipSlot, dt: number, stats: PlayerStats): void {
  const def = WEAPON_BY_ID[slot.weaponId];
  if (def.school !== 'blunt') return;
  slot.res.charge = Math.min(def.chargeMax, slot.res.charge + dt * stats.chargeSpeedMult);
}
export function releaseCharge(slot: EquipSlot, stats: PlayerStats): number {
  const def = WEAPON_BY_ID[slot.weaponId];
  const ratio = def.chargeMax > 0 ? slot.res.charge / def.chargeMax : 0;
  slot.res.charge = 0;
  slot.res.cooldown = Math.max(0.25, def.chargeMax * 0.5 / stats.chargeSpeedMult);
  return 1 + ratio * 1.5;
}
export function placeDeployable(slot: EquipSlot, def: WeaponDef,
  stats: PlayerStats, currentCount: number): boolean {
  if (def.school !== 'tech') return false;
  // 每种科技武器有自己的部署上限（炮塔 2 / 电网 2 / 无人机 1），
  // 同时受全局 deployCap 约束。
  if (currentCount >= Math.min(stats.deployCap, def.deployLimit || stats.deployCap)
      || slot.res.energy < def.energyCost) return false;
  slot.res.energy -= def.energyCost;
  slot.res.cooldown = 0.4;
  return true;
}
export function onPlayerHit(slot: EquipSlot | null, keepHalf: boolean): void {
  if (!slot) return;
  if (keepHalf) slot.res.combo = Math.floor(slot.res.combo / 2);
  else slot.res.combo = 0;
}
export function magSize(def: WeaponDef, stats: PlayerStats): number {
  return def.magSize + (def.school === 'gun' ? stats.magSizeAdd : 0);
}
export type { SlotResource };
