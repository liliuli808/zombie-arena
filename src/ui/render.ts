import { drawSprite, spriteDrawSize } from './sprites';
import { drawDeath, drawEntity, type PlayerAnim } from './anim';
import { drawBullets, drawImpacts, type Impact } from './bullets';
import type { Bullet } from '../game/bullets';
import type { RunState, PlayerStats, Phase, Loadout, Entity } from '../core/types';
import type { World } from '../game/combat';
import type { Arena, ArenaObject } from '../game/arena';
import { WEAPON_BY_ID } from '../data/weapons';
import { ZOMBIE_BY_ID } from '../data/zombies';
import { CONSUMABLE_BY_ID } from '../data/shop';
import { CHARACTER_BY_ID } from '../data/characters';
import { magSize } from '../engine/abilities';
import { GAME_W, GAME_H } from '../core/constants';
import { schoolMeta, weatherMeta, zombieLabel, comboLabel } from './labels';
import {
  drawDecals, drawVfxBack, drawVfxFront, drawWeatherFx, getShakeOffset,
  type VfxState,
} from './vfx';

export interface RenderInput {
  run: RunState;
  world: World;
  arena: Arena;
  stats: PlayerStats;
  mouse: { x: number; y: number };
  phase: Phase;
  dt: number;
  loadout: Loadout;
  /** 飞行中的子弹（纯视觉层，缺省为空） */
  bullets?: Bullet[];
  /** 命中爆裂特效（纯视觉层，缺省为空） */
  impacts?: Impact[];
  /** 粒子 / 震屏 / 地面残痕等全局视觉状态（可选） */
  vfx?: VfxState;
  /** 玩家护盾剩余秒数 */
  playerShield?: number;
  /** 刷怪队列剩余数量 */
  spawnQueueCount?: number;
}

const TAU = Math.PI * 2;
const HUD_FONT = '12px "Inter", "PingFang SC", "Microsoft YaHei", sans-serif';
const HUD_BOLD = '700 12px "Inter", "PingFang SC", "Microsoft YaHei", sans-serif';

// 环境动画时钟（火焰、悬浮、雨滴等），暂停时也继续走
let animClock = 0;

// 离屏地板缓存：每种地图只渲染一次，战斗中 1 次 drawImage 搞定
const floorCache = new Map<string, HTMLCanvasElement>();
const portraitCache = new Map<string, HTMLImageElement | null>();

function getPortrait(id: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  if (portraitCache.has(id)) return portraitCache.get(id) ?? null;
  const img = new Image();
  img.src = `/assets/portraits/${id}.png`;
  portraitCache.set(id, img);
  return img;
}

