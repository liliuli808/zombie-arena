import { describe, it, expect } from 'vitest';
import { SPRITE_MAPS, spriteIds } from './sprites';
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
  it('has a pixel map for every referenced sprite id', () => {
    for (const id of spriteIds()) expect(SPRITE_MAPS[id]).toBeDefined();
    expect(spriteIds().length).toBeGreaterThanOrEqual(15);
  });
  it('each pixel map has equal-length rows and a palette for every glyph', () => {
    for (const [id, m] of Object.entries(SPRITE_MAPS)) {
      expect(m.rows.every(r => r.length === m.w), id).toBe(true);
      for (const row of m.rows) for (const ch of row) {
        if (ch !== '.') expect(m.palette[ch], `${id}:${ch}`).toBeDefined();
      }
    }
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
