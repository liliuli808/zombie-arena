import type { RNG } from '../engine/rng';

export type School = 'blade' | 'gun' | 'blunt' | 'tech' | 'magic';
export type Element = 'fire' | 'ice' | 'lightning' | null;
export type WeatherId = 'clear' | 'night' | 'rain' | 'fire' | 'fog';
export type Phase = 'title' | 'character' | 'shop' | 'combat' | 'waveEnd' | 'gameOver' | 'meta';
export type AbilityId = 'meleeSwing' | 'hitscan' | 'projectile' | 'chargeSlam'
  | 'placeDeployable' | 'spellBolt' | 'aoeBurst' | 'reload' | 'dash' | 'detonate';
export type StatusId = 'burn' | 'chill' | 'shock' | 'stun' | 'freeze' | 'poison';
export type DamageTag = 'bullet' | 'melee' | 'heavy' | 'spell' | 'turret'
  | 'arc' | 'explosion' | 'breakArmor' | 'elemental';
export type Trigger = 'passive' | 'onHit' | 'onDamage' | 'onKill' | 'onCast'
  | 'onReload' | 'onHeavy' | 'onWaveStart' | 'onWaveEnd' | 'onPurchase' | 'onPlace';
export type EffectStage = 'base' | 'add' | 'mult' | 'override';
export const STAGE_ORDER: Record<EffectStage, number> = { base: 0, add: 1, mult: 2, override: 3 };

export interface DamageOp {
  base: number; add: number; mult: number;
  crit: boolean; critMult: number;
  element: Element; tags: DamageTag[];
  negated: boolean; source: School; targetId: number;
}
export function newDamageOp(base: number, source: School, targetId: number, tags: DamageTag[] = []): DamageOp {
  return { base, add: 0, mult: 1, crit: false, critMult: 2, element: null,
    tags: tags.slice(), negated: false, source, targetId };
}
export function finalDamage(op: DamageOp): number {
  return op.negated ? 0 : Math.max(0, (op.base + op.add) * op.mult * (op.crit ? op.critMult : 1));
}

export type Predicate =
  | { kind: 'all'; of: Predicate[] }
  | { kind: 'any'; of: Predicate[] }
  | { kind: 'not'; of: Predicate }
  | { kind: 'always' }
  | { kind: 'schoolCount'; school: School; min: number }
  | { kind: 'hasSchools'; schools: School[] }
  | { kind: 'minStar'; min: number }
  | { kind: 'comboAtLeast'; n: number }
  | { kind: 'castMod'; n: number; rem: number }
  | { kind: 'waveMod'; n: number; rem: number }
  | { kind: 'weather'; id: WeatherId }
  | { kind: 'opTag'; tag: DamageTag }
  | { kind: 'opElement'; element: Exclude<Element, null> }
  | { kind: 'targetTag'; tag: string }
  | { kind: 'frontFacing'; v: boolean };

export type Effect =
  | { kind: 'dmgBase'; v: number }
  | { kind: 'dmgAdd'; v: number }
  | { kind: 'dmgMult'; v: number }
  | { kind: 'critAdd'; v: number }
  | { kind: 'setElement'; e: Exclude<Element, null> }
  | { kind: 'addTag'; t: DamageTag }
  | { kind: 'negate' }
  | { kind: 'heal'; v: number }
  | { kind: 'gold'; v: number }
  | { kind: 'status'; s: StatusId; stacks: number }
  | { kind: 'spawn'; what: string; n: number }
  | { kind: 'stat'; key: keyof PlayerStats; add?: number; mult?: number; set?: number | boolean }
  | { kind: 'vfx'; name: string };

export interface Rule {
  id: string;
  trigger: Trigger;
  when?: Predicate;
  stage: EffectStage;
  order: number;
  effects: Effect[];
}
export function rule(id: string, trigger: Trigger, effects: Effect[],
  when?: Predicate, stage: EffectStage = 'add', order = 100): Rule {
  return { id, trigger, when, stage, order, effects };
}