function safeRadialGrad(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, r0: number,
  x1: number, y1: number, r1: number,
  stops: [number, string][],
  fallback: string,
): string | CanvasGradient {
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  if (g && typeof g.addColorStop === 'function') {
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }
  return fallback;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function renderFrame(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
  const { run, world, arena, stats, mouse, phase, vfx } = inp;
  animClock += inp.dt;
  const t = animClock;
  ctx.clearRect(0, 0, GAME_W, GAME_H);

  const shake = phase === 'combat' ? getShakeOffset(vfx) : { x: 0, y: 0 };
  const player = world.entities.find(e => e.id === 1 && !e.dead);
  const slot = run.slots[run.activeSlot];
  const activeDef = slot ? WEAPON_BY_ID[slot.weaponId] : null;

  ctx.save();
  if (shake.x !== 0 || shake.y !== 0) ctx.translate(shake.x, shake.y);

  // 1) 缓存的纹理地板 + 地面持久战损
  drawCachedFloor(ctx, arena.mapId);
  drawDecals(ctx, vfx);

  // 2) 陷阱增幅位（手持科技武器时显露 46px 增幅圈）
  drawTraps(ctx, arena, t, activeDef?.school === 'tech');

  // 3) 场景物件（带接触阴影、受损裂纹与血条）
  drawArenaProps(ctx, arena, t);

  // 4) 火焰地带（热浪底座 + 摇曳火舌）
  for (const f of arena.fires) drawFlame(ctx, f.x, f.y, t, f.x * 0.017 + f.y * 0.011);

  // 5) 底部冲击波
  drawVfxBack(ctx, vfx);

  // 6) 倒地尸体（画在存活实体之下）
  for (const d of world.deaths) drawDeath(ctx, d);

  // 7) 实体按 Y 坐标深度排序，消除遮挡穿帮
  const playerAnim: PlayerAnim | undefined = slot && activeDef ? {
    weapon: activeDef,
    charging: activeDef.school === 'blunt' && slot.res.charge > 0,
    chargeFrac: activeDef.chargeMax > 0 ? slot.res.charge / activeDef.chargeMax : 0,
  } : undefined;

  const sorted = world.entities.filter(e => !e.dead).sort((a, b) => a.y - b.y);
  for (const e of sorted) {
    drawEntity(ctx, e, t, e.id === 1 ? playerAnim : undefined);
    if (e.id === 1 && (inp.playerShield ?? 0) > 0) {
      drawShieldBubble(ctx, e, inp.playerShield!, t);
    }
    if (e.hp < e.maxHp && e.id !== 1 && !e.tags.includes('boss')) {
      drawMiniHpBar(ctx, e);
    }
  }

  // 8) 弹幕、命中爆裂与粒子火花
  drawBullets(ctx, inp.bullets ?? []);
  drawImpacts(ctx, inp.impacts ?? []);
  drawVfxFront(ctx, vfx);

  // 9) 浮空伤害跳字（描边 + 色彩区分 + 向上缓动）
  drawFloatingText(ctx, world);

  ctx.restore();

  // 10) 天气氛围、光照遮罩与暗角
  drawAtmosphere(ctx, arena, player, mouse, t, vfx);

  // 11) 低血量 / 受伤红色边缘脉冲
  if (phase === 'combat') {
    drawDamageVignette(ctx, run.hp / Math.max(1, stats.maxHp), vfx?.hurtFlash ?? 0, t);
    drawCrosshair(ctx, mouse, slot, activeDef, stats, t);
  }

  // 12) 战斗 HUD（只在战斗中完整展示，避免遮挡其他全屏面板）
  if (phase === 'combat') {
    drawHud(ctx, inp, player);
  }
}

// ── 地板程序化生成 + 离线缓存 ───────────────────────────────
const FLOOR_THEMES: Record<string, {
  base: string;
  tileA: string;
  tileB: string;
  line: string;
  speck: string;
  border: string;
  accent: string;
  feature: 'yard' | 'lab' | 'rooftop';
}> = {
  yard: {
    base: '#1b1f26', tileA: '#20252e', tileB: '#181c23',
    line: 'rgba(255,255,255,0.035)', speck: 'rgba(255,255,255,0.045)',
    border: '#101319', accent: '#c9972e', feature: 'yard',
  },
  lab: {
    base: '#121822', tileA: '#171f2c', tileB: '#10151f',
    line: 'rgba(92,190,235,0.06)', speck: 'rgba(120,210,255,0.04)',
    border: '#0a0f17', accent: '#36b5e5', feature: 'lab',
  },
  rooftop: {
    base: '#171621', tileA: '#1d1c29', tileB: '#14131d',
    line: 'rgba(180,185,220,0.038)', speck: 'rgba(200,210,240,0.04)',
    border: '#0d0c14', accent: '#8e7cc3', feature: 'rooftop',
  },
};

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) ^ (x * y * 2246822519);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawCachedFloor(ctx: CanvasRenderingContext2D, mapId: string): void {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    let cached = floorCache.get(mapId);
    if (!cached) {
      const c = document.createElement('canvas');
      c.width = GAME_W;
      c.height = GAME_H;
      const g = c.getContext('2d');
      if (g) {
        paintFloor(g, mapId);
        floorCache.set(mapId, c);
        cached = c;
      }
    }
    if (cached) {
      ctx.drawImage(cached, 0, 0);
      return;
    }
  }
  paintFloor(ctx, mapId);
}

