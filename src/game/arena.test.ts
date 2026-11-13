import { describe, it, expect } from 'vitest';
import { Arena, damageObject, repairBarriers, trapBonusAt, fireSpread } from './arena';
import { MAP_BY_ID } from '../data/maps';

describe('Arena', () => {
  it('loads a map with barriers, barrels, boxes and trap slots', () => {
    const a = new Arena('yard');
    expect(a.barriers.length).toBe(MAP_BY_ID['yard'].barriers.length);
    expect(a.barrels.length).toBe(2);
    expect(a.traps.length).toBe(3);
  });
  it('barriers break at 0 hp and repair costs gold', () => {
    const a = new Arena('yard');
    const b = a.barriers[0]; b.hp = 5; a.gold = 20;
    damageObject(b, 10); expect(b.hp).toBe(0);
    expect(repairBarriers(a)).toBe(1);
    expect(a.gold).toBe(15);
    expect(b.hp).toBeGreaterThan(0);
  });
  it('barrels explode when destroyed', () => {
    const a = new Arena('yard');
    const bar = a.barrels[0];
    expect(damageObject(bar, 999)).toBe('explosion');
  });
  it('trap slots grant a tech damage bonus at their position', () => {
    const a = new Arena('yard');
    const t = a.traps[0];
    expect(trapBonusAt(a, t.x, t.y)).toBeGreaterThan(1);
    expect(trapBonusAt(a, 5, 5)).toBe(1);
  });
  it('fire event spreads patches and fog shrinks the safe radius over time', () => {
    const a = new Arena('yard');
    a.setWeather('fire');
    expect(fireSpread(a).length).toBeGreaterThan(0);
    a.setWeather('fog');
    const r0 = a.safeRadius; a.tick(10); expect(a.safeRadius).toBeLessThan(r0);
  });
  it('night reduces visibility radius', () => {
    const a = new Arena('yard'); a.setWeather('night');
    expect(a.visionRadius).toBeLessThan(960);
  });
});
