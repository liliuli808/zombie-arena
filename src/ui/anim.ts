import { drawShapes, drawSprite, frameShapes, spriteDrawSize, spriteFrameCount, SPRITES, vectorIdFor } from './sprites';
import { clipFrame, drawRasterFrame, pickClip, rasterFor } from './raster';
import type { Entity, WeaponDef } from '../core/types';

export interface PlayerAnim {
  weapon: WeaponDef;
  /** 钝器正在蓄力（显示蓄力光环） */
  charging: boolean;
  /** 蓄力进度 0..1 */
  chargeFrac: number;
}

const TAU = Math.PI * 2;

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}

/** 攻击动作归一化进度：1 → 0 随 atkT 衰减 */
function atkPhase(e: Entity): number {
  const dur = e.data['atkDur'] ?? 0.3;
  return Math.min(1, (e.data['atkT'] ?? 0) / Math.max(0.01, dur));
}

interface PoseOpts {
  /** 行走相位（秒），驱动步态选帧 */
  walk: number;
  moving: boolean;
  /** 攻击进度 1→0 */
  atk: number;
  /** 受击进度 1→0 */
  hit: number;
  time: number;
  id: number;
  atkDur: number;
}

/** 像素精灵的步态选帧：静止用第 0 帧，行走在其余帧之间交替。
 *  步频固定，不与移动速度耦合，避免速度一变动作就失真。 */
function walkFrame(id: string, p: PoseOpts): number {
  const n = spriteFrameCount(id);
  if (n <= 1 || !p.moving) return 0;
  // 每秒约 6 步，两帧交替
  return 1 + (Math.floor(p.walk * 6) % (n - 1));
}

/** 绘制一帧精灵：整体位移按整数取整 + 受击后仰，
 *  保证像素对齐（亚像素平移会让放大后的像素边缘发虚）。 */
function drawPosedSprite(ctx: CanvasRenderingContext2D, id: string, size: number,
  p: PoseOpts): void {
  const vid = vectorIdFor(id);
  const sp = SPRITES[vid] ?? SPRITES['walker'];
  const k = size / sp.view;
  const frame = walkFrame(vid, p);
  const shapes = frameShapes(vid, frame);

  // 步态起伏：只在行走时抖 1 像素，静止不抖
  const bob = p.moving ? (frame % 2 === 0 ? 0 : -1) : 0;
  const recoil = p.hit > 0 ? -Math.round(p.hit * 2) : 0;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(k, k);
  ctx.translate(Math.round(recoil), Math.round(bob));
  drawShapes(ctx, shapes, sp.view);
  ctx.restore();
}

/** 单层实体的全部程序化动作：朝向翻转、步态、攻击前扑、
 *  受击后仰、状态特效、无人机悬浮；玩家额外绘制手持武器与攻击特效。 */
export function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, time: number,
  player?: PlayerAnim): void {
  const id = e.kind;
  const atk = atkPhase(e);
  const lunge = atk > 0 ? Math.round(atk * 5) : 0;
  const moving = (e.data['moving'] ?? 0) > 0;
  const walk = e.data['walk'] ?? 0;
  const hover = id === 'drone' ? Math.round(4 + Math.sin(time * 3 + e.id) * 2.5) : 0;
  const hitT = e.data['hitT'] ?? 0;
  const hit = Math.min(1, hitT / 0.22);
  const size = spriteDrawSize(id);
  const atkT = e.data['atkT'] ?? 0;
  const atkDur = e.data['atkDur'] ?? 0.3;

  const sheet = rasterFor(id);
  if (sheet) {
    const clip = pickClip({ dead: e.dead, hitT, atkT, moving });
    const phase = clip === 'attack' ? 1 - atkT / Math.max(0.01, atkDur)
      : clip === 'walk' ? walk : 0;
    const frame = clipFrame(sheet, clip, phase);
    const bob = clip === 'idle' ? (Math.sin(time * 4 + e.id) > 0 ? -1 : 0) : 0;
    drawRasterFrame(ctx, sheet, frame,
      e.x + Math.cos(e.facing) * lunge, e.y - hover + bob,
      size, Math.cos(e.facing) < 0);
  } else {
    ctx.save();
    ctx.translate(Math.round(e.x + Math.cos(e.facing) * lunge), Math.round(e.y - hover));
    if (Math.cos(e.facing) < 0) ctx.scale(-1, 1);
    drawPosedSprite(ctx, id, size, { walk, moving, atk, hit, time, id: e.id, atkDur });
    ctx.restore();
  }

  drawStatuses(ctx, e, time, id);

  if (hitT > 0) {
    ctx.globalAlpha = hit * 0.45;
    ctx.fillStyle = '#ff5040';
    circle(ctx, e.x, e.y, Math.max(12, size * 0.38));
    ctx.globalAlpha = 1;
  }
  if (player) drawPlayerWeapon(ctx, e, player, time);
}

/** 死亡特效：独立于实体列表，绘制 0.8 秒后淡出。 */
export function drawDeath(ctx: CanvasRenderingContext2D,
  d: { kind: string; x: number; y: number; facing: number; t: number }): void {
  const alpha = Math.max(0, 1 - d.t / 0.8);
  if (alpha <= 0) return;
  const size = spriteDrawSize(d.kind);
  const sheet = rasterFor(d.kind);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (sheet) {
    const frame = sheet.clips.death[0] ?? 8;
    drawRasterFrame(ctx, sheet, frame, d.x, d.y, size, Math.cos(d.facing) < 0);
  } else {
    drawSprite(ctx, vectorIdFor(d.kind), d.x, d.y, 1, 0);
  }
  ctx.restore();
}

