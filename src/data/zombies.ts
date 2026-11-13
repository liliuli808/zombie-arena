import { rule, type ZombieDef, type Effect } from '../core/types';

const negate: Effect = { kind: 'negate' };
const dmgMult = (v: number): Effect => ({ kind: 'dmgMult', v });

function z(d: Omit<ZombieDef, 'rules' | 'elite' | 'boss' | 'behaviour' | 'gold'> &
  Partial<Pick<ZombieDef, 'rules' | 'elite' | 'boss' | 'behaviour' | 'gold'>>): ZombieDef {
  return { rules: [], elite: false, boss: false, behaviour: 'chase', gold: 1, ...d } as ZombieDef;
}

export const ZOMBIES: ZombieDef[] = [
  z({ id: 'walker', name: '普通僵尸', hp: 26, speed: 42, radius: 11, sprite: 'walker', tags: [] }),
  z({ id: 'runner', name: '奔跑者', hp: 16, speed: 108, radius: 9, sprite: 'runner', tags: ['fast'] }),
  z({ id: 'fatty', name: '胖子', hp: 90, speed: 30, radius: 18, sprite: 'fatty', tags: ['explodes'] }),
  z({ id: 'shield', name: '持盾僵尸', hp: 55, speed: 40, radius: 13, sprite: 'shield', tags: ['shield'],
      rules: [rule('shield-front-immune', 'onHit', [negate],
        { kind: 'all', of: [{ kind: 'opTag', tag: 'bullet' }, { kind: 'frontFacing', v: true }] },
        'override', 900)] }),
  z({ id: 'spitter', name: '吐酸僵尸', hp: 34, speed: 46, radius: 12, sprite: 'spitter',
      behaviour: 'spitter', tags: ['poison'], rules: [
        rule('spitter-poison-hit', 'onHit', [{ kind: 'status', s: 'poison', stacks: 1 }], undefined, 'add')] }),
  z({ id: 'summoner', name: '召唤者', hp: 70, speed: 34, radius: 14, sprite: 'summoner',
      behaviour: 'summoner', elite: true, gold: 3, tags: ['priority'], rules: [
        rule('summoner-summon', 'onWaveStart', [{ kind: 'spawn', what: 'walker', n: 2 }],
          { kind: 'targetTag', tag: 'priority' }, 'add')] }),
  z({ id: 'armored', name: '装甲僵尸', hp: 120, speed: 32, radius: 16, sprite: 'armored',
      elite: true, gold: 3, tags: ['armored'], rules: [
        rule('armored-reduce', 'onHit', [dmgMult(0.45)],
          { kind: 'not', of: { kind: 'opTag', tag: 'breakArmor' } }, 'mult', 150)] }),
  z({ id: 'butcher', name: '巨型屠夫', hp: 900, speed: 62, radius: 30, sprite: 'butcher',
      boss: true, gold: 15, behaviour: 'boss', tags: ['boss', 'charges'] }),
  z({ id: 'mother', name: '尸潮之母', hp: 750, speed: 36, radius: 28, sprite: 'mother',
      boss: true, gold: 15, behaviour: 'boss', tags: ['boss', 'summons'] }),
];

export const ZOMBIE_BY_ID: Record<string, ZombieDef> =
  Object.fromEntries(ZOMBIES.map(x => [x.id, x]));
