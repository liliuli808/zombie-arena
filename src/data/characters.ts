import { rule, type CharacterDef } from '../core/types';

export const CHARACTERS: CharacterDef[] = [
  { id: 'veteran', name: '老兵', school: 'gun', shopBias: 'gun', cost: 0,
    desc: '开局 +6 金，换弹快 10%', rules: [
      rule('vet-reload', 'passive', [{ kind: 'stat', key: 'reloadMult', mult: 0.9 }]),
      rule('vet-gold', 'onWaveEnd', [{ kind: 'gold', v: 2 }])] },
  { id: 'wizard', name: '巫师', school: 'magic', shopBias: 'magic', cost: 0,
    desc: '法力回复 +20%，起手 ★2 火球杖', rules: [
      rule('wiz-mana', 'passive', [{ kind: 'stat', key: 'manaRegenMult', mult: 1.2 }])] },
  { id: 'engineer', name: '工程师', school: 'tech', shopBias: 'tech', cost: 40,
    desc: '部署上限 +1，能量回复 +20%', rules: [
      rule('eng-cap', 'passive', [{ kind: 'stat', key: 'deployCap', add: 1 }]),
      rule('eng-energy', 'passive', [{ kind: 'stat', key: 'energyRegenMult', mult: 1.2 }])] },
  { id: 'ronin', name: '浪人', school: 'blade', shopBias: 'blade', cost: 40,
    desc: '连击上限 +4，移速 +8%', rules: [
      rule('ron-combo', 'passive', [{ kind: 'stat', key: 'comboCap', add: 4 }]),
      rule('ron-speed', 'passive', [{ kind: 'stat', key: 'moveSpeed', mult: 1.08 }])] },
  { id: 'jailer', name: '狱卒', school: 'blunt', shopBias: 'blunt', cost: 60,
    desc: '蓄力快 15%，击退 +20%', rules: [
      rule('jail-charge', 'passive', [{ kind: 'stat', key: 'chargeSpeedMult', mult: 1.15 }]),
      rule('jail-knock', 'passive', [{ kind: 'stat', key: 'knockbackMult', mult: 1.2 }])] },
];
export const CHARACTER_BY_ID: Record<string, CharacterDef> =
  Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
