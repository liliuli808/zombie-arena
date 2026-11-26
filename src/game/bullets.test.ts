import { describe, it, expect } from 'vitest';
import { spawnBullet, advanceBullets, bulletProfile, type BulletPayload } from './bullets';
import type { Entity } from '../core/types';
import type { ArenaObject } from './arena';

const payload = (over: Partial<BulletPayload> = {}): BulletPayload => ({
  base: 10, school: 'gun', tags: ['bullet'], sourceSlot: 0, element: null, ...over,
});

function zombie(id: number, x: number, y: number, radius = 12): Entity {
  return { id, kind: 'walker', x, y, radius, hp: 100, maxHp: 100, speed: 0, facing: 0,
    tags: [], statuses: [], dead: false, ttl: 0, data: {} };
}

function barrel(x: number, y: number, w = 16, h = 16, hp = 12): ArenaObject {
  return { x, y, w, h, hp, maxHp: hp, kind: 'barrel' };
}

describe('bulletProfile', () => {
  it('gives each weapon family its own speed and colour', () => {
    const pistol = bulletProfile('pistol', 'gun', null);
    const sniper = bulletProfile('sniper', 'gun', null);
    const fire = bulletProfile('firestaff', 'magic', 'fire');
    expect(sniper.speed).toBeGreaterThan(pistol.speed);
    expect(sniper.trail).toBeGreaterThan(pistol.trail);
    expect(fire.speed).toBeLessThan(pistol.speed);
    expect(fire.color).not.toBe(pistol.color);
  });

  it('tints magic bullets by element', () => {
    expect(bulletProfile('firestaff', 'magic', 'fire').color)
      .not.toBe(bulletProfile('frosttome', 'magic', 'ice').color);
  });
});

describe('spawnBullet', () => {
  it('spawns ahead of the shooter along the aim direction', () => {
    const b = spawnBullet({ x: 100, y: 100 }, 0, 'pistol', payload(), 300);
    expect(b.x).toBeGreaterThan(100);
    expect(b.y).toBeCloseTo(100, 5);
    expect(b.dx).toBeCloseTo(1, 5);
    expect(b.range).toBe(300);
    // 记录开火点用于判断持盾判定
    expect(b.fromX).toBe(100);
  });

  it('copies tags so the caller cannot mutate a shared array', () => {
    const p = payload();
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', p, 100);
    b.tags.push('melee');
    expect(p.tags).not.toContain('melee');
  });
});

describe('advanceBullets', () => {
  it('moves a bullet forward when nothing is in the way', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { alive, hits } = advanceBullets([b], 0.05, [], []);
    expect(hits).toHaveLength(0);
    expect(alive).toHaveLength(1);
    expect(alive[0].x).toBeGreaterThan(b.x - 1);
  });

  it('hits a zombie standing in the bullet path', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { alive, hits } = advanceBullets([b], 0.05, [zombie(2, 60, 0)], []);
    expect(hits).toHaveLength(1);
    expect(hits[0].entity?.id).toBe(2);
    // 命中后不立刻消失，而是转入余晖淡出（否则屏幕上看不到弹道）
    expect(alive).toHaveLength(1);
    expect(alive[0].afterglow).toBeGreaterThan(0);
  });

  it('does not register the same hit twice while fading out', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const z = zombie(2, 60, 0);
    const first = advanceBullets([b], 0.05, [z], []);
    const second = advanceBullets(first.alive, 0.05, [z], []);
    expect(first.hits).toHaveLength(1);
    expect(second.hits).toHaveLength(0); // 余晖阶段不再参与碰撞
  });

  it('does not tunnel through a zombie at sniper speed', () => {
    // 狙击 2600px/s，单帧 0.05s 约走 130px，远超僵尸直径
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'sniper', payload(), 1000);
    const { hits } = advanceBullets([b], 0.05, [zombie(2, 60, 0, 12)], []);
    expect(hits).toHaveLength(1);
  });

  it('hits a scene object in the path', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { alive, hits } = advanceBullets([b], 0.05, [], [barrel(50, -8)]);
    expect(hits).toHaveLength(1);
    expect(hits[0].solid?.kind).toBe('barrel');
    expect(alive[0].afterglow).toBeGreaterThan(0);
  });

  it('ignores destroyed objects with zero hp', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { alive } = advanceBullets([b], 0.02, [], [barrel(50, -8, 16, 16, 0)]);
    expect(alive).toHaveLength(1);
  });

  it('ignores dead entities', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const z = zombie(2, 60, 0); z.dead = true;
    const { alive } = advanceBullets([b], 0.05, [z], []);
    expect(alive).toHaveLength(1);
  });

  it('stops advancing a bullet once it exceeds its range', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 20);
    const first = advanceBullets([b], 0.5, [], []);
    expect(first.hits).toHaveLength(0);
    // 超程后进入余晖，位置不再推进
    const xAtStop = first.alive[0].x;
    const second = advanceBullets(first.alive, 0.05, [], []);
    expect(second.alive[0]?.x).toBe(xAtStop);
  });

  it('eventually removes a bullet after its afterglow finishes', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 20);
    let list = advanceBullets([b], 0.5, [], []).alive;
    for (let i = 0; i < 20 && list.length > 0; i++) {
      list = advanceBullets(list, 0.1, [], []).alive;
    }
    expect(list).toHaveLength(0);
  });

  it('drops bullets whose lifetime ran out', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1e9);
    b.life = 0.01;
    expect(advanceBullets([b], 0.5, [], []).alive).toHaveLength(0);
  });

  it('steers a homing bullet toward its target', () => {
    // 朝 +x 发射，目标在正下方：追踪应让 dy 变成正数
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'turret', payload({ school: 'tech' }), 1000,
      { homingTarget: 2, homing: 2 });
    advanceBullets([b], 0.05, [zombie(2, 0, 200)], []);
    expect(b.dy).toBeGreaterThan(0);
  });

  it('forgets a homing target that died', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'turret', payload({ school: 'tech' }), 1000,
      { homingTarget: 2, homing: 2 });
    const z = zombie(2, 0, 200); z.dead = true;
    advanceBullets([b], 0.02, [z], []);
    expect(b.homingTarget).toBeNull();
  });

  it('stops a bullet at the first thing it touches', () => {
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { hits } = advanceBullets([b], 0.05, [zombie(2, 40, 0)], [barrel(90, -8)]);
    expect(hits).toHaveLength(1);
    expect(hits[0].entity?.id).toBe(2); // 先撞僵尸，不会穿透去撞桶
  });

  it('never hits the player who fired it', () => {
    // 玩家实体 id=1，枪口偏移 16px 时仍在其碰撞范围内
    const player = zombie(1, 0, 0, 12);
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { alive, hits } = advanceBullets([b], 0.02, [player], []);
    expect(hits).toHaveLength(0);
    expect(alive).toHaveLength(1);
  });

  it('passes through the player to hit a zombie beyond', () => {
    const player = zombie(1, 0, 0, 12);
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { hits } = advanceBullets([b], 0.05, [player, zombie(2, 80, 0)], []);
    expect(hits).toHaveLength(1);
    expect(hits[0].entity?.id).toBe(2);
  });

  it('passes through friendly deployables', () => {
    const turret = zombie(9, 40, 0, 10); turret.tags.push('deployable');
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload(), 1000);
    const { hits } = advanceBullets([b], 0.05, [turret, zombie(2, 90, 0)], []);
    expect(hits).toHaveLength(1);
    expect(hits[0].entity?.id).toBe(2);
  });
});
