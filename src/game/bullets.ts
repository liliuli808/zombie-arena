import type { DamageTag, Element, Entity, School } from '../core/types';
import type { ArenaObject } from './arena';

/** 各种武器的弹道外观与速度。速度同时决定手感（狙击最快、法术最慢）。
 *  width 为弹头直径、trail 为拖尾长度、glow 为外发光半径。 */
export interface BulletProfile {
  speed: number; trail: number; width: number; glow: number; color: string;
}

const ELEMENT_COLOR: Record<string, string> = {
  fire: '#ff8a3d', ice: '#8fdcff', lightning: '#ffe066',
};

export function bulletProfile(sprite: string, school: School, element: Element): BulletProfile {
  if (school === 'gun') {
    if (sprite === 'shotgun') return { speed: 1500, trail: 26, width: 3.4, glow: 8, color: '#ffb830' };
    if (sprite === 'sniper') return { speed: 2600, trail: 46, width: 3.8, glow: 12, color: '#eaf6ff' };
    return { speed: 1800, trail: 30, width: 3.2, glow: 9, color: '#ffd24a' };
  }
  if (school === 'tech') return { speed: 1100, trail: 26, width: 3.6, glow: 10, color: '#8fdcff' };
  const color = ELEMENT_COLOR[element ?? ''] ?? '#b39ddb';
  if (sprite === 'firestaff') return { speed: 720, trail: 34, width: 4.6, glow: 14, color };
  if (sprite === 'frosttome') return { speed: 900, trail: 30, width: 4.2, glow: 12, color };
  return { speed: 1000, trail: 28, width: 4, glow: 12, color };
}

/** 命中时才构造 DamageOp 所需的一切：规则要用真实目标 ID 才正确。 */
export interface BulletPayload {
  base: number;
  school: School;
  tags: DamageTag[];
  sourceSlot: number;
  element: Exclude<Element, null> | null;
}

export interface Bullet extends BulletPayload {
  x: number; y: number;
  dx: number; dy: number;
  speed: number;
  trail: number;
  /** 弹头直径与外发光半径，供渲染层做大光斑 */
  width: number;
  glow: number;
  color: string;
  sprite: string;
  /** 已飞行距离与总航程 */
  traveled: number; range: number;
  /** 兜底存活时间 */
  life: number;
  /** 开火位置，用于判定「是否打在持盾僵尸正面」 */
  fromX: number; fromY: number;
  /** 弱追踪：命中锥内选中的目标 id 与追踪强度 */
  homingTarget: number | null;
  homing: number;
  /** 余晖淡出进度：0 = 正常飞行，>0 = 已停下只做视觉残留 */
  afterglow: number;
}

const MUZZLE = 16; // 枪口偏移，避免子弹从身体中心冒出

export function spawnBullet(
  from: { x: number; y: number },
  angle: number,
  sprite: string,
  payload: BulletPayload,
  range: number,
  opts: { homingTarget?: number | null; homing?: number } = {},
): Bullet {
  const look = bulletProfile(sprite, payload.school, payload.element);
  return {
    ...payload,
    tags: payload.tags.slice(),
    x: from.x + Math.cos(angle) * MUZZLE,
    y: from.y + Math.sin(angle) * MUZZLE,
    dx: Math.cos(angle), dy: Math.sin(angle),
    speed: look.speed, trail: look.trail, color: look.color, sprite,
    width: look.width, glow: look.glow,
    traveled: 0, range, life: 2,
    fromX: from.x, fromY: from.y,
    homingTarget: opts.homingTarget ?? null,
    homing: opts.homing ?? 0,
    afterglow: 0,
  };
}

export interface BulletHit {
  bullet: Bullet;
  /** 命中僵尸 */
  entity?: Entity;
  /** 命中场景物件（木箱 / 油桶 / 路障） */
  solid?: ArenaObject;
}

/** 是否会被子弹命中：玩家自己与部署物（炮塔/无人机）不参与判定。 */
function isHittable(e: Entity): boolean {
  return !e.dead && e.id !== 1 && !e.tags.includes('deployable');
}

/** 余晖时长：命中后拖尾继续可见并淡出的秒数。 */
const AFTERGLOW = 0.16;

/**
 * 推进所有子弹并检测碰撞。
 * 高速子弹单帧可跨越上百像素，必须按固定步长细分，否则会直接穿过僵尸。
 * 命中或超程后子弹不立刻消失，而是转为余晖继续淡出——
 * 否则一帧就走完全程，屏幕上根本看不到弹道。
 */
export function advanceBullets(
  list: Bullet[],
  dt: number,
  entities: Entity[],
  solids: ArenaObject[],
): { alive: Bullet[]; hits: BulletHit[] } {
  const alive: Bullet[] = [];
  const hits: BulletHit[] = [];
  // 每步最多 6 像素：小于最细僵尸的碰撞半径，保证不会漏判
  const MAX_STEP = 6;

  for (const b of list) {
    // 余晖阶段：停止移动，只按时间淡出
    if (b.afterglow > 0) {
      b.afterglow += dt / AFTERGLOW;
      if (b.afterglow < 1) alive.push(b);
      continue;
    }

    b.life -= dt;
    if (b.life <= 0) continue;
    steer(b, entities, dt);

    const frameLen = b.speed * dt;
    const steps = Math.max(1, Math.ceil(frameLen / MAX_STEP));
    const step = frameLen / steps;
    let consumed = false;

    for (let i = 0; i < steps; i++) {
      b.x += b.dx * step; b.y += b.dy * step;
      b.traveled += step;

      const solid = solids.find(o => containsPoint(o, b.x, b.y));
      if (solid) { hits.push({ bullet: b, solid }); consumed = true; break; }

      const target = entities.find(e => isHittable(e)
        && Math.hypot(e.x - b.x, e.y - b.y) <= e.radius + 3);
      if (target) { hits.push({ bullet: b, entity: target }); consumed = true; break; }

      if (b.traveled >= b.range) { consumed = true; break; }
    }
    if (consumed) b.afterglow = 1e-6; // 起步进入余晖，命中点留下残影
    alive.push(b);
  }
  return { alive, hits };
}

/** 弱追踪：把方向缓慢转向目标，转角上限由 homing 强度决定。 */
function steer(b: Bullet, entities: Entity[], dt: number): void {
  if (!b.homingTarget || b.homing <= 0) return;
  const t = entities.find(e => e.id === b.homingTarget);
  if (!t || t.dead) { b.homingTarget = null; return; }
  const want = Math.atan2(t.y - b.y, t.x - b.x);
  const cur = Math.atan2(b.dy, b.dx);
  const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  const maxTurn = b.homing * 3.2 * dt;
  const turned = cur + Math.max(-maxTurn, Math.min(maxTurn, diff));
  b.dx = Math.cos(turned); b.dy = Math.sin(turned);
}

function containsPoint(o: ArenaObject, x: number, y: number): boolean {
  if (o.hp <= 0) return false;
  return x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h;
}
