import type { SpriteArt } from './vector';

/** 骨架规格：所有数值都是 48 网格内的像素坐标，y 越小越靠上。 */
export interface Rig {
  hip: [number, number];
  neck: [number, number];
  head: [number, number];
  headR: number;
  torsoTop: number;
  torsoBottom: number;
  /** 肩宽 / 髋宽（像素）。 */
  shoulderW: number;
  hipW: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  /** 四肢粗细。 */
  armW: number;
  legW: number;
}

/** 骨架定义的调色板：每个材质三阶（亮 / 中 / 暗）。 */
export type Shading = { light: string; mid: string; dark: string };

export interface Look {
  outline: string;
  skin: Shading;
  cloth: Shading;
  pants: Shading;
  shoes: Shading;
  accent: Shading;
  /** 额外的单色小块（眼睛发光、伤口等）。 */
  extras?: Record<string, string>;
}

/** 字符画布：在 48×48 上落笔。 */
export class Canvas {
  readonly w: number;
  readonly h: number;
  grid: string[][];

  constructor(w = 48, h = 48) {
    this.w = w;
    this.h = h;
    this.grid = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  }

  set(x: number, y: number, ch: string): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    this.grid[iy][ix] = ch;
  }

  get(x: number, y: number): string {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return '.';
    return this.grid[iy][ix];
  }

  disc(cx: number, cy: number, r: number, ch: string): void {
    const rr = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= rr) this.set(x, y, ch);
      }
    }
  }

  /** 沿线段扫掠圆盘，用于四肢。 */
  limb(x0: number, y0: number, x1: number, y1: number, width: number, ch: string): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
    const half = width / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + dx * t, y0 + dy * t, half, ch);
    }
  }

  /** 以中心和两宽填充躯干。 */
  trapezoid(cx: number, top: number, bottom: number, wTop: number, wBottom: number, ch: string): void {
    const rows = bottom - top;
    for (let i = 0; i <= rows; i++) {
      const t = rows === 0 ? 0 : i / rows;
      const w = wTop + (wBottom - wTop) * t;
      const y = top + i;
      for (let x = Math.floor(cx - w / 2); x <= Math.ceil(cx + w / 2); x++) {
        this.set(x, y, ch);
      }
    }
  }

  /** 所有实心像素外描一圈轮廓。 */
  outline(ch: string): void {
    const solid = this.grid.map((row) => row.map((c) => c !== '.'));
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (solid[y][x]) continue;
        const near =
          (y > 0 && solid[y - 1][x]) ||
          (y < this.h - 1 && solid[y + 1][x]) ||
          (x > 0 && solid[y][x - 1]) ||
          (x < this.w - 1 && solid[y][x + 1]);
        if (near) this.grid[y][x] = ch;
      }
    }
  }

  /** 左侧受光：实心像素的左邻或上邻为空时提亮，右/下边缘压暗。 */
  shadeBody(bodyChars: Set<string>, light: string, dark: string): void {
    const solid = this.grid.map((row) => row.map((c) => bodyChars.has(c)));
    const out = this.grid.map((row) => row.slice());
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!solid[y][x]) continue;
        const leftOpen = x === 0 || !solid[y][x - 1];
        const topOpen = y === 0 || !solid[y - 1][x];
        const rightSolid = x + 1 < this.w && solid[y][x + 1];
        const belowSolid = y + 1 < this.h && solid[y + 1][x];
        if (leftOpen || topOpen) out[y][x] = light;
        else if (!rightSolid || !belowSolid) out[y][x] = dark;
      }
    }
    this.grid = out;
  }

  rows(): string[] {
    return this.grid.map((row) => row.join(''));
  }
}

/** 由角度（度，0=右，90=下）与长度得到末端点。 */
const tip = (x: number, y: number, len: number, deg: number): [number, number] => {
  const rad = (deg * Math.PI) / 180;
  return [x + Math.cos(rad) * len, y + Math.sin(rad) * len];
};

export interface Pose {
  /** 躯干前倾角度（度）。 */
  lean: number;
  /** 整体上下浮动（像素）。 */
  bob: number;
  /** 近侧腿 / 远侧腿的大腿角。90 = 垂直向下。 */
  thighNear: number;
  shinNear: number;
  thighFar: number;
  shinFar: number;
  /** 近侧臂 / 远侧臂的肩角。 */
  armNear: number;
  elbowNear: number;
  armFar: number;
  elbowFar: number;
  /** 头相对脖子向前偏移。 */
  headForward: number;
}

export type PoseKey = 'idleA' | 'idleB' | 'walk0' | 'walk1' | 'walk2' | 'walk3';

