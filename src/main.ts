import { EventBus } from './engine/events';
import { createRunState, resolveLoadout, makeCtx } from './game/state';
import { World, dealDamage, tickStatuses } from './game/combat';
import { Arena, damageObject, repairBarriers, trapBonusAt, fireSpread,
  type ArenaObject } from './game/arena';
import { rollShop, refreshShop, toggleLock, buyItem, sellSlot, settleWaveEnd } from './game/economy';
import { composeWave, previewFor, WEATHER_FOR_WAVE } from './game/wave';
import { loadSave, saveGame, settleRun, buyUnlock } from './game/meta';
import { WEAPONS, WEAPON_BY_ID } from './data/weapons';
import { ZOMBIE_BY_ID } from './data/zombies';
import { TALENTS, CURSES } from './data/rules.content';
import { createInput, consumeEdges } from './ui/input';
import { renderFrame } from './ui/render';
import { preloadRasterSheets } from './ui/raster';
import { spawnBullet, advanceBullets, type Bullet, type BulletHit } from './game/bullets';
import { spawnImpact, tickImpacts, type Impact } from './ui/bullets';
import {
  createVfx, resetVfx, tickVfx, addShake, triggerHurtFlash,
  spawnBurst, spawnMuzzleFlash, spawnShockwave, spawnDecal,
} from './ui/vfx';
import { Screens, type ScreenAction } from './ui/screens';
import { tickResources, canFire, consumeFire, startReload, startCharge,
  releaseCharge, placeDeployable, onPlayerHit, magSize } from './engine/abilities';
import { newDamageOp, newSlotResource,
  type Entity, type RunState, type Phase, type Loadout } from './core/types';
import { GAME_W, GAME_H } from './core/constants';

