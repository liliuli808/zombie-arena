# 僵尸竞技场（Zombie Arena）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-11-13-zombie-arena-design.md` 实现一个可完整游玩一局的 TypeScript + Vite + Canvas 2D 无尽波次僵尸构筑游戏。

**Architecture:** 声明式规则引擎为主轴 —— 装备/套装/组合技/天赋/诅咒/天气/僵尸特性全部是 `Rule` 数据；`resolveLoadout()` 把 3 格装备结算成确定顺序的扁平 `ActiveRule[]` + `PlayerStats`；战斗走 `DamageOp` 管线（`onHit` → 规则改值 → `combat` 提交）；10 个内置能力原语承载 5 流派带时间状态的操作手感。渲染层只读状态。

**Tech Stack:** TypeScript 5 (strict), Vite 6, Vitest 3, Canvas 2D, localStorage, Node 22。运行时零依赖，无外部素材与网络请求。

---

## 文件结构（先锁定边界）

设计规格把 `RunState` 放在 `game/state.ts`，但 `engine/` 与 `game/` 双向依赖会造成类型循环。本计划把**所有共享类型与常量集中到 `src/core/types.ts`**（纯 `interface`/`type`，零运行时逻辑），`game/state.ts` 只放 `createRunState()` / `resolveLoadout()` / `computeStats()`。这是对目录的唯一细化，职责边界不变。

```
index.html                        Vite 入口，canvas + 根 div
package.json / tsconfig.json / vite.config.ts / vitest.config.ts
src/
  core/types.ts                   ★ 全部共享类型、默认 stats、finalDamage()
  engine/rng.ts                   播种 RNG (mulberry32)
  engine/events.ts                类型化 EventBus
  engine/effects.ts               evalPredicate() + applyEffect() + EffectSink
  engine/rules.ts                 RuleEngine（订阅 EventBus，按 stage/order 派发）
  engine/abilities.ts             10 个原语 + 5 流派输入/资源状态机
  data/weapons.ts                 15 件武器 + 星级规则
  data/zombies.ts                 7 种僵尸 + 2 Boss + 特性规则
  data/characters.ts              5 角色 + 解锁表
  data/shop.ts                    被动/消耗品/价格/权重
  data/maps.ts                    3 张地图布局
  data/rules.content.ts           套装、5 组合技、天赋、诅咒、天气（全 Rule）
  game/state.ts                   createRunState / resolveLoadout / computeStats
  game/economy.ts                 商店刷新/锁定/购买/售出/合成/利息
  game/wave.ts                    波次组成/预告/Boss/难度曲线
  game/meta.ts                    点数结算与 localStorage 存档
  game/combat.ts                  实体、伤害管线、状态、元素反应
  game/arena.ts                   路障/油桶/电箱/陷阱位/天气
  ui/sprites.ts                   程序化像素精灵（离屏 Canvas）
  ui/render.ts                    Canvas 绘制（只读状态）
  ui/input.ts                     键鼠映射
  ui/screens.ts                   商店/天赋/角色/结算 DOM 界面
  main.ts                         RAF 主循环 + 阶段状态机 + 组装
src/**/*.test.ts                  与被测模块同目录
```

**全局约定**：`npm test` = `npx vitest run`；单文件测试用 `npx vitest run src/<path>.test.ts`。所有逻辑测试在 node 环境跑，不碰 DOM。提交信息格式 `feat: <简述>` / `test: <简述>` / `fix: <简述>`。

---

### Task 1: 脚手架与构建流水线

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/main.test.ts`

- [ ] **Step 1: 写配置与最小入口**

`package.json`
```json
{
  "name": "zombie-arena",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`vite.config.ts`
```ts
import { defineConfig } from 'vite';
export default defineConfig({ base: './' });
```

`vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'] } });
```

`index.html`
```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>僵尸竞技场</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #0d0f14; color: #e8e6df;
      font-family: ui-monospace, "Cascadia Code", Consolas, monospace; overflow: hidden; }
    #app { position: relative; width: 960px; height: 640px; margin: 0 auto; }
    canvas { display: block; image-rendering: pixelated; background: #161a22; }
    #overlay { position: absolute; inset: 0; pointer-events: none; }
    #overlay > * { pointer-events: auto; }
  </style>
</head>
<body>
  <div id="app">
    <canvas id="game" width="960" height="640"></canvas>
    <div id="overlay"></div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`src/core/constants.ts`
```ts
export const GAME_W = 960;
export const GAME_H = 640;
```

`src/main.ts`
```ts
export { GAME_W, GAME_H } from './core/constants';

export function boot(): boolean {
  const canvas = document.getElementById('game');
  return canvas instanceof HTMLCanvasElement;
}
```

- [ ] **Step 2: 写失败测试**

`src/main.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { GAME_W, GAME_H } from './core/constants';

describe('scaffold', () => {
  it('uses a single-screen 960x640 logical arena', () => {
    expect(GAME_W).toBe(960);
    expect(GAME_H).toBe(640);
  });
});
```

- [ ] **Step 3: 安装依赖并跑测试**

Run: `npm install`
Expected: 无报错，生成 `package-lock.json`。

Run: `npm test`
Expected: `1 passed`，`scaffold` 用例 PASS。

- [ ] **Step 4: 验证类型与构建**

Run: `npm run build`
Expected: `tsc --noEmit` 无错误，`vite build` 产出 `dist/index.html`、`dist/assets/*.js`，退出码 0。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: scaffold Vite + TypeScript + Vitest project"
```

---

### Task 2: 共享类型与播种 RNG

**Files:**
- Create: `src/core/types.ts`, `src/engine/rng.ts`, `src/engine/rng.test.ts`

- [ ] **Step 1: 写失败测试**

`src/engine/rng.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { RNG } from './rng';

describe('RNG', () => {
  it('is reproducible for the same seed', () => {
    const a = new RNG(12345), b = new RNG(12345);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('diverges for different seeds', () => {
    expect(new RNG(1).next()).not.toBe(new RNG(2).next());
  });
  it('stays in [0,1) and handles seed 0', () => {
    const r = new RNG(0);
    for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('int() is inclusive on both ends and pick/shuffle stay in range', () => {
    const r = new RNG(7);
    for (let i = 0; i < 200; i++) { expect(r.int(3, 5)).toBeGreaterThanOrEqual(3); expect(r.int(3, 5)).toBeLessThanOrEqual(5); }
    expect([1, 2, 3]).toContain(r.pick([1, 2, 3]));
    expect(r.shuffle([1, 2, 3, 4]).slice().sort()).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/engine/rng.test.ts`
Expected: FAIL — `Failed to resolve import "./rng"`.

- [ ] **Step 3: 实现 `src/engine/rng.ts`**

```ts
export class RNG {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  chance(p: number): boolean { return this.next() < p; }
}
```

- [ ] **Step 4: 实现 `src/core/types.ts`（本任务的核心，后续所有任务的契约）**

```ts
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
```

- [ ] **Step 5: 跑测试与类型检查，提交**

Run: `npm test`
Expected: `5 passed`（rng 4 + scaffold 1）。

Run: `npx tsc --noEmit`
Expected: 无输出、退出码 0（`import type` 避免运行时循环）。

```bash
git add -A && git commit -m "feat: add shared type contracts and seeded RNG"
```

---

### Task 3: 事件总线、谓词求值与 Effect 原语

**Files:**
- Create: `src/engine/events.ts`, `src/engine/effects.ts`, `src/engine/effects.test.ts`

- [ ] **Step 1: 实现 `src/engine/events.ts`（本任务先写实现，因其是纯基础设施，测试针对 effects）**

```ts
import type { Ctx, Trigger } from '../core/types';

export interface EventPayloads {
  passive: { ctx: Ctx };
  onHit: { ctx: Ctx };
  onDamage: { ctx: Ctx; amount: number };
  onKill: { ctx: Ctx; byMelee: boolean };
  onCast: { ctx: Ctx };
  onReload: { ctx: Ctx };
  onHeavy: { ctx: Ctx };
  onWaveStart: { ctx: Ctx; wave: number };
  onWaveEnd: { ctx: Ctx; wave: number };
  onPurchase: { ctx: Ctx; itemId: string };
  onPlace: { ctx: Ctx };
}
export type EventName = Trigger;
type Handler<K extends EventName> = (p: EventPayloads[K]) => void;

export class EventBus {
  private handlers = new Map<EventName, ((p: unknown) => void)[]>();
  on<K extends EventName>(name: K, fn: Handler<K>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(fn as (p: unknown) => void);
    this.handlers.set(name, list);
    return () => {
      const l = this.handlers.get(name);
      if (l) { const i = l.indexOf(fn as (p: unknown) => void); if (i >= 0) l.splice(i, 1); }
    };
  }
  emit<K extends EventName>(name: K, payload: EventPayloads[K]): void {
    for (const fn of (this.handlers.get(name) ?? []).slice()) fn(payload);
  }
  clear(): void { this.handlers.clear(); }
}
```

- [ ] **Step 2: 写失败测试**

`src/engine/effects.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { evalPredicate, applyEffect, makeOpSink, type EffectSink } from './effects';
import { newDamageOp, defaultStats, newSlotResource, type Ctx, type PlayerStats } from '../core/types';
import { RNG } from './rng';

function ctx(over: Partial<Ctx> = {}): Ctx {
  return {
    run: { seed: 1, rng: new RNG(1), phase: 'combat', wave: 3, gold: 20, hp: 100,
      characterId: 'veteran', mapId: 'yard', slots: [null, null, null], passives: [],
      consumables: {}, talents: [], curses: [], activeSlot: 0,
      shop: { items: [], freeRefresh: true, refreshCost: 2 }, weather: 'clear',
      nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0 },
    stats: defaultStats(), schools: ['gun', 'magic'], stars: [1, 1, 0], activeStar: 1,
    activeSlot: 0, combo: 4, castCount: 5, wave: 3, weather: 'clear',
    targetId: 9, target: null, op: null, frontFacing: false, ...over,
  };
}
function sink(ctxVal: Ctx): EffectSink & { healed: number; earned: number } {
  const op = newDamageOp(10, 'gun', 9, ['bullet']);
  ctxVal.op = op;
  const s = makeOpSink(op);
  return Object.assign(s, { healed: 0, earned: 0,
    heal(v: number) { (this as { healed: number }).healed += v; },
    gold(v: number) { (this as { earned: number }).earned += v; },
  });
}

describe('evalPredicate', () => {
  const c = ctx();
  it('combines all/any/not', () => {
    expect(evalPredicate({ kind: 'all', of: [{ kind: 'schoolCount', school: 'gun', min: 1 }, { kind: 'comboAtLeast', n: 3 }] }, c)).toBe(true);
    expect(evalPredicate({ kind: 'any', of: [{ kind: 'weather', id: 'night' }, { kind: 'comboAtLeast', n: 3 }] }, c)).toBe(true);
    expect(evalPredicate({ kind: 'not', of: { kind: 'weather', id: 'clear' } }, c)).toBe(false);
  });
  it('matches schools, wave/cast modulo, weather, op tags and facing', () => {
    expect(evalPredicate({ kind: 'hasSchools', schools: ['gun', 'magic'] }, c)).toBe(true);
    expect(evalPredicate({ kind: 'castMod', n: 5, rem: 0 }, c)).toBe(true);
    expect(evalPredicate({ kind: 'waveMod', n: 5, rem: 0 }, c)).toBe(false);
    expect(evalPredicate({ kind: 'opTag', tag: 'bullet' }, c)).toBe(true);
    expect(evalPredicate({ kind: 'frontFacing', v: false }, c)).toBe(true);
    expect(evalPredicate({ kind: 'minStar', min: 2 }, c)).toBe(false);
  });
  it('returns false for op predicates when no op exists', () => {
    expect(evalPredicate({ kind: 'opTag', tag: 'bullet' }, ctx({ op: null }))).toBe(false);
  });
});

describe('applyEffect', () => {
  it('mutates DamageOp numbers, element, tags and negation', () => {
    const c = ctx(), s = sink(c);
    for (const e of [
      { kind: 'dmgAdd', v: 5 }, { kind: 'dmgMult', v: 2 }, { kind: 'critAdd', v: 1 },
      { kind: 'setElement', e: 'fire' }, { kind: 'addTag', t: 'elemental' },
    ] as const) applyEffect(e as never, s, c);
    expect(s.op!.add).toBe(5); expect(s.op!.mult).toBe(2);
    expect(s.op!.crit).toBe(true); expect(s.op!.element).toBe('fire');
    expect(s.op!.tags).toContain('elemental');
  });
  it('negate wins regardless of other effects', async () => {
    const { finalDamage } = await import('../core/types');
    const c = ctx(), s = sink(c);
    applyEffect({ kind: 'dmgMult', v: 99 } as never, s, c);
    applyEffect({ kind: 'negate' } as never, s, c);
    expect(finalDamage(s.op!)).toBe(0);
  });
  it('stat patches add, multiply and set', () => {
    const stats: PlayerStats = defaultStats();
    const s = makeOpSink(null, stats);
    applyEffect({ kind: 'stat', key: 'reloadMult', mult: 0.7 } as never, s, ctx());
    applyEffect({ kind: 'stat', key: 'comboCap', add: 4 } as never, s, ctx());
    applyEffect({ kind: 'stat', key: 'comboKeepOnHit', set: true } as never, s, ctx());
    expect(stats.reloadMult).toBeCloseTo(0.7);
    expect(stats.comboCap).toBe(14);
    expect(stats.comboKeepOnHit).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run src/engine/effects.test.ts`
Expected: FAIL — `Failed to resolve import "./effects"`.

- [ ] **Step 4: 实现 `src/engine/effects.ts`**

```ts
import type { Ctx, Effect, Predicate, DamageOp, PlayerStats, StatusId } from '../core/types';

export function evalPredicate(p: Predicate | undefined, c: Ctx): boolean {
  if (!p) return true;
  switch (p.kind) {
    case 'always': return true;
    case 'all': return p.of.every(x => evalPredicate(x, c));
    case 'any': return p.of.some(x => evalPredicate(x, c));
    case 'not': return !evalPredicate(p.of, c);
    case 'schoolCount': return c.schools.filter(s => s === p.school).length >= p.min;
    case 'hasSchools': return p.schools.every(s => c.schools.includes(s));
    case 'minStar': return c.activeStar >= p.min;
    case 'comboAtLeast': return c.combo >= p.n;
    case 'castMod': return c.castCount > 0 && c.castCount % p.n === p.rem;
    case 'waveMod': return c.wave % p.n === p.rem;
    case 'weather': return c.weather === p.id;
    case 'opTag': return c.op !== null && c.op.tags.includes(p.tag);
    case 'opElement': return c.op !== null && c.op.element === p.element;
    case 'targetTag': return c.target !== null && c.target.tags.includes(p.tag);
    case 'frontFacing': return c.frontFacing === p.v;
  }
}

export interface EffectSink {
  op: DamageOp | null;
  heal(v: number): void;
  gold(v: number): void;
  status(s: StatusId, stacks: number): void;
  spawn(what: string, n: number): void;
  stat(key: keyof PlayerStats, add?: number, mult?: number, set?: number | boolean): void;
  vfx(name: string): void;
}

export function makeOpSink(op: DamageOp | null, stats?: PlayerStats): EffectSink {
  return {
    op,
    heal() {}, gold() {}, status() {}, spawn() {}, vfx() {},
    stat(key, add, mult, set) {
      if (!stats) return;
      const cur = stats[key];
      if (typeof set === 'boolean') { (stats[key] as boolean) = set; return; }
      if (typeof set === 'number') { (stats[key] as number) = set; return; }
      if (typeof cur !== 'number') return;
      let v = cur;
      if (add !== undefined) v += add;
      if (mult !== undefined) v *= mult;
      (stats[key] as number) = v;
    },
  };
}

export function applyEffect(e: Effect, sink: EffectSink, c: Ctx): void {
  const op = sink.op;
  switch (e.kind) {
    case 'dmgBase': if (op) op.base = e.v; break;
    case 'dmgAdd': if (op) op.add += e.v; break;
    case 'dmgMult': if (op) op.mult *= e.v; break;
    case 'critAdd': if (op) { if (e.v >= 1 || c.run.rng.chance(e.v)) op.crit = true; } break;
    case 'setElement': if (op) op.element = e.e; break;
    case 'addTag': if (op && !op.tags.includes(e.t)) op.tags.push(e.t); break;
    case 'negate': if (op) op.negated = true; break;
    case 'heal': sink.heal(e.v); break;
    case 'gold': sink.gold(e.v); break;
    case 'status': sink.status(e.s, e.stacks); break;
    case 'spawn': sink.spawn(e.what, e.n); break;
    case 'stat': sink.stat(e.key, e.add, e.mult, e.set); break;
    case 'vfx': sink.vfx(e.name); break;
  }
}
```

- [ ] **Step 5: 跑测试、类型检查、提交**

Run: `npx vitest run src/engine/effects.test.ts`
Expected: `7 passed`.

Run: `npx tsc --noEmit`
Expected: 无错误。

```bash
git add -A && git commit -m "feat: add EventBus, predicate evaluation and effect primitives"
```

---

### Task 4: 声明式规则引擎

**Files:**
- Create: `src/engine/rules.ts`, `src/engine/rules.test.ts`

- [ ] **Step 1: 写失败测试**

`src/engine/rules.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { RuleEngine } from './rules';
import { EventBus } from './events';
import { RNG } from './rng';
import { newDamageOp, defaultStats, rule, finalDamage, type Ctx, type Rule, type Effect } from '../core/types';

function ctx(): Ctx {
  return {
    run: { seed: 1, rng: new RNG(1), phase: 'combat', wave: 1, gold: 0, hp: 100,
      characterId: 'veteran', mapId: 'yard', slots: [null, null, null], passives: [],
      consumables: {}, talents: [], curses: [], activeSlot: 0,
      shop: { items: [], freeRefresh: true, refreshCost: 2 }, weather: 'clear',
      nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0 },
    stats: defaultStats(), schools: ['gun'], stars: [1, 0, 0], activeStar: 1,
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/engine/rules.test.ts`
Expected: FAIL — `Failed to resolve import "./rules"`.

- [ ] **Step 3: 实现 `src/engine/rules.ts`**

```ts
import type { ActiveRule, Ctx, EffectStage, Trigger } from '../core/types';
import { STAGE_ORDER } from '../core/types';
import { EventBus, type EventPayloads } from './events';
import { evalPredicate, applyEffect, type EffectSink } from './effects';

export class RuleEngine {
  private rules: ActiveRule[] = [];
  private unsubs: (() => void)[] = [];
  private sink: EffectSink;

  constructor(private bus: EventBus, sink?: EffectSink) {
    this.sink = sink ?? {
      op: null, heal() {}, gold() {}, status() {}, spawn() {}, stat() {}, vfx() {},
    };
    // onHit 由 dealDamage() 独占派发（需要在派发前注入目标僵尸的特性规则），
    // 引擎只订阅其余事件，避免同一条 onHit 规则被应用两次。
    const triggers: Trigger[] = ['onDamage', 'onKill', 'onCast', 'onReload',
      'onHeavy', 'onWaveStart', 'onWaveEnd', 'onPurchase', 'onPlace'];
    for (const t of triggers) {
      this.unsubs.push(this.bus.on(t, ((p: { ctx: Ctx }) => this.dispatch(t, p.ctx)) as never));
    }
  }

  setSink(sink: EffectSink): void { this.sink = sink; }

  setRules(rules: ActiveRule[]): void {
    this.rules = rules
      .filter(r => r.trigger !== 'passive')
      .slice()
      .sort((a, b) => STAGE_ORDER[a.stage as EffectStage] - STAGE_ORDER[b.stage as EffectStage]
        || a.order - b.order);
  }

  private dispatch(trigger: Trigger, ctx: Ctx): void {
    this.dispatchFor(trigger, ctx);
  }

  /** 唯一的规则求值入口。dealDamage() 传入 extraRules 注入目标僵尸特性，
   *  事件订阅不传。sorted() 保证 stage/order 顺序。 */
  dispatchFor(trigger: Trigger, ctx: Ctx, extraRules: ActiveRule[] = []): void {
    const all = extraRules.length === 0 ? this.rules
      : [...this.rules, ...extraRules].sort((a, b) =>
          STAGE_ORDER[a.stage as EffectStage] - STAGE_ORDER[b.stage as EffectStage] || a.order - b.order);
    for (const r of all) {
      if (r.trigger !== trigger) continue;
      if (!evalPredicate(r.when, ctx)) continue;
      for (const e of r.effects) applyEffect(e, this.sink, ctx);
    }
  }

  dispose(): void { for (const u of this.unsubs) u(); this.unsubs = []; }
}
export type { EventPayloads };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/engine/rules.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: 全量测试与提交**

