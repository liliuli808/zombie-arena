import { RNG } from '../engine/rng';
import type { WeatherId } from '../core/types';

export interface WaveGroup { id: string; count: number }
export interface WavePlan { groups: WaveGroup[]; boss: string | null; hpScale: number }

const NORMAL_BY_WAVE: Record<string, number> = {
  walker: 1, runner: 2, fatty: 3, shield: 4, spitter: 5, summoner: 6, armored: 7,
};
const WEATHERS: WeatherId[] = ['clear', 'night', 'rain', 'fire', 'fog'];

export function isBossWave(wave: number): boolean { return wave % 5 === 0; }
export function waveHpScale(wave: number): number { return 1 + (wave - 1) * 0.14; }

export function WEATHER_FOR_WAVE(wave: number, rng: RNG): WeatherId {
  if (wave <= 1) return 'clear';
  return WEATHERS[rng.int(1, WEATHERS.length - 1)];
}

export function previewFor(wave: number, rng: RNG): string[] {
  if (isBossWave(wave)) return ['boss'];
  const unlocked = Object.entries(NORMAL_BY_WAVE)
    .filter(([, min]) => min <= Math.max(2, Math.min(7, Math.ceil(wave / 2))))
    .map(([id]) => id);
  const pool = unlocked.filter(id => id !== 'walker');
  const picks = rng.shuffle(pool).slice(0, Math.min(2, pool.length));
  return ['walker', ...picks];
}

export function composeWave(wave: number, rng: RNG): WavePlan {
  const hpScale = waveHpScale(wave);
  if (isBossWave(wave)) {
    const boss = (Math.floor(wave / 5) % 2 === 1) ? 'butcher' : 'mother';
    const escorts = rng.shuffle(['walker', 'runner', 'fatty']).slice(0, 2);
    return { boss, hpScale,
      groups: escorts.map(id => ({ id, count: 3 + Math.floor(wave / 3) })) };
  }
  const preview = previewFor(wave, rng);
  const total = 5 + wave * 2;
  const groups: WaveGroup[] = preview.map((id, i) => ({
    id, count: Math.max(1, Math.round(total * (i === 0 ? 0.5 : 0.5 / (preview.length - 1)))),
  }));
  return { boss: null, hpScale, groups };
}
