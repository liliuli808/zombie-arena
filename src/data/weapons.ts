import { rule, type WeaponDef, type Effect } from '../core/types';

const dmgAdd = (v: number): Effect => ({ kind: 'dmgAdd', v });
const dmgMult = (v: number): Effect => ({ kind: 'dmgMult', v });

function w(d: Omit<WeaponDef, 'starRules' | 'fireInterval' | 'range' | 'magSize' | 'reloadTime'
  | 'chargeMax' | 'manaCost' | 'energyCost' | 'deployLimit' | 'element'> &
  Partial<Pick<WeaponDef, 'fireInterval' | 'range' | 'magSize' | 'reloadTime' | 'chargeMax'
  | 'manaCost' | 'energyCost' | 'deployLimit' | 'element'>>): WeaponDef {
  return {
    fireInterval: 0.35, range: 90, magSize: 0, reloadTime: 0, chargeMax: 0,
    manaCost: 0, energyCost: 0, deployLimit: 0, element: null,
    // 星级规则必须绑定「造成伤害的那一格」，否则备用栏的 ★2/★3 武器
    // 会给近战、炮塔、手雷等所有伤害来源凭空加伤。
    starRules: {
      2: [rule(`${d.id}-s2`, 'onHit', [dmgAdd(d.baseDamage * 0.25)],
        { kind: 'sourceSlot', slot: 0, star: 2 }, 'add')],
      3: [rule(`${d.id}-s3`, 'onHit', [dmgMult(1.25)],
        { kind: 'sourceSlot', slot: 0, star: 3 }, 'mult', 120)],
    },
    ...d,
  } as WeaponDef;
}

export const WEAPONS: WeaponDef[] = [
  w({ id: 'shortknife', name: '短刀', school: 'blade', rarity: 1, price: 3, ability: 'meleeSwing',
      baseDamage: 9, fireInterval: 0.18, range: 62, sprite: 'knife', desc: '极快连击，靠层数堆伤害' }),
  w({ id: 'katana', name: '武士刀', school: 'blade', rarity: 2, price: 6, ability: 'meleeSwing',
      baseDamage: 17, fireInterval: 0.3, range: 84, sprite: 'katana', desc: '更长更痛，连击收益高' }),
  w({ id: 'chainsaw', name: '链锯', school: 'blade', rarity: 3, price: 10, ability: 'meleeSwing',
      baseDamage: 4, fireInterval: 0.08, range: 56, sprite: 'saw', desc: '按住持续切割，会过热' }),
  w({ id: 'pistol', name: '手枪', school: 'gun', rarity: 1, price: 3, ability: 'hitscan',
      baseDamage: 14, fireInterval: 0.28, range: 520, magSize: 8, reloadTime: 1.1, sprite: 'pistol',
      desc: '稳定远程，R 换弹' }),
  w({ id: 'shotgun', name: '霰弹枪', school: 'gun', rarity: 2, price: 6, ability: 'hitscan',
      baseDamage: 9, fireInterval: 0.65, range: 240, magSize: 5, reloadTime: 1.7, sprite: 'shotgun',
      desc: '扇形 5 弹丸，贴脸爆发' }),
  w({ id: 'sniper', name: '狙击枪', school: 'gun', rarity: 3, price: 10, ability: 'hitscan',
      baseDamage: 60, fireInterval: 1.1, range: 900, magSize: 3, reloadTime: 2.2, sprite: 'sniper',
      desc: '穿透 + 开镜减速' }),
  w({ id: 'bat', name: '球棒', school: 'blunt', rarity: 1, price: 3, ability: 'chargeSlam',
      baseDamage: 16, chargeMax: 1.2, range: 78, sprite: 'bat', desc: '蓄力扇形重击 + 击退' }),
  w({ id: 'hammer', name: '铁锤', school: 'blunt', rarity: 2, price: 6, ability: 'chargeSlam',
      baseDamage: 26, chargeMax: 1.2, range: 90, sprite: 'hammer', desc: '蓄满眩晕 0.8s' }),
  w({ id: 'mace', name: '狼牙棒', school: 'blunt', rarity: 3, price: 10, ability: 'chargeSlam',
      baseDamage: 32, chargeMax: 1.2, range: 96, sprite: 'mace', desc: '重击自带破甲' }),
  w({ id: 'turret', name: '自动炮塔', school: 'tech', rarity: 1, price: 3, ability: 'placeDeployable',
      baseDamage: 8, energyCost: 35, deployLimit: 2, range: 300, sprite: 'turret',
      desc: '右键放置，自动索敌' }),
  w({ id: 'grid', name: '电网', school: 'tech', rarity: 2, price: 6, ability: 'placeDeployable',
      baseDamage: 5, energyCost: 45, deployLimit: 2, range: 110, sprite: 'grid',
      desc: '地面持续伤害区域' }),
  w({ id: 'drone', name: '无人机', school: 'tech', rarity: 3, price: 10, ability: 'placeDeployable',
      baseDamage: 11, energyCost: 55, deployLimit: 1, range: 360, sprite: 'drone',
      desc: '跟随并自动射击' }),
  w({ id: 'firestaff', name: '火球杖', school: 'magic', rarity: 1, price: 3, ability: 'spellBolt',
      baseDamage: 20, manaCost: 18, range: 480, element: 'fire', sprite: 'firestaff',
      desc: '火 = 灼烧 DoT' }),
  w({ id: 'frosttome', name: '冰霜法典', school: 'magic', rarity: 2, price: 6, ability: 'spellBolt',
      baseDamage: 16, manaCost: 20, range: 440, element: 'ice', sprite: 'frosttome',
      desc: '冰 = 减速叠层 → 冻结' }),
  w({ id: 'ring', name: '雷电戒指', school: 'magic', rarity: 3, price: 10, ability: 'aoeBurst',
      baseDamage: 24, manaCost: 28, range: 160, element: 'lightning', sprite: 'ring',
      desc: '雷 = 导电叠层 → 连锁' }),
];

for (const weapon of WEAPONS) {
  if (weapon.school === 'blunt') {
    weapon.starRules[2]!.push(rule(`${weapon.id}-break`, 'onHeavy',
      [{ kind: 'addTag', t: 'breakArmor' }], undefined, 'add'));
  }
}

export const WEAPON_BY_ID: Record<string, WeaponDef> =
  Object.fromEntries(WEAPONS.map(x => [x.id, x]));