Run: `npm test`
Expected: `19 passed` (1 + 4 + 7 + 6 + 1 冗余计数以实际输出为准，全部 PASS)。

```bash
git add -A && git commit -m "feat: add declarative rule engine with staged effect ordering"
```

---

### Task 5: 数据表（武器 / 僵尸 / 角色 / 商店 / 地图）

**Files:**
- Create: `src/data/weapons.ts`, `src/data/zombies.ts`, `src/data/characters.ts`, `src/data/shop.ts`, `src/data/maps.ts`, `src/data/tables.test.ts`

- [ ] **Step 1: 写失败测试**

`src/data/tables.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { WEAPONS, WEAPON_BY_ID } from './weapons';
import { ZOMBIES, ZOMBIE_BY_ID } from './zombies';
import { CHARACTERS } from './characters';
import { PASSIVES, CONSUMABLES } from './shop';
import { MAPS } from './maps';
import type { School } from '../core/types';

const SCHOOLS: School[] = ['blade', 'gun', 'blunt', 'tech', 'magic'];

describe('data tables', () => {
  it('has exactly 3 weapons in each of the 5 schools (15 total)', () => {
    expect(WEAPONS).toHaveLength(15);
    for (const s of SCHOOLS) expect(WEAPONS.filter(w => w.school === s)).toHaveLength(3);
  });
  it('has unique ids and valid prices / star rules', () => {
    expect(new Set(WEAPONS.map(w => w.id)).size).toBe(15);
    for (const w of WEAPONS) {
      expect(w.price).toBeGreaterThan(0);
      expect(WEAPON_BY_ID[w.id]).toBe(w);
      expect(w.starRules[2]).toBeDefined();
      expect(w.starRules[3]).toBeDefined();
    }
  });
  it('has 7 normal zombies and 2 bosses', () => {
    expect(ZOMBIES.filter(z => !z.boss)).toHaveLength(7);
    expect(ZOMBIES.filter(z => z.boss)).toHaveLength(2);
    expect(ZOMBIES.filter(z => z.elite)).toHaveLength(2);
    for (const z of ZOMBIES) expect(ZOMBIE_BY_ID[z.id]).toBe(z);
  });
  it('shield/front-immunity and armor breakArmor are declared as rules', () => {
    expect(ZOMBIE_BY_ID['shield'].rules.some(r => r.id === 'shield-front-immune')).toBe(true);
    expect(ZOMBIE_BY_ID['armored'].tags).toContain('armored');
    expect(WEAPONS.filter(w => w.school === 'blunt').every(w => w.id.length > 0)).toBe(true);
  });
  it('has 5 characters, 5 passives, 3 consumables and 3 maps', () => {
    expect(CHARACTERS).toHaveLength(5);
    expect(new Set(CHARACTERS.map(c => c.shopBias)).size).toBe(5);
    expect(PASSIVES.length).toBeGreaterThanOrEqual(4);
    expect(CONSUMABLES.length).toBeGreaterThanOrEqual(3);
    expect(MAPS).toHaveLength(3);
    for (const m of MAPS) expect(m.traps.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/data/tables.test.ts`
Expected: FAIL — 无法解析 `./weapons`。

- [ ] **Step 3: 实现 `src/data/weapons.ts`**

```ts
import { rule, type WeaponDef, type Effect } from '../core/types';

const dmgAdd = (v: number): Effect => ({ kind: 'dmgAdd', v });
const dmgMult = (v: number): Effect => ({ kind: 'dmgMult', v });

function w(d: Omit<WeaponDef, 'starRules' | 'fireInterval' | 'range' | 'magSize' | 'reloadTime'
  | 'chargeMax' | 'manaCost' | 'energyCost' | 'deployLimit' | 'element'> &
  Partial<Pick<WeaponDef, 'fireInterval' | 'range' | 'magSize' | 'reloadTime' | 'chargeMax'
  | 'manaCost' | 'energyCost' | 'deployLimit' | 'element'>>): WeaponDef {
  return {
    fireInterval: 0.35, range: 90, magSize: 0, reloadTime: 0, chargeMax: 0,
    manaCost: 0, energyCost: 0, deployLimit: 0, element: null,
    starRules: {
      2: [rule(`${d.id}-s2`, 'onHit', [dmgAdd(d.baseDamage * 0.25)], undefined, 'add')],
      3: [rule(`${d.id}-s3`, 'onHit', [dmgMult(1.25)],
        { kind: 'minStar', min: 3 }, 'mult', 120)],
    },
    ...d,
  } as WeaponDef;
}

export const WEAPONS: WeaponDef[] = [
  // 刀
  w({ id: 'shortknife', name: '短刀', school: 'blade', rarity: 1, price: 3, ability: 'meleeSwing',
      baseDamage: 9, fireInterval: 0.18, range: 62, sprite: 'knife', desc: '极快连击，靠层数堆伤害' }),
  w({ id: 'katana', name: '武士刀', school: 'blade', rarity: 2, price: 6, ability: 'meleeSwing',
      baseDamage: 17, fireInterval: 0.3, range: 84, sprite: 'katana', desc: '更长更痛，连击收益高' }),
  w({ id: 'chainsaw', name: '链锯', school: 'blade', rarity: 3, price: 10, ability: 'meleeSwing',
      baseDamage: 4, fireInterval: 0.08, range: 56, sprite: 'saw', desc: '按住持续切割，会过热' }),
  // 枪
  w({ id: 'pistol', name: '手枪', school: 'gun', rarity: 1, price: 3, ability: 'hitscan',
      baseDamage: 14, fireInterval: 0.28, range: 520, magSize: 8, reloadTime: 1.1, sprite: 'pistol',
      desc: '稳定远程，R 换弹' }),
  w({ id: 'shotgun', name: '霰弹枪', school: 'gun', rarity: 2, price: 6, ability: 'hitscan',
      baseDamage: 9, fireInterval: 0.65, range: 240, magSize: 5, reloadTime: 1.7, sprite: 'shotgun',
      desc: '扇形 5 弹丸，贴脸爆发' }),
  w({ id: 'sniper', name: '狙击枪', school: 'gun', rarity: 3, price: 10, ability: 'hitscan',
      baseDamage: 60, fireInterval: 1.1, range: 900, magSize: 3, reloadTime: 2.2, sprite: 'sniper',
      desc: '穿透 + 开镜减速' }),
  // 棍棒
  w({ id: 'bat', name: '球棒', school: 'blunt', rarity: 1, price: 3, ability: 'chargeSlam',
      baseDamage: 16, chargeMax: 1.2, range: 78, sprite: 'bat', desc: '蓄力扇形重击 + 击退' }),
  w({ id: 'hammer', name: '铁锤', school: 'blunt', rarity: 2, price: 6, ability: 'chargeSlam',
      baseDamage: 26, chargeMax: 1.2, range: 90, sprite: 'hammer', desc: '蓄满眩晕 0.8s' }),
  w({ id: 'mace', name: '狼牙棒', school: 'blunt', rarity: 3, price: 10, ability: 'chargeSlam',
      baseDamage: 32, chargeMax: 1.2, range: 96, sprite: 'mace', desc: '重击自带破甲' }),
  // 科技
  w({ id: 'turret', name: '自动炮塔', school: 'tech', rarity: 1, price: 3, ability: 'placeDeployable',
      baseDamage: 8, energyCost: 35, deployLimit: 2, range: 300, sprite: 'turret',
      desc: '右键放置，自动索敌' }),
  w({ id: 'grid', name: '电网', school: 'tech', rarity: 2, price: 6, ability: 'placeDeployable',
      baseDamage: 5, energyCost: 45, deployLimit: 2, range: 110, sprite: 'grid',
      desc: '地面持续伤害区域' }),
  w({ id: 'drone', name: '无人机', school: 'tech', rarity: 3, price: 10, ability: 'placeDeployable',
      baseDamage: 11, energyCost: 55, deployLimit: 1, range: 360, sprite: 'drone',
      desc: '跟随并自动射击' }),
  // 魔法
  w({ id: 'firestaff', name: '火球杖', school: 'magic', rarity: 1, price: 3, ability: 'spellBolt',
      baseDamage: 20, manaCost: 18, range: 480, element: 'fire', sprite: 'firestaff',
      desc: '火 = 灼烧 DoT' }),
  w({ id: 'frosttome', name: '冰霜法典', school: 'magic', rarity: 2, price: 6, ability: 'spellBolt',
      baseDamage: 16, manaCost: 20, range: 440, element: 'ice', sprite: 'frosttome',
      desc: '冰 = 减速叠层 → 冻结' }),
  w({ id: 'ring', name: '雷电戒指', school: 'magic', rarity: 3, price: 10, ability: 'aoeBurst',
      baseDamage: 24, manaCost: 28, range: 160, element: 'lightning', sprite: 'ring',
      desc: '雷 = 导电叠层 → 连锁' }),
];

// 破甲标签：棍棒重击
for (const weapon of WEAPONS) {
  if (weapon.school === 'blunt') {
    weapon.starRules[2]!.push(rule(`${weapon.id}-break`, 'onHeavy',
      [{ kind: 'addTag', t: 'breakArmor' }], undefined, 'add'));
  }
}

export const WEAPON_BY_ID: Record<string, WeaponDef> =
  Object.fromEntries(WEAPONS.map(x => [x.id, x]));
```

- [ ] **Step 4: 实现 `src/data/zombies.ts`**

```ts
import { rule, type ZombieDef, type Effect } from '../core/types';

const negate: Effect = { kind: 'negate' };
const dmgMult = (v: number): Effect => ({ kind: 'dmgMult', v });

function z(d: Omit<ZombieDef, 'rules' | 'elite' | 'boss' | 'behaviour' | 'gold'> &
  Partial<Pick<ZombieDef, 'rules' | 'elite' | 'boss' | 'behaviour' | 'gold'>>): ZombieDef {
  return { rules: [], elite: false, boss: false, behaviour: 'chase', gold: 1, ...d } as ZombieDef;
}

export const ZOMBIES: ZombieDef[] = [
  z({ id: 'walker', name: '普通僵尸', hp: 26, speed: 42, radius: 11, sprite: 'walker', tags: [] }),
  z({ id: 'runner', name: '奔跑者', hp: 16, speed: 108, radius: 9, sprite: 'runner', tags: ['fast'] }),
  z({ id: 'fatty', name: '胖子', hp: 90, speed: 30, radius: 18, sprite: 'fatty', tags: ['explodes'] }),
  z({ id: 'shield', name: '持盾僵尸', hp: 55, speed: 40, radius: 13, sprite: 'shield', tags: ['shield'],
      rules: [rule('shield-front-immune', 'onHit', [negate],
        { kind: 'all', of: [{ kind: 'opTag', tag: 'bullet' }, { kind: 'frontFacing', v: true }] },
        'override', 900)] }),
  z({ id: 'spitter', name: '吐酸僵尸', hp: 34, speed: 46, radius: 12, sprite: 'spitter',
      behaviour: 'spitter', tags: ['poison'], rules: [
        rule('spitter-poison-hit', 'onHit', [{ kind: 'status', s: 'poison', stacks: 1 }], undefined, 'add')] }),
  z({ id: 'summoner', name: '召唤者', hp: 70, speed: 34, radius: 14, sprite: 'summoner',
      behaviour: 'summoner', elite: true, gold: 3, tags: ['priority'], rules: [
        rule('summoner-summon', 'onWaveStart', [{ kind: 'spawn', what: 'walker', n: 2 }],
          { kind: 'targetTag', tag: 'priority' }, 'add')] }),
  z({ id: 'armored', name: '装甲僵尸', hp: 120, speed: 32, radius: 16, sprite: 'armored',
      elite: true, gold: 3, tags: ['armored'], rules: [
        rule('armored-reduce', 'onHit', [dmgMult(0.45)],
          { kind: 'not', of: { kind: 'opTag', tag: 'breakArmor' } }, 'mult', 150)] }),
  z({ id: 'butcher', name: '巨型屠夫', hp: 900, speed: 62, radius: 30, sprite: 'butcher',
      boss: true, gold: 15, behaviour: 'boss', tags: ['boss', 'charges'] }),
  z({ id: 'mother', name: '尸潮之母', hp: 750, speed: 36, radius: 28, sprite: 'mother',
      boss: true, gold: 15, behaviour: 'boss', tags: ['boss', 'summons'] }),
];

export const ZOMBIE_BY_ID: Record<string, ZombieDef> =
  Object.fromEntries(ZOMBIES.map(x => [x.id, x]));
```

