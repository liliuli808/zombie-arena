import { rule, type Rule, type School, type WeatherId, type TalentDef, type CurseDef, type Predicate } from '../core/types';

const has = (s: School, n: number): Predicate => ({ kind: 'schoolCount', school: s, min: n });
const comboWhen = (a: School, b: School): Predicate =>
  ({ kind: 'all', of: [{ kind: 'hasSchools', schools: [a, b] }, { kind: 'always' }] });

export interface SetRule extends Rule { school: School; tier: 2 | 3 }
const setRule = (id: string, school: School, tier: 2 | 3, effects: Rule['effects']): SetRule => ({
  ...rule(id, 'passive', effects, has(school, tier), 'add', 10), school, tier,
});

export const SET_RULES: SetRule[] = [
  setRule('set-blade-2', 'blade', 2, [{ kind: 'stat', key: 'comboCap', add: 4 }]),
  setRule('set-blade-3', 'blade', 3, [
    { kind: 'stat', key: 'comboKeepOnHit', set: true },
    { kind: 'stat', key: 'comboCap', add: 4 }]),
  setRule('set-gun-2', 'gun', 2, [{ kind: 'stat', key: 'magSizeAdd', add: 2 }]),
  setRule('set-gun-3', 'gun', 3, [{ kind: 'stat', key: 'reloadMult', mult: 0.7 }]),
  setRule('set-blunt-2', 'blunt', 2, [{ kind: 'stat', key: 'knockbackMult', mult: 1.25 }]),
  setRule('set-blunt-3', 'blunt', 3, [{ kind: 'stat', key: 'chargeSpeedMult', mult: 1.4 }]),
  setRule('set-tech-2', 'tech', 2, [{ kind: 'stat', key: 'energyRegenMult', mult: 1.25 }]),
  setRule('set-tech-3', 'tech', 3, [{ kind: 'stat', key: 'deployCap', add: 2 }]),
  setRule('set-magic-2', 'magic', 2, [{ kind: 'stat', key: 'manaRegenMult', mult: 1.25 }]),
  setRule('set-magic-3', 'magic', 3, [
    { kind: 'stat', key: 'nthCastFree', set: 5 },
    { kind: 'stat', key: 'castCritMult', set: 3 }, // 三件魔法：法术暴击 3 倍
  ]),
];

// 第 5 次施法免费且伤害翻倍：由 resolveLoadout() 在 3 件魔法时单独追加。
// 用 onHit（而非 onCast）：DamageOp 只在 dealDamage() 里存在，onCast 时 op 为空，乘区会落空。
export const MAGIC_NTH_RULE: Rule = rule('magic-nth-cast', 'onHit',
  [{ kind: 'dmgMult', v: 2 }],
  { kind: 'all', of: [has('magic', 3), { kind: 'castMod', n: 5, rem: 0 }] }, 'mult', 130);

export interface ComboDef { id: string; name: string; desc: string; when: Rule['when']; rules: Rule[] }
export const COMBOS: ComboDef[] = [
  { id: 'enchanted-bullets', name: '附魔子弹', desc: '子弹带元素效果',
    when: comboWhen('gun', 'magic'), rules: [
      rule('combo-enchant-stat', 'passive', [{ kind: 'stat', key: 'enchantedBullets', set: true }]),
      rule('combo-enchant-hit', 'onHit', [{ kind: 'addTag', t: 'elemental' }],
        { kind: 'opTag', tag: 'bullet' }, 'add', 60)] },
  { id: 'shock-baton', name: '电击棍', desc: '重击释放连锁电弧',
    when: comboWhen('blunt', 'tech'), rules: [
      rule('combo-arc-stat', 'passive', [{ kind: 'stat', key: 'arcOnHeavy', set: true }]),
      rule('combo-arc', 'onHeavy', [{ kind: 'spawn', what: 'arc', n: 1 }], undefined, 'add', 60)] },
  { id: 'vampiric-blade', name: '吸血刃', desc: '近战击杀回血',
    when: comboWhen('blade', 'magic'), rules: [
      rule('combo-vamp', 'passive', [{ kind: 'stat', key: 'meleeKillHeal', add: 6 }])] },
  { id: 'rune-turret', name: '符文炮塔', desc: '炮塔发射法术弹',
    when: comboWhen('tech', 'magic'), rules: [
      rule('combo-rune', 'passive', [{ kind: 'stat', key: 'turretSpell', set: true }])] },
  { id: 'smart-aim', name: '智能瞄准', desc: '子弹弱追踪',
    when: comboWhen('gun', 'tech'), rules: [
      rule('combo-homing', 'passive', [{ kind: 'stat', key: 'bulletHoming', add: 1 }])] },
];