export { GAME_W, GAME_H } from './core/constants';
export function boot(): boolean {
  return document.getElementById('game') instanceof HTMLCanvasElement;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = true;
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
let selectedMapId = save.unlockedMaps[0] ?? 'yard';
let clearedWave = 1;
let talentChoices: string[] = [];
let curseChoices: string[] = [];
let pickedTalent = false, pickedCurse = false;
let pendingForcedBoss = false; // 「提前降临」只影响紧接着的下一波
let needReplace: number | undefined;
let spawnQueue: string[] = [];
let spawnTimer = 0;
let playerShield = 0;
/** 飞行中的子弹：纯视觉层，伤害已在命中瞬间结算 */
let bullets: Bullet[] = [];
/** 命中爆裂特效（纯视觉） */
let impacts: Impact[] = [];
/** 粒子 / 震屏 / 地面残痕等全局视觉状态 */
const vfx = createVfx();
let last = performance.now();

// 回血必须落到玩家实体上：否则 run.hp 与 world.entities[0].hp 脱钩，
// 吸血刃 / 嗜血的治疗会被下一帧的 run.hp = p.hp 覆盖掉。
function setupWorld(): void {
  world.sink.heal = (v: number) => {
    const p = world.entities.find(e => e.id === 1);
    if (!p) return;
    p.hp = Math.min(loadout.stats.maxHp, p.hp + v);
    run.hp = p.hp;
  };
}
setupWorld();

const screens = new Screens(overlay, { onAction: handleAction });

function handleAction(a: ScreenAction): void {
  switch (a.t) {
    case 'continue':
      if (phase === 'title') { phase = 'character'; screens.characterSelect(save, selectedMapId); }
      else if (phase === 'waveEnd') enterShop();
      break;
    case 'unlock': { save = buyUnlock(save, a.id); saveGame(save); screens.title(save); break; }
    case 'selectMap': selectedMapId = a.mapId; screens.characterSelect(save, selectedMapId); break;
    case 'start': startRun(a.characterId, a.mapId); break;
    case 'repair': {
      arena.gold = run.gold;
      repairBarriers(arena);
      run.gold = arena.gold;
      screens.shop(run, loadout);
      break;
    }
    case 'buy': {
      const itemId = run.shop.items[a.index]?.id ?? '';
      const r = buyItem(run, a.index, a.replaceSlot);
      needReplace = r === 'needReplace' ? a.index : undefined;
      refreshLoadout();
      bus.emit('onPurchase', { ctx: makeCtx(run, loadout.stats), itemId });
      screens.shop(run, loadout, { needReplace });
      break;
    }
    case 'refresh': refreshShop(run); screens.shop(run, loadout); break;
    case 'lock': toggleLock(run, a.index); screens.shop(run, loadout); break;
    case 'sell': sellSlot(run, a.slot); refreshLoadout(); screens.shop(run, loadout); break;
    case 'beginWave': startWave(); break;
    case 'talent':
      if (!pickedTalent) { run.talents.push(a.id); pickedTalent = true; refreshLoadout(); }
      screens.waveEnd(run, talentChoices, curseChoices, clearedWave, pickedTalent, pickedCurse);
      break;
    case 'curse':
      if (!pickedCurse) {
        if (a.id) {
          run.curses.push(a.id);
          const c = CURSES.find(x => x.id === a.id);
          run.gold += c?.gold ?? 0;
          if (a.id === 'early-boss') grantRareEquipment();
        }
        pickedCurse = true; refreshLoadout();
      }
      screens.waveEnd(run, talentChoices, curseChoices, clearedWave, pickedTalent, pickedCurse);
      break;
    case 'restart': save = loadSave(); phase = 'title'; screens.title(save); break;
  }
}

/** 「提前降临」：立即获得一件稀有装备，并把下一波标成 Boss 波。 */
function grantRareEquipment(): void {
  pendingForcedBoss = true;
  const def = run.rng.pick(WEAPONS.filter(w => w.rarity === 3));
  const empty = run.slots.findIndex(s => s === null);
  if (empty >= 0) {
    const res = newSlotResource();
    res.ammo = magSize(def, loadout.stats);
    run.slots[empty] = { weaponId: def.id, star: 1, res };
  } else {
    run.gold += 12; // 装备栏已满时折现
  }
}

function refreshLoadout(): void {
  loadout = resolveLoadout(run);
  world.setRules(loadout.rules);
}
function startRun(characterId: string, mapId: string): void {
  bus.clear();
  run = createRunState(Date.now() & 0xffffff, characterId, mapId);
  // 角色开局奖励按 UI 描述发放（随身武器由 createRunState 统一发放）
  if (characterId === 'veteran') run.gold += 6;
  world = new World(run, bus);
  arena = new Arena(mapId);
  pendingForcedBoss = false;
  needReplace = undefined;
  playerShield = 0;
  bullets = [];
  impacts = [];
  resetVfx(vfx);
  paused = false;
  refreshLoadout();
  setupWorld();
  run.hp = loadout.stats.maxHp;
  enterShop();
}
function enterShop(): void {
  phase = 'shop'; run.phase = 'shop';
  // 预告必须与本波实际刷怪一致；「提前降临」时预告 Boss。
  run.nextWavePreview = previewFor(run.wave, run.rng, pendingForcedBoss);
  run.weather = WEATHER_FOR_WAVE(run.wave, run.rng);
  arena.setWeather(run.weather);
  refreshLoadout(); // 天气规则要进入 loadout
  rollShop(run);
  screens.shop(run, loadout);
}
function startWave(): void {
  phase = 'combat'; run.phase = 'combat';
  screens.clear();
  refreshLoadout();
  resetVfx(vfx);
  const force = pendingForcedBoss;
  pendingForcedBoss = false;
  const plan = composeWave(run.wave, run.rng, force, run.nextWavePreview);
  spawnQueue = [];
  for (const g of plan.groups) for (let i = 0; i < g.count; i++) spawnQueue.push(g.id);
  if (plan.boss) spawnQueue.push(plan.boss);
  spawnQueue = run.rng.shuffle(spawnQueue);
  spawnTimer = 0;
  // 部署物每波重置：否则科技流会在无尽波次里永久累积免费炮塔大军
  world.entities = world.entities.filter(e => e.id === 1);
  const p = ensurePlayer();
  p.maxHp = loadout.stats.maxHp; // 天赋/被动提升 maxHp 后血条与治疗上限要同步
  p.speed = loadout.stats.moveSpeed;
  p.hp = Math.min(loadout.stats.maxHp, Math.max(1, run.hp));
  run.hp = p.hp;
  bus.emit('onWaveStart', { ctx: makeCtx(run, loadout.stats), wave: run.wave });
  consumeSpawns();
}
function ensurePlayer(): Entity {
  let p = world.entities.find(e => e.id === 1);
  if (!p) {
    p = { id: 1, kind: run.characterId, x: GAME_W / 2, y: GAME_H / 2, radius: 12,
      hp: run.hp, maxHp: loadout.stats.maxHp, speed: loadout.stats.moveSpeed, facing: 0,
      tags: ['player'], statuses: [], dead: false, ttl: 0, data: {} };
    world.entities.push(p);
  }
  return p;
}
function endWave(): void {
  clearedWave = run.wave;
  bus.emit('onWaveEnd', { ctx: makeCtx(run, loadout.stats), wave: clearedWave });
  consumeSpawns();
  // 击杀金币已由 dealDamage() 在击杀时即时入账，这里只结算利息 + 波次奖励，
  // 传 0 避免重复发放。
  settleWaveEnd(run, clearedWave, 0);
  refreshLoadout();
  run.hp = Math.min(loadout.stats.maxHp, run.hp);
  run.wave += 1; // 推进波次，否则永远停在第 1 波、永远不出 Boss
  talentChoices = run.rng.shuffle(TALENTS.map(t => t.id)).slice(0, 3);
  curseChoices = run.rng.shuffle(CURSES.map(c => c.id)).slice(0, 2);
  pickedTalent = false; pickedCurse = false;
  phase = 'waveEnd'; run.phase = 'waveEnd';
  screens.waveEnd(run, talentChoices, curseChoices, clearedWave, pickedTalent, pickedCurse);
}
function gameOver(): void {
  save = settleRun(run, save);
  saveGame(save);
  phase = 'gameOver'; run.phase = 'gameOver';
  screens.gameOver(run, save);
}

function spawnZombie(id: string): void {
  const def = ZOMBIE_BY_ID[id];
  if (!def) return;
  const edge = run.rng.int(0, 3);
  const x = edge === 0 ? 20 : edge === 1 ? GAME_W - 20 : run.rng.int(40, GAME_W - 40);
  const y = edge === 2 ? 20 : edge === 3 ? GAME_H - 20 : run.rng.int(40, GAME_H - 40);
  const scale = 1 + (run.wave - 1) * 0.14;
  const hp = def.hp * scale * (def.elite ? 1.6 : 1);
  world.entities.push({ id: world.newId() + 1, kind: id, x, y, radius: def.radius,
    hp, maxHp: hp, speed: def.speed * loadout.stats.zombieSpeedMult,
    facing: Math.atan2(GAME_H / 2 - y, GAME_W / 2 - x),
    tags: def.tags.slice(), statuses: [], dead: false, ttl: 0,
    data: { attack: 0, summon: 0 } });
}

/** 消费声明式规则产生的 spawn 效果（天气、爆炸、连锁电弧、召唤等）。 */
function consumeSpawns(): void {
  if (world.spawned.length === 0) return;
  const batch = world.spawned.splice(0); // 新产生的留到下一帧，避免连锁反应无限递归
  const p = world.entities.find(e => e.id === 1);
  const px = p?.x ?? GAME_W / 2, py = p?.y ?? GAME_H / 2;
  for (const s of batch) {
    const x = s.x ?? px, y = s.y ?? py;
    if (s.what === 'walker') {
      for (let i = 0; i < s.n; i++) spawnQueue.push('walker');
    } else if (s.what === 'firePatch') {
      for (const f of fireSpread(arena)) if (arena.fires.length < 8) arena.fires.push(f);
    } else if (s.what === 'fog') {
      arena.weather = 'fog';
    } else if (s.what === 'explosion' || s.what === 'arc') {
      const isExp = s.what === 'explosion';
      const radius = isExp ? 90 : 150;
      const dmg = isExp ? 40 : 16;
      const tag = isExp ? 'explosion' : 'arc';
      // 爆炸 / 电弧视觉反馈
      spawnShockwave(vfx, x, y, 10, radius, isExp ? '#ff8a3d' : '#7ae3ff', 0.32, isExp ? 4.5 : 3);
      spawnMuzzleFlash(vfx, x, y, isExp ? '#ffb84d' : '#8fdcff', radius * 0.9, 0.16);
      spawnBurst(vfx, x, y, isExp ? '#ff8a3d' : '#ffe066', isExp ? 20 : 12, {
        speedMin: 60, speedMax: 220, sizeMin: 2.5, sizeMax: 5, life: 0.42, glow: true,
      });
      if (isExp) {
        spawnDecal(vfx, x, y, 26, '#0c0a0a', 0.46, 18);
        addShake(vfx, 7.5);
      } else {
        addShake(vfx, 3);
      }
      for (const e of world.entities) {
        if (e.dead || e.tags.includes('deployable')) continue;
        if (Math.hypot(e.x - x, e.y - y) > radius) continue;
        if (e.id === 1) {
          if (s.hostile && playerShield <= 0) {
            e.hp -= dmg * 0.4;
            triggerHurtFlash(vfx, 0.7);
          }
        } else {
          dealDamage(world, e, newDamageOp(dmg, 'tech', e.id, [tag]));
        }
      }
    }
  }
}

function turnToward(cur: number, target: number, maxStep: number): number {
  const d = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
/** 玩家是否处在僵尸的正面弧内（持盾僵尸正面免疫子弹，绕后可破）。 */
function frontOf(e: Entity, p: Entity): boolean {
  const toP = Math.atan2(p.y - e.y, p.x - e.x);
  return Math.abs(Math.atan2(Math.sin(e.facing - toP), Math.cos(e.facing - toP))) < 1.0;
}
function blocked(x: number, y: number): boolean {
  return arena.solidObjects().some(o =>
    x + 11 > o.x && x - 11 < o.x + o.w && y + 11 > o.y && y - 11 < o.y + o.h);
}
function arenaObjects(): ArenaObject[] {
  return [...arena.barriers, ...arena.barrels, ...arena.boxes].filter(o => o.hp > 0);
}
function spawnObjectEffect(o: ArenaObject, res: string): void {
  if (res !== 'explosion' && res !== 'shock') return;
  world.spawned.push({ what: res === 'explosion' ? 'explosion' : 'arc', n: 1,
    x: o.x + o.w / 2, y: o.y + o.h / 2 });
}

function updateCombat(dt: number): void {
  const p = ensurePlayer();
  if (p.hp <= 0) { gameOver(); return; }
  let dx = 0, dy = 0;
  if (input.keys.has('w') || input.keys.has('arrowup')) dy -= 1;
  if (input.keys.has('s') || input.keys.has('arrowdown')) dy += 1;
  if (input.keys.has('a') || input.keys.has('arrowleft')) dx -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) dx += 1;
  const len = Math.hypot(dx, dy) || 1;
  p.data['moving'] = (dx !== 0 || dy !== 0) ? 1 : 0;
  if (dx !== 0 || dy !== 0) p.data['walk'] = (p.data['walk'] ?? 0) + dt;
  const sniperSlow = run.slots[run.activeSlot]?.weaponId === 'sniper' && input.mouseDown ? 0.55 : 1;
  const step = loadout.stats.moveSpeed * sniperSlow * dt;
  const nx = Math.max(16, Math.min(GAME_W - 16, p.x + dx / len * step));
  const ny = Math.max(16, Math.min(GAME_H - 16, p.y + dy / len * step));
  if (!blocked(nx, p.y)) p.x = nx;
  if (!blocked(p.x, ny)) p.y = ny;
  p.facing = Math.atan2(input.mouse.y - p.y, input.mouse.x - p.x);

  if (input.slotRequest !== null) { run.activeSlot = input.slotRequest; refreshLoadout(); }
  const slot = run.slots[run.activeSlot];
  if (slot) {
    const def = WEAPON_BY_ID[slot.weaponId];
    tickResources(slot, dt, loadout.stats, bus, run);
    if (input.reload) startReload(slot, def, loadout.stats);
    if (slot.res.ammo <= 0 && def.school === 'gun' && slot.res.reloading <= 0)
      startReload(slot, def, loadout.stats);
    slot.res.ammo = Math.min(slot.res.ammo, magSize(def, loadout.stats));
    fireInput(slot, def, p, dt);
  }
  if (input.useConsumable) useConsumable(p);

  spawnTimer -= dt;
  if (spawnQueue.length > 0 && spawnTimer <= 0) { spawnZombie(spawnQueue.shift()!); spawnTimer = 0.45; }

  for (const e of world.entities) {
    if (e.dead || e.id === 1 || e.tags.includes('deployable')) continue; // 炮塔不是僵尸
    tickStatuses(world, e, dt);
    if (e.dead || (e.data['cc'] ?? 0) > 0) continue;
    const d = Math.hypot(p.x - e.x, p.y - e.y) || 1;
    const def = ZOMBIE_BY_ID[e.kind];
    const behaviour = def?.behaviour ?? 'chase';
    // 渐变的转向速度让玩家能绕到持盾僵尸背后
    e.facing = turnToward(e.facing, Math.atan2(p.y - e.y, p.x - e.x), dt * 3.2);
    if ((behaviour !== 'spitter' || d >= 220) && d > e.radius + p.radius) {
      e.x += Math.cos(e.facing) * e.speed * dt;
      e.y += Math.sin(e.facing) * e.speed * dt;
      e.data['moving'] = 1;
      e.data['walk'] = (e.data['walk'] ?? 0) + dt;
    } else e.data['moving'] = 0;
    e.data['attack'] = (e.data['attack'] ?? 0) - dt;
    e.data['summon'] = (e.data['summon'] ?? 0) - dt;
    e.data['fireCd'] = (e.data['fireCd'] ?? 0) - dt;
    if (d < e.radius + p.radius + 4 && (e.data['attack'] ?? 0) <= 0) {
      const dmg = (def?.boss ? 16 : 8) * loadout.stats.playerDamageTakenMult;
      if (playerShield <= 0) {
        p.hp -= dmg;
        triggerHurtFlash(vfx, def?.boss ? 0.9 : 0.6);
      }
      e.data['attack'] = 0.8;
      e.data['atkT'] = 0.3; // 前扑动作
      e.data['atkDur'] = 0.3;
      if (slot) onPlayerHit(slot, loadout.stats.comboKeepOnHit);
      world.float(p.x, p.y - 16, `-${Math.round(dmg)}`);
    }
    if (behaviour === 'spitter' && (e.data['attack'] ?? 0) <= 0 && d < 320) {
      e.data['attack'] = 2.2;
      e.data['atkT'] = 0.45; // 鼓喉喷酸动作
      e.data['atkDur'] = 0.45;
      world.float(e.x, e.y - 12, '酸');
      spawnBurst(vfx, p.x, p.y, '#84d86a', 8, { speedMin: 30, speedMax: 110, life: 0.35, glow: true });
      if (playerShield <= 0) {
        p.hp -= 4;
        triggerHurtFlash(vfx, 0.35);
      }
    }
    // 召唤者 / 尸潮之母持续生成小怪，必须优先击杀
    if ((behaviour === 'summoner' || e.tags.includes('summons')) && (e.data['summon'] ?? 0) <= 0) {
      e.data['summon'] = def?.boss ? 5 : 4;
      e.data['atkT'] = 0.6; // 举杖召唤动作
      e.data['atkDur'] = 0.6;
      spawnShockwave(vfx, e.x, e.y, 8, 42, '#b78bfa', 0.4, 2.5);
      spawnQueue.push('walker', 'walker');
    }
  }

  // 炮塔 / 无人机自动索敌（陷阱位提供 1.5 倍伤害）
  for (const e of world.entities) {
    if (!e.tags.includes('deployable') || e.dead) continue;
    const target = world.entities.find(t => t.id !== 1 && !t.dead && !t.tags.includes('deployable')
      && Math.hypot(t.x - e.x, t.y - e.y) < 300);
    e.data['attack'] = (e.data['attack'] ?? 0) - dt;
    if (target && (e.data['attack'] ?? 0) <= 0) {
      e.data['attack'] = 0.5;
      e.data['atkT'] = 0.18; // 炮管后坐动作
      e.data['atkDur'] = 0.18;
      const spell = loadout.stats.turretSpell;
      const angle = Math.atan2(target.y - e.y, target.x - e.x);
      bullets.push(spawnBullet(e, angle, 'turret', {
        base: (spell ? 16 : 10) * (e.data['bonus'] ?? 1),
        school: spell ? 'magic' : 'tech',
        tags: spell ? ['spell', 'turret'] : ['turret'],
        sourceSlot: -1,
        element: spell ? 'lightning' : null,
      }, 320, { homingTarget: target.id, homing: 1 }));
    }
  }

  // 火场与毒雾：地图本身也造成伤害
  for (const f of arena.fires) {
    for (const e of world.entities) {
      if (e.dead || e.tags.includes('deployable')) continue;
      if (Math.hypot(e.x - f.x, e.y - f.y) > 22) continue;
      if (e.id === 1) { if (playerShield <= 0) p.hp -= 8 * dt; }
      else if ((e.data['fireCd'] ?? 0) <= 0) {
        e.data['fireCd'] = 0.4;
        dealDamage(world, e, newDamageOp(9, 'magic', e.id, ['elemental', 'spell']));
      }
    }
  }
  if (arena.weather === 'fog' && Math.hypot(p.x - GAME_W / 2, p.y - GAME_H / 2) > arena.safeRadius
      && playerShield <= 0) p.hp -= 6 * dt;

  consumeSpawns();
  // 为刚死亡的实体生成一次击杀粒子与地面血渍残痕
  for (const d of world.deaths) {
    if (d.t === 0) {
      const def = ZOMBIE_BY_ID[d.kind];
      const isBoss = def?.boss ?? false;
      const color = d.kind === 'spitter' ? '#7fe066'
        : d.kind === 'summoner' ? '#b78bfa' : '#7ea850';
      spawnBurst(vfx, d.x, d.y, color, isBoss ? 24 : 10, {
        speedMin: 40, speedMax: isBoss ? 220 : 135, sizeMin: 2.2, sizeMax: isBoss ? 5.5 : 4, life: 0.45,
      });
      spawnDecal(vfx, d.x, d.y + 8, isBoss ? 24 : 12,
        d.kind === 'spitter' ? '#254a1f' : '#2a361d', 0.42, 16);
      if (isBoss) {
        spawnShockwave(vfx, d.x, d.y, 12, 110, '#ff6b57', 0.45, 4);
        addShake(vfx, 9);
      }
    }
  }
  world.sweepDead();
  world.tickDeaths(dt);
  // 动作计时器（受击闪红 / 攻击动作）逐帧衰减
  for (const e of world.entities) {
    if ((e.data['hitT'] ?? 0) > 0) e.data['hitT'] = Math.max(0, e.data['hitT'] - dt);
    if ((e.data['atkT'] ?? 0) > 0) e.data['atkT'] = Math.max(0, e.data['atkT'] - dt);
  }
  for (const f of world.floating) f.time -= dt;
  world.floating = world.floating.filter(f => f.time > 0);
  const flight = advanceBullets(bullets, dt, world.entities, arenaObjects());
  bullets = flight.alive;
  resolveBulletHits(flight.hits);
  impacts = tickImpacts(impacts, dt);
  tickVfx(vfx, dt, arena.weather);
  arena.tick(dt);
  playerShield = Math.max(0, playerShield - dt);
  run.hp = p.hp;
  if (run.hp <= 0) { gameOver(); return; }
  if (spawnQueue.length === 0
      && !world.entities.some(e => e.id !== 1 && !e.dead && !e.tags.includes('deployable')))
    endWave();
}

function fireInput(slot: NonNullable<RunState['slots'][number]>,
  def: (typeof WEAPON_BY_ID)[string], p: Entity, dt: number): void {
  const res = slot.res;
  if (def.school === 'blunt') {
    if (input.mouseDown) { startCharge(slot, dt, loadout.stats); return; }
    if (res.charge > 0) {
      const power = releaseCharge(slot, loadout.stats);
      bus.emit('onHeavy', { ctx: makeCtx(run, loadout.stats) });
      consumeSpawns();
      swing(p, def, power, true);
    }
    return;
  }
  if (def.school === 'tech') {
    if (input.rightDown && res.cooldown <= 0) {
      const count = world.entities.filter(e => e.tags.includes('deployable') && !e.dead).length;
      if (placeDeployable(slot, def, loadout.stats, count)) {
        const x = input.mouse.x, y = input.mouse.y;
        world.entities.push({ id: world.newId() + 1, kind: def.sprite, x, y,
          radius: 10, hp: 40, maxHp: 40, speed: 0, facing: 0, tags: ['deployable'],
          statuses: [], dead: false, ttl: 0,
          data: { attack: 0, bonus: trapBonusAt(arena, x, y) } });
        spawnShockwave(vfx, x, y, 6, 36, '#4fd1ff', 0.28, 2.5);
        bus.emit('onPlace', { ctx: makeCtx(run, loadout.stats) });
        consumeSpawns();
      }
    }
    return;
  }
  if (!input.mouseDown || !canFire(slot, def, loadout.stats)) return;
  consumeFire(slot, def, run, loadout.stats);
  if (def.school === 'magic') bus.emit('onCast', { ctx: makeCtx(run, loadout.stats) });
  if (def.school === 'blade') swing(p, def, 1 + Math.min(res.combo, loadout.stats.comboCap) * 0.12, false);
  else shoot(p, def);
}

function swing(p: Entity, def: (typeof WEAPON_BY_ID)[string], power: number, heavy: boolean): void {
  p.data['atkT'] = heavy ? 0.32 : 0.18;
  p.data['atkDur'] = heavy ? 0.32 : 0.18;
  const range = def.range + loadout.stats.meleeRangeAdd;
  if (heavy) {
    spawnShockwave(vfx, p.x, p.y, 14, range, '#ff9466', 0.28, 3.5);
    addShake(vfx, 5.5);
  }
  for (const o of arenaObjects()) {
    if (Math.hypot(o.x + o.w / 2 - p.x, o.y + o.h / 2 - p.y) > range + 12) continue;
    const res = damageObject(o, def.baseDamage * power);
    if (res) spawnObjectEffect(o, res);
  }
  for (const e of world.entities) {
    if (e.id === 1 || e.dead || e.tags.includes('deployable')) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > range + e.radius) continue;
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    if (!heavy && Math.abs(Math.atan2(Math.sin(a - p.facing), Math.cos(a - p.facing))) > 0.9) continue;
    const op = newDamageOp(def.baseDamage * power, def.school, e.id,
      heavy ? ['heavy', 'melee', 'breakArmor'] : ['melee'], run.activeSlot);
    if (heavy && loadout.stats.arcOnHeavy) op.tags.push('arc');
    const dmg = dealDamage(world, e, op, frontOf(e, p));
    if (dmg > 0) {
      spawnBurst(vfx, e.x, e.y, heavy ? '#ff9466' : '#ffe9a8', heavy ? 10 : 5, {
        angle: a, spread: 1.1, speedMin: 60, speedMax: 170, life: 0.25, glow: true,
      });
      if (heavy) {
        const kb = 90 * loadout.stats.knockbackMult;
        e.x += Math.cos(a) * kb * 0.3; e.y += Math.sin(a) * kb * 0.3;
        world.addStatus(e, 'stun', 1, 0.35 + Math.min(1, power - 1) * 0.55);
      }
    }
  }
}
function shoot(p: Entity, def: (typeof WEAPON_BY_ID)[string]): void {
  p.data['atkT'] = 0.12;
  p.data['atkDur'] = 0.12;
  const pellets = def.id === 'shotgun' ? 5 : 1;
  const aimTolerance = 0.16 + loadout.stats.bulletHoming * 0.12;
  const tags: ('bullet' | 'spell' | 'elemental')[] = def.school === 'gun' ? ['bullet'] : ['spell'];
  let element = def.element;
  if (def.school === 'gun' && loadout.stats.enchantedBullets) {
    const magic = run.slots.map(s => s ? WEAPON_BY_ID[s.weaponId] : null)
      .find(w => w && w.school === 'magic' && w.element);
    if (magic?.element) element = magic.element;
    if (!tags.includes('elemental')) tags.push('elemental');
  }
  // 枪口光晕 + 轻度后坐震屏
  const mx = p.x + Math.cos(p.facing) * 24;
  const my = p.y + Math.sin(p.facing) * 24;
  const flashCol = def.school === 'gun' ? '#ffd24a'
    : element === 'ice' ? '#8fdcff' : element === 'lightning' ? '#ffe066' : '#ff8a3d';
  spawnMuzzleFlash(vfx, mx, my, flashCol, def.id === 'shotgun' ? 62 : 42, 0.09);
  addShake(vfx, def.id === 'sniper' ? 4.5 : def.id === 'shotgun' ? 3.8 : 1.4);

  for (let i = 0; i < pellets; i++) {
    const a = p.facing + (pellets > 1 ? (i - 2) * 0.11 : 0);
    let homingTarget: number | null = null, bestD = def.range;
    for (const e of world.entities) {
      if (e.id === 1 || e.dead || e.tags.includes('deployable')) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const ea = Math.atan2(e.y - p.y, e.x - p.x);
      if (d < bestD && Math.abs(Math.atan2(Math.sin(ea - a), Math.cos(ea - a))) < aimTolerance) {
        homingTarget = e.id; bestD = d;
      }
    }
    bullets.push(spawnBullet(p, a, def.sprite,
      { base: def.baseDamage, school: def.school, tags, sourceSlot: run.activeSlot, element },
      def.range, { homingTarget, homing: loadout.stats.bulletHoming }));
  }
}