- [ ] **Step 5: 实现 `src/data/characters.ts`、`src/data/shop.ts`、`src/data/maps.ts`**

`src/data/characters.ts`
```ts
import { rule, type CharacterDef } from '../core/types';

export const CHARACTERS: CharacterDef[] = [
  { id: 'veteran', name: '老兵', school: 'gun', shopBias: 'gun', cost: 0,
    desc: '开局 +6 金，换弹快 10%', rules: [
      rule('vet-reload', 'passive', [{ kind: 'stat', key: 'reloadMult', mult: 0.9 }]),
      rule('vet-gold', 'onWaveEnd', [{ kind: 'gold', v: 2 }])] },
  { id: 'wizard', name: '巫师', school: 'magic', shopBias: 'magic', cost: 0,
    desc: '法力回复 +20%，起手 ★2 火球杖', rules: [
      rule('wiz-mana', 'passive', [{ kind: 'stat', key: 'manaRegenMult', mult: 1.2 }])] },
  { id: 'engineer', name: '工程师', school: 'tech', shopBias: 'tech', cost: 40,
    desc: '部署上限 +1，能量回复 +20%', rules: [
      rule('eng-cap', 'passive', [{ kind: 'stat', key: 'deployCap', add: 1 }]),
      rule('eng-energy', 'passive', [{ kind: 'stat', key: 'energyRegenMult', mult: 1.2 }])] },
  { id: 'ronin', name: '浪人', school: 'blade', shopBias: 'blade', cost: 40,
    desc: '连击上限 +4，移速 +8%', rules: [
      rule('ron-combo', 'passive', [{ kind: 'stat', key: 'comboCap', add: 4 }]),
      rule('ron-speed', 'passive', [{ kind: 'stat', key: 'moveSpeed', mult: 1.08 }])] },
  { id: 'jailer', name: '狱卒', school: 'blunt', shopBias: 'blunt', cost: 60,
    desc: '蓄力快 15%，击退 +20%', rules: [
      rule('jail-charge', 'passive', [{ kind: 'stat', key: 'chargeSpeedMult', mult: 1.15 }]),
      rule('jail-knock', 'passive', [{ kind: 'stat', key: 'knockbackMult', mult: 1.2 }])] },
];
export const CHARACTER_BY_ID: Record<string, CharacterDef> =
  Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
```

`src/data/shop.ts`
```ts
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
```

`src/data/maps.ts`
```ts
import type { MapDef } from '../core/types';
const W = 960, H = 640;
export const MAPS: MapDef[] = [
  { id: 'yard', name: '废弃货场', cost: 0,
    barriers: [{ x: 300, y: 200, w: 20, h: 120 }, { x: 640, y: 320, w: 20, h: 120 }],
    barrels: [{ x: 200, y: 140 }, { x: 760, y: 500 }],
    boxes: [{ x: 480, y: 100 }, { x: 480, y: 540 }],
    traps: [{ x: 420, y: 320 }, { x: 540, y: 320 }, { x: 480, y: 240 }] },
  { id: 'lab', name: '地下实验室', cost: 50,
    barriers: [{ x: 200, y: 300, w: 160, h: 20 }, { x: 600, y: 300, w: 160, h: 20 }],
    barrels: [{ x: 120, y: 120 }, { x: 840, y: 520 }, { x: 480, y: 320 }],
    boxes: [{ x: 100, y: 560 }, { x: 860, y: 80 }, { x: 480, y: 60 }],
    traps: [{ x: 340, y: 200 }, { x: 620, y: 440 }, { x: 480, y: 480 }] },
  { id: 'rooftop', name: '雨夜天台', cost: 90,
    barriers: [{ x: 460, y: 80, w: 40, h: 140 }, { x: 460, y: 420, w: 40, h: 140 }],
    barrels: [{ x: 300, y: 320 }, { x: 660, y: 320 }],
    boxes: [{ x: 160, y: 160 }, { x: 800, y: 480 }],
    traps: [{ x: 480, y: 320 }, { x: 360, y: 480 }, { x: 600, y: 160 }] },
];
export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAPS.map(m => [m.id, m]));
```

- [ ] **Step 6: 跑测试、类型检查、提交**

Run: `npx vitest run src/data/tables.test.ts`
Expected: `5 passed`.

Run: `npx tsc --noEmit`
Expected: 无错误。

```bash
git add -A && git commit -m "feat: add weapon/zombie/character/shop/map data tables"
```

---

### Task 6: 规则内容（套装 / 组合技 / 天赋 / 诅咒 / 天气 / 僵尸全局）

**Files:**
- Create: `src/data/rules.content.ts`, `src/data/rules.content.test.ts`

- [ ] **Step 1: 写失败测试**

`src/data/rules.content.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { SET_RULES, COMBOS, TALENTS, CURSES, WEATHER_RULES, MAGIC_NTH_RULE } from './rules.content';
import { evalPredicate } from '../engine/effects';
import { RNG } from '../engine/rng';
import { defaultStats, newSlotResource, type Ctx } from '../core/types';

function ctx(schools: Ctx['schools'], weather: Ctx['weather'] = 'clear'): Ctx {
  return {
    run: { seed: 1, rng: new RNG(1), phase: 'combat', wave: 10, gold: 0, hp: 100,
      characterId: 'veteran', mapId: 'yard', slots: [null, null, null], passives: [],
      consumables: {}, talents: [], curses: [], activeSlot: 0,
      shop: { items: [], freeRefresh: true, refreshCost: 2 }, weather,
      nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0 },
    stats: defaultStats(), schools, stars: [1, 1, 1], activeStar: 1, activeSlot: 0,
    combo: 0, castCount: 5, wave: 10, weather, targetId: 1, target: null,
    op: null, frontFacing: false,
  };
}

describe('rule content', () => {
  it('has 5 set schools x 2 tiers and 5 cross-school combos', () => {
    expect(SET_RULES).toHaveLength(10);
    expect(COMBOS).toHaveLength(5);
    expect(new Set(COMBOS.map(c => c.id)).size).toBe(5);
  });
  it('3-piece magic set predicate matches only 3 magic schools, and 5th-cast rule needs both', () => {
    const set = SET_RULES.find(x => x.id === 'set-magic-3')!;
    expect(set.when!.kind).toBe('schoolCount');
    expect(evalPredicate(set.when, ctx(['magic', 'magic', 'magic']))).toBe(true);
    expect(evalPredicate(set.when, ctx(['magic', 'magic', 'gun']))).toBe(false);
    expect(MAGIC_NTH_RULE.when!.kind).toBe('all');
    const c5 = ctx(['magic', 'magic', 'magic']); // castCount = 5
    expect(evalPredicate(MAGIC_NTH_RULE.when, c5)).toBe(true);
    const c4 = ctx(['magic', 'magic', 'magic']); c4.castCount = 4;
    expect(evalPredicate(MAGIC_NTH_RULE.when, c4)).toBe(false);
    const c2 = ctx(['magic', 'magic', 'gun']); c2.castCount = 5;
    expect(evalPredicate(MAGIC_NTH_RULE.when, c2)).toBe(false);
  });
  it('every combo predicate needs both of its schools', () => {
    for (const c of COMBOS) {
      const needed = (c.when as { of: { schools: Ctx['schools'] }[] }).of[0].schools;
      expect(evalPredicate(c.when, ctx(needed))).toBe(true);
      expect(evalPredicate(c.when, ctx([needed[0]]))).toBe(false);
    }
  });
  it('has >=14 stackable talents, 4 curses and 4 weather events', () => {
    expect(TALENTS.length).toBeGreaterThanOrEqual(14);
    expect(CURSES).toHaveLength(4);
    expect(Object.keys(WEATHER_RULES)).toEqual(['night', 'rain', 'fire', 'fog']);
  });
  it('rain boosts lightning by 30% only when the op is lightning', () => {
    const r = WEATHER_RULES.rain[0];
    expect(r.when!.kind).toBe('opElement');
    expect(evalPredicate(r.when, ctx(['magic'], 'rain'))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/data/rules.content.test.ts`
Expected: FAIL — 无法解析 `./rules.content`。

- [ ] **Step 3: 实现 `src/data/rules.content.ts`**

```ts
import { rule, type Rule, type School, type WeatherId, type TalentDef, type CurseDef, type Predicate } from '../core/types';

const has = (s: School, n: number): Predicate => ({ kind: 'schoolCount', school: s, min: n });
const comboWhen = (a: School, b: School): Predicate =>
  ({ kind: 'all', of: [{ kind: 'hasSchools', schools: [a, b] }, { kind: 'always' }] });

export interface SetRule extends Rule { school: School; tier: 2 | 3 }
const setRule = (id: string, school: School, tier: 2 | 3, effects: Rule['effects']): SetRule => ({
  ...rule(id, 'passive', effects, has(school, tier), 'add', 10), school, tier,
});

export const SET_RULES: SetRule[] = [
  setRule('set-blade-2', 'blade', 2, [{ kind: 'stat', key: 'comboCap', add: 4 }]),
  setRule('set-blade-3', 'blade', 3, [
    { kind: 'stat', key: 'comboKeepOnHit', set: true },
    { kind: 'stat', key: 'comboCap', add: 4 }]),
  setRule('set-gun-2', 'gun', 2, [{ kind: 'stat', key: 'magSizeAdd', add: 2 }]),
  setRule('set-gun-3', 'gun', 3, [{ kind: 'stat', key: 'reloadMult', mult: 0.7 }]),
  setRule('set-blunt-2', 'blunt', 2, [{ kind: 'stat', key: 'knockbackMult', mult: 1.25 }]),
  setRule('set-blunt-3', 'blunt', 3, [{ kind: 'stat', key: 'chargeSpeedMult', mult: 1.4 }]),
  setRule('set-tech-2', 'tech', 2, [{ kind: 'stat', key: 'energyRegenMult', mult: 1.25 }]),
  setRule('set-tech-3', 'tech', 3, [{ kind: 'stat', key: 'deployCap', add: 2 }]),
  setRule('set-magic-2', 'magic', 2, [{ kind: 'stat', key: 'manaRegenMult', mult: 1.25 }]),
  setRule('set-magic-3', 'magic', 3, [
    { kind: 'stat', key: 'nthCastFree', set: 5 },
    { kind: 'stat', key: 'castCritMult', set: 2 },
  ]),
];

// 第 5 次施法免费且伤害翻倍：由 resolveLoadout() 在 3 件魔法时单独追加。
// 用 onHit（而非 onCast）：DamageOp 只在 dealDamage() 里存在，onCast 时 op 为空，乘区会落空。
export const MAGIC_NTH_RULE: Rule = rule('magic-nth-cast', 'onHit',
  [{ kind: 'dmgMult', v: 2 }],
  { kind: 'all', of: [has('magic', 3), { kind: 'castMod', n: 5, rem: 0 }] }, 'mult', 130);

export interface ComboDef { id: string; name: string; desc: string; when: Rule['when']; rules: Rule[] }
export const COMBOS: ComboDef[] = [
  { id: 'enchanted-bullets', name: '附魔子弹', desc: '子弹带元素效果',
    when: comboWhen('gun', 'magic'), rules: [
      rule('combo-enchant-stat', 'passive', [{ kind: 'stat', key: 'enchantedBullets', set: true }]),
      rule('combo-enchant-hit', 'onHit', [{ kind: 'addTag', t: 'elemental' }],
        { kind: 'opTag', tag: 'bullet' }, 'add', 60)] },
  { id: 'shock-baton', name: '电击棍', desc: '重击释放连锁电弧',
    when: comboWhen('blunt', 'tech'), rules: [
      rule('combo-arc-stat', 'passive', [{ kind: 'stat', key: 'arcOnHeavy', set: true }]),
      rule('combo-arc', 'onHeavy', [{ kind: 'spawn', what: 'arc', n: 1 }], undefined, 'add', 60)] },
  { id: 'vampiric-blade', name: '吸血刃', desc: '近战击杀回血',
    when: comboWhen('blade', 'magic'), rules: [
      rule('combo-vamp', 'passive', [{ kind: 'stat', key: 'meleeKillHeal', add: 6 }])] },
  { id: 'rune-turret', name: '符文炮塔', desc: '炮塔发射法术弹',
    when: comboWhen('tech', 'magic'), rules: [
      rule('combo-rune', 'passive', [{ kind: 'stat', key: 'turretSpell', set: true }])] },
  { id: 'smart-aim', name: '智能瞄准', desc: '子弹弱追踪',
    when: comboWhen('gun', 'tech'), rules: [
      rule('combo-homing', 'passive', [{ kind: 'stat', key: 'bulletHoming', add: 1 }])] },
];

const talent = (id: string, name: string, desc: string, effects: Rule['effects']): TalentDef => ({
  id, name, desc, rules: [rule(`t-${id}`, 'passive', effects)],
});
export const TALENTS: TalentDef[] = [
  talent('crit', '致命一击', '暴击率 +10%', [{ kind: 'stat', key: 'critChance', add: 0.1 }]),
  talent('lifesteal', '嗜血', '近战击杀回血 +5', [{ kind: 'stat', key: 'meleeKillHeal', add: 5 }]),
  talent('turret-plus', '额外炮塔', '部署上限 +1', [{ kind: 'stat', key: 'deployCap', add: 1 }]),
  talent('mana', '灵能涌动', '法力回复 +25%', [{ kind: 'stat', key: 'manaRegenMult', mult: 1.25 }]),
  talent('reload', '快速装填', '换弹快 20%', [{ kind: 'stat', key: 'reloadMult', mult: 0.8 }]),
  talent('speed', '轻步', '移速 +8%', [{ kind: 'stat', key: 'moveSpeed', mult: 1.08 }]),
  talent('reach', '长臂', '近战范围 +15', [{ kind: 'stat', key: 'meleeRangeAdd', add: 15 }]),
  talent('elements', '元素亲和', '元素层数上限 +1', [{ kind: 'stat', key: 'elementCapAdd', add: 1 }]),
  talent('interest', '高利贷', '利息上限 +2', [{ kind: 'stat', key: 'interestCap', add: 2 }]),
  talent('hp', '强健', '最大生命 +25', [{ kind: 'stat', key: 'maxHp', add: 25 }]),
  talent('energy', '超频', '能量回复 +25%', [{ kind: 'stat', key: 'energyRegenMult', mult: 1.25 }]),
  talent('charge', '蓄势', '蓄力快 20%', [{ kind: 'stat', key: 'chargeSpeedMult', mult: 1.2 }]),
  talent('knock', '巨力', '击退 +25%', [{ kind: 'stat', key: 'knockbackMult', mult: 1.25 }]),
  talent('combo', '连击大师', '连击上限 +5', [{ kind: 'stat', key: 'comboCap', add: 5 }]),
  talent('greed', '贪财', '每波结束 +3 金', []),
];
// greed 是事件规则而非被动，补一条
TALENTS[TALENTS.length - 1].rules = [rule('t-greed', 'onWaveEnd', [{ kind: 'gold', v: 3 }])];

export const CURSES: CurseDef[] = [
  { id: 'haste', name: '亡者疾行', desc: '僵尸移速 +20%', gold: 12,
    rules: [rule('c-haste', 'passive', [{ kind: 'stat', key: 'zombieSpeedMult', mult: 1.2 }])] },
  { id: 'inflation', name: '奸商', desc: '商店涨价 25%', gold: 12,
    rules: [rule('c-inflation', 'passive', [{ kind: 'stat', key: 'shopPriceMult', mult: 1.25 }])] },
  { id: 'fragile', name: '玻璃之躯', desc: '玩家受伤 +15%', gold: 15,
    rules: [rule('c-fragile', 'passive', [{ kind: 'stat', key: 'playerDamageTakenMult', mult: 1.15 }])] },
  { id: 'early-boss', name: '提前降临', desc: '立即获得一件稀有装备，但下波必出 Boss', gold: 18,
    rules: [rule('c-earlyboss', 'passive', [{ kind: 'stat', key: 'deployCap', add: 0 }])] },
];

export const WEATHER_RULES: Record<Exclude<WeatherId, 'clear'>, Rule[]> = {
  night: [rule('w-night', 'passive', [{ kind: 'stat', key: 'moveSpeed', mult: 1.0 }])],
  rain: [rule('w-rain-lightning', 'onHit', [{ kind: 'dmgMult', v: 1.3 }],
    { kind: 'opElement', element: 'lightning' }, 'mult', 140)],
  fire: [rule('w-fire', 'onWaveStart', [{ kind: 'spawn', what: 'firePatch', n: 3 }],
    { kind: 'weather', id: 'fire' }, 'add', 50)],
  fog: [rule('w-fog', 'onWaveStart', [{ kind: 'spawn', what: 'fog', n: 1 }],
    { kind: 'weather', id: 'fog' }, 'add', 50)],
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/data/rules.content.test.ts`
Expected: `5 passed`。

