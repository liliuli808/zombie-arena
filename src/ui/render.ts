import { drawSprite, spriteDrawSize } from './sprites';
import { drawDeath, drawEntity, type PlayerAnim } from './anim';
import { drawBullets, drawImpacts, type Impact } from './bullets';
import type { Bullet } from '../game/bullets';
import type { RunState, PlayerStats, Phase, Loadout } from '../core/types';
import type { World } from '../game/combat';
import type { Arena } from '../game/arena';
import { WEAPON_BY_ID } from '../data/weapons';
import { GAME_W, GAME_H } from '../core/constants';

export interface RenderInput {
  run: RunState; world: World; arena: Arena; stats: PlayerStats;
  mouse: { x: number; y: number }; phase: Phase; dt: number; loadout: Loadout;
  /** 飞行中的子弹（纯视觉层，缺省为空） */
  bullets?: Bullet[];
  /** 命中爆裂特效（纯视觉层，缺省为空） */
  impacts?: Impact[];
}

// 环境动画时钟（火焰、悬浮等），暂停时也继续走
let animClock = 0;

export function renderFrame(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
  const { run, world, arena, stats, mouse, phase } = inp;
  animClock += inp.dt;
  const t = animClock;
  ctx.clearRect(0, 0, GAME_W, GAME_H);
  drawFloor(ctx, arena.mapId);
  // 陷阱：黄黑警示板 + 脉动电极
  for (const tax of arena.traps) {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#8a7a1e' : '#2a2d33';
      ctx.fillRect(tax.x - 10 + i * 5, tax.y - 10 + j * 5, 5, 5);
    }
    const pulse = 0.5 + Math.sin(t * 5) * 0.5;
    ctx.fillStyle = '#b8c2cc'; ctx.fillRect(tax.x - 2, tax.y - 2, 4, 4);
    ctx.globalAlpha = 0.25 + pulse * 0.5;
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(tax.x, tax.y, 5 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  for (const o of [...arena.barrels, ...arena.boxes]) {
    if (o.hp <= 0) continue;
    const id = o.kind === 'barrel' ? 'barrel' : 'crate';
    ctx.globalAlpha = o.hp / o.maxHp * 0.5 + 0.5;
    drawSprite(ctx, id, o.x + o.w / 2, o.y + o.h / 2);
  }
  // 路障：木板 + 金属立柱
  for (const o of arena.barriers) {
    if (o.hp <= 0) continue;
    ctx.globalAlpha = o.hp / o.maxHp * 0.5 + 0.5;
    ctx.fillStyle = '#6b5330'; ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#4a3a20';
    if (o.w > o.h) { for (let x = o.x + 16; x < o.x + o.w; x += 24) ctx.fillRect(x, o.y, 4, o.h); }
    else { for (let y = o.y + 16; y < o.y + o.h; y += 24) ctx.fillRect(o.x, y, o.w, 4); }
    ctx.strokeStyle = '#8a6d42'; ctx.lineWidth = 2; ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 1;
  // 火焰地带：三层火团 + 摇曳
  for (const f of arena.fires) drawFlame(ctx, f.x, f.y, t, f.x * 0.01);
  const slot = run.slots[run.activeSlot];
  const activeDef = slot ? WEAPON_BY_ID[slot.weaponId] : null;
  const playerAnim: PlayerAnim | undefined = slot && activeDef ? {
    weapon: activeDef,
    charging: activeDef.school === 'blunt' && slot.res.charge > 0,
    chargeFrac: activeDef.chargeMax > 0 ? slot.res.charge / activeDef.chargeMax : 0,
  } : undefined;
  for (const e of world.entities) {
    if (e.dead) continue;
    const id = e.kind;
    drawEntity(ctx, e, t, e.id === 1 ? playerAnim : undefined);
    if (e.hp < e.maxHp) {
      const barY = e.y - spriteDrawSize(id) / 2 - 5;
      ctx.fillStyle = '#000'; ctx.fillRect(e.x - 14, barY, 28, 3);
      ctx.fillStyle = '#e05050'; ctx.fillRect(e.x - 14, barY, 28 * Math.min(1, Math.max(0, e.hp / e.maxHp)), 3);
    }
  }
  for (const d of world.deaths) drawDeath(ctx, d);
  ctx.font = '12px monospace'; ctx.textAlign = 'center';
  // 弹幕画在实体之上、浮字之下，保证任何场景下都清晰可见
  drawBullets(ctx, inp.bullets ?? []);
  drawImpacts(ctx, inp.impacts ?? []);
  for (const f of world.floating) { ctx.fillStyle = '#ffe9a8'; ctx.fillText(f.text, f.x, f.y); }
  ctx.textAlign = 'left';
  if (arena.weather === 'night' || arena.weather === 'fog') {
    const px = world.entities.find(e => e.id === 1)?.x ?? GAME_W / 2;
    const py = world.entities.find(e => e.id === 1)?.y ?? GAME_H / 2;
    const r = arena.weather === 'night' ? arena.visionRadius : arena.safeRadius;
    const g = ctx.createRadialGradient(px, py, r * 0.55, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(4,6,10,0.96)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);
    if (arena.weather === 'fog') drawToxicFog(ctx, px, py, arena.safeRadius, t);
  }
  if (phase === 'combat') {
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouse.x - 11, mouse.y); ctx.lineTo(mouse.x - 4, mouse.y);
    ctx.moveTo(mouse.x + 4, mouse.y); ctx.lineTo(mouse.x + 11, mouse.y); ctx.stroke();
  }
  drawHud(ctx, inp);
}

/** 矢量火团：外焰抖动 + 内焰心跳，替代原来的双层方块 */
function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number,
  time: number, seed: number): void {
  const flick = Math.sin(time * 9 + seed) * 2;
  const beat = 0.5 + Math.sin(time * 6 + seed * 2) * 0.5;
  ctx.globalAlpha = 0.3 + beat * 0.2;
  ctx.fillStyle = '#ff6b35';
  ctx.beginPath(); ctx.ellipse(x, y + flick * 0.3, 13 + beat * 2, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#ffb84d';
  ctx.beginPath();
  ctx.moveTo(x, y - 10 - beat * 3);
  ctx.quadraticCurveTo(x + 8, y - 2, x, y + 8);
  ctx.quadraticCurveTo(x - 8, y - 2, x, y - 10 - beat * 3);
  ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = '#ffe066';
  ctx.beginPath(); ctx.ellipse(x, y + 2, 3, 4 + beat * 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

/** 毒雾边界：环上流动的绿色弧段，提示安全圈正在收缩 */
function drawToxicFog(ctx: CanvasRenderingContext2D, px: number, py: number,
  r: number, time: number): void {
  ctx.strokeStyle = '#84d86a'; ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    const a0 = time * 0.35 + i * (Math.PI / 3);
    ctx.globalAlpha = 0.25 + Math.abs(Math.sin(time * 2 + i)) * 0.35;
    ctx.beginPath(); ctx.arc(px, py, r, a0, a0 + 0.42); ctx.stroke();
  }
  ctx.globalAlpha = 1;
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
  if (phase === 'combat') ctx.fillText(`剩余 ${inp.world.entities.filter(e => !e.dead && e.id !== 1 && !e.tags.includes('deployable')).length}`, 510, 22);
  ctx.fillStyle = '#ffe066';
  ctx.fillText(`预告: ${run.nextWavePreview.join(' / ') || '—'}`, 620, 22);
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

// ── 地图地板主题（纯矢量程序化生成，不再依赖地板 PNG）──────
const FLOOR_THEMES: Record<string, {
  base: string; line: string; speck: string; patch: string;
  /** 主题特征层：货场=油渍、实验室=发光地砖、天台=积水反光 */
  feature: 'oil' | 'panel' | 'puddle';
}> = {
  yard:    { base: '#20242b', line: '#2a2f38', speck: '#2c323c', patch: '#262b33', feature: 'oil' },
  lab:     { base: '#161a23', line: '#232a38', speck: '#1e242f', patch: '#1c2230', feature: 'panel' },
  rooftop: { base: '#1d1a26', line: '#292635', speck: '#252231', patch: '#221f2d', feature: 'puddle' },
};

// 确定性伪随机（同一块地板每次渲染一致）
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ (x * y * 2246822519);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawFloor(ctx: CanvasRenderingContext2D, mapId: string): void {
  const t = FLOOR_THEMES[mapId] ?? FLOOR_THEMES['yard'];
  ctx.fillStyle = t.base; ctx.fillRect(0, 0, GAME_W, GAME_H);
  // 大块地坪色斑
  for (let i = 0; i < 14; i++) {
    const px = Math.floor(hash2(i, 7) * GAME_W / 32) * 32;
    const py = Math.floor(hash2(i, 13) * GAME_H / 32) * 32;
    const pw = 64 + Math.floor(hash2(i, 21) * 4) * 32;
    const ph = 64 + Math.floor(hash2(i, 29) * 3) * 32;
    ctx.fillStyle = t.patch; ctx.fillRect(px, py, pw, ph);
  }
  drawFloorFeature(ctx, t.feature);
  // 细碎斑点
  for (let i = 0; i < 320; i++) {
    const px = Math.floor(hash2(i, 101) * GAME_W);
    const py = Math.floor(hash2(i, 211) * GAME_H);
    ctx.fillStyle = hash2(i, 307) > 0.5 ? t.speck : t.line;
    ctx.fillRect(px, py, 2, 2);
  }
  // 网格缝线
  ctx.strokeStyle = t.line; ctx.lineWidth = 1;
  for (let x = 0; x <= GAME_W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GAME_H); ctx.stroke(); }
  for (let y = 0; y <= GAME_H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GAME_W, y); ctx.stroke(); }
}

/** 主题特征层：让三张地图一眼可辨，同时不带任何外部贴图 */
function drawFloorFeature(ctx: CanvasRenderingContext2D, feature: string): void {
  if (feature === 'oil') {
    // 货场：不规则油渍
    ctx.fillStyle = 'rgba(10,12,18,0.55)';
    for (let i = 0; i < 9; i++) {
      const x = hash2(i, 401) * GAME_W, y = hash2(i, 409) * GAME_H;
      const r = 18 + hash2(i, 419) * 42;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.55 + hash2(i, 421) * 0.4), hash2(i, 423) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (feature === 'panel') {
    // 实验室：发光地砖 + 通风格栅
    for (let x = 32; x < GAME_W; x += 128) {
      for (let y = 32; y < GAME_H; y += 128) {
        ctx.fillStyle = 'rgba(60,190,220,0.10)';
        ctx.fillRect(x, y, 40, 8);
        ctx.fillStyle = 'rgba(60,190,220,0.05)';
        ctx.fillRect(x, y + 12, 24, 4);
      }
    }
    ctx.strokeStyle = 'rgba(110,150,170,0.12)'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = hash2(i, 501) * GAME_W, y = hash2(i, 509) * GAME_H;
      for (let k = 0; k < 6; k++) {
        ctx.beginPath(); ctx.moveTo(x, y + k * 5); ctx.lineTo(x + 36, y + k * 5); ctx.stroke();
      }
    }
  } else {
    // 天台：积水反光
    for (let i = 0; i < 11; i++) {
      const x = hash2(i, 601) * GAME_W, y = hash2(i, 607) * GAME_H;
      const r = 22 + hash2(i, 613) * 50;
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(120,150,190,0.16)');
      g.addColorStop(1, 'rgba(120,150,190,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