export interface PlayerStats {
  maxHp: number; moveSpeed: number; critChance: number; reloadMult: number;
  deployCap: number; energyRegenMult: number; manaRegenMult: number;
  chargeSpeedMult: number; comboCap: number; comboKeepOnHit: boolean;
  magSizeAdd: number; knockbackMult: number; interestCap: number;
  meleeKillHeal: number; nthCastFree: number; shopPriceMult: number;
  zombieSpeedMult: number; playerDamageTakenMult: number; bulletHoming: number;
  turretSpell: boolean; enchantedBullets: boolean; arcOnHeavy: boolean;
  castCritMult: number; elementCapAdd: number; meleeRangeAdd: number;
}
export function defaultStats(): PlayerStats {
  return { maxHp: 100, moveSpeed: 190, critChance: 0.05, reloadMult: 1,
    deployCap: 3, energyRegenMult: 1, manaRegenMult: 1, chargeSpeedMult: 1,
    comboCap: 10, comboKeepOnHit: false, magSizeAdd: 0, knockbackMult: 1,
    interestCap: 5, meleeKillHeal: 0, nthCastFree: 0, shopPriceMult: 1,
    zombieSpeedMult: 1, playerDamageTakenMult: 1, bulletHoming: 0,
    turretSpell: false, enchantedBullets: false, arcOnHeavy: false,
    castCritMult: 2, elementCapAdd: 0, meleeRangeAdd: 0 };
}

export interface Entity {
  id: number; kind: string; x: number; y: number; radius: number;
  hp: number; maxHp: number; speed: number; facing: number;
  tags: string[]; statuses: { id: StatusId; stacks: number; time: number }[];
  dead: boolean; ttl: number; data: Record<string, number>;
}
export interface SlotResource {
  ammo: number; reloading: number; combo: number; charge: number;
  energy: number; mana: number; overheat: number; castCount: number; cooldown: number;
}
export function newSlotResource(): SlotResource {
  return { ammo: 0, reloading: 0, combo: 0, charge: 0,
    energy: 100, mana: 100, overheat: 0, castCount: 0, cooldown: 0 };
}
export interface EquipSlot { weaponId: string; star: 1 | 2 | 3; res: SlotResource }

export interface WeaponDef {
  id: string; name: string; school: School; rarity: 1 | 2 | 3; price: number;
  ability: AbilityId; baseDamage: number; element: Exclude<Element, null> | null;
  fireInterval: number; range: number; magSize: number; reloadTime: number;
  chargeMax: number; manaCost: number; energyCost: number; deployLimit: number;
  starRules: Partial<Record<2 | 3, Rule[]>>; sprite: string; desc: string;
}
export interface ZombieDef {
  id: string; name: string; hp: number; speed: number; radius: number;
  gold: number; elite: boolean; boss: boolean; sprite: string;
  tags: string[]; rules: Rule[]; behaviour: 'chase' | 'charge' | 'spitter' | 'summoner' | 'boss';
}
export interface CharacterDef {
  id: string; name: string; school: School; desc: string;
  rules: Rule[]; shopBias: School; cost: number;
}
export interface PassiveDef { id: string; name: string; price: number; rules: Rule[]; desc: string }
export interface ConsumableDef { id: string; name: string; price: number; desc: string }
export interface MapDef {
  id: string; name: string; cost: number;
  barriers: { x: number; y: number; w: number; h: number }[];
  barrels: { x: number; y: number }[];
  boxes: { x: number; y: number }[];
  traps: { x: number; y: number }[];
}

export interface ShopItem { id: string; kind: 'weapon' | 'passive' | 'consumable'; price: number; locked: boolean }
export interface ShopState { items: ShopItem[]; freeRefresh: boolean; refreshCost: number }
export interface TalentDef { id: string; name: string; desc: string; rules: Rule[] }
export interface CurseDef { id: string; name: string; desc: string; rules: Rule[]; gold: number }

export interface RunState {
  seed: number; rng: RNG; phase: Phase; wave: number; gold: number; hp: number;
  characterId: string; mapId: string; slots: (EquipSlot | null)[];
  passives: string[]; consumables: Record<string, number>;
  talents: string[]; curses: string[]; activeSlot: number;
  shop: ShopState; weather: WeatherId; nextWavePreview: string[];
  kills: number; bossKills: number; totalGoldEarned: number;
}
export interface Ctx {
  run: RunState; stats: PlayerStats;
  schools: School[]; stars: number[]; activeStar: number; activeSlot: number;
  combo: number; castCount: number; wave: number; weather: WeatherId;
  targetId: number; target: Entity | null; op: DamageOp | null; frontFacing: boolean;
}
export interface ActiveRule extends Rule {}
export interface Loadout {
  rules: ActiveRule[]; stats: PlayerStats;
  setBonuses: { school: School; count: number; tier: 0 | 2 | 3 }[];
  combos: string[];
}
export interface SaveData {
  version: 1; points: number; bestWave: number; totalKills: number;
  unlockedCharacters: string[]; unlockedMaps: string[]; unlockedWeapons: string[];
}
