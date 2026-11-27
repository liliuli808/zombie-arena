import type { WeatherId } from '../core/types';
import { GAME_W, GAME_H } from '../core/constants';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  drag: number;
  glow?: boolean;
}

export interface Shockwave {
  x: number;
  y: number;
  r0: number;
  r1: number;
  color: string;
  lineWidth: number;
  t: number;
  life: number;
}

export interface FlashLight {
  x: number;
  y: number;
  radius: number;
  color: string;
  t: number;
  life: number;
}

export interface GroundDecal {
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface VfxState {
  particles: Particle[];
  shockwaves: Shockwave[];
  flashes: FlashLight[];
  decals: GroundDecal[];
  shake: number;
  hurtFlash: number;
  lightning: number;
  clock: number;
  seq: number;
}

export function createVfx(): VfxState {
  return {
    particles: [],
    shockwaves: [],
    flashes: [],
    decals: [],
    shake: 0,
    hurtFlash: 0,
    lightning: 0,
    clock: 0,
    seq: 1,
  };
}

export function resetVfx(vfx: VfxState): void {
  vfx.particles.length = 0;
  vfx.shockwaves.length = 0;
  vfx.flashes.length = 0;
  vfx.decals.length = 0;
  vfx.shake = 0;
  vfx.hurtFlash = 0;
  vfx.lightning = 0;
}

function nextRand(vfx: VfxState): number {
  vfx.seq = (vfx.seq * 1664525 + 1013904223) >>> 0;
  return vfx.seq / 4294967296;
}

export function addShake(vfx: VfxState, amount: number): void {
  vfx.shake = Math.min(12, Math.max(vfx.shake, amount));
}

export function triggerHurtFlash(vfx: VfxState, intensity = 0.75): void {
  vfx.hurtFlash = Math.min(1, Math.max(vfx.hurtFlash, intensity));
  addShake(vfx, 5.5);
}

export function getShakeOffset(vfx: VfxState | undefined): { x: number; y: number } {
  if (!vfx || vfx.shake <= 0.15) return { x: 0, y: 0 };
  const s = vfx.shake;
  return {
    x: Math.round(Math.sin(vfx.clock * 73.1) * s),
    y: Math.round(Math.cos(vfx.clock * 91.7) * s),
  };
}

export function spawnBurst(
  vfx: VfxState,
  x: number,
  y: number,
  color: string,
  count: number,
  opts: {
    speedMin?: number;
    speedMax?: number;
    sizeMin?: number;
    sizeMax?: number;
    life?: number;
    angle?: number;
    spread?: number;
    glow?: boolean;
  } = {},
): void {
  const speedMin = opts.speedMin ?? 45;
  const speedMax = opts.speedMax ?? 165;
  const sizeMin = opts.sizeMin ?? 2;
  const sizeMax = opts.sizeMax ?? 4.5;
  const baseLife = opts.life ?? 0.35;
  const spread = opts.spread ?? Math.PI * 2;
  const baseAngle = opts.angle ?? 0;

  for (let i = 0; i < count; i++) {
    if (vfx.particles.length >= 260) vfx.particles.shift();
    const a = opts.angle === undefined
      ? nextRand(vfx) * Math.PI * 2
      : baseAngle + (nextRand(vfx) - 0.5) * spread;
    const sp = speedMin + nextRand(vfx) * (speedMax - speedMin);
    const life = baseLife * (0.65 + nextRand(vfx) * 0.7);
    vfx.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      size: sizeMin + nextRand(vfx) * (sizeMax - sizeMin),
      color,
      life,
      maxLife: life,
      drag: 0.9,
      glow: opts.glow,
    });
  }
}

export function spawnShockwave(
  vfx: VfxState,
  x: number,
  y: number,
  r0: number,
  r1: number,
  color: string,
  life = 0.28,
  lineWidth = 3,
): void {
  if (vfx.shockwaves.length >= 24) vfx.shockwaves.shift();
  vfx.shockwaves.push({ x, y, r0, r1, color, lineWidth, t: 0, life });
}

export function spawnMuzzleFlash(
  vfx: VfxState,
  x: number,
  y: number,
  color: string,
  radius = 46,
  life = 0.1,
): void {
  if (vfx.flashes.length >= 16) vfx.flashes.shift();
  vfx.flashes.push({ x, y, radius, color, t: 0, life });
}

export function spawnDecal(
  vfx: VfxState,
  x: number,
  y: number,
  rx: number,
  color: string,
  alpha = 0.38,
  life = 14,
): void {
  if (vfx.decals.length >= 64) vfx.decals.shift();
  const angle = nextRand(vfx) * Math.PI;
  const ry = rx * (0.55 + nextRand(vfx) * 0.35);
  vfx.decals.push({ x, y, rx, ry, angle, color, alpha, life, maxLife: life });
}