- [ ] **Step 5: 提交**

Run: `npx tsc --noEmit` → 无错误。

```bash
git add -A && git commit -m "feat: add set bonuses, combos, talents, curses and weather rules"
```

---

### Task 7: `resolveLoadout()` —— 3 格构筑结算

**Files:**
- Create: `src/game/state.ts`, `src/game/state.test.ts`

- [ ] **Step 1: 写失败测试**

`src/game/state.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { createRunState, resolveLoadout } from './state';
import { WEAPON_BY_ID } from '../data/weapons';
import { RNG } from '../engine/rng';

function run() { return createRunState(42, 'veteran', 'yard'); }
function equip(r: ReturnType<typeof run>, ids: (string | null)[], stars: (1|2|3)[] = [1,1,1]) {
  r.slots = ids.map((id, i) => id ? { weaponId: id, star: stars[i], res: r.slots[i]?.res ?? {
    ammo: 0, reloading: 0, combo: 0, charge: 0, energy: 100, mana: 100,
    overheat: 0, castCount: 0, cooldown: 0 } } : null);
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
  it('includes the 5th-cast rule only for a 3-piece magic loadout', () => {
    const r = run(); equip(r, ['firestaff', 'frosttome', 'ring']);
    expect(resolveLoadout(r).rules.some(x => x.id === 'magic-nth-cast')).toBe(true);
    const r2 = run(); equip(r2, ['firestaff', 'frosttome', 'pistol']);
    expect(resolveLoadout(r2).rules.some(x => x.id === 'magic-nth-cast')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/state.test.ts`
Expected: FAIL — 无法解析 `./state`。

- [ ] **Step 3: 实现 `src/game/state.ts`**

```ts
import { RNG } from '../engine/rng';
import { defaultStats, newSlotResource, STAGE_ORDER,
  type RunState, type Loadout, type PlayerStats, type Rule, type School,
  type ActiveRule, type Ctx, type Entity, newDamageOp } from '../core/types';
import { WEAPON_BY_ID } from '../data/weapons';
import { CHARACTER_BY_ID } from '../data/characters';
import { PASSIVE_BY_ID } from '../data/shop';
import { SET_RULES, COMBOS, TALENTS, CURSES, WEATHER_RULES, MAGIC_NTH_RULE } from '../data/rules.content';
import { makeOpSink, applyEffect } from '../engine/effects';

export function createRunState(seed: number, characterId: string, mapId: string): RunState {
  const rng = new RNG(seed);
  const slots: RunState['slots'] = [null, null, null];
  return {
    seed, rng, phase: 'shop', wave: 1, gold: 15, hp: 100,
    characterId, mapId, slots, passives: [], consumables: {},
    talents: [], curses: [], activeSlot: 0,
    shop: { items: [], freeRefresh: true, refreshCost: 2 },
    weather: 'clear', nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0,
  };
}

export function makeCtx(run: RunState, stats: PlayerStats,
  over: Partial<Ctx> = {}): Ctx {
  const schools: School[] = run.slots.map(s => s ? WEAPON_BY_ID[s.weaponId].school : null)
    .filter((s): s is School => s !== null);
  const stars = run.slots.map(s => s?.star ?? 0);
  const active = run.slots[run.activeSlot];
  const emptyEntity: Entity | null = null;
  return {
    run, stats, schools, stars,
    activeStar: active?.star ?? 0, activeSlot: run.activeSlot,
    combo: active?.res.combo ?? 0, castCount: active?.res.castCount ?? 0,
    wave: run.wave, weather: run.weather, targetId: 0, target: emptyEntity,
    op: newDamageOp(0, schools[run.activeSlot] ?? 'blade', 0),
    frontFacing: false, ...over,
  };
}

function collectedRules(run: RunState): { rules: Rule[]; combos: string[];
  setBonuses: Loadout['setBonuses'] } {
  const out: Rule[] = [];
  const schools = run.slots.map(s => s ? WEAPON_BY_ID[s.weaponId].school : null);
  const counts = new Map<School, number>();
  for (const s of schools) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);

  const setBonuses: Loadout['setBonuses'] = [];
  for (const [school, count] of counts) {
    const tier: 0 | 2 | 3 = count >= 3 ? 3 : count === 2 ? 2 : 0;
    setBonuses.push({ school, count, tier });
    if (tier === 0) continue;
    for (const sr of SET_RULES) if (sr.school === school && sr.tier <= tier) out.push(sr);
  }

  const combos: string[] = [];
  const present = new Set(schools.filter((s): s is School => s !== null));
  for (const c of COMBOS) {
    const needed = (c.when as { of: { schools: School[] }[] }).of[0].schools;
    if (needed.every(s => present.has(s))) { combos.push(c.id); out.push(...c.rules); }
  }
  if (counts.get('magic') === 3) out.push(MAGIC_NTH_RULE);

  const char = CHARACTER_BY_ID[run.characterId];
  if (char) out.push(...char.rules);
  for (const id of run.talents) { const t = TALENTS.find(x => x.id === id); if (t) out.push(...t.rules); }
  for (const id of run.curses) { const c = CURSES.find(x => x.id === id); if (c) out.push(...c.rules); }
  for (const id of run.passives) { const p = PASSIVE_BY_ID[id]; if (p) out.push(...p.rules); }
  for (const s of run.slots) {
    if (!s) continue;
    const def = WEAPON_BY_ID[s.weaponId];
    if (s.star >= 2) out.push(...(def.starRules[2] ?? []));
    if (s.star >= 3) out.push(...(def.starRules[3] ?? []));
  }
  if (run.weather !== 'clear') out.push(...WEATHER_RULES[run.weather]);
  return { rules: out, combos, setBonuses };
}

export function computeStats(passive: Rule[], ctx: Ctx): PlayerStats {
  const stats = defaultStats();
  ctx.stats = stats;
  const sink = makeOpSink(null, stats);
  const sorted = passive.slice().sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.order - b.order);
  for (const r of sorted) for (const e of r.effects) applyEffect(e as never, sink, ctx);
  return stats;
}

export function resolveLoadout(run: RunState): Loadout {
  const { rules, combos, setBonuses } = collectedRules(run);
  const baseCtx = makeCtx(run, defaultStats());
  const passive = rules.filter(r => r.trigger === 'passive');
  const stats = computeStats(passive, baseCtx);
  const active: ActiveRule[] = rules
    .filter(r => r.trigger !== 'passive')
    .slice()
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.order - b.order);
  return { rules: active, stats, setBonuses, combos };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/state.test.ts`
Expected: `7 passed`。

- [ ] **Step 5: 全量测试与提交**

Run: `npm test` → 全部 PASS；`npx tsc --noEmit` → 无错误。

```bash
git add -A && git commit -m "feat: add resolveLoadout with deterministic stat/rule resolution"
```

---

### Task 8: 商店经济

**Files:**
- Create: `src/game/economy.ts`, `src/game/economy.test.ts`

- [ ] **Step 1: 写失败测试**

`src/game/economy.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { createRunState, resolveLoadout } from './state';
import { rollShop, refreshShop, toggleLock, buyItem, sellSlot, settleWaveEnd,
  type BuyResult } from './economy';
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
    expect(buyItem(r, 1)).toBe('consumable'); expect(r.consumables['medkit']).toBe(1);
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/economy.test.ts`
Expected: FAIL — 无法解析 `./economy`。

- [ ] **Step 3: 实现 `src/game/economy.ts`**

```ts
import { WEAPONS, WEAPON_BY_ID } from '../data/weapons';
import { PASSIVES, PASSIVE_BY_ID, CONSUMABLES, CONSUMABLE_BY_ID } from '../data/shop';
import { CHARACTER_BY_ID } from '../data/characters';
import { resolveLoadout } from './state';
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
  run.slots[target] = { weaponId: item.id, star: 1, res: {
    ammo: WEAPON_BY_ID[item.id].magSize, reloading: 0, combo: 0, charge: 0,
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/economy.test.ts`
Expected: `10 passed`.

- [ ] **Step 5: 提交**

Run: `npm test && npx tsc --noEmit` → 全绿。

```bash
git add -A && git commit -m "feat: add shop economy with refresh, lock, merge, sell and interest"
```

---

### Task 9: 波次导演

**Files:**
- Create: `src/game/wave.ts`, `src/game/wave.test.ts`

- [ ] **Step 1: 写失败测试**

`src/game/wave.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { composeWave, previewFor, waveHpScale, isBossWave, WEATHER_FOR_WAVE } from './wave';
import { RNG } from '../engine/rng';
import { ZOMBIE_BY_ID } from '../data/zombies';

describe('composeWave', () => {
  it('is reproducible for the same seed and references real zombie ids', () => {
    const a = composeWave(3, new RNG(5)), b = composeWave(3, new RNG(5));
    expect(a).toEqual(b);
    for (const g of a.groups) expect(ZOMBIE_BY_ID[g.id]).toBeDefined();
  });
  it('every 5th wave is a boss wave with an alternating boss', () => {
    expect(isBossWave(5)).toBe(true); expect(isBossWave(10)).toBe(true);
    expect(isBossWave(4)).toBe(false);
    const b5 = composeWave(5, new RNG(1)), b10 = composeWave(10, new RNG(1));
    expect(b5.boss).toBe('butcher');
    expect(b10.boss).toBe('mother');
  });
  it('preview matches the dominant normal types of the actual wave', () => {
    for (const wave of [1, 2, 3, 7, 12]) {
      const p = previewFor(wave, new RNG(wave));
      expect(p.length).toBeGreaterThan(0);
      const c = composeWave(wave, new RNG(wave));
      expect(p.every(id => c.groups.some(g => g.id === id))).toBe(true);
    }
  });
  it('hp scale and count grow monotonically', () => {
    expect(waveHpScale(10)).toBeGreaterThan(waveHpScale(1));
    expect(composeWave(12, new RNG(3)).groups.reduce((s, g) => s + g.count, 0))
      .toBeGreaterThan(composeWave(2, new RNG(3)).groups.reduce((s, g) => s + g.count, 0));
  });
  it('weather is deterministic per wave and clear on wave 1', () => {
    expect(WEATHER_FOR_WAVE(1, new RNG(1))).toBe('clear');
    expect(WEATHER_FOR_WAVE(9, new RNG(9))).toBe(WEATHER_FOR_WAVE(9, new RNG(9)));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/wave.test.ts`
Expected: FAIL — 无法解析 `./wave`。

- [ ] **Step 3: 实现 `src/game/wave.ts`**

```ts
import { RNG } from '../engine/rng';
import type { WeatherId } from '../core/types';

export interface WaveGroup { id: string; count: number }
export interface WavePlan { groups: WaveGroup[]; boss: string | null; hpScale: number }

const NORMAL_BY_WAVE: Record<string, number> = {
  walker: 1, runner: 2, fatty: 3, shield: 4, spitter: 5, summoner: 6, armored: 7,
};
const WEATHERS: WeatherId[] = ['clear', 'night', 'rain', 'fire', 'fog'];

export function isBossWave(wave: number): boolean { return wave % 5 === 0; }
export function waveHpScale(wave: number): number { return 1 + (wave - 1) * 0.14; }

export function WEATHER_FOR_WAVE(wave: number, rng: RNG): WeatherId {
  if (wave <= 1) return 'clear';
  return WEATHERS[rng.int(1, WEATHERS.length - 1)];
}

export function previewFor(wave: number, rng: RNG): string[] {
  if (isBossWave(wave)) return ['boss'];
  const unlocked = Object.entries(NORMAL_BY_WAVE)
    .filter(([, min]) => min <= Math.max(2, Math.min(7, Math.ceil(wave / 2))))
    .map(([id]) => id);
  const pool = unlocked.filter(id => id !== 'walker');
  const picks = rng.shuffle(pool).slice(0, Math.min(2, pool.length));
  return ['walker', ...picks];
}

export function composeWave(wave: number, rng: RNG): WavePlan {
  const hpScale = waveHpScale(wave);
  if (isBossWave(wave)) {
    const boss = (Math.floor(wave / 5) % 2 === 1) ? 'butcher' : 'mother';
    const escorts = rng.shuffle(['walker', 'runner', fattyId()]).slice(0, 2);
    return { boss, hpScale,
      groups: escorts.map(id => ({ id, count: 3 + Math.floor(wave / 3) })) };
  }
  const preview = previewFor(wave, rng);
  const total = 5 + wave * 2;
  const groups: WaveGroup[] = preview.map((id, i) => ({
    id, count: Math.max(1, Math.round(total * (i === 0 ? 0.5 : 0.5 / (preview.length - 1)))),
  }));
  return { boss: null, hpScale, groups };
}
function fattyId(): string { return 'fatty'; }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/wave.test.ts`
Expected: `5 passed`.

- [ ] **Step 5: 提交**

Run: `npm test && npx tsc --noEmit` → 全绿。

```bash
git add -A && git commit -m "feat: add wave director with preview, boss cadence and weather"
```

---

### Task 10: 局外存档与点数结算

**Files:**
- Create: `src/game/meta.ts`, `src/game/meta.test.ts`

- [ ] **Step 1: 写失败测试**

`src/game/meta.test.ts`
```ts
import { describe, it, expect, vi } from 'vitest';
import { loadSave, saveGame, settleRun, UNLOCKS, defaultSave } from './meta';
import { createRunState } from './state';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe('save data', () => {
  it('returns a default save when storage is empty', () => {
    expect(loadSave(fakeStorage())).toEqual(defaultSave());
  });
  it('round-trips through saveGame/loadSave', () => {
    const s = fakeStorage();
    const d = { ...defaultSave(), points: 77, unlockedMaps: ['lab'] };
    saveGame(d, s);
    expect(loadSave(s)).toEqual(d);
  });
  it('safely resets on corrupt JSON or incompatible version', () => {
    const s = fakeStorage(); s.setItem('zombie-arena-save', '{not json');
    expect(loadSave(s)).toEqual(defaultSave());
    const s2 = fakeStorage(); s2.setItem('zombie-arena-save', JSON.stringify({ version: 999 }));
    expect(loadSave(s2)).toEqual(defaultSave());
  });
});

describe('settleRun', () => {
  it('awards wave*2 + kills/10 + bossKills*5 points', () => {
    const r = createRunState(1, 'veteran', 'yard');
    r.wave = 12; r.kills = 130; r.bossKills = 2;
    const d = settleRun(r, defaultSave());
    expect(d.points).toBe(24 + 13 + 10);
    expect(d.bestWave).toBe(12);
    expect(d.totalKills).toBe(130);
  });
  it('never lowers bestWave across runs', () => {
    const r = createRunState(1, 'veteran', 'yard'); r.wave = 3;
    const prev = { ...defaultSave(), bestWave: 20, totalKills: 50 };
    expect(settleRun(r, prev).bestWave).toBe(20);
    expect(settleRun(r, prev).totalKills).toBe(50);
  });
  it('exposes unlock catalogue with costs', () => {
    expect(UNLOCKS.length).toBeGreaterThan(0);
    for (const u of UNLOCKS) expect(u.cost).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/meta.test.ts`