/** 子弹命中结算：这里才构造 DamageOp，规则才会绑定到真正的目标。 */
function resolveBulletHits(hits: BulletHit[]): void {
  for (const h of hits) {
    const b = h.bullet;
    if (h.solid) {
      impacts.push(spawnImpact(b.x, b.y, b.color, b.glow * 1.6));
      spawnBurst(vfx, b.x, b.y, '#ffd24a', 5, { speedMin: 40, speedMax: 130, life: 0.22, glow: true });
      const res = damageObject(h.solid, b.base);
      if (res) spawnObjectEffect(h.solid, res);
      world.float(h.solid.x + h.solid.w / 2, h.solid.y + h.solid.h / 2 - 10, '×');
      continue;
    }
    const e = h.entity;
    if (!e || e.dead) continue;
    impacts.push(spawnImpact(b.x, b.y, b.color, b.glow * 1.6));
    spawnBurst(vfx, b.x, b.y, b.color, 4, {
      angle: Math.atan2(b.dy, b.dx), spread: 1.2, speedMin: 50, speedMax: 150, life: 0.2, glow: true,
    });
    const op = newDamageOp(b.base, b.school, e.id, b.tags, b.sourceSlot);
    if (b.element) op.element = b.element;
    dealDamage(world, e, op, frontOf(e, { x: b.fromX, y: b.fromY } as Entity));
  }
}
function useConsumable(p: Entity): void {
  const id = Object.keys(run.consumables).find(k => run.consumables[k] > 0);
  if (!id) return;
  run.consumables[id] -= 1;
  if (id === 'medkit') {
    p.hp = Math.min(loadout.stats.maxHp, p.hp + 35); run.hp = p.hp;
    spawnBurst(vfx, p.x, p.y, '#5ce07a', 12, { speedMin: 30, speedMax: 90, life: 0.45, glow: true });
    world.float(p.x, p.y - 18, '+35');
  }
  if (id === 'grenade') {
    world.spawned.push({ what: 'explosion', n: 1, x: input.mouse.x, y: input.mouse.y });
    consumeSpawns();
  }
  if (id === 'shieldkit') {
    playerShield = 3;
    spawnShockwave(vfx, p.x, p.y, 12, 42, '#4fd1ff', 0.3, 3);
  }
}

window.addEventListener('blur', () => {
  paused = true;
  input.mouseDown = false; input.rightDown = false; input.keys.clear();
});
window.addEventListener('focus', () => { paused = false; last = performance.now(); });

screens.title(save);
void preloadRasterSheets();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) {
    if (phase === 'combat') updateCombat(dt);
    else if (phase === 'shop' && input.refresh) { refreshShop(run); screens.shop(run, loadout); }
  }
  renderFrame(ctx, {
    run, world, arena, stats: loadout.stats, mouse: input.mouse,
    phase, dt, loadout, bullets, impacts, vfx, playerShield,
    spawnQueueCount: spawnQueue.length,
  });
  consumeEdges(input);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
