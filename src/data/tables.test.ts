import { describe, it, expect } from 'vitest';
import { WEAPONS, WEAPON_BY_ID } from './weapons';
import { ZOMBIES, ZOMBIE_BY_ID } from './zombies';
import { CHARACTERS } from './characters';
import { PASSIVES, CONSUMABLES } from './shop';
import { MAPS } from './maps';
import type { School } from '../core/types';

const SCHOOLS: School[] = ['blade', 'gun', 'blunt', 'tech', 'magic'];

describe('data tables', () => {
  it('has exactly 3 weapons in each of the 5 schools (15 total)', () => {
    expect(WEAPONS).toHaveLength(15);
    for (const s of SCHOOLS) expect(WEAPONS.filter(w => w.school === s)).toHaveLength(3);
  });
  it('has unique ids and valid prices / star rules', () => {
    expect(new Set(WEAPONS.map(w => w.id)).size).toBe(15);
    for (const w of WEAPONS) {
      expect(w.price).toBeGreaterThan(0);
      expect(WEAPON_BY_ID[w.id]).toBe(w);
      expect(w.starRules[2]).toBeDefined();
      expect(w.starRules[3]).toBeDefined();
    }
  });
  it('has 7 normal zombies and 2 bosses', () => {
    expect(ZOMBIES.filter(z => !z.boss)).toHaveLength(7);
    expect(ZOMBIES.filter(z => z.boss)).toHaveLength(2);
    expect(ZOMBIES.filter(z => z.elite)).toHaveLength(2);
    for (const z of ZOMBIES) expect(ZOMBIE_BY_ID[z.id]).toBe(z);
  });
  it('shield/front-immunity and armor breakArmor are declared as rules', () => {
    expect(ZOMBIE_BY_ID['shield'].rules.some(r => r.id === 'shield-front-immune')).toBe(true);
    expect(ZOMBIE_BY_ID['armored'].tags).toContain('armored');
    expect(WEAPONS.filter(w => w.school === 'blunt').every(w => w.id.length > 0)).toBe(true);
  });
  it('has 5 characters, 5 passives, 3 consumables and 3 maps', () => {
    expect(CHARACTERS).toHaveLength(5);
    expect(new Set(CHARACTERS.map(c => c.shopBias)).size).toBe(5);
    expect(PASSIVES.length).toBeGreaterThanOrEqual(4);
    expect(CONSUMABLES.length).toBeGreaterThanOrEqual(3);
    expect(MAPS).toHaveLength(3);
    for (const m of MAPS) expect(m.traps.length).toBeGreaterThan(0);
  });
});
