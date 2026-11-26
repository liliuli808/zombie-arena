import { describe, expect, it } from 'vitest';
import { Canvas, renderFrame, WALK_POSES } from './rig';
import { buildCharacter, CHARACTERS, POSE_ORDER } from './characters';

describe('Canvas', () => {
  it('starts fully empty and clips writes outside the grid', () => {
    const c = new Canvas(8, 8);
    expect(c.rows().every((r) => r === '........')).toBe(true);
    c.set(-5, 3, 'x');
    c.set(99, 3, 'x');
    expect(c.rows().every((r) => r === '........')).toBe(true);
  });

  it('draws a filled disc of the requested radius', () => {
    const c = new Canvas(9, 9);
    c.disc(4, 4, 2, 'x');
    const solid = c.rows().join('').split('').filter((ch) => ch === 'x').length;
    expect(solid).toBeGreaterThan(8);
    expect(c.get(4, 4)).toBe('x');
    expect(c.get(4, 0)).toBe('.');
  });

  it('outline wraps only pixels adjacent to solid ones', () => {
    const c = new Canvas(5, 5);
    c.set(2, 2, 'x');
    c.outline('k');
    expect(c.get(2, 2)).toBe('x');
    expect(c.get(1, 2)).toBe('k');
    expect(c.get(2, 1)).toBe('k');
    expect(c.get(0, 0)).toBe('.');
  });
});

describe('renderFrame', () => {
  const spec = CHARACTERS.player;

  it('produces a 48×48 grid for every pose', () => {
    for (const key of POSE_ORDER) {
      const rows = renderFrame(spec.rig, spec.look, WALK_POSES[key]);
      expect(rows).toHaveLength(48);
      expect(rows.every((r) => r.length === 48)).toBe(true);
    }
  });

  it('keeps every body pixel inside the canvas for all walk poses', () => {
    for (const key of POSE_ORDER) {
      const rows = renderFrame(spec.rig, spec.look, WALK_POSES[key]);
      expect(rows[0]).toBe('.'.repeat(48));
      expect(rows[47].replace(/\./g, '')).toBe('');
      const leftEdge = rows.map((r) => r[0]).join('');
      const rightEdge = rows.map((r) => r[47]).join('');
      expect(leftEdge.replace(/\./g, '')).toBe('');
      expect(rightEdge.replace(/\./g, '')).toBe('');
    }
  });

  it('gives walk frames more spread than idle frames', () => {
    const width = (key: keyof typeof WALK_POSES) => {
      const rows = renderFrame(spec.rig, spec.look, WALK_POSES[key]);
      const cols = new Set<number>();
      rows.forEach((r) => [...r].forEach((ch, x) => ch !== '.' && cols.add(x)));
      return Math.max(...cols) - Math.min(...cols);
    };
    expect(Math.max(width('walk0'), width('walk2'))).toBeGreaterThan(width('idleA'));
  });

  it('swings the feet through the walk cycle', () => {
    const footSpan = (key: keyof typeof WALK_POSES) => {
      const rows = renderFrame(spec.rig, spec.look, WALK_POSES[key]);
      for (let y = rows.length - 1; y >= 0; y--) {
        const xs = [...rows[y]].map((ch, x) => (ch !== '.' ? x : -1)).filter((x) => x >= 0);
        if (xs.length) return { min: Math.min(...xs), max: Math.max(...xs) };
      }
      return { min: 0, max: 0 };
    };
    const left = footSpan('walk0');
    const right = footSpan('walk2');
    expect(left.max - left.min).toBeGreaterThan(3);
    expect(right.max - right.min).toBeGreaterThan(3);
    // contact frames lean forward, so their feet sit further right than the idle stance
    expect(footSpan('idleA').max).toBeLessThan(Math.max(left.max, right.max));
  });
});

describe('buildCharacter', () => {
  it('returns a 48 view sprite with one palette entry per used char', () => {
    const art = buildCharacter('player');
    expect(art.view).toBe(48);
    expect(art.frames).toHaveLength(POSE_ORDER.length);
    const used = new Set(
      art.frames.flatMap((f) => f.join('').split('')).filter((ch) => ch !== '.'),
    );
    for (const ch of used) expect(art.palette[ch]).toBeDefined();
  });

  it('rejects unknown character ids', () => {
    expect(() => buildCharacter('nope')).toThrow(/unknown character/);
  });
});
