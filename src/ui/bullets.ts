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
  // 用位置派生火花角度：同一处爆炸形状一致，不引入全局随机
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
  for (const i of list) {
    const fade = 1 - i.t;
    // 扩散环
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = i.color;
    ctx.lineWidth = 2.4 * fade + 0.6;
    ctx.beginPath();
    ctx.arc(i.x, i.y, i.radius * (0.35 + i.t * 0.9), 0, Math.PI * 2);
    ctx.stroke();
    // 放射火花
    ctx.fillStyle = i.color;
    for (let k = 0; k < 6; k++) {
      const a = i.seed + k * (Math.PI / 3);
      const d = i.radius * (0.5 + i.t * 0.8);
      ctx.globalAlpha = fade * 0.9;
      ctx.beginPath();
      ctx.arc(i.x + Math.cos(a) * d, i.y + Math.sin(a) * d, 2 * fade + 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 中心闪光
    ctx.globalAlpha = fade * 0.7;
    ctx.fillStyle = '#fffef8';
    ctx.beginPath(); ctx.arc(i.x, i.y, i.radius * 0.3 * fade, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** 绘制弹幕：外发光 → 加色混合的光束 → 锥形拖尾 → 高光弹头。
 *  全部用矢量绘制，同屏几百发也不会掉帧。 */
export function drawBullets(ctx: CanvasRenderingContext2D, list: Bullet[]): void {
  // afterglow 为 0 表示仍在飞行，>= 1 表示余晖已淡尽；全是淡尽的就无事可做
  const visible = list.filter(b => b.afterglow < 1);
  if (visible.length === 0) return;
  ctx.save();
  // 加色混合让重叠的弹道自然提亮，形成密集弹幕的辉光感
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  for (const b of visible) {
    // 余晖阶段整体淡出，拖尾随之后退，形成“飞过去”的残影
    const fade = b.afterglow > 0 ? Math.max(0, 1 - b.afterglow) : 1;
    if (fade <= 0) continue;
    const trail = b.trail * (0.4 + fade * 0.6);
    const tailX = b.x - b.dx * trail;
    const tailY = b.y - b.dy * trail;

    // 1) 外发光：大半径低透明度圆，柔和地照亮周围
    const halo = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.glow * fade);
    halo.addColorStop(0, b.color);
    halo.addColorStop(0.45, withAlpha(b.color, 0.35));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55 * fade;
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.glow * fade, 0, Math.PI * 2); ctx.fill();

    // 2) 光束：从尾端透明过渡到弹头实色
    const beam = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    beam.addColorStop(0, 'rgba(0,0,0,0)');
    beam.addColorStop(0.55, withAlpha(b.color, 0.5));
    beam.addColorStop(1, b.color);
    ctx.globalAlpha = 0.9 * fade;
    ctx.strokeStyle = beam;
    ctx.lineWidth = b.width * 1.5 * (0.5 + fade * 0.5);
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(b.x, b.y); ctx.stroke();

    // 3) 锥形拖尾：靠近弹头处更粗，收束成一道尖锋
    const tip = 0.32; // 弹头附近这段最亮最粗
    const tipX = b.x - b.dx * trail * tip;
    const tipY = b.y - b.dy * trail * tip;
    const nx = -b.dy, ny = b.dx;
    const halfAt = b.width * 1.15 * fade, halfTail = b.width * 0.18 * fade;
    const cone = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    cone.addColorStop(0, withAlpha(b.color, 0));
    cone.addColorStop(0.4, withAlpha(b.color, 0.45));
    cone.addColorStop(1, withAlpha(b.color, 0.95));
    ctx.fillStyle = cone;
    ctx.globalAlpha = 0.8 * fade;
    ctx.beginPath();
    ctx.moveTo(tailX + nx * halfTail, tailY + ny * halfTail);
    ctx.lineTo(tipX + nx * halfAt, tipY + ny * halfAt);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(tipX - nx * halfAt, tipY - ny * halfAt);
    ctx.lineTo(tailX - nx * halfTail, tailY - ny * halfTail);
    ctx.closePath(); ctx.fill();

    // 4) 弹头：实心光斑 + 近白高光核心
    ctx.globalAlpha = fade;
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.width * fade, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffef8';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.width * 0.5 * fade, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

/** '#rrggbb' → 'rgba(r,g,b,a)'；非 6 位十六进制原样返回（回退为不透明色）。 */
function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
