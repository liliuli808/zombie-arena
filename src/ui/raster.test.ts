import { afterEach, describe, expect, it } from 'vitest';
import { RASTER_META } from './rasterMeta.generated';
import {
  __resetRasterForTest, __setRasterForTest, clipFrame, pickClip,
  preloadRasterSheets, rasterFor, type LoadedSheet,
} from './raster';

const WALKER: LoadedSheet = {
  id: 'walker',
  src: '/assets/characters/walker.png',
  view: 48,
  frames: 9,
  walkFps: 8,
  clips: { idle: [0], walk: [0, 1, 2, 3], attack: [4, 5, 6], hit: [7], death: [8] },
  image: {} as CanvasImageSource,
};

describe('RASTER_META', () => {
  it('covers all 14 characters with 9 frames and in-range clips', () => {
    expect(Object.keys(RASTER_META)).toHaveLength(14);
    for (const [id, meta] of Object.entries(RASTER_META)) {
      expect(meta.frames, id).toBe(9);
      expect(meta.src, id).toBe(`/assets/characters/${id}.png`);
      for (const frames of Object.values(meta.clips)) {
        expect(frames.length).toBeGreaterThan(0);
        for (const f of frames) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThan(9);
        }
      }
    }
  });
});

describe('clipFrame', () => {
  it('returns the only frame for idle, hit and death', () => {
    expect(clipFrame(WALKER, 'idle', 0.4)).toBe(0);
    expect(clipFrame(WALKER, 'hit', 0.2)).toBe(7);
    expect(clipFrame(WALKER, 'death', 0.9)).toBe(8);
  });

  it('cycles walk frames by walkFps', () => {
    expect(clipFrame(WALKER, 'walk', 0)).toBe(0);
    expect(clipFrame(WALKER, 'walk', 0.13)).toBe(1);
    expect(clipFrame(WALKER, 'walk', 0.26)).toBe(2);
    expect(clipFrame(WALKER, 'walk', 0.5)).toBe(0);
  });

  it('maps attack phase to windup, strike and recover', () => {
    expect(clipFrame(WALKER, 'attack', 0)).toBe(4);
    expect(clipFrame(WALKER, 'attack', 0.34)).toBe(5);
    expect(clipFrame(WALKER, 'attack', 0.99)).toBe(6);
  });
});

describe('pickClip', () => {
  it('uses death > hit > attack > walk > idle', () => {
    expect(pickClip({ dead: true, hitT: 1, atkT: 1, moving: true })).toBe('death');
    expect(pickClip({ hitT: 0.1, atkT: 1, moving: true })).toBe('hit');
    expect(pickClip({ atkT: 0.1, moving: true })).toBe('attack');
    expect(pickClip({ moving: true })).toBe('walk');
    expect(pickClip({})).toBe('idle');
  });
});

describe('loader', () => {
  afterEach(() => __resetRasterForTest());

  it('no-ops without an Image constructor', async () => {
    const original = (globalThis as { Image?: unknown }).Image;
    delete (globalThis as { Image?: unknown }).Image;
    await expect(preloadRasterSheets(['walker'])).resolves.toBeUndefined();
    expect(rasterFor('walker')).toBeUndefined();
    if (original) (globalThis as { Image?: unknown }).Image = original;
  });

  it('exposes a sheet injected for tests', () => {
    __setRasterForTest('walker', WALKER);
    expect(rasterFor('walker')).toBe(WALKER);
  });
});