function paintFloor(ctx: CanvasRenderingContext2D, mapId: string): void {
  const th = FLOOR_THEMES[mapId] ?? FLOOR_THEMES['yard'];
  ctx.fillStyle = th.base;
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  // 1) 棋盘式 64×64 混凝土/地砖色差块
  const tile = 64;
  for (let y = 0; y < GAME_H; y += tile) {
    for (let x = 0; x < GAME_W; x += tile) {
      const n = hash2(x / tile + 1, y / tile + 1);
      ctx.fillStyle = n > 0.55 ? th.tileA : n < 0.25 ? th.tileB : th.base;
      ctx.fillRect(x, y, tile, tile);
    }
  }

  // 2) 地砖缝线
  ctx.strokeStyle = th.line;
  ctx.lineWidth = 1;
  for (let x = 0; x <= GAME_W; x += tile) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, GAME_H); ctx.stroke();
  }
  for (let y = 0; y <= GAME_H; y += tile) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(GAME_W, y + 0.5); ctx.stroke();
  }

  // 3) 主题环境特征
  if (th.feature === 'yard') {
    // 胎痕与装卸区标线
    ctx.strokeStyle = 'rgba(201, 151, 46, 0.14)';
    ctx.lineWidth = 3;
    ctx.strokeRect(44, 44, GAME_W - 88, GAME_H - 88);
    // 路面裂纹
    ctx.strokeStyle = 'rgba(6, 8, 12, 0.52)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 12; i++) {
      let cx = 60 + hash2(i, 31) * (GAME_W - 120);
      let cy = 60 + hash2(i, 47) * (GAME_H - 120);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let s = 0; s < 4; s++) {
        cx += (hash2(i * 7 + s, 53) - 0.5) * 34;
        cy += (hash2(i * 7 + s, 71) - 0.5) * 34;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    // 油渍
    ctx.fillStyle = 'rgba(8, 10, 15, 0.5)';
    for (let i = 0; i < 9; i++) {
      const x = hash2(i, 401) * GAME_W, y = hash2(i, 409) * GAME_H;
      const r = 18 + hash2(i, 419) * 40;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + hash2(i, 421) * 0.4), hash2(i, 423) * Math.PI, 0, TAU);
      ctx.fill();
    }
  } else if (th.feature === 'lab') {
    // 实验室发光管线与核心扇区圆环
    ctx.strokeStyle = 'rgba(54, 181, 229, 0.14)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(GAME_W / 2, GAME_H / 2, 130, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(GAME_W / 2, GAME_H / 2, 230, 0, TAU);
    ctx.stroke();
    for (let x = 64; x < GAME_W - 64; x += 128) {
      for (let y = 64; y < GAME_H - 64; y += 128) {
        ctx.fillStyle = 'rgba(60, 200, 240, 0.12)';
        ctx.fillRect(x - 16, y - 3, 32, 6);
        ctx.fillStyle = 'rgba(60, 200, 240, 0.06)';
        ctx.fillRect(x - 10, y + 6, 20, 3);
      }
    }
    // 通风格栅
    ctx.strokeStyle = 'rgba(120, 165, 195, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = 80 + hash2(i, 501) * (GAME_W - 160);
      const y = 80 + hash2(i, 509) * (GAME_H - 160);
      ctx.strokeRect(x, y, 40, 28);
      for (let k = 1; k < 5; k++) {
        ctx.beginPath(); ctx.moveTo(x + 2, y + k * 5.6); ctx.lineTo(x + 38, y + k * 5.6); ctx.stroke();
      }
    }
  } else {
    // 天台停机坪标志 + 积水反光
    ctx.strokeStyle = 'rgba(210, 198, 255, 0.08)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(GAME_W / 2, GAME_H / 2, 120, 0, TAU);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const x = hash2(i, 601) * GAME_W, y = hash2(i, 607) * GAME_H;
      const r = 24 + hash2(i, 613) * 52;
      ctx.fillStyle = safeRadialGrad(
        ctx, x, y, 2, x, y, r,
        [[0, 'rgba(130,165,220,0.18)'], [1, 'rgba(130,165,220,0)']],
        'rgba(130,165,220,0.08)',
      );
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.52, 0, 0, TAU); ctx.fill();
    }
  }

  // 4) 颗粒质感噪点
  for (let i = 0; i < 420; i++) {
    const px = Math.floor(hash2(i, 101) * GAME_W);
    const py = Math.floor(hash2(i, 211) * GAME_H);
    ctx.fillStyle = i % 3 === 0 ? 'rgba(0,0,0,0.22)' : th.speck;
    ctx.fillRect(px, py, 2, 2);
  }

  // 5) 竞技场外圈围墙边框 + 四角警示条
  ctx.strokeStyle = th.border;
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, GAME_W - 14, GAME_H - 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(14.5, 14.5, GAME_W - 29, GAME_H - 29);

  // 四角战术亮边
  ctx.strokeStyle = th.accent;
  ctx.globalAlpha = 0.32;
  ctx.lineWidth = 2;
  const cLen = 28;
  for (const [cx, cy, sx, sy] of [
    [18, 18, 1, 1], [GAME_W - 18, 18, -1, 1],
    [18, GAME_H - 18, 1, -1], [GAME_W - 18, GAME_H - 18, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * cLen, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * cLen);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 6) 柔和边缘暗角（把视线自然聚焦到战场中心）
  const vig = safeRadialGrad(
    ctx, GAME_W / 2, GAME_H / 2, GAME_H * 0.35, GAME_W / 2, GAME_H / 2, GAME_W * 0.62,
    [[0, 'rgba(0,0,0,0)'], [1, 'rgba(3,5,10,0.46)']],
    'rgba(0,0,0,0)',
  );
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, GAME_W, GAME_H);
}