export function tickVfx(vfx: VfxState, dt: number, weather: WeatherId): void {
  vfx.clock += dt;
  vfx.shake = Math.max(0, vfx.shake - dt * 28);
  vfx.hurtFlash = Math.max(0, vfx.hurtFlash - dt * 2.4);
  vfx.lightning = Math.max(0, vfx.lightning - dt * 4.5);

  if (weather === 'rain' && nextRand(vfx) < dt * 0.22) {
    vfx.lightning = 0.55;
  }

  for (let i = vfx.particles.length - 1; i >= 0; i--) {
    const p = vfx.particles[i]!;
    p.life -= dt;
    if (p.life <= 0) {
      vfx.particles.splice(i, 1);
      continue;
    }
    const damp = Math.pow(p.drag, dt * 60);
    p.vx *= damp;
    p.vy *= damp;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  for (let i = vfx.shockwaves.length - 1; i >= 0; i--) {
    const s = vfx.shockwaves[i]!;
    s.t += dt / s.life;
    if (s.t >= 1) vfx.shockwaves.splice(i, 1);
  }

  for (let i = vfx.flashes.length - 1; i >= 0; i--) {
    const f = vfx.flashes[i]!;
    f.t += dt / f.life;
    if (f.t >= 1) vfx.flashes.splice(i, 1);
  }

  for (let i = vfx.decals.length - 1; i >= 0; i--) {
    const d = vfx.decals[i]!;
    d.life -= dt;
    if (d.life <= 0) vfx.decals.splice(i, 1);
  }
}

export function drawDecals(ctx: CanvasRenderingContext2D, vfx: VfxState | undefined): void {
  if (!vfx || vfx.decals.length === 0) return;
  ctx.save();
  for (const d of vfx.decals) {
    const fade = Math.min(1, d.life / Math.min(3, d.maxLife));
    ctx.globalAlpha = d.alpha * fade;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.rx, d.ry, d.angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawVfxBack(ctx: CanvasRenderingContext2D, vfx: VfxState | undefined): void {
  if (!vfx || vfx.shockwaves.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of vfx.shockwaves) {
    const ease = 1 - Math.pow(1 - s.t, 2);
    const r = s.r0 + (s.r1 - s.r0) * ease;
    const fade = 1 - s.t;
    ctx.globalAlpha = fade * 0.72;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = Math.max(1, s.lineWidth * fade);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawVfxFront(ctx: CanvasRenderingContext2D, vfx: VfxState | undefined): void {
  if (!vfx) return;
  if (vfx.flashes.length > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of vfx.flashes) {
      const fade = 1 - f.t;
      const r = f.radius * (0.75 + f.t * 0.45);
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      if (g && typeof g.addColorStop === 'function') {
        g.addColorStop(0, f.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = f.color;
      }
      ctx.globalAlpha = fade * 0.48;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (vfx.particles.length > 0) {
    ctx.save();
    for (const p of vfx.particles) {
      const fade = Math.max(0, p.life / p.maxLife);
      ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
      ctx.globalAlpha = fade * (p.glow ? 0.9 : 0.85);
      ctx.fillStyle = p.color;
      const sz = Math.max(1.2, p.size * (0.45 + fade * 0.55));
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    }
    ctx.restore();
  }
}

export function drawWeatherFx(
  ctx: CanvasRenderingContext2D,
  weather: WeatherId,
  time: number,
  vfx?: VfxState,
): void {
  if (weather === 'rain') {
    ctx.save();
    ctx.fillStyle = 'rgba(22, 42, 74, 0.14)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.strokeStyle = 'rgba(162, 214, 255, 0.34)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 64; i++) {
      const sx = ((i * 97.3 + time * 260) % (GAME_W + 80)) - 40;
      const sy = ((i * 61.7 + time * 720) % (GAME_H + 60)) - 30;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 6, sy + 18);
    }
    ctx.stroke();
    if (vfx && vfx.lightning > 0.02) {
      ctx.fillStyle = `rgba(210, 238, 255, ${(vfx.lightning * 0.28).toFixed(3)})`;
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }
    ctx.restore();
  } else if (weather === 'fire') {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 92, 28, 0.07)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 28; i++) {
      const ex = (i * 83.1 + Math.sin(time * 1.6 + i) * 32 + GAME_W) % GAME_W;
      const ey = (GAME_H - ((i * 49.7 + time * (32 + (i % 5) * 9)) % (GAME_H + 20)));
      const a = 0.25 + Math.abs(Math.sin(time * 4 + i * 1.7)) * 0.55;
      ctx.globalAlpha = a;
      ctx.fillStyle = i % 2 === 0 ? '#ffb84d' : '#ff6b35';
      ctx.fillRect(ex, ey, 2.5, 2.5);
    }
    ctx.restore();
  } else if (weather === 'fog') {
    ctx.save();
    for (let i = 0; i < 24; i++) {
      const fx = (i * 113.7 + time * 14) % GAME_W;
      const fy = (i * 67.3 + Math.sin(time + i) * 18 + GAME_H) % GAME_H;
      ctx.globalAlpha = 0.16 + Math.abs(Math.sin(time * 1.8 + i)) * 0.2;
      ctx.fillStyle = '#8ce86d';
      ctx.beginPath();
      ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