// ── 状态特效 ────────────────────────────────────────────────
function drawStatuses(ctx: CanvasRenderingContext2D, e: Entity, time: number,
  id: string): void {
  const r = Math.max(11, spriteDrawSize(id) * 0.36);
  for (const st of e.statuses) {
    if (st.id === 'burn') {
      ctx.fillStyle = '#ff6b35';
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.35 + Math.abs(Math.sin(time * 14 + e.id + i * 2.1)) * 0.35;
        circle(ctx, e.x + Math.sin(time * 7 + i * 2.1) * r * 0.55,
          e.y + r * 0.5 - Math.abs(Math.sin(time * 9 + i)) * 5, 3);
      }
    } else if (st.id === 'poison') {
      ctx.fillStyle = '#84d86a';
      for (let i = 0; i < 3; i++) {
        const t = (time * 1.4 + i / 3) % 1;
        ctx.globalAlpha = (1 - t) * 0.5;
        circle(ctx, e.x + Math.sin(e.id + i * 2.4) * r * 0.5, e.y + r * 0.4 - t * 12, 2.5);
      }
    } else if (st.id === 'chill' || st.id === 'freeze') {
      ctx.globalAlpha = st.id === 'freeze' ? 0.4 : 0.2;
      ctx.fillStyle = '#8fdcff';
      circle(ctx, e.x, e.y, r + 2);
      if (st.id === 'freeze') {
        ctx.globalAlpha = 0.8; ctx.strokeStyle = '#eaf6ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(e.x, e.y, r + 2, 0, TAU); ctx.stroke();
      }
    } else if (st.id === 'shock') {
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const a = time * 12 + i * (TAU / 3);
        const rr = r * (0.7 + Math.abs(Math.sin(time * 10 + i)) * 0.4);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
        ctx.lineTo(e.x + Math.cos(a) * (rr + 5), e.y + Math.sin(a) * (rr + 5));
        ctx.stroke();
      }
    } else if (st.id === 'stun') {
      ctx.fillStyle = '#ffd24a';
      for (let i = 0; i < 2; i++) {
        const a = time * 6 + i * Math.PI;
        ctx.globalAlpha = 0.85;
        circle(ctx, e.x + Math.cos(a) * 7, e.y - r - 6 + Math.sin(a) * 2.5, 2);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ── 玩家：手持武器 + 攻击特效 ───────────────────────────────
function drawPlayerWeapon(ctx: CanvasRenderingContext2D, e: Entity,
  anim: PlayerAnim, time: number): void {
  const a = e.facing;
  const def = anim.weapon;
  const phase = atkPhase(e);
  const melee = def.school === 'blade' || def.school === 'blunt';

  // 钝器蓄力光环：随蓄力进度变大变红
  if (anim.charging && anim.chargeFrac > 0) {
    const t = Math.min(1, anim.chargeFrac);
    ctx.globalAlpha = 0.18 + t * 0.28;
    ctx.fillStyle = t >= 1 ? '#ff6b35' : '#ffd24a';
    circle(ctx, e.x, e.y, 12 + t * 20 + Math.sin(time * 10) * 1.5);
    ctx.globalAlpha = 1;
  }

  // 手持武器：随朝向旋转。像素图用最近邻旋转（关平滑）保持硬边。
  ctx.save();
  ctx.translate(e.x + Math.cos(a) * 13, e.y + Math.sin(a) * 13);
  let rot = a - Math.PI / 4; // 武器像素图刀刃朝右上，归一到持握角
  if (melee && phase > 0) rot += (1 - phase) * 1.7 - 0.85;
  ctx.rotate(rot);
  drawSpriteRotated(ctx, def.sprite);
  ctx.restore();

  // 近战挥砍扫弧（世界坐标扇形）
  if (melee && phase > 0) {
    const t = 1 - phase;
    ctx.globalAlpha = (1 - t) * 0.35;
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    const sweep = 0.55;
    ctx.arc(e.x, e.y, def.range * 0.8, a - 0.9 + t * 1.2, a - 0.9 + t * 1.2 + sweep);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 枪口火光
  if (def.school === 'gun' && phase > 0) {
    const bx = e.x + Math.cos(a) * 30, by = e.y + Math.sin(a) * 30;
    ctx.globalAlpha = phase;
    ctx.fillStyle = '#ffe066';
    ctx.save();
    ctx.translate(bx, by); ctx.rotate(a);
    for (let i = 0; i < 4; i++) { // 十字火花
      ctx.fillRect(-1, -6, 2, 12);
      ctx.rotate(Math.PI / 4);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 施法扩散环（颜色跟元素走）
  if (def.school === 'magic' && phase > 0) {
    const t = 1 - Math.min(1, (e.data['atkT'] ?? 0) / 0.2);
    ctx.globalAlpha = (1 - t) * 0.5;
    ctx.strokeStyle = def.element === 'ice' ? '#8fdcff'
      : def.element === 'lightning' ? '#ffe066' : '#ff6b35';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(e.x, e.y, 10 + t * 26, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** 手持武器：在已旋转的世界坐标里画像素图。像素画旋转本会失真，
 *  这里用 1.4 倍超采样尺寸绘制并关平滑，让旋转后仍保留方块感。 */
function drawSpriteRotated(ctx: CanvasRenderingContext2D, id: string): void {
  const sp = SPRITES[id] ?? SPRITES['knife'];
  const size = spriteDrawSize(id) * 0.62;
  const k = size / sp.view;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(k, k);
  drawShapes(ctx, frameShapes(id, 0), sp.view);
  ctx.restore();
}