// ── 陷阱位、掩体、油桶、箱子 ────────────────────────────────
function drawTraps(ctx: CanvasRenderingContext2D, arena: Arena, t: number, showRadius: boolean): void {
  const pulse = 0.5 + Math.sin(t * 4.5) * 0.5;
  for (const tr of arena.traps) {
    ctx.save();
    // 科技流派选持时显示 46px 增幅范围提示
    if (showRadius) {
      ctx.strokeStyle = `rgba(79, 209, 255, ${(0.18 + pulse * 0.16).toFixed(2)})`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(tr.x, tr.y, 46, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 金属底座
    roundRectPath(ctx, tr.x - 14, tr.y - 14, 28, 28, 4);
    ctx.fillStyle = '#1b222e';
    ctx.fill();
    ctx.strokeStyle = '#3b485e';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 内部斜向黄黑警示核心
    ctx.fillStyle = '#2c2918';
    ctx.fillRect(tr.x - 10, tr.y - 10, 20, 20);
    ctx.fillStyle = 'rgba(245, 197, 66, 0.45)';
    for (let k = -8; k <= 8; k += 8) {
      ctx.fillRect(tr.x + k - 2, tr.y - 9, 3, 18);
    }

    // 中央脉动能量核
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = safeRadialGrad(
      ctx, tr.x, tr.y, 1, tr.x, tr.y, 12,
      [[0, 'rgba(79,209,255,0.85)'], [1, 'rgba(79,209,255,0)']],
      '#4fd1ff',
    );
    ctx.globalAlpha = 0.4 + pulse * 0.45;
    ctx.beginPath();
    ctx.arc(tr.x, tr.y, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#d8f6ff';
    ctx.globalAlpha = 0.9;
    ctx.fillRect(tr.x - 2, tr.y - 2, 4, 4);
    ctx.restore();
  }
}

function drawArenaProps(ctx: CanvasRenderingContext2D, arena: Arena, t: number): void {
  // 路障：带投影的工业强化挡板 + 钢钉 + 损伤进度条
  for (const o of arena.barriers) {
    if (o.hp <= 0) continue;
    const ratio = Math.max(0, Math.min(1, o.hp / o.maxHp));
    ctx.save();
    // 阴影
    ctx.fillStyle = 'rgba(4, 6, 12, 0.5)';
    roundRectPath(ctx, o.x + 3, o.y + 5, o.w, o.h, 3);
    ctx.fill();

    // 主体木钢结构
    roundRectPath(ctx, o.x, o.y, o.w, o.h, 3);
    ctx.fillStyle = '#57432a';
    ctx.fill();
    ctx.fillStyle = '#755a37';
    ctx.fillRect(o.x + 2, o.y + 2, Math.max(0, o.w - 4), Math.max(0, o.h - 6));

    // 钢制加固筋条
    ctx.fillStyle = '#333b48';
    if (o.w > o.h) {
      for (let x = o.x + 14; x < o.x + o.w - 8; x += 24) ctx.fillRect(x, o.y, 5, o.h);
    } else {
      for (let y = o.y + 14; y < o.y + o.h - 8; y += 24) ctx.fillRect(o.x, y, o.w, 5);
    }

    // 边框与高光
    ctx.strokeStyle = ratio < 0.4 ? '#d96b43' : '#96764c';
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1, 3);
    ctx.stroke();

    // 受损裂纹提示 + 迷你耐久条
    if (ratio < 1) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      ctx.fillRect(o.x + 2, o.y - 7, o.w - 4, 4);
      ctx.fillStyle = ratio > 0.4 ? '#d9a441' : '#ef5350';
      ctx.fillRect(o.x + 2, o.y - 7, (o.w - 4) * ratio, 4);
    }
    ctx.restore();
  }

  // 油桶与补给箱（带落地影与油桶红晕）
  const props: ArenaObject[] = [...arena.barrels, ...arena.boxes];
  for (const o of props) {
    if (o.hp <= 0) continue;
    const cx = o.x + o.w / 2;
    const cy = o.y + o.h / 2;
    const id = o.kind === 'barrel' ? 'barrel' : 'crate';
    ctx.save();
    ctx.fillStyle = 'rgba(4, 6, 12, 0.52)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 14, 15, 6, 0, 0, TAU);
    ctx.fill();
    if (o.kind === 'barrel') {
      const pulse = 0.5 + Math.sin(t * 4 + cx) * 0.5;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255, 92, 54, ${(0.08 + pulse * 0.08).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = o.hp / o.maxHp * 0.45 + 0.55;
    drawSprite(ctx, id, cx, cy);
    ctx.restore();
  }
}

/** 火焰地带：炽热地面焦痕 + 三层摇曳火团 */
function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number,
  time: number, seed: number): void {
  const flick = Math.sin(time * 10 + seed) * 2.2;
  const beat = 0.5 + Math.sin(time * 6.5 + seed * 2) * 0.5;
  ctx.save();
  ctx.fillStyle = 'rgba(18, 9, 6, 0.45)';
  ctx.beginPath();
  ctx.ellipse(x, y + 6, 18, 10, 0, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = safeRadialGrad(
    ctx, x, y, 2, x, y, 24 + beat * 4,
    [[0, 'rgba(255,140,42,0.52)'], [1, 'rgba(255,80,20,0)']],
    'rgba(255,107,53,0.28)',
  );
  ctx.beginPath(); ctx.arc(x, y, 24 + beat * 4, 0, TAU); ctx.fill();

  ctx.globalAlpha = 0.65;
  ctx.fillStyle = '#ff7b2e';
  ctx.beginPath();
  ctx.moveTo(x + flick * 0.4, y - 13 - beat * 4);
  ctx.quadraticCurveTo(x + 11, y - 1, x, y + 9);
  ctx.quadraticCurveTo(x - 11, y - 1, x + flick * 0.4, y - 13 - beat * 4);
  ctx.fill();

  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#ffe066';
  ctx.beginPath(); ctx.ellipse(x, y + 2, 4, 5.5 + beat * 2, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawShieldBubble(ctx: CanvasRenderingContext2D, p: Entity, shieldSec: number, t: number): void {
  const pulse = 0.5 + Math.sin(t * 9) * 0.5;
  const r = 26 + pulse * 2.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = safeRadialGrad(
    ctx, p.x, p.y, r * 0.3, p.x, p.y, r,
    [[0, 'rgba(79,209,255,0.06)'], [1, 'rgba(79,209,255,0.38)']],
    'rgba(79,209,255,0.2)',
  );
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = shieldSec < 0.8 && Math.floor(t * 14) % 2 === 0 ? '#ffffff' : '#7ae3ff';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
  ctx.restore();
}

function drawMiniHpBar(ctx: CanvasRenderingContext2D, e: Entity): void {
  const w = e.tags.includes('armored') || e.tags.includes('priority') ? 36 : 28;
  const barY = e.y - spriteDrawSize(e.kind) / 2 - 7;
  const frac = Math.min(1, Math.max(0, e.hp / Math.max(1, e.maxHp)));
  ctx.save();
  ctx.fillStyle = 'rgba(6, 8, 14, 0.85)';
  ctx.fillRect(e.x - w / 2 - 1, barY - 1, w + 2, 6);
  ctx.fillStyle = e.tags.includes('armored') ? '#74b9ff' : '#ef5350';
  ctx.fillRect(e.x - w / 2, barY, w * frac, 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.fillRect(e.x - w / 2, barY, w * frac, 1.5);
  ctx.restore();
}

function drawFloatingText(ctx: CanvasRenderingContext2D, world: World): void {
  if (world.floating.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  for (const f of world.floating) {
    if (f.text === '·') continue;
    const progress = Math.max(0, Math.min(1, 1 - f.time / 0.8));
    const lift = progress * 18;
    const alpha = Math.min(1, f.time * 2.5);
    const isHurt = f.text.startsWith('-');
    const numeric = Number(f.text);
    const isBig = Number.isFinite(numeric) && numeric >= 35;

    ctx.globalAlpha = alpha;
    ctx.font = isBig || isHurt
      ? '800 14px "Inter", "PingFang SC", sans-serif'
      : '700 12px "Inter", "PingFang SC", sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(8, 10, 16, 0.9)';
    ctx.strokeText(f.text, f.x, f.y - lift);
    ctx.fillStyle = isHurt ? '#ff6464' : isBig ? '#ffe066' : '#f4f1de';
    ctx.fillText(f.text, f.x, f.y - lift);
  }
  ctx.restore();
}

// ── 天气与环境光 ────────────────────────────────────────────
function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  arena: Arena,
  player: Entity | undefined,
  mouse: { x: number; y: number },
  t: number,
  vfx?: VfxState,
): void {
  drawWeatherFx(ctx, arena.weather, t, vfx);

  if (arena.weather === 'night' || arena.weather === 'fog') {
    const px = player?.x ?? GAME_W / 2;
    const py = player?.y ?? GAME_H / 2;
    const r = arena.weather === 'night' ? arena.visionRadius : arena.safeRadius;
    const g = safeRadialGrad(
      ctx, px, py, r * 0.45, px, py, r,
      arena.weather === 'night'
        ? [[0, 'rgba(0,0,0,0)'], [0.75, 'rgba(5,8,16,0.58)'], [1, 'rgba(3,5,11,0.94)']]
        : [[0, 'rgba(0,0,0,0)'], [0.82, 'rgba(12,26,14,0.35)'], [1, 'rgba(6,16,10,0.88)']],
      'rgba(4,6,12,0.75)',
    );
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    // 夜晚模式额外补一道朝向准星的柔和手电光锥
    if (arena.weather === 'night' && player) {
      const aim = Math.atan2(mouse.y - py, mouse.x - px);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = safeRadialGrad(
        ctx, px, py, 10, px, py, r * 1.15,
        [[0, 'rgba(255,244,210,0.14)'], [1, 'rgba(255,244,210,0)']],
        'rgba(255,244,210,0.06)',
      );
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.arc(px, py, r * 1.15, aim - 0.34, aim + 0.34);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (arena.weather === 'fog') {
      drawToxicFog(ctx, GAME_W / 2, GAME_H / 2, arena.safeRadius, t);
    }
  }
}

function drawToxicFog(ctx: CanvasRenderingContext2D, cx: number, cy: number,
  r: number, time: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(132, 216, 106, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();

  ctx.strokeStyle = '#92f078';
  ctx.lineWidth = 3.5;
  for (let i = 0; i < 6; i++) {
    const a0 = time * 0.4 + i * (Math.PI / 3);
    ctx.globalAlpha = 0.25 + Math.abs(Math.sin(time * 2.2 + i)) * 0.45;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a0 + 0.45); ctx.stroke();
  }
  ctx.restore();
}

function drawDamageVignette(ctx: CanvasRenderingContext2D, hpRatio: number, hurtFlash: number, t: number): void {
  const lowPulse = hpRatio < 0.35 ? (0.35 - hpRatio) * (0.65 + Math.sin(t * 7) * 0.35) * 1.3 : 0;
  const alpha = Math.min(0.65, lowPulse + hurtFlash * 0.42);
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.fillStyle = safeRadialGrad(
    ctx, GAME_W / 2, GAME_H / 2, GAME_H * 0.3, GAME_W / 2, GAME_H / 2, GAME_W * 0.62,
    [[0, 'rgba(220,30,40,0)'], [1, `rgba(220,30,40,${alpha.toFixed(3)})`]],
    `rgba(220,30,40,${(alpha * 0.4).toFixed(3)})`,
  );
  ctx.fillRect(0, 0, GAME_W, GAME_H);
  ctx.restore();
}

// ── 动态战术准星（附换弹 / 蓄力进度环）──────────────────────
function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  mouse: { x: number; y: number },
  slot: RunState['slots'][number],
  def: (typeof WEAPON_BY_ID)[string] | null,
  stats: PlayerStats,
  t: number,
): void {
  const mx = mouse.x, my = mouse.y;
  const color = def ? schoolMeta(def.school).color : '#f5c542';
  const reloading = slot && def && def.school === 'gun' && slot.res.reloading > 0;
  const charging = slot && def && def.school === 'blunt' && slot.res.charge > 0;
  const spread = reloading ? 12 : 8 + Math.sin(t * 4) * 0.6;

  ctx.save();
  // 外环进度（换弹或蓄力）
  if (reloading && def) {
    const total = Math.max(0.1, def.reloadTime * stats.reloadMult);
    const frac = 1 - Math.max(0, Math.min(1, slot!.res.reloading / total));
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(mx, my, 15, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#f5c542';
    ctx.beginPath(); ctx.arc(mx, my, 15, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.stroke();
  } else if (charging && def && def.chargeMax > 0) {
    const frac = Math.min(1, slot!.res.charge / def.chargeMax);
    ctx.strokeStyle = frac >= 1 ? '#ff6b35' : '#ffe066';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(mx, my, 15, -Math.PI / 2, -Math.PI / 2 + TAU * frac); ctx.stroke();
  }

  // 四向准星刻线 + 中心点
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 3.2;
  drawReticleLines(ctx, mx, my, spread);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  drawReticleLines(ctx, mx, my, spread);

  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(mx, my, 1.8, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawReticleLines(ctx: CanvasRenderingContext2D, x: number, y: number, gap: number): void {
  const len = 6;
  ctx.beginPath();
  ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
  ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
  ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
  ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
  ctx.stroke();
}

// ── 现代战术 HUD ────────────────────────────────────────────
function drawHud(ctx: CanvasRenderingContext2D, inp: RenderInput, player: Entity | undefined): void {
  const { run, stats, loadout, world } = inp;
  const activeBoss = world.entities.find(e => !e.dead && e.tags.includes('boss'));
  const aliveZombies = world.entities.filter(
    e => !e.dead && e.id !== 1 && !e.tags.includes('deployable'),
  ).length;
  const remaining = aliveZombies + (inp.spawnQueueCount ?? 0);

  // ── 1. 左上角：幸存者状态板（头像 + 血条 + 护盾）
  const px = 14, py = 12, pw = 248, ph = 54;
  drawGlassCard(ctx, px, py, pw, ph, 'rgba(130, 160, 210, 0.25)');

  // 头像框
  const avX = px + 7, avY = py + 7, avS = 40;
  roundRectPath(ctx, avX, avY, avS, avS, 7);
  ctx.fillStyle = '#0c1018';
  ctx.fill();
  const portrait = getPortrait(run.characterId);
  if (portrait && portrait.complete && portrait.naturalWidth > 0) {
    ctx.save();
    roundRectPath(ctx, avX, avY, avS, avS, 7);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(portrait, avX + 2, avY + 2, avS - 4, avS - 4);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, avX, avY, avS, avS, 7);
  ctx.stroke();

  // 角色名 + 血量文本
  const barX = avX + avS + 10;
  const barW = pw - (barX - px) - 12;
  const hp = Math.max(0, Math.ceil(player?.hp ?? run.hp));
  const maxHp = Math.max(1, Math.round(stats.maxHp));
  const hpFrac = Math.min(1, Math.max(0, hp / maxHp));
  const charName = CHARACTER_BY_ID[run.characterId]?.name ?? '幸存者';

  ctx.font = HUD_BOLD;
  ctx.fillStyle = '#eef1f7';
  ctx.textAlign = 'left';
  ctx.fillText(charName, barX, py + 19);
  ctx.textAlign = 'right';
  ctx.fillStyle = hpFrac < 0.3 ? '#ff7675' : '#d5dfef';
  ctx.fillText(`${hp} / ${maxHp}`, barX + barW, py + 19);

  // 血条本体
  roundRectPath(ctx, barX, py + 25, barW, 12, 4);
  ctx.fillStyle = 'rgba(5, 8, 14, 0.88)';
  ctx.fill();
  if (hpFrac > 0) {
    roundRectPath(ctx, barX + 1, py + 26, Math.max(4, (barW - 2) * hpFrac), 10, 3);
    ctx.fillStyle = hpFrac > 0.5 ? '#43c96e' : hpFrac > 0.28 ? '#f5b841' : '#e84855';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(barX + 2, py + 26, Math.max(2, (barW - 4) * hpFrac), 3);
  }
  // 护盾条（激活时）
  if ((inp.playerShield ?? 0) > 0) {
    const shFrac = Math.min(1, inp.playerShield! / 3);
    ctx.fillStyle = '#4fd1ff';
    ctx.fillRect(barX, py + 41, barW * shFrac, 3);
  } else {
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7e8da8';
    ctx.fillText(`移速 ${Math.round(stats.moveSpeed)} · 暴击 ${Math.round(stats.critChance * 100)}%`, barX, py + 46);
  }

  // ── 2. 顶部中央：Boss 大血条 或 波次进度胶囊
  if (activeBoss) {
    const bw = 320, bx = (GAME_W - bw) / 2, by = 12;
    drawGlassCard(ctx, bx, by, bw, 46, 'rgba(239, 83, 80, 0.55)');
    const bName = ZOMBIE_BY_ID[activeBoss.kind]?.name ?? 'Boss';
    const bFrac = Math.max(0, Math.min(1, activeBoss.hp / Math.max(1, activeBoss.maxHp)));
    ctx.font = '800 12px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = '#ff8a80';
    ctx.textAlign = 'left';
    ctx.fillText(`☠ ${bName}`, bx + 12, by + 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd6d6';
    ctx.fillText(`${Math.ceil(activeBoss.hp)} / ${Math.ceil(activeBoss.maxHp)}`, bx + bw - 12, by + 18);
    roundRectPath(ctx, bx + 12, by + 25, bw - 24, 11, 4);
    ctx.fillStyle = 'rgba(10, 4, 6, 0.9)';
    ctx.fill();
    if (bFrac > 0) {
      roundRectPath(ctx, bx + 13, by + 26, Math.max(4, (bw - 26) * bFrac), 9, 3);
      ctx.fillStyle = '#e53935';
      ctx.fill();
    }
  } else {
    const wm = weatherMeta(run.weather);
    const cw = 276, cx = (GAME_W - cw) / 2, cy = 12;
    drawGlassCard(ctx, cx, cy, cw, 38, 'rgba(130, 160, 210, 0.25)');
    ctx.textAlign = 'left';
    ctx.font = '800 13px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = '#ffe066';
    ctx.fillText(`第 ${run.wave} 波`, cx + 14, cy + 23);

    ctx.font = HUD_BOLD;
    ctx.fillStyle = '#d4deee';
    ctx.textAlign = 'center';
    ctx.fillText(`剩余 ${remaining}`, cx + cw / 2 + 4, cy + 23);

    ctx.textAlign = 'right';
    ctx.fillStyle = wm.color;
    ctx.fillText(`${wm.icon} ${wm.name}`, cx + cw - 14, cy + 23);
  }

  // ── 3. 右上角：经济、击杀与预告
  const rw = 216, rx = GAME_W - rw - 14, ry = 12;
  drawGlassCard(ctx, rx, ry, rw, 54, 'rgba(245, 197, 66, 0.25)');
  ctx.textAlign = 'left';
  ctx.font = '800 13px "Inter", "PingFang SC", sans-serif';
  ctx.fillStyle = '#f5c542';
  ctx.fillText(`🪙 ${run.gold} 金`, rx + 12, ry + 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#dce4f2';
  ctx.font = HUD_BOLD;
  ctx.fillText(`击杀 ${run.kills}`, rx + rw - 12, ry + 22);

  ctx.textAlign = 'left';
  ctx.font = '11px "Inter", "PingFang SC", sans-serif';
  ctx.fillStyle = '#8b9ab5';
  const preview = run.nextWavePreview.map(zombieLabel).join(' / ') || '—';
  ctx.fillText(`敌情: ${preview.slice(0, 18)}`, rx + 12, ry + 42);

  // ── 4. 底部战术武器坞 + [Q] 消耗品 + 羁绊标签
  drawBottomDock(ctx, run, stats, loadout);
}

function drawBottomDock(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  stats: PlayerStats,
  loadout: Loadout,
): void {
  const cardW = 148, cardH = 58, gap = 10;
  const consW = 108;
  const totalW = cardW * 3 + gap * 2 + gap + consW;
  const startX = Math.round((GAME_W - totalW) / 2);
  const y = GAME_H - cardH - 12;

  // 羁绊 & 组合技胶囊（悬浮于武器坞正上方）
  const pills: { text: string; color: string }[] = [];
  for (const b of loadout.setBonuses) {
    if (b.tier > 0) {
      const sm = schoolMeta(b.school);
      pills.push({ text: `${sm.name}×${b.count}`, color: sm.color });
    }
  }
  for (const cid of loadout.combos) {
    pills.push({ text: `✦ ${comboLabel(cid).name}`, color: '#d0b0ff' });
  }
  if (pills.length > 0) {
    ctx.save();
    ctx.font = '700 11px "Inter", "PingFang SC", sans-serif';
    let px = startX;
    for (const p of pills) {
      const tw = ctx.measureText(p.text).width + 16;
      drawGlassCard(ctx, px, y - 24, tw, 19, p.color);
      ctx.fillStyle = p.color;
      ctx.textAlign = 'left';
      ctx.fillText(p.text, px + 8, y - 11);
      px += tw + 6;
    }
    ctx.restore();
  }

  // 三个武器槽位
  for (let i = 0; i < 3; i++) {
    const x = startX + i * (cardW + gap);
    const active = i === run.activeSlot;
    const s = run.slots[i];
    const def = s ? WEAPON_BY_ID[s.weaponId] : null;
    const accent = def ? schoolMeta(def.school).color : '#3f4c66';

    drawGlassCard(
      ctx, x, y, cardW, cardH,
      active ? accent : 'rgba(120, 145, 185, 0.22)',
      active ? 'rgba(24, 33, 52, 0.92)' : 'rgba(12, 16, 25, 0.82)',
    );

    // 顶部流派色条
    if (def) {
      ctx.fillStyle = accent;
      ctx.globalAlpha = active ? 0.95 : 0.4;
      ctx.fillRect(x + 8, y + 1, cardW - 16, 2.5);
      ctx.globalAlpha = 1;
    }

    // 快捷键角标 [1][2][3]
    roundRectPath(ctx, x + 7, y + 8, 17, 17, 4);
    ctx.fillStyle = active ? accent : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.font = '800 11px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = active ? '#0b0e14' : '#9aa7bd';
    ctx.fillText(String(i + 1), x + 15.5, y + 20);

    if (s && def) {
      ctx.textAlign = 'left';
      ctx.font = HUD_BOLD;
      ctx.fillStyle = '#f2f5fb';
      ctx.fillText(def.name, x + 29, y + 20);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#f5c542';
      ctx.font = '11px sans-serif';
      ctx.fillText('★'.repeat(s.star), x + cardW - 8, y + 20);

      // 数值标签 + 资源条
      const gauge = resourceGauge(s.res, def, stats);
      ctx.textAlign = 'left';
      ctx.font = '10px "Inter", "PingFang SC", sans-serif';
      ctx.fillStyle = '#9db0cc';
      ctx.fillText(gauge.label, x + 8, y + 37);

      roundRectPath(ctx, x + 8, y + 43, cardW - 16, 7, 3);
      ctx.fillStyle = 'rgba(5, 8, 14, 0.85)';
      ctx.fill();
      if (gauge.frac > 0) {
        roundRectPath(ctx, x + 9, y + 44, Math.max(3, (cardW - 18) * gauge.frac), 5, 2);
        ctx.fillStyle = gauge.color;
        ctx.fill();
      }
    } else {
      ctx.textAlign = 'left';
      ctx.font = HUD_FONT;
      ctx.fillStyle = '#5e6b82';
      ctx.fillText('空槽位', x + 30, y + 21);
      ctx.font = '10px "Inter", "PingFang SC", sans-serif';
      ctx.fillText('商店购买装备', x + 8, y + 43);
    }
  }

  // [Q] 消耗品快捷卡
  const qx = startX + 3 * (cardW + gap);
  const nextConsId = Object.keys(run.consumables).find(k => (run.consumables[k] ?? 0) > 0);
  const nextCons = nextConsId ? CONSUMABLE_BY_ID[nextConsId] : null;
  const consCount = nextConsId ? run.consumables[nextConsId] ?? 0 : 0;

  drawGlassCard(
    ctx, qx, y, consW, cardH,
    nextCons ? 'rgba(92, 224, 122, 0.45)' : 'rgba(120, 145, 185, 0.2)',
    'rgba(12, 17, 26, 0.84)',
  );
  roundRectPath(ctx, qx + 7, y + 8, 18, 17, 4);
  ctx.fillStyle = nextCons ? '#5ce07a' : 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.font = '800 11px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = nextCons ? '#09150d' : '#7f8da6';
  ctx.fillText('Q', qx + 16, y + 20);

  ctx.textAlign = 'left';
  if (nextCons) {
    ctx.font = HUD_BOLD;
    ctx.fillStyle = '#eef1f7';
    ctx.fillText(nextCons.name, qx + 30, y + 20);
    ctx.font = '11px "Inter", "PingFang SC", sans-serif';
    ctx.fillStyle = '#7ce896';
    ctx.fillText(`库存 ×${consCount}`, qx + 10, y + 44);
  } else {
    ctx.font = HUD_FONT;
    ctx.fillStyle = '#5e6b82';
    ctx.fillText('无道具', qx + 30, y + 20);
    ctx.font = '10px "Inter", "PingFang SC", sans-serif';
    ctx.fillText('R 换弹 · 右键部署', qx + 8, y + 44);
  }
}

function drawGlassCard(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  border: string,
  fill = 'rgba(11, 15, 24, 0.84)',
): void {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function resourceGauge(
  r: { ammo: number; reloading: number; combo: number; charge: number; mana: number; energy: number; overheat: number },
  def: (typeof WEAPON_BY_ID)[string],
  stats: PlayerStats,
): { label: string; frac: number; color: string } {
  if (def.school === 'gun') {
    if (r.reloading > 0) {
      const total = Math.max(0.1, def.reloadTime * stats.reloadMult);
      return {
        label: `换弹中 ${r.reloading.toFixed(1)}s`,
        frac: 1 - Math.min(1, r.reloading / total),
        color: '#ff9f43',
      };
    }
    const cap = Math.max(1, magSize(def, stats));
    return { label: `弹药 ${r.ammo} / ${cap}`, frac: Math.min(1, r.ammo / cap), color: '#f5c542' };
  }
  if (def.school === 'blade') {
    if (def.id === 'chainsaw') {
      return {
        label: `过热 ${Math.round(r.overheat)}%`,
        frac: Math.min(1, r.overheat / 100),
        color: r.overheat > 75 ? '#ef5350' : '#ff7b54',
      };
    }
    const cap = Math.max(1, stats.comboCap);
    return { label: `连击 ${r.combo} / ${cap}`, frac: Math.min(1, r.combo / cap), color: '#ff7b54' };
  }
  if (def.school === 'blunt') {
    const cap = Math.max(0.1, def.chargeMax);
    return {
      label: r.charge > 0 ? `蓄力 ${Math.round((r.charge / cap) * 100)}%` : '按住左键蓄力',
      frac: Math.min(1, r.charge / cap),
      color: '#e85d75',
    };
  }
  if (def.school === 'magic') {
    return { label: `法力 ${Math.round(r.mana)} / 100`, frac: Math.min(1, r.mana / 100), color: '#b78bfa' };
  }
  return { label: `能量 ${Math.round(r.energy)} / 100`, frac: Math.min(1, r.energy / 100), color: '#4fd1ff' };
}
