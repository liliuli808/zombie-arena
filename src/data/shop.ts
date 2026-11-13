import { rule, type PassiveDef, type ConsumableDef } from '../core/types';

export const PASSIVES: PassiveDef[] = [
  { id: 'boots', name: '移速鞋', price: 3, desc: '移速 +12%',
    rules: [rule('p-boots', 'passive', [{ kind: 'stat', key: 'moveSpeed', mult: 1.12 }])] },
  { id: 'armor', name: '护甲', price: 6, desc: '最大生命 +30',
    rules: [rule('p-armor', 'passive', [{ kind: 'stat', key: 'maxHp', add: 30 }])] },
  { id: 'scope', name: '暴击镜', price: 6, desc: '暴击率 +10%',
    rules: [rule('p-scope', 'passive', [{ kind: 'stat', key: 'critChance', add: 0.1 }])] },
  { id: 'charm', name: '回血符', price: 6, desc: '每波结束回 8 血',
    rules: [rule('p-charm', 'onWaveEnd', [{ kind: 'heal', v: 8 }])] },
  { id: 'battery', name: '电容', price: 6, desc: '能量回复 +25%',
    rules: [rule('p-battery', 'passive', [{ kind: 'stat', key: 'energyRegenMult', mult: 1.25 }])] },
];
export const CONSUMABLES: ConsumableDef[] = [
  { id: 'medkit', name: '血包', price: 3, desc: 'Q 使用，回 35 血' },
  { id: 'grenade', name: '手雷', price: 4, desc: 'Q 使用，范围爆炸' },
  { id: 'shieldkit', name: '一次性护盾', price: 4, desc: 'Q 使用，3 秒免伤' },
];
export const PASSIVE_BY_ID: Record<string, PassiveDef> =
  Object.fromEntries(PASSIVES.map(p => [p.id, p]));
export const CONSUMABLE_BY_ID: Record<string, ConsumableDef> =
  Object.fromEntries(CONSUMABLES.map(c => [c.id, c]));
export const RARITY_PRICE: Record<1 | 2 | 3, number> = { 1: 3, 2: 6, 3: 10 };
