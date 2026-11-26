import { describe, expect, it } from 'vitest';
import { iconFor } from './icons';

describe('iconFor', () => {
  it('returns static icon paths for passives and consumables', () => {
    expect(iconFor('consumable', 'medkit')).toBe('/assets/icons/medkit.png');
    expect(iconFor('passive', 'armor')).toBe('/assets/icons/armor.png');
  });

  it('returns an empty string for weapon icons without a DOM', () => {
    expect(iconFor('weapon', 'pistol')).toBe('');
  });
});