const talent = (id: string, name: string, desc: string, effects: Rule['effects']): TalentDef => ({
  id, name, desc, rules: [rule(`t-${id}`, 'passive', effects)],
});
export const TALENTS: TalentDef[] = [
  talent('crit', '致命一击', '暴击率 +10%', [{ kind: 'stat', key: 'critChance', add: 0.1 }]),
  talent('lifesteal', '嗜血', '近战击杀回血 +5', [{ kind: 'stat', key: 'meleeKillHeal', add: 5 }]),
  talent('turret-plus', '额外炮塔', '部署上限 +1', [{ kind: 'stat', key: 'deployCap', add: 1 }]),
  talent('mana', '灵能涌动', '法力回复 +25%', [{ kind: 'stat', key: 'manaRegenMult', mult: 1.25 }]),
  talent('reload', '快速装填', '换弹快 20%', [{ kind: 'stat', key: 'reloadMult', mult: 0.8 }]),
  talent('speed', '轻步', '移速 +8%', [{ kind: 'stat', key: 'moveSpeed', mult: 1.08 }]),
  talent('reach', '长臂', '近战范围 +15', [{ kind: 'stat', key: 'meleeRangeAdd', add: 15 }]),
  talent('elements', '元素亲和', '元素层数上限 +1', [{ kind: 'stat', key: 'elementCapAdd', add: 1 }]),
  talent('interest', '高利贷', '利息上限 +2', [{ kind: 'stat', key: 'interestCap', add: 2 }]),
  talent('hp', '强健', '最大生命 +25', [{ kind: 'stat', key: 'maxHp', add: 25 }]),
  talent('energy', '超频', '能量回复 +25%', [{ kind: 'stat', key: 'energyRegenMult', mult: 1.25 }]),
  talent('charge', '蓄势', '蓄力快 20%', [{ kind: 'stat', key: 'chargeSpeedMult', mult: 1.2 }]),
  talent('knock', '巨力', '击退 +25%', [{ kind: 'stat', key: 'knockbackMult', mult: 1.25 }]),
  talent('combo', '连击大师', '连击上限 +5', [{ kind: 'stat', key: 'comboCap', add: 5 }]),
  talent('greed', '贪财', '每波结束 +3 金', []),
];
TALENTS[TALENTS.length - 1].rules = [rule('t-greed', 'onWaveEnd', [{ kind: 'gold', v: 3 }])];

export const CURSES: CurseDef[] = [
  { id: 'haste', name: '亡者疾行', desc: '僵尸移速 +20%', gold: 12,
    rules: [rule('c-haste', 'passive', [{ kind: 'stat', key: 'zombieSpeedMult', mult: 1.2 }])] },
  { id: 'inflation', name: '奸商', desc: '商店涨价 25%', gold: 12,
    rules: [rule('c-inflation', 'passive', [{ kind: 'stat', key: 'shopPriceMult', mult: 1.25 }])] },
  { id: 'fragile', name: '玻璃之躯', desc: '玩家受伤 +15%', gold: 15,
    rules: [rule('c-fragile', 'passive', [{ kind: 'stat', key: 'playerDamageTakenMult', mult: 1.15 }])] },
  // 「下波必出 Boss」由主循环在 startWave() 里消费 pendingForcedBoss 实现；
  // 「立即获得稀有装备」由 grantRareEquipment() 发放。这里不挂无效果的占位规则。
  { id: 'early-boss', name: '提前降临', desc: '立即获得一件稀有装备，但下波必出 Boss', gold: 18,
    rules: [] },
];

export const WEATHER_RULES: Record<Exclude<WeatherId, 'clear'>, Rule[]> = {
  // 夜晚的「视野缩小」由 renderer 的径向遮罩 + Arena.visionRadius 实现，不需要数值规则。
  night: [],
  rain: [rule('w-rain-lightning', 'onHit', [{ kind: 'dmgMult', v: 1.3 }],
    { kind: 'opElement', element: 'lightning' }, 'mult', 140)],
  fire: [rule('w-fire', 'onWaveStart', [{ kind: 'spawn', what: 'firePatch', n: 3 }],
    { kind: 'weather', id: 'fire' }, 'add', 50)],
  fog: [rule('w-fog', 'onWaveStart', [{ kind: 'spawn', what: 'fog', n: 1 }],
    { kind: 'weather', id: 'fog' }, 'add', 50)],
};
