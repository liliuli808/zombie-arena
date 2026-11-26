import { RNG } from '../engine/rng';
import { defaultStats, STAGE_ORDER, newSlotResource,
  type RunState, type Loadout, type PlayerStats, type Rule, type School,
  type ActiveRule, type Ctx, newDamageOp } from '../core/types';
import { WEAPON_BY_ID } from '../data/weapons';
import { CHARACTER_BY_ID } from '../data/characters';
import { PASSIVE_BY_ID } from '../data/shop';
import { SET_RULES, COMBOS, TALENTS, CURSES, WEATHER_RULES, MAGIC_NTH_RULE } from '../data/rules.content';
import { makeOpSink, applyEffect } from '../engine/effects';

export function createRunState(seed: number, characterId: string, mapId: string): RunState {
  const rng = new RNG(seed);
  const slots: RunState['slots'] = [null, null, null];
  // 每个角色都有随身初始武器，进游戏即可攻击（商店仍可在第 2/3 格扩展构筑）
  const char = CHARACTER_BY_ID[characterId];
  if (char) {
    const def = WEAPON_BY_ID[char.start.weapon];
    if (def) {
      const res = newSlotResource();
      if (def.magSize > 0) res.ammo = def.magSize; // 枪械满弹匣开局
      slots[0] = { weaponId: def.id, star: char.start.star, res };
    }
  }
  return {
    seed, rng, phase: 'shop', wave: 1, gold: 15, hp: 100,
    characterId, mapId, slots, passives: [], consumables: {},
    talents: [], curses: [], activeSlot: 0,
    shop: { items: [], freeRefresh: true, refreshCost: 2 },
    weather: 'clear', nextWavePreview: [], kills: 0, bossKills: 0, totalGoldEarned: 0,
  };
}

export function makeCtx(run: RunState, stats: PlayerStats, over: Partial<Ctx> = {}): Ctx {
  const schools: School[] = run.slots.map(s => s ? WEAPON_BY_ID[s.weaponId].school : null)
    .filter((s): s is School => s !== null);
  const stars = run.slots.map(s => s?.star ?? 0);
  const active = run.slots[run.activeSlot];
  return {
    run, stats, schools, stars,
    activeStar: active?.star ?? 0, activeSlot: run.activeSlot,
    sourceSlot: over.op?.sourceSlot ?? run.activeSlot,
    combo: active?.res.combo ?? 0, castCount: active?.res.castCount ?? 0,
    wave: run.wave, weather: run.weather, targetId: 0, target: null,
    op: newDamageOp(0, schools[run.activeSlot] ?? 'blade', 0),
    frontFacing: false, ...over,
  };
}

function collectedRules(run: RunState): { rules: Rule[]; combos: string[];
  setBonuses: Loadout['setBonuses'] } {
  const out: Rule[] = [];
  const schools = run.slots.map(s => s ? WEAPON_BY_ID[s.weaponId].school : null);
  const counts = new Map<School, number>();
  for (const s of schools) if (s) counts.set(s, (counts.get(s) ?? 0) + 1);

  const setBonuses: Loadout['setBonuses'] = [];
  for (const [school, count] of counts) {
    const tier: 0 | 2 | 3 = count >= 3 ? 3 : count === 2 ? 2 : 0;
    setBonuses.push({ school, count, tier });
    if (tier === 0) continue;
    for (const sr of SET_RULES) if (sr.school === school && sr.tier <= tier) out.push(sr);
  }

  const combos: string[] = [];
  const present = new Set(schools.filter((s): s is School => s !== null));
  for (const c of COMBOS) {
    const needed = (c.when as { of: { schools: School[] }[] }).of[0].schools;
    if (needed.every(s => present.has(s))) { combos.push(c.id); out.push(...c.rules); }
  }
  if (counts.get('magic') === 3) out.push(MAGIC_NTH_RULE);

  const char = CHARACTER_BY_ID[run.characterId];
  if (char) out.push(...char.rules);
  for (const id of run.talents) { const t = TALENTS.find(x => x.id === id); if (t) out.push(...t.rules); }
  for (const id of run.curses) { const c = CURSES.find(x => x.id === id); if (c) out.push(...c.rules); }
  for (const id of run.passives) { const p = PASSIVE_BY_ID[id]; if (p) out.push(...p.rules); }
  for (let i = 0; i < run.slots.length; i++) {
    const s = run.slots[i];
    if (!s) continue;
    const def = WEAPON_BY_ID[s.weaponId];
    const bind = (r: Rule, star: 2 | 3): Rule => ({
      ...r,
      // 把 sourceSlot 谓词绑到真实格号，星级加成只对这件武器的伤害生效
      when: { kind: 'sourceSlot', slot: i, star },
    });
    if (s.star >= 2) out.push(...(def.starRules[2] ?? []).map(r => bind(r, 2)));
    if (s.star >= 3) out.push(...(def.starRules[3] ?? []).map(r => bind(r, 3)));
  }
  if (run.weather !== 'clear') out.push(...WEATHER_RULES[run.weather]);
  return { rules: out, combos, setBonuses };
}

export function computeStats(passive: Rule[], ctx: Ctx): PlayerStats {
  const stats = defaultStats();
  ctx.stats = stats;
  const sink = makeOpSink(null, stats);
  const sorted = passive.slice().sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.order - b.order);
  for (const r of sorted) for (const e of r.effects) applyEffect(e as never, sink, ctx);
  return stats;
}

export function resolveLoadout(run: RunState): Loadout {
  const { rules, combos, setBonuses } = collectedRules(run);
  const baseCtx = makeCtx(run, defaultStats());
  const passive = rules.filter(r => r.trigger === 'passive');
  const stats = computeStats(passive, baseCtx);
  const active: ActiveRule[] = rules
    .filter(r => r.trigger !== 'passive')
    .slice()
    .sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.order - b.order);
  return { rules: active, stats, setBonuses, combos };
}
