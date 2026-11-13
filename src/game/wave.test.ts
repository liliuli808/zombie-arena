import { describe, it, expect } from 'vitest';
import { composeWave, previewFor, waveHpScale, isBossWave, WEATHER_FOR_WAVE } from './wave';
import { RNG } from '../engine/rng';
import { ZOMBIE_BY_ID } from '../data/zombies';

describe('composeWave', () => {
  it('is reproducible for the same seed and references real zombie ids', () => {
    const a = composeWave(3, new RNG(5)), b = composeWave(3, new RNG(5));
    expect(a).toEqual(b);
    for (const g of a.groups) expect(ZOMBIE_BY_ID[g.id]).toBeDefined();
  });
  it('every 5th wave is a boss wave with an alternating boss', () => {
    expect(isBossWave(5)).toBe(true); expect(isBossWave(10)).toBe(true);
    expect(isBossWave(4)).toBe(false);
    const b5 = composeWave(5, new RNG(1)), b10 = composeWave(10, new RNG(1));
    expect(b5.boss).toBe('butcher');
    expect(b10.boss).toBe('mother');
  });
  it('preview matches the dominant normal types of the actual wave', () => {
    for (const wave of [1, 2, 3, 7, 12]) {
      const p = previewFor(wave, new RNG(wave));
      expect(p.length).toBeGreaterThan(0);
      const c = composeWave(wave, new RNG(wave));
      expect(p.every(id => c.groups.some(g => g.id === id))).toBe(true);
    }
  });
  it('hp scale and count grow monotonically', () => {
    expect(waveHpScale(10)).toBeGreaterThan(waveHpScale(1));
    expect(composeWave(12, new RNG(3)).groups.reduce((s, g) => s + g.count, 0))
      .toBeGreaterThan(composeWave(2, new RNG(3)).groups.reduce((s, g) => s + g.count, 0));
  });
  it('weather is deterministic per wave and clear on wave 1', () => {
    expect(WEATHER_FOR_WAVE(1, new RNG(1))).toBe('clear');
    expect(WEATHER_FOR_WAVE(9, new RNG(9))).toBe(WEATHER_FOR_WAVE(9, new RNG(9)));
  });
});
