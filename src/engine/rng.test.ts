import { describe, it, expect } from 'vitest';
import { RNG } from './rng';

describe('RNG', () => {
  it('is reproducible for the same seed', () => {
    const a = new RNG(12345), b = new RNG(12345);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('diverges for different seeds', () => {
    expect(new RNG(1).next()).not.toBe(new RNG(2).next());
  });
  it('stays in [0,1) and handles seed 0', () => {
    const r = new RNG(0);
    for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('int() is inclusive on both ends and pick/shuffle stay in range', () => {
    const r = new RNG(7);
    for (let i = 0; i < 200; i++) { expect(r.int(3, 5)).toBeGreaterThanOrEqual(3); expect(r.int(3, 5)).toBeLessThanOrEqual(5); }
    expect([1, 2, 3]).toContain(r.pick([1, 2, 3]));
    expect(r.shuffle([1, 2, 3, 4]).slice().sort()).toEqual([1, 2, 3, 4]);
  });
});