Expected: FAIL — 无法解析 `./meta`。

- [ ] **Step 3: 实现 `src/game/meta.ts`**

```ts
import type { SaveData, RunState } from '../core/types';

export const SAVE_KEY = 'zombie-arena-save';
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
export interface UnlockDef { id: string; name: string; cost: number; kind: 'character' | 'map' | 'weapon' }
export const UNLOCKS: UnlockDef[] = [
  { id: 'engineer', name: '工程师', cost: 40, kind: 'character' },
  { id: 'ronin', name: '浪人', cost: 40, kind: 'character' },
  { id: 'jailer', name: '狱卒', cost: 60, kind: 'character' },
  { id: 'lab', name: '地下实验室', cost: 50, kind: 'map' },
  { id: 'rooftop', name: '雨夜天台', cost: 90, kind: 'map' },
  { id: 'chainsaw', name: '链锯（加入商店池）', cost: 70, kind: 'weapon' },
  { id: 'sniper', name: '狙击枪（加入商店池）', cost: 70, kind: 'weapon' },
];
export function defaultSave(): SaveData {
  return { version: 1, points: 0, bestWave: 0, totalKills: 0,
    unlockedCharacters: ['veteran', 'wizard'], unlockedMaps: ['yard'], unlockedWeapons: [] };
}
function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
export function loadSave(storage: StorageLike | null = browserStorage()): SaveData {
  if (!storage) return defaultSave();
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed.version !== 1 || typeof parsed.points !== 'number'
      || !Array.isArray(parsed.unlockedCharacters)) return defaultSave();
    return { ...defaultSave(), ...parsed };
  } catch { return defaultSave(); }
}
export function saveGame(data: SaveData, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try { storage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* 存储被禁用时静默降级 */ }
}
export function settleRun(run: RunState, prev: SaveData): SaveData {
  const points = run.wave * 2 + Math.floor(run.kills / 10) + run.bossKills * 5;
  return {
    ...prev,
    points: prev.points + points,
    bestWave: Math.max(prev.bestWave, run.wave),
    totalKills: prev.totalKills + run.kills,
  };
}
export function buyUnlock(save: SaveData, id: string): SaveData {
  const u = UNLOCKS.find(x => x.id === id);
  if (!u || save.points < u.cost) return save;
  const next = { ...save, points: save.points - u.cost };
  if (u.kind === 'character') next.unlockedCharacters = [...save.unlockedCharacters, id];
  if (u.kind === 'map') next.unlockedMaps = [...save.unlockedMaps, id];
  if (u.kind === 'weapon') next.unlockedWeapons = [...save.unlockedWeapons, id];
  return next;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/meta.test.ts`
Expected: `6 passed`（`vi` 未使用不影响）。

- [ ] **Step 5: 提交**

Run: `npm test && npx tsc --noEmit` → 全绿。

```bash
git add -A && git commit -m "feat: add meta progression with versioned localStorage save"
```

---

### Task 11: 战斗、伤害管线、状态与元素反应

**Files:**
- Create: `src/game/combat.ts`, `src/game/combat.test.ts`

- [ ] **Step 1: 写失败测试**

`src/game/combat.test.ts`
```ts
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
    const { w, run } = world();
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/combat.test.ts`
Expected: FAIL — 无法解析 `./combat`。

- [ ] **Step 3: 实现 `src/game/combat.ts`**

```ts
import { EventBus } from '../engine/events';
import { RuleEngine } from '../engine/rules';
import { makeOpSink, type EffectSink } from '../engine/effects';
import { finalDamage, newDamageOp,
  type RunState, type Entity, type DamageOp, type Ctx, type Rule,
  type StatusId, type ActiveRule, type PlayerStats } from '../core/types';
import { makeCtx, resolveLoadout } from './state';
import { ZOMBIE_BY_ID } from '../data/zombies';

export class World {
  entities: Entity[] = [];
  private nextId = 1;
  ruleSet: ActiveRule[] = [];
  extraRules: Rule[] = [];
  stats: PlayerStats;
  engine: RuleEngine;
  sink: EffectSink;
  logs: string[] = [];
  spawned: { what: string; n: number }[] = [];
  floating: { x: number; y: number; text: string; time: number }[] = [];

  constructor(public run: RunState, public bus: EventBus) {
    this.stats = resolveLoadout(run).stats;
    this.sink = {
      op: null,
      heal: v => { this.run.hp = Math.min(this.stats.maxHp, this.run.hp + v); },
      gold: v => { this.run.gold += v; this.run.totalGoldEarned += v; },
      status: (s, stacks) => this.addStatus(this.currentTarget, s, stacks),
      spawn: (what, n) => this.spawned.push({ what, n }),
      stat: () => {},
      vfx: name => this.logs.push(name),
    };
    this.engine = new RuleEngine(bus, this.sink);
    this.bus.on('onKill', (p) => {
      if (p.byMelee && this.stats.meleeKillHeal > 0) this.sink.heal(this.stats.meleeKillHeal);
    });
  }
  currentTarget: Entity | null = null;
  setRules(rules: ActiveRule[]): void {
    this.stats = resolveLoadout(this.run).stats;
    this.ruleSet = rules.slice();
    this.engine.setRules(this.ruleSet); // extraRules 只由 dealDamage 注入 onHit 求值
  }
  ctxFor(target: Entity | null, op: DamageOp | null, frontFacing: boolean): Ctx {
    const c = makeCtx(this.run, this.stats, {
      targetId: target?.id ?? 0, target, op, frontFacing,
    });
    return c;
  }
  newId(): number { return this.nextId++; }
  addStatus(e: Entity | null, s: StatusId, stacks: number): void {
    if (!e) return;
    const cur = e.statuses.find(x => x.id === s);
    if (cur) { cur.stacks += stacks; cur.time = Math.max(cur.time, 2); }
    else e.statuses.push({ id: s, stacks, time: 2 });
  }
  float(x: number, y: number, text: string): void { this.floating.push({ x, y, text, time: 0.8 }); }
  sweepDead(): void { this.entities = this.entities.filter(e => !e.dead); }
}

export function dealDamage(w: World, target: Entity, op: DamageOp, frontFacing = false): number {
  if (target.dead) return 0;
  w.currentTarget = target;
  const ctx = w.ctxFor(target, op, frontFacing);
  w.sink.op = op;

  // 僵尸自身特性规则（同属声明式规则，按 stage/order 参与求值）。
  // 注入到 dispatchFor 的 extraRules，与 loadout 规则一起排序后**只求值一次**。
  const zombieRules: ActiveRule[] = [
    ...(w.extraRules as ActiveRule[]),
    ...((ZOMBIE_BY_ID[target.kind]?.rules ?? []) as ActiveRule[]),
  ];
  w.engine.dispatchFor('onHit', ctx, zombieRules);
  // 暴击判定（被动规则里 critChance 由 stats 提供）
  if (!op.crit && w.run.rng.chance(w.stats.critChance)) op.crit = true;

  const amount = finalDamage(op);
  if (amount > 0) {
    target.hp -= amount;
    w.float(target.x, target.y - 14, String(Math.round(amount)));
    w.bus.emit('onDamage', { ctx, amount });
    if (op.element) {
      const s: StatusId = op.element === 'fire' ? 'burn' : op.element === 'ice' ? 'chill' : 'shock';
      w.addStatus(target, s, 1);
      const reaction = elementReaction(target, s);
      if (reaction === 'chain') w.spawned.push({ what: 'arc', n: 1 });
    }
    if (target.hp <= 0) {
      target.dead = true;
      w.run.kills += 1;
      const def = ZOMBIE_BY_ID[target.kind];
      if (def) {
        w.run.gold += def.gold; w.run.totalGoldEarned += def.gold;
        if (def.boss) w.run.bossKills += 1;
        if (target.tags.includes('explodes')) w.spawned.push({ what: 'explosion', n: 1 });
      }
      const byMelee = op.tags.includes('melee') || op.tags.includes('heavy');
      w.bus.emit('onKill', { ctx, byMelee });
    }
  }
  return amount;
}

export function elementReaction(e: Entity, s: StatusId): 'freeze' | 'chain' | null {
  const cur = e.statuses.find(x => x.id === s);
  if (!cur) return null;
  const cap = 3;
  if (s === 'chill' && cur.stacks >= cap) {
    if (!e.statuses.some(x => x.id === 'freeze')) e.statuses.push({ id: 'freeze', stacks: 1, time: 1.2 });
    return 'freeze';
  }
  if (s === 'shock' && cur.stacks >= cap) { cur.stacks = 0; return 'chain'; }
  return null;
}

export function tickStatuses(w: World, e: Entity, dt: number): void {
  for (const st of e.statuses) {
    st.time -= dt;
    if (st.id === 'burn') { e.hp -= 3 * st.stacks * dt; w.float(e.x, e.y - 8, '·'); }
    if (st.id === 'poison') e.hp -= 2 * st.stacks * dt;
    if (st.id === 'stun' || st.id === 'freeze') e.data['cc'] = st.time;
    if (e.hp <= 0) e.dead = true;
  }
  e.statuses = e.statuses.filter(s => s.time > 0);
  if (!e.statuses.some(s => s.id === 'stun' || s.id === 'freeze')) e.data['cc'] = 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/combat.test.ts`
Expected: `7 passed`。僵尸特性规则由 `dealDamage()` 通过 `ZOMBIE_BY_ID[target.kind].rules` 自动注入，测试只需把实体的 `kind` 设为 `'shield'` / `'armored'`，无需手动往 `ruleSet` 里塞规则。

- [ ] **Step 5: 提交**

Run: `npm test && npx tsc --noEmit` → 全绿。

```bash
git add -A && git commit -m "feat: add combat damage pipeline, statuses and element reactions"
```

---

### Task 12: 地图互动物件与天气效果

**Files:**
- Create: `src/game/arena.ts`, `src/game/arena.test.ts`

- [ ] **Step 1: 写失败测试**

`src/game/arena.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { Arena, damageObject, repairBarriers, trapBonusAt, fireSpread } from './arena';
import { MAP_BY_ID } from '../data/maps';

describe('Arena', () => {
  it('loads a map with barriers, barrels, boxes and trap slots', () => {
    const a = new Arena('yard');
    expect(a.barriers.length).toBe(MAP_BY_ID['yard'].barriers.length);
    expect(a.barrels.length).toBe(2);
    expect(a.traps.length).toBe(3);
  });
  it('barriers break at 0 hp and repair costs gold', () => {
    const a = new Arena('yard');
    const b = a.barriers[0]; b.hp = 5; a.gold = 20;
    damageObject(b, 10); expect(b.hp).toBe(0);
    expect(repairBarriers(a)).toBe(1);
    expect(a.gold).toBe(15);
    expect(b.hp).toBeGreaterThan(0);
  });
  it('barrels explode when destroyed', () => {
    const a = new Arena('yard');
    const bar = a.barrels[0];
    expect(damageObject(bar, 999)).toBe('explosion');
  });
  it('trap slots grant a tech damage bonus at their position', () => {
    const a = new Arena('yard');
    const t = a.traps[0];
    expect(trapBonusAt(a, t.x, t.y)).toBeGreaterThan(1);
    expect(trapBonusAt(a, 5, 5)).toBe(1);
  });
  it('fire event spreads patches and fog shrinks the safe radius over time', () => {
    const a = new Arena('yard');
    a.setWeather('fire');
    expect(fireSpread(a).length).toBeGreaterThan(0);
    a.setWeather('fog');
    const r0 = a.safeRadius; a.tick(10); expect(a.safeRadius).toBeLessThan(r0);
  });
  it('night reduces visibility radius', () => {
    const a = new Arena('yard'); a.setWeather('night');
    expect(a.visionRadius).toBeLessThan(960);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/game/arena.test.ts`
Expected: FAIL — 无法解析 `./arena`。

- [ ] **Step 3: 实现 `src/game/arena.ts`**

