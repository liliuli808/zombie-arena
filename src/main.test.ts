import { describe, it, expect } from 'vitest';
import { GAME_W, GAME_H } from './core/constants';
import { createRunState, resolveLoadout } from './game/state';
import { rollShop, buyItem, settleWaveEnd } from './game/economy';
import { composeWave, previewFor, WEATHER_FOR_WAVE } from './game/wave';
import { settleRun, defaultSave } from './game/meta';
import { World, dealDamage } from './game/combat';
import { EventBus } from './engine/events';
import { Arena } from './game/arena';
import { newDamageOp } from './core/types';

describe('scaffold', () => {
  it('uses a single-screen 960x640 logical arena', () => {
    expect(GAME_W).toBe(960);
    expect(GAME_H).toBe(640);
  });
});

describe('one full run loop', () => {
  it('shop -> wave -> combat -> settlement -> meta is coherent', () => {
    const run = createRunState(2026, 'veteran', 'yard');
    const bus = new EventBus();
    const world = new World(run, bus);
    const arena = new Arena('yard');
    run.nextWavePreview = previewFor(run.wave, run.rng);
    run.weather = WEATHER_FOR_WAVE(run.wave, run.rng);
    arena.setWeather(run.weather);
    const shop = rollShop(run);
    expect(shop.length).toBeGreaterThanOrEqual(4);
    world.setRules(resolveLoadout(run).rules);
    const plan = composeWave(run.wave, run.rng);
    expect(plan.groups.length).toBeGreaterThan(0);
    // 买一件，验证构筑重算
    const weaponIndex = shop.findIndex(i => i.kind === 'weapon');
    if (weaponIndex >= 0) buyItem(run, weaponIndex);
    world.setRules(resolveLoadout(run).rules);
    // 造一只僵尸并打死
    const z = { id: 2, kind: 'walker', x: 200, y: 200, radius: 12, hp: 10, maxHp: 10,
      speed: 40, facing: 0, tags: [] as string[], statuses: [], dead: false, ttl: 0,
      data: {} as Record<string, number> };
    world.entities.push(z);
    dealDamage(world, z, newDamageOp(50, 'blade', 2, ['melee']));
    expect(run.kills).toBe(1);
    const s = settleWaveEnd(run, run.wave, 0);
    expect(run.gold).toBeGreaterThan(0);
    expect(s.interest).toBeGreaterThanOrEqual(0);
    run.wave += 1;
    const save = settleRun(run, defaultSave());
    expect(save.points).toBeGreaterThan(0);
  });
});
