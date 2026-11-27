import { drawShapes, drawSprite, frameShapes, spriteDrawSize, spriteFrameCount, SPRITES, vectorIdFor } from './sprites';
import { clipFrame, drawRasterFrame, pickClip, rasterFor } from './raster';
import { DEATH_LIFETIME, type Entity, type WeaponDef, type DeathRecord } from '../core/types';

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
}

/** 像素精灵的步态选帧：静止用第 0 帧，行走在其余帧之间交替。
 *  步频固定，不与移动速度耦合，避免速度一变动作就失真。 */
function walkFrame(id: string, p: PoseOpts): number {
  const n = spriteFrameCount(id);
  if (n <= 1 || !p.moving) return 0;
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

  const bob = p.moving ? (frame % 2 === 0 ? 0 : -1) : 0;
  const recoil = p.hit > 0 ? -Math.round(p.hit * 2) : 0;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.scale(k, k);
  ctx.translate(Math.round(recoil), Math.round(bob));
  drawShapes(ctx, shapes, sp.view);
  ctx.restore();
}

/** 脚底接触阴影 + 精英/Boss/玩家脚底识别圈，彻底消除贴图“浮空感”。 */
function drawGroundAnchor(ctx: CanvasRenderingContext2D, e: Entity, size: number, time: number): void {
  const footY = e.y + size * 0.34;
  const rx = Math.max(10, size * 0.27);
  const ry = Math.max(4, rx * 0.42);

  ctx.save();
  // 接触阴影
  ctx.fillStyle = 'rgba(4, 6, 12, 0.52)';
  ctx.beginPath();
  ctx.ellipse(e.x, footY, rx, ry, 0, 0, TAU);
  ctx.fill();

  // 玩家青色脚底光环 / Boss 暗红压迫环 / 精英紫金识别环
  if (e.id === 1) {
    ctx.strokeStyle = 'rgba(79, 209, 255, 0.42)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(e.x, footY, rx + 3, ry + 1.5, 0, 0, TAU);
    ctx.stroke();
  } else if (e.tags.includes('boss')) {
    const pulse = 0.5 + Math.sin(time * 5) * 0.5;
    ctx.strokeStyle = `rgba(255, 76, 76, ${(0.38 + pulse * 0.35).toFixed(2)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(e.x, footY, rx + 5 + pulse * 3, ry + 2.5 + pulse, 0, 0, TAU);
    ctx.stroke();
  } else if (e.tags.includes('priority') || e.tags.includes('armored')) {
    ctx.strokeStyle = 'rgba(245, 197, 66, 0.38)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(e.x, footY, rx + 2.5, ry + 1.2, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** 单层实体的全部程序化动作：接触阴影、朝向翻转、步态、攻击前扑、
 *  受击后仰、状态特效、无人机悬浮；玩家额外绘制手持武器与攻击特效。 */
export function drawEntity(ctx: CanvasRenderingContext2D, e: Entity, time: number,
  player?: PlayerAnim): void {
  const id = e.kind;
  const atk = atkPhase(e);
  const lunge = atk > 0 ? Math.round(atk * 5) : 0;
  const moving = (e.data['moving'] ?? 0) > 0;
  const walk = e.data['walk'] ?? 0;
  const hover = id === 'drone' ? Math.round(5 + Math.sin(time * 3.5 + e.id) * 2.5) : 0;
  const hitT = e.data['hitT'] ?? 0;
  const hit = Math.min(1, hitT / 0.22);
  const size = spriteDrawSize(id);
  const atkT = e.data['atkT'] ?? 0;
  const atkDur = e.data['atkDur'] ?? 0.3;

  drawGroundAnchor(ctx, e, size, time);

  // 受击微颤偏移
  const jitterX = hit > 0.3 ? Math.round(Math.sin(time * 90 + e.id) * 2 * hit) : 0;

  const sheet = rasterFor(id);
  if (sheet) {
    const clip = pickClip({ dead: e.dead, hitT, atkT, moving });
    const phase = clip === 'attack' ? Math.max(0, 1 - atkT / Math.max(0.01, atkDur))
      : clip === 'walk' ? walk : 0;
    const frame = clipFrame(sheet, clip, phase);
    const bob = clip === 'idle' ? (Math.sin(time * 4 + e.id) > 0 ? -1 : 0) : 0;
    // 大号敌人（屠夫/尸潮之母）的碰撞半径更大，绘制尺寸必须跟上，否则贴图小于判定框
    drawRasterFrame(ctx, sheet, frame,
      e.x + Math.cos(e.facing) * lunge + jitterX, e.y - hover + bob,
      size, Math.cos(e.facing) < 0);
  } else {
    ctx.save();
    ctx.translate(Math.round(e.x + Math.cos(e.facing) * lunge + jitterX), Math.round(e.y - hover));
    if (Math.cos(e.facing) < 0) ctx.scale(-1, 1);
    drawPosedSprite(ctx, id, size, { walk, moving, atk, hit, time, id: e.id });
    ctx.restore();
  }

  drawStatuses(ctx, e, time, id);

  if (hitT > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = hit * 0.42;
    ctx.fillStyle = hit > 0.65 ? '#fff3e0' : '#ff5244';
    circle(ctx, e.x, e.y - hover, Math.max(11, size * 0.34));
    ctx.restore();
  }
  if (player) drawPlayerWeapon(ctx, e, player, time);
}

/** 死亡特效：独立于实体列表，绘制 0.8 秒后淡出。 */
export function drawDeath(ctx: CanvasRenderingContext2D, d: DeathRecord): void {
  const alpha = Math.max(0, 1 - d.t / DEATH_LIFETIME);
  if (alpha <= 0) return;
  const size = spriteDrawSize(d.kind);
  const sheet = rasterFor(d.kind);
  const flip = Math.cos(d.facing) < 0;
  ctx.save();
  ctx.globalAlpha = alpha * 0.45;
  ctx.fillStyle = '#07090f';
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + size * 0.28, size * 0.3, size * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;
  if (sheet) {
    const frame = sheet.clips.death[0] ?? 0;
    drawRasterFrame(ctx, sheet, frame, d.x, d.y, size, flip);
  } else {
    // 矢量回退：drawSprite 不带翻转，这里补上朝向
    ctx.save();
    ctx.translate(Math.round(d.x), Math.round(d.y));
    if (flip) ctx.scale(-1, 1);
    drawSprite(ctx, vectorIdFor(d.kind), 0, 0, 1, 0);
    ctx.restore();
  }
  ctx.restore();
}

// ── 状态特效 ────────────────────────────────────────────────
function drawStatuses(ctx: CanvasRenderingContext2D, e: Entity, time: number,
  id: string): void {
  const r = Math.max(11, spriteDrawSize(id) * 0.36);
  for (const st of e.statuses) {
    if (st.id === 'burn') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const flicker = Math.abs(Math.sin(time * 13 + e.id + i * 2.1));
        ctx.globalAlpha = 0.4 + flicker * 0.4;
        ctx.fillStyle = i === 0 ? '#ffe066' : '#ff6b35';
        circle(ctx, e.x + Math.sin(time * 7 + i * 2.1) * r * 0.55,
          e.y + r * 0.45 - flicker * 8, 2.5 + flicker * 1.4);
      }
      ctx.restore();
    } else if (st.id === 'poison') {
      ctx.fillStyle = '#84d86a';
      for (let i = 0; i < 3; i++) {
        const t = (time * 1.5 + i / 3) % 1;
        ctx.globalAlpha = (1 - t) * 0.6;
        circle(ctx, e.x + Math.sin(e.id + i * 2.4) * r * 0.55, e.y + r * 0.35 - t * 14, 2.4);
      }
    } else if (st.id === 'chill' || st.id === 'freeze') {
      ctx.globalAlpha = st.id === 'freeze' ? 0.38 : 0.18;
      ctx.fillStyle = '#7ad7ff';
      circle(ctx, e.x, e.y, r + 2);
      if (st.id === 'freeze') {
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#e6f7ff';
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(e.x, e.y, r + 2, 0, TAU); ctx.stroke();
      }
    } else if (st.id === 'shock') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) {
        const a = time * 14 + i * (TAU / 3);
        const rr = r * (0.65 + Math.abs(Math.sin(time * 11 + i)) * 0.38);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
        ctx.lineTo(e.x + Math.cos(a + 0.18) * (rr + 4), e.y + Math.sin(a + 0.18) * (rr + 4));
        ctx.lineTo(e.x + Math.cos(a) * (rr + 7), e.y + Math.sin(a) * (rr + 7));
        ctx.stroke();
      }
      ctx.restore();
    } else if (st.id === 'stun') {
      ctx.fillStyle = '#ffd24a';
      for (let i = 0; i < 3; i++) {
        const a = time * 6.5 + i * (TAU / 3);
        ctx.globalAlpha = 0.9;
        circle(ctx, e.x + Math.cos(a) * 8, e.y - r - 6 + Math.sin(a) * 2.5, 2.1);
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

  // 钝器蓄力光环：外圈进度弧 + 脉冲内核
  if (anim.charging && anim.chargeFrac > 0) {
    const t = Math.min(1, anim.chargeFrac);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 + t * 0.22;
    ctx.fillStyle = t >= 1 ? '#ff6b35' : '#ffd24a';
    circle(ctx, e.x, e.y, 13 + t * 18 + Math.sin(time * 12) * 1.5);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = t >= 1 ? '#ff7b4a' : '#ffe066';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 20 + t * 8, -Math.PI / 2, -Math.PI / 2 + TAU * t);
    ctx.stroke();
    ctx.restore();
  }

  // 手持武器：随朝向旋转。像素图用最近邻旋转（关平滑）保持硬边。
  ctx.save();
  const recoilDist = def.school === 'gun' && phase > 0 ? -phase * 3.5 : 0;
  ctx.translate(e.x + Math.cos(a) * (13 + recoilDist), e.y + Math.sin(a) * (13 + recoilDist));
  let rot = a - Math.PI / 4; // 武器像素图刀刃朝右上，归一到持握角
  if (melee && phase > 0) rot += (1 - phase) * 1.85 - 0.92;
  ctx.rotate(rot);
  drawSpriteRotated(ctx, def.sprite);
  ctx.restore();

  // 近战挥砍月牙刀光（多层加色弯弧）
  if (melee && phase > 0) {
    const t = 1 - phase;
    const outerR = def.range * 0.86;
    const sweepStart = a - 0.95 + t * 1.05;
    const sweepEnd = sweepStart + 0.72;
    const color = def.school === 'blunt' ? '#ff9466' : '#ffe9a8';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - t) * 0.22;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.arc(e.x, e.y, outerR, sweepStart, sweepEnd);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = (1 - t) * 0.85;
    ctx.strokeStyle = '#fff9df';
    ctx.lineWidth = 4.5 * (1 - t * 0.5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(e.x, e.y, outerR - 2, sweepStart, sweepEnd);
    ctx.stroke();
    ctx.restore();
  }

  // 枪口火光：定向炽热焰锥 + 星芒
  if (def.school === 'gun' && phase > 0) {
    const bx = e.x + Math.cos(a) * 28, by = e.y + Math.sin(a) * 28;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(bx, by);
    ctx.rotate(a);
    ctx.globalAlpha = phase * 0.92;
    ctx.fillStyle = '#ffae38';
    ctx.beginPath();
    ctx.moveTo(0, -5 * phase);
    ctx.lineTo(15 * phase, 0);
    ctx.lineTo(0, 5 * phase);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fffef0';
    ctx.beginPath();
    ctx.arc(2, 0, 3.8 * phase, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  // 施法扩散环（颜色跟元素走）
  if (def.school === 'magic' && phase > 0) {
    const t = 1 - Math.min(1, atkPhase(e));
    const col = def.element === 'ice' ? '#8fdcff'
      : def.element === 'lightning' ? '#ffe066' : '#ff6b35';
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - t) * 0.65;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.2 * (1 - t * 0.5);
    ctx.beginPath(); ctx.arc(e.x, e.y, 10 + t * 28, 0, TAU); ctx.stroke();
    ctx.restore();
  }
}

/** 手持武器：在已旋转的世界坐标里画像素图。 */
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
