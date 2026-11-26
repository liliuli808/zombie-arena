import { describe, it, expect } from 'vitest';
import { SPRITES, spriteIds, spriteDrawSize, spriteParts, frameShapes, spriteFrameCount } from './sprites';
import { renderFrame } from './render';
import { createRunState, resolveLoadout } from '../game/state';
import { EventBus } from '../engine/events';
import { World } from '../game/combat';
import { Arena } from '../game/arena';

function stubCtx() {
  const calls: string[] = [];
  const c = new Proxy({}, { get: (_t, k) => {
    if (k === 'canvas') return { width: 960, height: 640 };
    return (...args: unknown[]) => { calls.push(String(k)); void args; };
  } }) as unknown as CanvasRenderingContext2D;
  return { c, calls };
}

describe('sprites', () => {
  it('has a pixel sprite for every referenced id', () => {
    for (const id of spriteIds()) expect(SPRITES[id]).toBeDefined();
    expect(spriteIds().length).toBeGreaterThanOrEqual(15);
  });

  it('every frame is a square grid of known characters', () => {
    for (const [id, sp] of Object.entries(SPRITES)) {
      expect(sp.frames.length, id).toBeGreaterThan(0);
      for (const [fi, rows] of sp.frames.entries()) {
        expect(rows.length, `${id} frame ${fi} height`).toBe(sp.view);
        for (const row of rows) {
          expect(row.length, `${id} frame ${fi} width`).toBe(sp.view);
          for (const ch of row) {
            if (ch !== '.') expect(sp.palette[ch], `${id}:${ch}`).toBeDefined();
          }
        }
      }
    }
  });

  it('expands frames into pixel runs that stay inside the grid', () => {
    for (const id of spriteIds()) {
      for (let f = 0; f < spriteFrameCount(id); f++) {
        const shapes = frameShapes(id, f);
        expect(shapes.length, `${id}#${f}`).toBeGreaterThan(0);
        for (const s of shapes) {
          expect(s.w, id).toBeGreaterThan(0);
          expect(s.h, id).toBeGreaterThan(0);
          expect(s.x + s.w, id).toBeLessThanOrEqual(SPRITES[id].view);
          expect(s.y + s.h, id).toBeLessThanOrEqual(SPRITES[id].view);
        }
      }
    }
  });

  it('splits shapes into skeleton parts without losing any', () => {
    for (const id of spriteIds()) {
      const parts = spriteParts(id);
      const total = Object.values(parts).reduce((n, arr) => n + arr.length, 0);
      expect(total, id).toBe(frameShapes(id, 0).length);
    }
  });
});

describe('spriteDrawSize', () => {
  it('returns a positive size for every sprite', () => {
    for (const id of spriteIds()) expect(spriteDrawSize(id)).toBeGreaterThan(0);
  });

  it('registers player classes and maps them to the vector survivor', async () => {
    const { vectorIdFor } = await import('./sprites');
    for (const id of ['veteran', 'wizard', 'engineer', 'ronin', 'jailer']) {
      expect(spriteDrawSize(id), id).toBe(48);
      expect(vectorIdFor(id), id).toBe('player');
    }
    expect(vectorIdFor('walker')).toBe('walker');
  });
});

describe('renderFrame', () => {
  it('draws a frame without throwing using a stub 2D context', () => {
    const { c, calls } = stubCtx();
    const run = createRunState(1, 'veteran', 'yard');
    const bus = new EventBus();
    const world = new World(run, bus);
    world.setRules(resolveLoadout(run).rules);
    const arena = new Arena('yard');
    expect(() => renderFrame(c, { run, world, arena, stats: world.stats,
      mouse: { x: 100, y: 100 }, phase: 'combat', dt: 0.016,
      loadout: resolveLoadout(run) })).not.toThrow();
    expect(calls.length).toBeGreaterThan(10);
  });
});
