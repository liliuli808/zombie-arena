import type { Bullet } from '../game/bullets';

/** 命中爆裂：短命的扩散环 + 放射火花，让每一发子弹都有打击反馈。 */
export interface Impact {
  x: number; y: number;
  /** 0 → 1 的生命进度 */
  t: number;
  life: number;
  color: string;
  /** 爆裂半径 */
  radius: number;
  /** 放射火花的方向种子，决定每次炸开的形状 */
  seed: number;
}

export function spawnImpact(x: number, y: number, color: string, radius = 18): Impact {
  const seed = (x * 0.37 + y * 0.71) % (Math.PI * 2);
  return { x, y, t: 0, life: 0.28, color, radius, seed };
}

export function tickImpacts(list: Impact[], dt: number): Impact[] {
  const alive: Impact[] = [];
  for (const i of list) {
    i.t += dt / i.life;
    if (i.t < 1) alive.push(i);
  }
  return alive;
}

export function drawImpacts(ctx: CanvasRenderingContext2D, list: Impact[]): void {
  if (list.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const i of list) {
    const fade = 1 - i.t;
    const ease = 1 - fade * fade;
    // 外扩散环
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = i.color;
    ctx.lineWidth = 2.6 * fade + 0.6;
    ctx.beginPath();
    ctx.arc(i.x, i.y, i.radius * (0.3 + ease * 0.95), 0, Math.PI * 2);
    ctx.stroke();

    // 放射尖锐火花线条
    ctx.strokeStyle = i.color;
    ctx.lineWidth = 1.8 * fade + 0.5;
    for (let k = 0; k < 6; k++) {
      const a = i.seed + k * (Math.PI / 3);
      const d0 = i.radius * (0.28 + ease * 0.55);
      const d1 = d0 + i.radius * 0.36 * fade;
      ctx.globalAlpha = fade * 0.92;
      ctx.beginPath();
      ctx.moveTo(i.x + Math.cos(a) * d0, i.y + Math.sin(a) * d0);
      ctx.lineTo(i.x + Math.cos(a) * d1, i.y + Math.sin(a) * d1);
      ctx.stroke();
    }

    // 中心炽白闪光
    ctx.globalAlpha = fade * 0.8;
    ctx.fillStyle = '#fffef8';
    ctx.beginPath(); ctx.arc(i.x, i.y, i.radius * 0.34 * fade, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** 绘制弹幕：外发光 → 加色混合的光束 → 锥形拖尾 → 高光弹头。
 *  全部用矢量绘制，同屏几百发也不会掉帧。 */
export function drawBullets(ctx: CanvasRenderingContext2D, list: Bullet[]): void {
  const visible = list.filter(b => b.afterglow < 1);
  if (visible.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (const b of visible) {
    const fade = b.afterglow > 0 ? Math.max(0, 1 - b.afterglow) : 1;
    if (fade <= 0) continue;
    const trail = b.trail * (0.42 + fade * 0.58);
    const tailX = b.x - b.dx * trail;
    const tailY = b.y - b.dy * trail;

    // 1) 外发光
    const haloR = Math.max(1, b.glow * 1.15 * fade);
    const halo = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, haloR);
    if (halo && typeof halo.addColorStop === 'function') {
      halo.addColorStop(0, b.color);
      halo.addColorStop(0.45, withAlpha(b.color, 0.35));
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
    } else {
      ctx.fillStyle = b.color;
    }
    ctx.globalAlpha = 0.58 * fade;
    ctx.beginPath(); ctx.arc(b.x, b.y, haloR, 0, Math.PI * 2); ctx.fill();

    // 2) 光束
    const beam = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    if (beam && typeof beam.addColorStop === 'function') {
      beam.addColorStop(0, 'rgba(0,0,0,0)');
      beam.addColorStop(0.55, withAlpha(b.color, 0.55));
      beam.addColorStop(1, b.color);
      ctx.strokeStyle = beam;
    } else {
      ctx.strokeStyle = b.color;
    }
    ctx.globalAlpha = 0.92 * fade;
    ctx.lineWidth = b.width * 1.6 * (0.5 + fade * 0.5);
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(b.x, b.y); ctx.stroke();

    // 3) 锥形拖尾
    const tip = 0.34;
    const tipX = b.x - b.dx * trail * tip;
    const tipY = b.y - b.dy * trail * tip;
    const nx = -b.dy, ny = b.dx;
    const halfAt = b.width * 1.15 * fade, halfTail = b.width * 0.16 * fade;
    const cone = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    if (cone && typeof cone.addColorStop === 'function') {
      cone.addColorStop(0, withAlpha(b.color, 0));
      cone.addColorStop(0.45, withAlpha(b.color, 0.48));
      cone.addColorStop(1, withAlpha('#fffef8', 0.95));
      ctx.fillStyle = cone;
    } else {
      ctx.fillStyle = b.color;
    }
    ctx.globalAlpha = 0.82 * fade;
    ctx.beginPath();
    ctx.moveTo(tailX + nx * halfTail, tailY + ny * halfTail);
    ctx.lineTo(tipX + nx * halfAt, tipY + ny * halfAt);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(tipX - nx * halfAt, tipY - ny * halfAt);
    ctx.lineTo(tailX - nx * halfTail, tailY - ny * halfTail);
    ctx.closePath(); ctx.fill();

    // 4) 弹头高光核心
    ctx.globalAlpha = fade;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.width * fade, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffef8';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.width * 0.55 * fade, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

/** '#rrggbb' → 'rgba(r,g,b,a)'；非 6 位十六进制原样返回。 */
function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
