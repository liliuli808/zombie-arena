import type { SaveData, RunState } from '../core/types';

export const SAVE_KEY = 'zombie-arena-save';
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
export interface UnlockDef { id: string; name: string; cost: number; kind: 'character' | 'map' | 'weapon' }
export const UNLOCKS: UnlockDef[] = [
  { id: 'engineer', name: '工程师', cost: 40, kind: 'character' },
  { id: 'ronin', name: '浪人', cost: 40, kind: 'character' },
  { id: 'jailer', name: '狱卒', cost: 60, kind: 'character' },
  { id: 'lab', name: '地下实验室', cost: 50, kind: 'map' },
  { id: 'rooftop', name: '雨夜天台', cost: 90, kind: 'map' },
  { id: 'chainsaw', name: '链锯（加入商店池）', cost: 70, kind: 'weapon' },
  { id: 'sniper', name: '狙击枪（加入商店池）', cost: 70, kind: 'weapon' },
];
export function defaultSave(): SaveData {
  return { version: 1, points: 0, bestWave: 0, totalKills: 0,
    unlockedCharacters: ['veteran', 'wizard'], unlockedMaps: ['yard'], unlockedWeapons: [] };
}
function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
export function loadSave(storage: StorageLike | null = browserStorage()): SaveData {
  if (!storage) return defaultSave();
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed.version !== 1 || typeof parsed.points !== 'number'
      || !Array.isArray(parsed.unlockedCharacters)) return defaultSave();
    return { ...defaultSave(), ...parsed };
  } catch { return defaultSave(); }
}
export function saveGame(data: SaveData, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try { storage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* 存储被禁用时静默降级 */ }
}
export function settleRun(run: RunState, prev: SaveData): SaveData {
  const points = run.wave * 2 + Math.floor(run.kills / 10) + run.bossKills * 5;
  return {
    ...prev,
    points: prev.points + points,
    bestWave: Math.max(prev.bestWave, run.wave),
    totalKills: prev.totalKills + run.kills,
  };
}
export function buyUnlock(save: SaveData, id: string): SaveData {
  const u = UNLOCKS.find(x => x.id === id);
  if (!u || save.points < u.cost) return save;
  const next = { ...save, points: save.points - u.cost };
  if (u.kind === 'character') next.unlockedCharacters = [...save.unlockedCharacters, id];
  if (u.kind === 'map') next.unlockedMaps = [...save.unlockedMaps, id];
  if (u.kind === 'weapon') next.unlockedWeapons = [...save.unlockedWeapons, id];
  return next;
}
