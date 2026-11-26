import { describe, expect, it } from 'vitest';
import { iconFor, weaponSpriteId } from './icons';
import { SPRITES } from './sprites';
import { WEAPON_BY_ID } from '../data/weapons';

describe('iconFor', () => {
  it('returns static icon paths for passives and consumables', () => {
    expect(iconFor('consumable', 'medkit')).toBe('/assets/icons/medkit.png');
    expect(iconFor('passive', 'armor')).toBe('/assets/icons/armor.png');
  });

  it('returns an empty string for weapon icons without a DOM', () => {
    expect(iconFor('weapon', 'pistol')).toBe('');
  });
});

describe('weaponSpriteId', () => {
  it('maps weapon ids whose sprite name differs', () => {
    expect(weaponSpriteId('shortknife')).toBe('knife');
    expect(weaponSpriteId('chainsaw')).toBe('saw');
    expect(weaponSpriteId('pistol')).toBe('pistol');
  });

  it('resolves every weapon to a drawable sprite', () => {
    for (const w of Object.values(WEAPON_BY_ID)) {
      expect(SPRITES[weaponSpriteId(w.id)]).toBeDefined();
    }
  });

  it('renders a weapon icon when a canvas is available', () => {
    const calls: string[] = [];
    const ctx = new Proxy({}, { get: (_t, k) => {
      if (k === 'canvas') return { width: 48, height: 48 };
      return (...a: unknown[]) => { calls.push(String(k)); void a; };
    } });
    const fakeCanvas = {
      width: 0, height: 0,
      getContext: () => ctx,
      toDataURL: () => 'data:image/png;base64,AAAA',
    };
    const g = globalThis as { document?: unknown };
    g.document = { createElement: () => fakeCanvas };
    try {
      expect(iconFor('weapon', 'shortknife')).toBe('data:image/png;base64,AAAA');
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      delete g.document;
    }
  });
});