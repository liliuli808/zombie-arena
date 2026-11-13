import { WEAPONS, WEAPON_BY_ID } from '../data/weapons';
import { PASSIVES, CONSUMABLES } from '../data/shop';
import { CHARACTER_BY_ID } from '../data/characters';
import { resolveLoadout } from './state';
import { magSize } from '../engine/abilities';
import type { RunState, ShopItem } from '../core/types';

export type BuyResult = 'equipped' | 'upgraded' | 'refunded' | 'passive' | 'consumable'
  | 'insufficient' | 'needReplace' | 'fullPassive' | 'invalid';

export function rollShop(run: RunState): ShopItem[] {
  const char = CHARACTER_BY_ID[run.characterId];
  const pool: ShopItem[] = [];
  for (const w of WEAPONS) {
    const weight = w.school === char?.shopBias ? 3 : 1;
    for (let i = 0; i < weight; i++) pool.push({ id: w.id, kind: 'weapon', price: w.price, locked: false });
  }
  for (const p of PASSIVES) pool.push({ id: p.id, kind: 'passive', price: p.price, locked: false });
  for (const c of CONSUMABLES) pool.push({ id: c.id, kind: 'consumable', price: c.price, locked: false });
  const n = run.rng.int(4, 5);
  const picked: ShopItem[] = [];
  const used = new Set<string>();
  const shuffled = run.rng.shuffle(pool);
  for (const item of shuffled) {
    if (picked.length >= n) break;
    if (used.has(item.id)) continue;
    used.add(item.id); picked.push({ ...item });
  }
  run.shop.items = picked;
  return picked;
}

export function refreshShop(run: RunState): boolean {
  const cost = run.shop.freeRefresh ? 0 : run.shop.refreshCost;
  if (run.gold < cost) return false;
  run.gold -= cost;
  const locked = run.shop.items.filter(i => i.locked);
  const fresh = rollShop(run).filter(i => !locked.some(l => l.id === i.id));
  run.shop.items = [...locked, ...fresh].slice(0, 5);
  run.shop.freeRefresh = false;
  return true;
}

export function toggleLock(run: RunState, index: number): void {
  const item = run.shop.items[index];
  if (item) item.locked = !item.locked;
}

export function priceOf(run: RunState, item: ShopItem): number {
  const mult = resolveLoadout(run).stats.shopPriceMult;
  return Math.ceil(item.price * mult);
}

export function buyItem(run: RunState, index: number, replaceSlot?: number): BuyResult {
  const item = run.shop.items[index];
  if (!item) return 'invalid';
  const price = priceOf(run, item);
  if (run.gold < price) return 'insufficient';

  if (item.kind === 'consumable') {
    run.gold -= price;
    run.consumables[item.id] = (run.consumables[item.id] ?? 0) + 1;
    run.shop.items.splice(index, 1);
    return 'consumable';
  }
  if (item.kind === 'passive') {
    if (run.passives.length >= 3 || run.passives.includes(item.id)) return 'fullPassive';
    run.gold -= price;
    run.passives.push(item.id);
    run.shop.items.splice(index, 1);
    return 'passive';
  }

  const existing = run.slots.findIndex(s => s?.weaponId === item.id);
  if (existing >= 0) {
    const s = run.slots[existing]!;
    if (s.star >= 3) return 'refunded';
    run.gold -= price;
    s.star = (s.star + 1) as 1 | 2 | 3;
    run.shop.items.splice(index, 1);
    return 'upgraded';
  }
  const empty = run.slots.findIndex(s => s === null);
  if (empty < 0 && replaceSlot === undefined) return 'needReplace';
  const target = empty >= 0 ? empty : replaceSlot!;
  if (target < 0 || target > 2 || !WEAPON_BY_ID[item.id]) return 'invalid';
  run.gold -= price;
  const def = WEAPON_BY_ID[item.id];
  run.slots[target] = { weaponId: item.id, star: 1, res: {
    ammo: magSize(def, resolveLoadout(run).stats), reloading: 0, combo: 0, charge: 0,
    energy: 100, mana: 100, overheat: 0, castCount: 0, cooldown: 0 } };
  run.shop.items.splice(index, 1);
  return 'equipped';
}

export function sellSlot(run: RunState, slotIndex: number): void {
  const s = run.slots[slotIndex];
  if (!s) return;
  const def = WEAPON_BY_ID[s.weaponId];
  run.gold += Math.floor(def.price * (1 + (s.star - 1) * 0.5) / 2);
  run.slots[slotIndex] = null;
}

export function settleWaveEnd(run: RunState, wave: number, killGold: number):
  { reward: number; interest: number; killGold: number } {
  const interest = Math.min(Math.floor(run.gold / 10), resolveLoadout(run).stats.interestCap);
  const reward = 5 + wave;
  run.gold += interest + reward + killGold;
  run.totalGoldEarned += interest + reward + killGold;
  run.shop.freeRefresh = true;
  for (const i of run.shop.items) i.locked = false;
  return { reward, interest, killGold };
}