/** 行走循环：四帧，对角四肢反相摆动。 */
export const WALK_POSES: Record<PoseKey, Pose> = {
  idleA: {
    lean: 2, bob: 0,
    thighNear: 88, shinNear: 92, thighFar: 92, shinFar: 88,
    armNear: 84, elbowNear: 88, armFar: 96, elbowFar: 92,
    headForward: 0,
  },
  idleB: {
    lean: 2, bob: 1,
    thighNear: 88, shinNear: 92, thighFar: 92, shinFar: 88,
    armNear: 86, elbowNear: 86, armFar: 94, elbowFar: 94,
    headForward: 1,
  },
  walk0: {
    lean: 6, bob: 0,
    thighNear: 70, shinNear: 84, thighFar: 112, shinFar: 98,
    armNear: 104, elbowNear: 96, armFar: 74, elbowFar: 82,
    headForward: 1,
  },
  walk1: {
    lean: 6, bob: 1,
    thighNear: 86, shinNear: 96, thighFar: 92, shinFar: 88,
    armNear: 94, elbowNear: 92, armFar: 86, elbowFar: 88,
    headForward: 1,
  },
  walk2: {
    lean: 6, bob: 0,
    thighNear: 112, shinNear: 98, thighFar: 70, shinFar: 84,
    armNear: 74, elbowNear: 82, armFar: 104, elbowFar: 96,
    headForward: 1,
  },
  walk3: {
    lean: 6, bob: 1,
    thighNear: 92, shinNear: 88, thighFar: 86, shinFar: 96,
    armNear: 86, elbowNear: 88, armFar: 94, elbowFar: 92,
    headForward: 1,
  },
};

/** 渲染一帧到字符网格。角色一律朝右。
 *
 *  字符含义：
 *   k 描边   S 皮肤   A 头部装饰（帽/盔/面罩）   C 外衣   E 内衬
 *   D 裤子   B 鞋     H 发色   F 武器/配件      X 发光点缀
 */
export function renderFrame(rig: Rig, look: Look, pose: Pose): string[] {
  const c = new Canvas(48, 48);
  const [hx, hy0] = rig.hip;
  const bob = pose.bob;
  const hy = hy0 - bob;

  // 躯干沿前倾方向从髋部画到脖子
  const leanRad = (pose.lean * Math.PI) / 180;
  const torsoH = rig.torsoBottom - rig.torsoTop;
  const neckX = hx + Math.sin(leanRad) * torsoH * 0.7;
  const shoulderY = rig.torsoTop - bob;

  c.trapezoid(hx, shoulderY, rig.torsoBottom - bob, rig.shoulderW, rig.hipW, 'C');

  // 头
  const headX = neckX + pose.headForward;
  const headY = rig.head[1] - bob;
  c.disc(headX, headY, rig.headR, 'S');
  // 帽檐以下保留皮肤，以上换成装饰色
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      if (c.get(x, y) !== 'S') continue;
      if (y <= Math.round(headY - 1)) c.set(x, y, 'A');
    }
  }
  // 侧面特征：朝右的鼻尖与眼睛
  c.set(headX + rig.headR, headY, 'S');
  c.set(headX + rig.headR, headY + 1, 'S');
  c.set(headX + 2, headY, 'O');

  const drawLeg = (thigh: number, shin: number, ch: string) => {
    const [kx, ky] = tip(hx, hy, rig.thigh, thigh);
    const [ax, ay] = tip(kx, ky, rig.shin, shin);
    c.limb(hx, hy, kx, ky, rig.legW, ch);
    c.limb(kx, ky, ax, ay, rig.legW - 1, ch);
    c.disc(ax + 1, ay, rig.legW / 2 + 0.5, 'B');
  };

  const drawArm = (shoulder: number, elbow: number, ch: string) => {
    const [ex, ey] = tip(neckX, shoulderY + 4, rig.upperArm, shoulder);
    const [wx, wy] = tip(ex, ey, rig.foreArm, elbow);
    c.limb(neckX, shoulderY + 4, ex, ey, rig.armW, ch);
    c.limb(ex, ey, wx, wy, rig.armW - 1, ch);
    c.disc(wx, wy, rig.armW / 2, 'S');
  };

  // 远侧肢体先画，近侧后画，形成遮挡层次
  drawLeg(pose.thighFar, pose.shinFar, 'D');
  drawArm(pose.armFar, pose.elbowFar, 'E');
  drawLeg(pose.thighNear, pose.shinNear, 'C');
  drawArm(pose.armNear, pose.elbowNear, 'C');

  c.outline('k');
  return c.rows();
}

/** 把字符网格与调色板打包成 SpriteArt。 */
export function rig(look: Look, frames: string[][]): SpriteArt {
  const palette: Record<string, string> = {
    k: look.outline,
    S: look.skin.mid,
    A: look.accent.mid,
    C: look.cloth.mid,
    E: look.accent.dark,
    D: look.pants.mid,
    B: look.shoes.mid,
    H: look.accent.light,
    F: '#9090a0',
    X: '#ffe066',
    O: look.outline,
    ...(look.extras ?? {}),
  };
  return { view: 48, palette, frames };
}
