import { afterEach, describe, expect, it } from 'vitest';
import { drawEntity, drawDeath } from './anim';
import { __resetRasterForTest, __setRasterForTest, type LoadedSheet } from './raster';
import type { Entity } from '../core/types';

const SHEET: LoadedSheet = {
  id: 'walker',
  src: '/assets/characters/walker.png',
  view: 48,
  frames: 9,
  walkFps: 8,
  clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] },
  image: {} as CanvasImageSource,
};

function stubCtx(calls: string[]): CanvasRenderingContext2D {
  return new Proxy({}, { get: (_t, k) => {
    if (k === 'canvas') return { width: 960, height: 640 };
    return (...args: unknown[]) => { calls.push(String(k)); void args; };
  } }) as unknown as CanvasRenderingContext2D;
}

function zombie(kind = 'walker'): Entity {
  return { id: 2, kind, x: 100, y: 100, radius: 11, hp: 10, maxHp: 10,
    speed: 40, facing: 0, tags: [], statuses: [], dead: false, ttl: 0,
    data: { moving: 0, walk: 0 } };
}

describe('drawEntity raster path', () => {
  afterEach(() => __resetRasterForTest());

  it('uses drawImage when a sheet is loaded', () => {
    __setRasterForTest('walker', SHEET);
    const calls: string[] = [];
    drawEntity(stubCtx(calls), zombie(), 0);
    expect(calls).toContain('drawImage');
  });

  it('falls back to vector shapes when no sheet is loaded', () => {
    const calls: string[] = [];
    drawEntity(stubCtx(calls), zombie('walker'), 0);
    expect(calls).toContain('fillRect');
    expect(calls).not.toContain('drawImage');
  });

  it('renders a player class via the vector survivor fallback', () => {
    const calls: string[] = [];
    const p = { ...zombie('veteran'), id: 1, data: { moving: 0, walk: 0 } };
    drawEntity(stubCtx(calls), p, 0);
    expect(calls).toContain('fillRect');
  });

  it('still draws when atkT exceeds atkDur (clamped phase)', () => {
    __setRasterForTest('walker', SHEET);
    const calls: string[] = [];
    drawEntity(stubCtx(calls), { ...zombie(), id: 3,
      data: { moving: 0, walk: 0, atkT: 0.5, atkDur: 0.3 } }, 0);
    expect(calls).toContain('drawImage');
  });
});

describe('drawDeath', () => {
  afterEach(() => __resetRasterForTest());

  it('draws the death frame from the sheet', () => {
    __setRasterForTest('walker', SHEET);
    const calls: string[] = [];
    drawDeath(stubCtx(calls), { kind: 'walker', x: 100, y: 100, facing: 0, t: 0.2 });
    expect(calls).toContain('drawImage');
  });

  it('falls back to the vector sprite without a sheet', () => {
    const calls: string[] = [];
    drawDeath(stubCtx(calls), { kind: 'walker', x: 100, y: 100, facing: 0, t: 0.2 });
    expect(calls).toContain('fillRect');
  });
});