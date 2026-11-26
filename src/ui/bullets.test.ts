import { describe, it, expect } from 'vitest';
import { drawBullets, drawImpacts, spawnImpact, tickImpacts } from './bullets';
import { spawnBullet } from '../game/bullets';

function stubCtx() {
  const calls: string[] = [];
  const c = new Proxy({}, { get: (_t, k) => {
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return () => ({ addColorStop: () => {} });
    }
    return (...args: unknown[]) => { calls.push(String(k)); void args; };
  } }) as unknown as CanvasRenderingContext2D;
  return { c, calls };
}

const payload = { base: 10, school: 'gun' as const, tags: ['bullet' as const],
  sourceSlot: 0, element: null };

describe('drawBullets', () => {
  it('does nothing for an empty list', () => {
    const { c, calls } = stubCtx();
    drawBullets(c, []);
    expect(calls).toHaveLength(0);
  });

  it('draws halo, beam, cone and head for a bullet', () => {
    const { c, calls } = stubCtx();
    drawBullets(c, [spawnBullet({ x: 50, y: 50 }, 0.5, 'pistol', payload, 300)]);
    expect(calls).toContain('stroke');
    expect(calls).toContain('fill');
    expect(calls).toContain('arc');
  });

  it('skips bullets whose afterglow has fully faded', () => {
    const { c, calls } = stubCtx();
    const b = spawnBullet({ x: 0, y: 0 }, 0, 'pistol', payload, 300);
    b.afterglow = 1;
    drawBullets(c, [b]);
    expect(calls).toHaveLength(0);
  });
});

describe('impacts', () => {
  it('spawns an impact with a deterministic angular seed', () => {
    const a = spawnImpact(10, 20, '#ffd24a', 16);
    const b = spawnImpact(10, 20, '#ffd24a', 16);
    expect(a.seed).toBe(b.seed); // 同一位置的爆裂形状一致
    expect(a.radius).toBe(16);
  });

  it('advances and eventually expires', () => {
    let list = [spawnImpact(0, 0, '#fff')];
    expect(list[0].t).toBe(0);
    list = tickImpacts(list, 0.1);
    expect(list[0].t).toBeGreaterThan(0);
    for (let i = 0; i < 20 && list.length > 0; i++) list = tickImpacts(list, 0.05);
    expect(list).toHaveLength(0);
  });

  it('draws impacts without throwing', () => {
    const { c, calls } = stubCtx();
    drawImpacts(c, [spawnImpact(5, 5, '#ff8a3d')]);
    expect(calls).toContain('stroke');
    expect(calls).toContain('fill');
  });

  it('does nothing for an empty impact list', () => {
    const { c, calls } = stubCtx();
    drawImpacts(c, []);
    expect(calls).toHaveLength(0);
  });
});