```ts
import { MAP_BY_ID } from '../data/maps';
import type { WeatherId } from '../core/types';

export interface ArenaObject { x: number; y: number; w: number; h: number; hp: number; maxHp: number; kind: string }
export interface FirePatch { x: number; y: number; time: number }

export class Arena {
  mapId: string;
  barriers: ArenaObject[] = [];
  barrels: ArenaObject[] = [];
  boxes: ArenaObject[] = [];
  traps: { x: number; y: number }[] = [];
  gold = 0;
  weather: WeatherId = 'clear';
  safeRadius = 460;
  visionRadius = 960;
  fires: FirePatch[] = [];
  time = 0;

  constructor(mapId: string) {
    const m = MAP_BY_ID[mapId] ?? MAP_BY_ID['yard'];
    this.mapId = m.id;
    this.barriers = m.barriers.map(b => ({ ...b, hp: 60, maxHp: 60, kind: 'barrier' }));
    this.barrels = m.barrels.map(p => ({ x: p.x, y: p.y, w: 16, h: 16, hp: 12, maxHp: 12, kind: 'barrel' }));
    this.boxes = m.boxes.map(p => ({ x: p.x, y: p.y, w: 20, h: 20, hp: 40, maxHp: 40, kind: 'box' }));
    this.traps = m.traps.map(t => ({ ...t }));
  }
  setWeather(w: WeatherId): void {
    this.weather = w;
    this.safeRadius = 460; this.visionRadius = w === 'night' ? 220 : 960;
    this.fires = [];
    if (w === 'fire') this.fires = fireSpread(this);
  }
  tick(dt: number): void {
    this.time += dt;
    if (this.weather === 'fog') this.safeRadius = Math.max(140, 460 - this.time * 8);
    if (this.weather === 'fire') {
      for (const f of this.fires) f.time -= dt;
      if (this.fires.length < 6 && this.time % 3 < dt) this.fires.push(...fireSpread(this).slice(0, 1));
      this.fires = this.fires.filter(f => f.time > 0);
    }
  }
  solidObjects(): ArenaObject[] {
    return [...this.barriers.filter(b => b.hp > 0), ...this.boxes.filter(b => b.hp > 0)];
  }
}
export function damageObject(o: ArenaObject, amount: number): string | null {
  o.hp -= amount;
  if (o.hp > 0) return null;
  o.hp = 0;
  return o.kind === 'barrel' ? 'explosion' : o.kind === 'box' ? 'shock' : null;
}
export function repairBarriers(a: Arena, costPer = 5): number {
  let repaired = 0;
  for (const b of a.barriers) {
    if (b.hp < b.maxHp && a.gold >= costPer) { a.gold -= costPer; b.hp = b.maxHp; repaired++; }
  }
  return repaired;
}
export function trapBonusAt(a: Arena, x: number, y: number): number {
  const near = a.traps.some(t => Math.hypot(t.x - x, t.y - y) < 46);
  return near ? 1.5 : 1;
}
export function fireSpread(a: Arena): FirePatch[] {
  const seeds = a.barrels.map(b => ({ x: b.x, y: b.y }));
  return seeds.map((s, i) => ({ x: s.x + i * 24 - 12, y: s.y + i * 12, time: 6 }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/game/arena.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: 提交**

Run: `npm test && npx tsc --noEmit` → 全绿。

```bash
git add -A && git commit -m "feat: add arena objects, repair, traps and weather effects"
```

---

### Task 13: 能力原语与 5 流派手感

**Files:**
- Create: `src/engine/abilities.ts`, `src/engine/abilities.test.ts`

- [ ] **Step 1: 写失败测试**

`src/engine/abilities.test.ts`
```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/engine/abilities.test.ts`
Expected: FAIL — 无法解析 `./abilities`。

- [ ] **Step 3: 实现 `src/engine/abilities.ts`**

```ts
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
  if (r.reloading > 0) { tickReload(slot, dt, def); return; }
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
}
export function startReload(slot: EquipSlot, def: WeaponDef, stats: PlayerStats): void {
  if (def.school !== 'gun' || slot.res.reloading > 0) return;
  slot.res.reloading = def.reloadTime * stats.reloadMult;
}
export function tickReload(slot: EquipSlot, dt: number, def: WeaponDef): void {
  if (slot.res.reloading <= 0) return;
  slot.res.reloading -= dt;
  if (slot.res.reloading <= 0) {
    slot.res.reloading = 0;
    slot.res.ammo = def.magSize;
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
  if (currentCount >= stats.deployCap || slot.res.energy < def.energyCost) return false;
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/engine/abilities.test.ts`
Expected: `7 passed`.

- [ ] **Step 5: 提交**

Run: `npm test && npx tsc --noEmit` → 全绿。

```bash
git add -A && git commit -m "feat: add ability primitives and per-slot resource state machines"
```

---

### Task 14: 程序化像素精灵与 Canvas 渲染

**Files:**
- Create: `src/ui/sprites.ts`, `src/ui/render.ts`, `src/ui/render.test.ts`

- [ ] **Step 1: 写失败测试**

`src/ui/render.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { SPRITE_MAPS, spriteIds } from './sprites';
import { renderFrame } from './render';
import { createRunState, resolveLoadout } from '../game/state';
import { EventBus } from '../engine/events';
import { World } from '../game/combat';
import { Arena } from '../game/arena';

function stubCtx() {
  const calls: string[] = [];
  const c = new Proxy({}, { get: (_t, k) => {
    if (k === 'canvas') return { width: 960, height: 640 };
    return (...args: unknown[]) => { calls.push(String(k)); void args; };
  } }) as unknown as CanvasRenderingContext2D;
  return { c, calls };
}

describe('sprites', () => {
  it('has a pixel map for every referenced sprite id', () => {
    for (const id of spriteIds()) expect(SPRITE_MAPS[id]).toBeDefined();
    expect(spriteIds().length).toBeGreaterThanOrEqual(15);
  });
  it('each pixel map has equal-length rows and a palette for every glyph', () => {
    for (const [id, m] of Object.entries(SPRITE_MAPS)) {
      expect(m.rows.every(r => r.length === m.w), id).toBe(true);
      for (const row of m.rows) for (const ch of row) {
        if (ch !== '.') expect(m.palette[ch], `${id}:${ch}`).toBeDefined();
      }
    }
  });
});

describe('renderFrame', () => {
  it('draws a frame without throwing using a stub 2D context', () => {
    const { c, calls } = stubCtx();
    const run = createRunState(1, 'veteran', 'yard');
    const bus = new EventBus();
    const world = new World(run, bus);
    world.setRules(resolveLoadout(run).rules);
    const arena = new Arena('yard');
    expect(() => renderFrame(c, { run, world, arena, stats: world.stats,
      mouse: { x: 100, y: 100 }, phase: 'combat', dt: 0.016,
      loadout: resolveLoadout(run) })).not.toThrow();
    expect(calls.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/ui/render.test.ts`
Expected: FAIL — 无法解析 `./sprites`。

- [ ] **Step 3: 实现 `src/ui/sprites.ts`**

```ts
export interface PixelMap { w: number; h: number; rows: string[]; palette: Record<string, string>; scale: number }
const P = (rows: string[], palette: Record<string, string>, scale = 3): PixelMap =>
  ({ w: rows[0].length, h: rows.length, rows, palette, scale });

const FLESH = 'f', DARK = 'd', EYE = 'e', CLOTH = 'c', METAL = 'm', HOT = 'h', ICE = 'i', ARC = 'a';
const base: Record<string, string> = { f: '#8fae6a', d: '#3d4a2c', e: '#ff5555',
  c: '#5a4a63', m: '#b9c2cc', h: '#ff9a3c', i: '#8fdcff', a: '#ffe066' };

export const SPRITE_MAPS: Record<string, PixelMap> = {
  player: P(['..cccc..','.cffffc.','.cfeefc.','.cffffc.','..cmmc..','..m..m..','..m..m..','.bb..bb.'],
    { ...base, b: '#2b2b38' }),
  walker: P(['..ffff..','.ffeeff.','.ffffff.','..dddd..','.d.dd.d.','..d..d..','.d....d.','........'],
    base),
  runner: P(['..ffff..','.ffeeff.','.ffffff.','.dddddd.','d..dd..d','.d....d.','d......d','........'],
    { ...base, f: '#b9d17a' }),
  fatty: P(['.ffffff.','ffeeffeff','ffffffff','fddddddf','fddddddf','.fddddf.','.d.d.d.d.','..d..d..'],
    base),
  shield: P(['..ffff..','.ffeeff.','.ffffff.','mmmmmmmm','mmddddmm','mmddddmm','.d.d.d.d','..d..d..'],
    base),
  spitter: P(['..ffff..','.ffeeff.','.hhffhh.','.ffffff.','..dddd..','.d.dd.d.','..d..d..','........'],
    base),
  summoner: P(['..cccc..','.cceecc.','.cffffc.','.cccccc.','ccddddcc','.d.d.d.d','..d..d..','........'],
    base),
  armored: P(['.mmmmmm.','mmfeefmm','mmffffmm','mmmmmmmm','mmddddmm','mmddddmm','.m.m.m.m','..m..m..'],
    base),
  butcher: P(['mmffffmm','mffeeffm','ffffffff','ffddddff','ffddddff','mmffffmm','.m.m.m.m','..m..m..'],
    base),
  mother: P(['.ccffcc.','cceeeecc','cffffffc','ccffffcc','cccccccc','cddddddc','.d.d.d.d','..d..d..'],
    base),
  knife: P(['......m.','.....mm.','....mm..','...mm...','..mm....','.cc.....','cc......','........'], base),
  katana: P(['......m.','.....mm.','....mm..','...mm...','..mm....','.mm.....','cc......','........'], base),
  saw: P(['mmmmmm..','mhmmhmm.','cccccccc','cddddddc','cccccccc','.c....c.','........','........'], base),
  pistol: P(['..mmmm..','.mmmmmm.','.ccmmm..','..cc....','..cc....','........','........','........'], base),
  shotgun: P(['mmmmmmmm','ccccmmmm','..cc....','..cc....','........','........','........','........'], base),
  sniper: P(['mmmmmmmm','.ccmmmmm','..cc..c.','..cc....','........','........','........','........'], base),
  bat: P(['......mm','.....mm.','....mm..','...mm...','..mm....','.cc.....','cc......','........'], base),
  hammer: P(['..mmmm..','..mmmm..','...cc...','...cc...','...cc...','...cc...','........','........'], base),
  mace: P(['..mmmm..','.mhmmhm.','mmmmmmmm','...cc...','...cc...','...cc...','........','........'], base),
  turret: P(['..mmmm..','.mmccmm.','mmcmmcmm','.mmmmmm.','..cccc..','.cc..cc.','........','........'], base),
  grid: P(['ahahahah','hahahaha','ahahahah','hahahaha','........','........','........','........'], base),
  drone: P(['..a..a..','.aammaa.','aammmmaa','..mmmm..','..a..a..','........','........','........'], base),
  firestaff: P(['......h.','.....hh.','....hh..','...hh...','..hh....','.cc.....','cc......','........'], base),
  frosttome: P(['.iiiiii.','iccciicc','icccciic','icccciic','.iiiiii.','........','........','........'], base),
  ring: P(['..aaaa..','.a....a.','a..aa..a','a..aa..a','.a....a.','..aaaa..','........','........'], base),
  barrel: P(['.hhhhhh.','hddddddh','hdhddhdh','hddddddh','hdhddhdh','hddddddh','.hhhhhh.','........'], base),
  crate: P(['.cccccc.','cdcdcdcc','cccccccc','cdcdcdcc','cccccccc','.cccccc.','........','........'], base),
};
export function spriteIds(): string[] { return Object.keys(SPRITE_MAPS); }
export function drawSprite(ctx: CanvasRenderingContext2D, id: string, x: number, y: number): void {
  const m = SPRITE_MAPS[id] ?? SPRITE_MAPS['walker'];
  for (let r = 0; r < m.rows.length; r++) {
    for (let c = 0; c < m.w; c++) {
      const ch = m.rows[r][c];
      if (ch === '.') continue;
      ctx.fillStyle = m.palette[ch] ?? '#ffffff';
      ctx.fillRect(x + (c - m.w / 2) * m.scale, y + (r - m.h / 2) * m.scale, m.scale, m.scale);
    }
  }
}
```

- [ ] **Step 4: 实现 `src/ui/render.ts`**

```ts
import { drawSprite } from './sprites';
import type { RunState, PlayerStats, Phase, Loadout } from '../core/types';
import type { World } from '../game/combat';
import type { Arena } from '../game/arena';
import { WEAPON_BY_ID } from '../data/weapons';
import { GAME_W, GAME_H } from '../core/constants';

export interface RenderInput {
  run: RunState; world: World; arena: Arena; stats: PlayerStats;
  mouse: { x: number; y: number }; phase: Phase; dt: number; loadout: Loadout;
}

export function renderFrame(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
  const { run, world, arena, stats, mouse, phase } = inp;
  ctx.clearRect(0, 0, GAME_W, GAME_H);
  ctx.fillStyle = '#161a22'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  // 地砖
  ctx.strokeStyle = '#1f2632'; ctx.lineWidth = 1;
  for (let x = 0; x <= GAME_W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GAME_H); ctx.stroke(); }
  for (let y = 0; y <= GAME_H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GAME_W, y); ctx.stroke(); }
  // 陷阱位
  ctx.fillStyle = '#2a3550';
  for (const t of arena.traps) ctx.fillRect(t.x - 10, t.y - 10, 20, 20);
  // 互动物件
  for (const o of [...arena.barriers, ...arena.barrels, ...arena.boxes]) {
    if (o.hp <= 0) continue;
    const id = o.kind === 'barrel' ? 'barrel' : 'crate';
    ctx.globalAlpha = o.hp / o.maxHp * 0.5 + 0.5;
    if (o.kind === 'barrier') {
      ctx.fillStyle = '#6b5330'; ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.globalAlpha = 1;
    } else drawSprite(ctx, id, o.x + o.w / 2, o.y + o.h / 2);
  }
  ctx.globalAlpha = 1;
  // 火焰
  ctx.fillStyle = '#ff7a2f';
  for (const f of arena.fires) { ctx.globalAlpha = 0.5; ctx.fillRect(f.x - 12, f.y - 12, 24, 24); }
  ctx.globalAlpha = 1;
  // 实体
  for (const e of world.entities) {
    if (e.dead) continue;
    drawSprite(ctx, e.id === 1 ? 'player' : e.kind,
      e.x, e.y);
    if (e.hp < e.maxHp) {
      ctx.fillStyle = '#000'; ctx.fillRect(e.x - 14, e.y - 20, 28, 3);
      ctx.fillStyle = '#e05050'; ctx.fillRect(e.x - 14, e.y - 20, 28 * Math.max(0, e.hp / e.maxHp), 3);
    }
  }
  // 飘字
  ctx.font = '12px monospace'; ctx.textAlign = 'center';
  for (const f of world.floating) { ctx.fillStyle = '#ffe9a8'; ctx.fillText(f.text, f.x, f.y); }
  ctx.textAlign = 'left';
  // 夜晚 / 毒雾遮罩
  if (arena.weather === 'night' || arena.weather === 'fog') {
    const px = world.entities.find(e => e.id === 1)?.x ?? GAME_W / 2;
    const py = world.entities.find(e => e.id === 1)?.y ?? GAME_H / 2;
    const r = arena.weather === 'night' ? arena.visionRadius : arena.safeRadius;
    const g = ctx.createRadialGradient(px, py, r * 0.55, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(4,6,10,0.96)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);
  }
  // 准星
  if (phase === 'combat') {
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouse.x - 11, mouse.y); ctx.lineTo(mouse.x - 4, mouse.y);
    ctx.moveTo(mouse.x + 4, mouse.y); ctx.lineTo(mouse.x + 11, mouse.y); ctx.stroke();
  }
  drawHud(ctx, inp);
}

function drawHud(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
  const { run, stats, loadout, phase } = inp;
  ctx.fillStyle = '#0d0f14cc'; ctx.fillRect(0, 0, GAME_W, 34);
  ctx.font = '13px monospace'; ctx.fillStyle = '#e8e6df';
  ctx.fillText(`波次 ${run.wave}`, 12, 22);
  ctx.fillText(`金币 ${run.gold}`, 100, 22);
  ctx.fillText(`HP ${Math.ceil(run.hp)}/${stats.maxHp}`, 190, 22);
  ctx.fillText(`击杀 ${run.kills}`, 310, 22);
  ctx.fillText(`天气 ${run.weather}`, 400, 22);
  if (phase === 'combat') ctx.fillText(`剩余 ${inp.world.entities.filter(e => !e.dead && e.id !== 1).length}`, 510, 22);
  ctx.fillStyle = '#ffe066';
  ctx.fillText(`预告: ${run.nextWavePreview.join(' / ') || '—'}`, 620, 22);
  // 3 格装备
  for (let i = 0; i < 3; i++) {
    const x = 12 + i * 118, y = GAME_H - 62;
    ctx.fillStyle = i === run.activeSlot ? '#3a4a6a' : '#1b2130';
    ctx.fillRect(x, y, 110, 52);
    ctx.strokeStyle = i === run.activeSlot ? '#ffe066' : '#445'; ctx.strokeRect(x, y, 110, 52);
    const s = run.slots[i];
    if (s) {
      const d = WEAPON_BY_ID[s.weaponId];
      ctx.fillStyle = '#e8e6df'; ctx.fillText(`${i + 1} ${d.name} ${'★'.repeat(s.star)}`, x + 5, y + 16);
      ctx.fillStyle = '#9fb0c8'; ctx.fillText(`${d.school} | ${resourceText(s.res, d.school)}`, x + 5, y + 33);
    } else { ctx.fillStyle = '#667'; ctx.fillText(`${i + 1} (空)`, x + 5, y + 20); }
  }
  ctx.fillStyle = '#8fdcff';
  ctx.fillText(`套装:${loadout.setBonuses.map(b => `${b.school}${b.count}`).join(' ')}  组合:${loadout.combos.join(' ')}`,
    12, GAME_H - 70);
}
function resourceText(r: { ammo: number; combo: number; charge: number; mana: number; energy: number },
  school: string): string {
  if (school === 'gun') return `弹 ${r.ammo}`;
  if (school === 'blade') return `连击 ${r.combo}`;
  if (school === 'blunt') return `蓄力 ${r.charge.toFixed(1)}`;
  if (school === 'magic') return `法力 ${Math.round(r.mana)}`;
  return `能量 ${Math.round(r.energy)}`;
}
```

- [ ] **Step 5: 跑测试确认通过并提交**

Run: `npx vitest run src/ui/render.test.ts`
Expected: `3 passed`。

Run: `npm test && npx tsc --noEmit` → 全绿。

```bash
git add -A && git commit -m "feat: add procedural pixel sprites and canvas renderer"
```

---

### Task 15: 输入与 DOM 界面（商店 / 天赋 / 角色 / 结算）

**Files:**
- Create: `src/ui/input.ts`, `src/ui/screens.ts`

- [ ] **Step 1: 实现 `src/ui/input.ts`**

```ts
export interface InputState {
  keys: Set<string>;
  mouse: { x: number; y: number };
  mouseDown: boolean; rightDown: boolean;
  slotRequest: number | null;
  reload: boolean; useConsumable: boolean; refresh: boolean;
}
export function createInput(canvas: HTMLCanvasElement): InputState {
  const s: InputState = { keys: new Set(), mouse: { x: 480, y: 320 },
    mouseDown: false, rightDown: false, slotRequest: null,
    reload: false, useConsumable: false, refresh: false };
  window.addEventListener('keydown', e => {
    s.keys.add(e.key.toLowerCase());
    if ('123'.includes(e.key)) s.slotRequest = Number(e.key) - 1;
    if (e.key.toLowerCase() === 'r') s.reload = true;
    if (e.key.toLowerCase() === 'q') s.useConsumable = true;
    if (e.key.toLowerCase() === 'f') s.refresh = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
  });
  window.addEventListener('keyup', e => s.keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    s.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    s.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
  });
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) s.mouseDown = true;
    if (e.button === 2) s.rightDown = true;
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) s.mouseDown = false;
    if (e.button === 2) s.rightDown = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  return s;
}
export function consumeEdges(s: InputState): void {
  s.slotRequest = null; s.reload = false; s.useConsumable = false; s.refresh = false;
}
```

- [ ] **Step 2: 实现 `src/ui/screens.ts`**

```ts
import { WEAPON_BY_ID } from '../data/weapons';
import { PASSIVE_BY_ID, CONSUMABLE_BY_ID } from '../data/shop';
import { CHARACTERS } from '../data/characters';
import { MAPS } from '../data/maps';
import { TALENTS, CURSES } from '../data/rules.content';
import { UNLOCKS } from '../game/meta';
import type { RunState, SaveData, Loadout } from '../core/types';

export type ScreenAction =
  | { t: 'start'; characterId: string; mapId: string }
  | { t: 'buy'; index: number; replaceSlot?: number }
  | { t: 'refresh' } | { t: 'lock'; index: number } | { t: 'sell'; slot: number }
  | { t: 'beginWave' } | { t: 'talent'; id: string } | { t: 'curse'; id: string | null }
  | { t: 'continue' } | { t: 'unlock'; id: string } | { t: 'restart' };

export interface ScreenCallbacks { onAction(a: ScreenAction): void }
const esc = (s: string) => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Screens {
  constructor(private root: HTMLElement, private cb: ScreenCallbacks) {}
  private html(inner: string): void {
    this.root.innerHTML = `<div style="position:absolute;inset:0;background:#0d0f14ee;overflow:auto;padding:24px 32px">${inner}</div>`;
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach(el => {
      el.onclick = () => this.cb.onAction(JSON.parse(el.dataset.act!) as ScreenAction);
    });
  }
  clear(): void { this.root.innerHTML = ''; }
  private btn(act: ScreenAction, label: string, disabled = false): string {
    return `<button data-act='${esc(JSON.stringify(act))}' ${disabled ? 'disabled' : ''}
      style="background:#2b3a55;color:#e8e6df;border:1px solid #4a6080;padding:6px 12px;margin:3px;cursor:pointer;font:inherit">${esc(label)}</button>`;
  }
  title(save: SaveData): void {
    this.html(`<h1 style="color:#ffe066">僵尸竞技场</h1>
      <p>最高波次 ${save.bestWave} · 点数 ${save.points} · 总击杀 ${save.totalKills}</p>
      ${this.btn({ t: 'continue' }, '开始新的一局')}
      <h3>局外解锁</h3>
      ${UNLOCKS.map(u => `${esc(u.name)} (${u.cost} 点) ${this.btn({ t: 'unlock', id: u.id }, '解锁', save.points < u.cost)}`).join('<br>')}`);
  }
  characterSelect(save: SaveData): void {
    this.html(`<h2>选择角色 / 地图</h2>
      ${CHARACTERS.map(c => `${this.btn({ t: 'start', characterId: c.id, mapId: 'yard' }, `${c.name} — ${c.desc}`,
        !save.unlockedCharacters.includes(c.id))}`).join('<br>')}
      <p style="color:#889">地图在局外解锁后可在标题页切换；当前默认：废弃货场。共 ${MAPS.length} 张。</p>`);
  }
  shop(run: RunState, loadout: Loadout, options?: { needReplace?: number }): void {
    const need = options?.needReplace;
    const items = run.shop.items.map((it, i) => {
      const name = it.kind === 'weapon' ? WEAPON_BY_ID[it.id]?.name
        : it.kind === 'passive' ? PASSIVE_BY_ID[it.id]?.name : CONSUMABLE_BY_ID[it.id]?.name;
      const school = it.kind === 'weapon' ? ` [${WEAPON_BY_ID[it.id]?.school}]` : '';
      return `<div style="border:1px solid #33405a;padding:8px;margin:6px 0;max-width:620px">
        <b>${esc(name ?? it.id)}</b>${esc(school)} — ${it.price} 金 ${it.locked ? '🔒' : ''}
        ${this.btn({ t: 'buy', index: i }, '购买')}
        ${this.btn({ t: 'lock', index: i }, it.locked ? '解锁' : '锁定')}</div>`;
    }).join('');
    const slots = run.slots.map((s, i) => s
      ? `${i + 1}. ${WEAPON_BY_ID[s.weaponId].name} ★${s.star} ${this.btn({ t: 'sell', slot: i }, '售出')}`
      : `${i + 1}. (空)`).join('<br>');
    const replace = need === undefined ? '' :
      `<p style="color:#ff9a3c">装备栏已满，选择要替换的格子：${[0,1,2].map(i =>
        this.btn({ t: 'buy', index: need, replaceSlot: i }, `替换 ${i + 1}`)).join('')}</p>`;
    this.html(`<h2>商店 · 第 ${run.wave} 波前</h2>
      <p>金币 <b style="color:#ffe066">${run.gold}</b> · 下波预告 <b>${esc(run.nextWavePreview.join(' / '))}</b>
      · 利息上限 ${loadout.stats.interestCap}</p>
      <div style="display:flex;gap:40px"><div><h3>装备栏</h3>${slots}
      <h3>被动 (${run.passives.length}/3)</h3>${run.passives.map(p => esc(PASSIVE_BY_ID[p]?.name ?? p)).join(' / ') || '—'}
      <h3>消耗品</h3>${Object.entries(run.consumables).map(([k,v]) => `${esc(CONSUMABLE_BY_ID[k]?.name ?? k)} x${v}`).join(' / ') || '—'}
      <h3>套装 / 组合技</h3><span style="color:#8fdcff">${esc(loadout.setBonuses.map(b => `${b.school}×${b.count}`).join(' ') || '无')}
      | ${esc(loadout.combos.join(' ') || '无')}</span></div>
      <div><h3>货架 ${this.btn({ t: 'refresh' }, `刷新 (${run.shop.freeRefresh ? '免费' : '2 金'})`)}</h3>${items}${replace}</div></div>
      <p>${this.btn({ t: 'beginWave' }, '开始战斗 →')}</p>`);
  }
  waveEnd(run: RunState, talentIds: string[], curseIds: string[],
    pickedTalent: boolean, pickedCurse: boolean): void {
    const talents = talentIds.map(id => {
      const t = TALENTS.find(x => x.id === id)!;
      return `${this.btn({ t: 'talent', id }, `${t.name} — ${t.desc}`, pickedTalent)}`;
    }).join('');
    const curses = curseIds.map(id => {
      const c = CURSES.find(x => x.id === id)!;
      return `${this.btn({ t: 'curse', id }, `${c.name} (+${c.gold} 金) — ${c.desc}`, pickedCurse)}`;
    }).join('');
    this.html(`<h2>第 ${run.wave} 波结束 · 金币 ${run.gold}</h2>
      <h3>天赋三选一</h3>${talents}
      <h3>诅咒契约（可选，换金币 / 稀有装备）</h3>${curses}
      ${this.btn({ t: 'curse', id: null }, '拒绝契约', pickedCurse)}
      <p>${this.btn({ t: 'continue' }, '进入商店 →', !pickedTalent)}</p>`);
  }
  gameOver(run: RunState, save: SaveData): void {
    this.html(`<h1 style="color:#ff7a6a">你倒下了</h1>
      <p>到达波次 <b>${run.wave}</b> · 击杀 ${run.kills} · Boss ${run.bossKills} · 种子 ${run.seed}</p>
      <p>累计点数 ${save.points}（本局 +${run.wave * 2 + Math.floor(run.kills / 10) + run.bossKills * 5}）</p>
      ${this.btn({ t: 'restart' }, '返回标题')}`);
  }
}
```

- [ ] **Step 3: 验证类型与构建**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: add keyboard/mouse input and DOM shop/talent/character screens"
```

---

### Task 16: 主循环、阶段状态机、系统集成与验收

**Files:**
- Create: `src/main.ts`（覆盖 Task 1 的占位版本）, `src/main.test.ts`（追加集成用例）

- [ ] **Step 1: 追加集成测试**

在 `src/main.test.ts` 末尾追加：

```ts
import { createRunState, resolveLoadout } from './game/state';
import { rollShop, buyItem, settleWaveEnd } from './game/economy';
import { composeWave, previewFor, WEATHER_FOR_WAVE } from './game/wave';
import { settleRun, defaultSave } from './game/meta';
import { World, dealDamage } from './game/combat';
import { EventBus } from './engine/events';
import { Arena } from './game/arena';
import { newDamageOp } from './core/types';

describe('one full run loop', () => {
  it('shop -> wave -> combat -> settlement -> meta is coherent', () => {
    const run = createRunState(2026, 'veteran', 'yard');
    const bus = new EventBus();
    const world = new World(run, bus);
    const arena = new Arena('yard');
    run.nextWavePreview = previewFor(run.wave, run.rng);
    run.weather = WEATHER_FOR_WAVE(run.wave, run.rng);
    arena.setWeather(run.weather);
    const shop = rollShop(run);
    expect(shop.length).toBeGreaterThanOrEqual(4);
    world.setRules(resolveLoadout(run).rules);
    const plan = composeWave(run.wave, run.rng);
    expect(plan.groups.length).toBeGreaterThan(0);
    // 买一件，验证构筑重算
    const weaponIndex = shop.findIndex(i => i.kind === 'weapon');
    if (weaponIndex >= 0) buyItem(run, weaponIndex);
    world.setRules(resolveLoadout(run).rules);
    // 造一只僵尸并打死
    const z = { id: 2, kind: 'walker', x: 200, y: 200, radius: 12, hp: 10, maxHp: 10,
      speed: 40, facing: 0, tags: [] as string[], statuses: [], dead: false, ttl: 0,
      data: {} as Record<string, number> };
    world.entities.push(z);
    dealDamage(world, z, newDamageOp(50, 'blade', 2, ['melee']));
    expect(run.kills).toBe(1);
    const s = settleWaveEnd(run, run.wave, 0);
    expect(run.gold).toBeGreaterThan(0);
    expect(s.interest).toBeGreaterThanOrEqual(0);
    run.wave += 1;
    const save = settleRun(run, defaultSave());
    expect(save.points).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npm test`
Expected: 集成用例 PASS，其余全部 PASS。

- [ ] **Step 3: 用完整实现覆盖 `src/main.ts`**

```ts
import { RNG } from './engine/rng';
import { EventBus } from './engine/events';
import { createRunState, resolveLoadout, makeCtx } from './game/state';
import { World, dealDamage, tickStatuses } from './game/combat';
import { Arena } from './game/arena';
import { rollShop, refreshShop, toggleLock, buyItem, sellSlot, settleWaveEnd } from './game/economy';
import { composeWave, previewFor, WEATHER_FOR_WAVE, isBossWave } from './game/wave';
import { loadSave, saveGame, settleRun, buyUnlock } from './game/meta';
import { WEAPON_BY_ID } from './data/weapons';
import { ZOMBIE_BY_ID } from './data/zombies';
import { TALENTS, CURSES } from './data/rules.content';
import { createInput, consumeEdges, type InputState } from './ui/input';
import { renderFrame } from './ui/render';
import { Screens, type ScreenAction } from './ui/screens';
import { tickResources, canFire, consumeFire, startReload, startCharge,
  releaseCharge, placeDeployable, onPlayerHit, magSize } from './engine/abilities';
import { newDamageOp, type Entity, type RunState, type Phase, type Loadout } from './core/types';
import { GAME_W, GAME_H } from './core/constants';

export { GAME_W, GAME_H } from './core/constants';
export function boot(): boolean {
  const canvas = document.getElementById('game');
  return canvas instanceof HTMLCanvasElement;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;
const overlay = document.getElementById('overlay')!;
const input = createInput(canvas);
const bus = new EventBus();

let save = loadSave();
let run: RunState = createRunState(Date.now() & 0xffffff, 'veteran', 'yard');
let world = new World(run, bus);
let arena = new Arena('yard');
let loadout: Loadout = resolveLoadout(run);
let phase: Phase = 'title';
let paused = false;
let talentChoices: string[] = [];
let curseChoices: string[] = [];
let pickedTalent = false, pickedCurse = false;
let needReplace: number | undefined;
let spawnQueue: string[] = [];
let spawnTimer = 0;
let waveGold = 0;
let playerShield = 0;

const screens = new Screens(overlay, { onAction: handleAction });

function handleAction(a: ScreenAction): void {
  switch (a.t) {
    case 'continue':
      if (phase === 'title') { phase = 'character'; screens.characterSelect(save); }
      else if (phase === 'waveEnd') { enterShop(); }
      break;
    case 'unlock': { save = buyUnlock(save, a.id); saveGame(save); screens.title(save); break; }
    case 'start': startRun(a.characterId, a.mapId); break;
    case 'buy': {
      const r = buyItem(run, a.index, a.replaceSlot);
      needReplace = r === 'needReplace' ? a.index : undefined;
      refreshLoadout(); screens.shop(run, loadout, { needReplace });
      break;
    }
    case 'refresh': refreshShop(run); screens.shop(run, loadout); break;
    case 'lock': toggleLock(run, a.index); screens.shop(run, loadout); break;
    case 'sell': sellSlot(run, a.slot); refreshLoadout(); screens.shop(run, loadout); break;
    case 'beginWave': startWave(); break;
    case 'talent':
      if (!pickedTalent) { run.talents.push(a.id); pickedTalent = true; refreshLoadout(); }
      screens.waveEnd(run, talentChoices, curseChoices, pickedTalent, pickedCurse);
      break;
    case 'curse':
      if (!pickedCurse) { if (a.id) { run.curses.push(a.id); const c = CURSES.find(x => x.id === a.id); run.gold += c?.gold ?? 0; } pickedCurse = true; refreshLoadout(); }
      screens.waveEnd(run, talentChoices, curseChoices, pickedTalent, pickedCurse);
      break;
    case 'restart': save = loadSave(); phase = 'title'; screens.title(save); break;
  }
}

function refreshLoadout(): void {
  loadout = resolveLoadout(run);
  world.setRules(loadout.rules);
}
function startRun(characterId: string, mapId: string): void {
  bus.clear();
  run = createRunState(Date.now() & 0xffffff, characterId, mapId);
  run.rng = new RNG(run.seed);
  world = new World(run, bus);
  arena = new Arena(mapId);
  refreshLoadout();
  run.hp = loadout.stats.maxHp;
  enterShop();
}
function enterShop(): void {
  phase = 'shop';
  run.nextWavePreview = previewFor(run.wave, run.rng);
  run.weather = WEATHER_FOR_WAVE(run.wave, run.rng);
  arena.setWeather(run.weather);
  rollShop(run);
  screens.shop(run, loadout);
}
function startWave(): void {
  phase = 'combat';
  screens.clear();
  refreshLoadout();
  const plan = composeWave(run.wave, run.rng);
  spawnQueue = [];
  for (const g of plan.groups) for (let i = 0; i < g.count; i++) spawnQueue.push(g.id);
  if (plan.boss) spawnQueue.push(plan.boss);
  spawnQueue = run.rng.shuffle(spawnQueue);
  spawnTimer = 0; waveGold = 0;
  world.entities = world.entities.filter(e => e.id === 1);
  ensurePlayer();
  bus.emit('onWaveStart', { ctx: makeCtx(run, loadout.stats), wave: run.wave });
}
function ensurePlayer(): void {
  if (world.entities.some(e => e.id === 1)) return;
  const p: Entity = { id: 1, kind: 'player', x: GAME_W / 2, y: GAME_H / 2, radius: 12,
    hp: run.hp, maxHp: loadout.stats.maxHp, speed: loadout.stats.moveSpeed, facing: 0,
    tags: ['player'], statuses: [], dead: false, ttl: 0, data: {} };
  world.entities.push(p);
}

function endWave(): void {
  bus.emit('onWaveEnd', { ctx: makeCtx(run, loadout.stats), wave: run.wave });
  settleWaveEnd(run, run.wave, waveGold);
  refreshLoadout();
  run.hp = Math.min(loadout.stats.maxHp, run.hp);
  talentChoices = run.rng.shuffle(TALENTS.map(t => t.id)).slice(0, 3);
  curseChoices = run.rng.shuffle(CURSES.map(c => c.id)).slice(0, 2);
  pickedTalent = false; pickedCurse = false;
  phase = 'waveEnd';
  screens.waveEnd(run, talentChoices, curseChoices, pickedTalent, pickedCurse);
}
function gameOver(): void {
  save = settleRun(run, save);
  saveGame(save);
  phase = 'gameOver';
  screens.gameOver(run, save);
}

function spawnZombie(id: string): void {
  const def = ZOMBIE_BY_ID[id];
  if (!def) return;
  const edge = run.rng.int(0, 3);
  const x = edge === 0 ? 20 : edge === 1 ? GAME_W - 20 : run.rng.int(40, GAME_W - 40);
  const y = edge === 2 ? 20 : edge === 3 ? GAME_H - 20 : run.rng.int(40, GAME_H - 40);
  const scale = 1 + (run.wave - 1) * 0.14;
  world.entities.push({ id: world.newId() + 1, kind: id, x, y, radius: def.radius,
    hp: def.hp * scale * (def.elite ? 1.6 : 1), maxHp: def.hp * scale * (def.elite ? 1.6 : 1),
    speed: def.speed * loadout.stats.zombieSpeedMult, facing: 0,
    tags: def.tags.slice(), statuses: [], dead: false, ttl: 0, data: { attack: 0 } });
}

function updateCombat(dt: number): void {
  const p = world.entities.find(e => e.id === 1);
  if (!p) { ensurePlayer(); return; }
  // 移动
  let dx = 0, dy = 0;
  if (input.keys.has('w') || input.keys.has('arrowup')) dy -= 1;
  if (input.keys.has('s') || input.keys.has('arrowdown')) dy += 1;
  if (input.keys.has('a') || input.keys.has('arrowleft')) dx -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) dx += 1;
  const len = Math.hypot(dx, dy) || 1;
  const sniperSlow = run.slots[run.activeSlot]?.weaponId === 'sniper' && input.mouseDown ? 0.55 : 1;
  p.x = Math.max(16, Math.min(GAME_W - 16, p.x + dx / len * loadout.stats.moveSpeed * sniperSlow * dt));
  p.y = Math.max(16, Math.min(GAME_H - 16, p.y + dy / len * loadout.stats.moveSpeed * sniperSlow * dt));
  p.facing = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x);
  run.hp = p.hp;
  if (run.hp <= 0) { gameOver(); return; }

  // 切换武器
  if (input.slotRequest !== null) { run.activeSlot = input.slotRequest; refreshLoadout(); }
  const slot = run.slots[run.activeSlot];
  if (slot) {
    const def = WEAPON_BY_ID[slot.weaponId];
    tickResources(slot, dt, loadout.stats, bus, run);
    if (input.reload) startReload(slot, def, loadout.stats);
    if (slot.res.reloading > 0 && def.magSize > 0) slot.res.reloading = Math.max(0, slot.res.reloading - dt);
    if (slot.res.ammo <= 0 && def.school === 'gun' && slot.res.reloading <= 0) startReload(slot, def, loadout.stats);
    slot.res.ammo = Math.min(slot.res.ammo, magSize(def, loadout.stats));
    fireInput(slot, def, p, dt);
  }
  if (input.useConsumable) useConsumable(p);

  // 波次生成
  spawnTimer -= dt;
  if (spawnQueue.length > 0 && spawnTimer <= 0) { spawnZombie(spawnQueue.shift()!); spawnTimer = 0.45; }

  // 僵尸 AI
  for (const e of world.entities) {
    if (e.dead || e.id === 1) continue;
    tickStatuses(world, e, dt);
    const cc = e.data['cc'] ?? 0;
    if (cc > 0) continue;
    const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
    const behaviour = ZOMBIE_BY_ID[e.kind]?.behaviour ?? 'chase';
    let wantX = p.x, wantY = p.y;
    if (behaviour === 'spitter' && d < 220) { wantX = e.x; wantY = e.y; }
    const mvx = (wantX - e.x) / (Math.hypot(wantX - e.x, wantY - e.y) || 1);
    const mvy = (wantY - e.y) / (Math.hypot(wantX - e.x, wantY - e.y) || 1);
    if (d > e.radius + p.radius) { e.x += mvx * e.speed * dt; e.y += mvy * e.speed * dt; }
    e.facing = Math.atan2(p.y - e.y, p.x - e.x);
    e.data['attack'] = (e.data['attack'] ?? 0) - dt;
    if (d < e.radius + p.radius + 4 && (e.data['attack'] ?? 0) <= 0) {
      const dmg = 8 * loadout.stats.playerDamageTakenMult;
      if (playerShield <= 0) { p.hp -= dmg; run.hp = p.hp; }
      e.data['attack'] = 0.8;
      const s = run.slots[run.activeSlot];
      if (s) onPlayerHit(s, loadout.stats.comboKeepOnHit);
      world.float(p.x, p.y - 16, `-${Math.round(dmg)}`);
    }
    if (behaviour === 'spitter' && (e.data['attack'] ?? 0) <= 0 && d < 320) {
      e.data['attack'] = 2.2;
      world.float(e.x, e.y - 12, '酸');
      if (playerShield <= 0) { p.hp -= 4; run.hp = p.hp; }
    }
    if (e.tags.includes('summons') && (e.data['summon'] ?? 0) <= 0) {
      e.data['summon'] = 4; spawnQueue.push('walker', 'walker');
    }
  }
  // 炮塔 / 无人机自动索敌
  for (const e of world.entities) {
    if (!e.tags.includes('deployable')) continue;
    const target = world.entities.find(t => t.id !== 1 && !t.dead && !t.tags.includes('deployable')
      && Math.hypot(t.x - e.x, t.y - e.y) < 300);
    e.data['attack'] = (e.data['attack'] ?? 0) - dt;
    if (target && (e.data['attack'] ?? 0) <= 0) {
      e.data['attack'] = 0.5;
      const op = newDamageOp(loadout.stats.turretSpell ? 16 : 10,
        loadout.stats.turretSpell ? 'magic' : 'tech', target.id,
        loadout.stats.turretSpell ? ['spell'] : ['turret']);
      dealDamage(world, target, op);
    }
  }
  // 掉金
  for (const e of world.entities) {
    if (e.dead && !e.data['counted']) {
      e.data['counted'] = 1;
      waveGold += ZOMBIE_BY_ID[e.kind]?.gold ?? 1;
    }
  }
  world.sweepDead();
  for (const f of world.floating) f.time -= dt;
  world.floating = world.floating.filter(f => f.time > 0);
  arena.tick(dt);
  playerShield = Math.max(0, playerShield - dt);
  if (spawnQueue.length === 0 && !world.entities.some(e => e.id !== 1 && !e.dead)) endWave();
}

function fireInput(slot: NonNullable<RunState['slots'][number]>,
  def: (typeof WEAPON_BY_ID)[string], p: Entity, dt: number): void {
  const res = slot.res;
  if (def.school === 'blunt') {
    if (input.mouseDown) { startCharge(slot, dt, loadout.stats); return; }
    if (res.charge > 0) {
      const power = releaseCharge(slot, loadout.stats);
      bus.emit('onHeavy', { ctx: makeCtx(run, loadout.stats) });
      swing(p, def, power, true);
    } else if (input.mouseDown) return;
    return;
  }
  if (def.school === 'tech') {
    if (input.rightDown && res.cooldown <= 0) {
      const count = world.entities.filter(e => e.tags.includes('deployable')).length;
      if (placeDeployable(slot, def, loadout.stats, count)) {
        world.entities.push({ id: world.newId() + 1, kind: def.sprite, x: input.mouse.x, y: input.mouse.y,
          radius: 10, hp: 40, maxHp: 40, speed: 0, facing: 0, tags: ['deployable'],
          statuses: [], dead: false, ttl: 0, data: { attack: 0 } });
        bus.emit('onPlace', { ctx: makeCtx(run, loadout.stats) });
      }
    }
    return;
  }
  if (!input.mouseDown || !canFire(slot, def, loadout.stats)) return;
  consumeFire(slot, def, run, loadout.stats);
  if (def.school === 'magic') bus.emit('onCast', { ctx: makeCtx(run, loadout.stats) });
  if (def.school === 'gun' && loadout.stats.enchantedBullets) {
    // 附魔子弹：带上当前元素
  }
  if (def.school === 'blade') swing(p, def, 1 + Math.min(res.combo, loadout.stats.comboCap) * 0.12, false);
  else shoot(p, def);
}

function swing(p: Entity, def: (typeof WEAPON_BY_ID)[string], power: number, heavy: boolean): void {
  const range = def.range + loadout.stats.meleeRangeAdd;
  for (const e of world.entities) {
    if (e.id === 1 || e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > range + e.radius) continue;
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    if (!heavy && Math.abs(Math.atan2(Math.sin(a - p.facing), Math.cos(a - p.facing))) > 0.9) continue;
    const op = newDamageOp(def.baseDamage * power, def.school, e.id,
      heavy ? ['heavy', 'melee', 'breakArmor'] : ['melee']);
    if (heavy && loadout.stats.arcOnHeavy) op.tags.push('arc');
    const dmg = dealDamage(world, e, op);
    if (dmg > 0 && heavy) {
      const kb = 90 * loadout.stats.knockbackMult;
      e.x += Math.cos(a) * kb * 0.3; e.y += Math.sin(a) * kb * 0.3;
      world.addStatus(e, 'stun', 1);
    }
  }
}
function shoot(p: Entity, def: (typeof WEAPON_BY_ID)[string]): void {
  const angle = p.facing;
  const pellets = def.id === 'shotgun' ? 5 : 1;
  for (let i = 0; i < pellets; i++) {
    const a = angle + (pellets > 1 ? (i - 2) * 0.11 : 0);
    let best: Entity | null = null, bestD = def.range;
    for (const e of world.entities) {
      if (e.id === 1 || e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const ea = Math.atan2(e.y - p.y, e.x - p.x);
      if (d < bestD && Math.abs(Math.atan2(Math.sin(ea - a), Math.cos(ea - a))) < 0.16) { best = e; bestD = d; }
    }
    if (!best) continue;
    const tags: ('bullet' | 'spell' | 'elemental')[] = def.school === 'gun' ? ['bullet'] : ['spell'];
    if (loadout.stats.enchantedBullets) tags.push('elemental');
    const op = newDamageOp(def.baseDamage, def.school, best.id, tags);
    if (def.element) op.element = def.element;
    if (def.school === 'magic' || loadout.stats.turretSpell) bus.emit('onCast', { ctx: makeCtx(run, loadout.stats) });
    dealDamage(world, best, op);
    world.float(best.x, best.y - 10, '·');
  }
}
function useConsumable(p: Entity): void {
  const id = Object.keys(run.consumables).find(k => run.consumables[k] > 0);
  if (!id) return;
  run.consumables[id] -= 1;
  if (id === 'medkit') { p.hp = Math.min(loadout.stats.maxHp, p.hp + 35); run.hp = p.hp; }
  if (id === 'grenade') {
    for (const e of world.entities) {
      if (e.id === 1 || e.dead) continue;
      if (Math.hypot(e.x - input.mouse.x, e.y - input.mouse.y) < 110)
        dealDamage(world, e, newDamageOp(60, 'tech', e.id, ['explosion']));
    }
  }
  if (id === 'shieldkit') playerShield = 3;
}

window.addEventListener('blur', () => { paused = true; });
window.addEventListener('focus', () => { paused = false; last = performance.now(); });

screens.title(save);
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused && phase === 'combat') updateCombat(dt);
  renderFrame(ctx, { run, world, arena, stats: loadout.stats, mouse: input.mouse,
    phase, dt, loadout });
  consumeEdges(input);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

- [ ] **Step 4: 全量验证**

`GAME_W`/`GAME_H` 从 Task 1 起就定义在 `src/core/constants.ts`，`main.ts` 只做 re-export，`render.ts` 与 `main.test.ts` 都直接引用 `core/constants.ts` —— 因此 node 测试环境导入这些模块时不会触碰 `document`。此处只需确认全链路无误：

Run: `npm test`
Expected: 全部 PASS（集成用例 + 之前所有用例）。

Run: `npx tsc --noEmit && npm run build`
Expected: 类型检查通过，`dist/` 产出成功。

- [ ] **Step 5: 浏览器手动验收与提交**

Run: `npm run dev`
在浏览器打开提示的本地地址，逐项确认：
1. 标题页显示点数/最高波次，解锁按钮可用；
2. 选角色 → 商店有 4~5 件、预告有内容、刷新/锁定/购买/售出/合成升星都生效；
3. 「开始战斗」后 WASD 移动、鼠标瞄准、左键攻击、`1/2/3` 切换、`R` 换弹、棍棒按住蓄力、科技右键放置、`Q` 消耗品；
4. 3 件同流派出现套装、混搭出现组合技提示（HUD 底部）；
5. 每 5 波 Boss、天气事件（夜晚遮罩/毒雾缩圈/雨天电系加成）可见；
6. 波次结束天赋三选一 / 诅咒契约 → 回商店；
7. 死亡结算点数，返回标题后存档生效。

```bash
git add -A && git commit -m "feat: wire main loop, phase state machine and full run integration"
```

---

## 自查（Spec Coverage / Placeholders / Type Consistency）

**Spec 覆盖**
- §2 架构与数据流 → Task 1/2/3/4（types、RNG、EventBus、effects、RuleEngine）、Task 16（阶段状态机、dt 钳制、失焦暂停）
- §2.2 规则引擎 + 10 原语 → Task 4 + Task 13（`ABILITY_IDS` 恰 10 个）
- §2.3 resolveLoadout 扁平表 + DamageOp 管线 → Task 7 + Task 11
- §3.1 15 件武器 / 5 流派手感 / 每格独立资源 → Task 5 + Task 13
- §3.2 套装 / 5 组合技 / 合成升星 → Task 6 + Task 8
- §3.3 被动 3 格 / 消耗品 → Task 5 + Task 8
- §3.4 优先级与确定性 → Task 3/4/7
- §4.1 商店（4~5 件/刷新/锁定/售出/预告）→ Task 8 + Task 15
- §4.2 经济（掉金/波次奖励/利息/契约）→ Task 8 + Task 6
- §4.3 7 僵尸 + 2 Boss + 精英 + 克制规则 → Task 5 + Task 11
- §4.4 小地图/互动物件/4 种天气/3 张地图 → Task 12 + Task 5
- §4.5 天赋 14+ / 诅咒 4 / 5 角色 → Task 6 + Task 15
- §4.6 局外点数 / 版本存档 → Task 10 + Task 15
- §5 错误处理与测试 → 各任务 TDD + Task 10 存档重置 + Task 16 dt/失焦 + Task 14 渲染 smoke test
- §6 实现顺序 → Task 1→16 一一对应

**Placeholder 扫描**：无 TBD/TODO/"稍后实现"/"类似 Task N"。所有代码步骤含完整代码块，测试含真实断言与预期输出。

**类型一致性**：`Rule` / `Effect` / `Predicate` / `Ctx` / `PlayerStats` / `RunState` / `Entity` / `DamageOp` 全部在 Task 2 的 `src/core/types.ts` 一次性定义，后续任务只引用；`STAGE_ORDER`、`newDamageOp`、`finalDamage`、`defaultStats`、`newSlotResource` 全程同名；`resolveLoadout(run)` / `makeCtx(run, stats, over)` / `World.setRules(rules)` / `dealDamage(world, target, op, frontFacing?)` / `settleWaveEnd(run, wave, killGold)` / `composeWave(wave, rng)` / `WEATHER_FOR_WAVE(wave, rng)` 签名在各任务中一致。`GAME_W`/`GAME_H` 从 Task 1 起统一定义在 `src/core/constants.ts`，`main.ts` 仅 re-export，`main.test.ts` 与 `render.ts` 均直接引用 `core/constants.ts`（避免 node 测试环境触发 `document`）。

**已知实现注意事项（非占位）**：
- `onHit` 规则由 `dealDamage()` 独占派发，通过 `engine.dispatchFor('onHit', ctx, zombieRules)` 把目标僵尸特性规则注入同一次排序求值；`RuleEngine` 的事件订阅列表刻意不含 `onHit`，`World.setRules()` 也不合并 `extraRules`，保证每条 `onHit` 规则只生效一次。
- `MAGIC_NTH_RULE` 挂在 `onHit`（不是 `onCast`）：`onCast` 发生在生成 `DamageOp` 之前，乘区会落空；3 件魔法的「第 5 次免费 + 翻倍」由 `canFire()`（免费判定用 `stats.nthCastFree`）与 `onHit` 乘区共同实现。
