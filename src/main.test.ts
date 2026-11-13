import { describe, it, expect } from 'vitest';
import { GAME_W, GAME_H } from './core/constants';

describe('scaffold', () => {
  it('uses a single-screen 960x640 logical arena', () => {
    expect(GAME_W).toBe(960);
    expect(GAME_H).toBe(640);
  });
});
