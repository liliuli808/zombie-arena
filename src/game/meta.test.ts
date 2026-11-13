import { describe, it, expect } from 'vitest';
import { loadSave, saveGame, settleRun, UNLOCKS, defaultSave } from './meta';
import { createRunState } from './state';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe('save data', () => {
  it('returns a default save when storage is empty', () => {
    expect(loadSave(fakeStorage())).toEqual(defaultSave());
  });
  it('round-trips through saveGame/loadSave', () => {
    const s = fakeStorage();
    const d = { ...defaultSave(), points: 77, unlockedMaps: ['lab'] };
    saveGame(d, s);
    expect(loadSave(s)).toEqual(d);
  });
  it('safely resets on corrupt JSON or incompatible version', () => {
    const s = fakeStorage(); s.setItem('zombie-arena-save', '{not json');
    expect(loadSave(s)).toEqual(defaultSave());
    const s2 = fakeStorage(); s2.setItem('zombie-arena-save', JSON.stringify({ version: 999 }));
    expect(loadSave(s2)).toEqual(defaultSave());
  });
});

describe('settleRun', () => {
  it('awards wave*2 + kills/10 + bossKills*5 points', () => {
    const r = createRunState(1, 'veteran', 'yard');
    r.wave = 12; r.kills = 130; r.bossKills = 2;
    const d = settleRun(r, defaultSave());
    expect(d.points).toBe(24 + 13 + 10);
    expect(d.bestWave).toBe(12);
    expect(d.totalKills).toBe(130);
  });
  it('never lowers bestWave across runs', () => {
    const r = createRunState(1, 'veteran', 'yard'); r.wave = 3;
    const prev = { ...defaultSave(), bestWave: 20, totalKills: 50 };
    expect(settleRun(r, prev).bestWave).toBe(20);
    expect(settleRun(r, prev).totalKills).toBe(50);
  });
  it('exposes unlock catalogue with costs', () => {
    expect(UNLOCKS.length).toBeGreaterThan(0);
    for (const u of UNLOCKS) expect(u.cost).toBeGreaterThan(0);
  });
});
