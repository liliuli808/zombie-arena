import type { School, WeatherId } from '../core/types';
import { ZOMBIE_BY_ID } from '../data/zombies';
import { COMBOS } from '../data/rules.content';

export interface SchoolMeta {
  name: string;
  color: string;
  soft: string;
  tag: string;
}

export const SCHOOL_META: Record<School, SchoolMeta> = {
  blade: { name: '利刃', color: '#ff7b54', soft: 'rgba(255,123,84,0.16)', tag: '近战连击' },
  gun:   { name: '枪械', color: '#f5c542', soft: 'rgba(245,197,66,0.16)', tag: '远程火力' },
  blunt: { name: '钝器', color: '#e85d75', soft: 'rgba(232,93,117,0.16)', tag: '蓄力击退' },
  tech:  { name: '科技', color: '#4fd1ff', soft: 'rgba(79,209,255,0.16)', tag: '自动部署' },
  magic: { name: '魔法', color: '#b78bfa', soft: 'rgba(183,139,250,0.16)', tag: '元素法术' },
};

export interface WeatherMeta {
  name: string;
  icon: string;
  color: string;
  desc: string;
}

export const WEATHER_META: Record<WeatherId, WeatherMeta> = {
  clear: { name: '晴朗', icon: '☀', color: '#c8d4e3', desc: '视野开阔，无环境异变' },
  night: { name: '永夜', icon: '☾', color: '#8fa8ff', desc: '视野受限，仅余随身光束' },
  rain:  { name: '雷雨', icon: '⚡', color: '#4fd1ff', desc: '雷电伤害 +30%' },
  fire:  { name: '火场', icon: '🔥', color: '#ff8a3d', desc: '地面持续蔓延燃烧火带' },
  fog:   { name: '毒雾', icon: '☣', color: '#7ee068', desc: '安全区随时间不断收缩' },
};

export interface RarityMeta {
  name: string;
  color: string;
  cls: string;
}

export const RARITY_META: Record<1 | 2 | 3, RarityMeta> = {
  1: { name: '普通', color: '#9aa8bc', cls: 'r1' },
  2: { name: '精良', color: '#4fd1ff', cls: 'r2' },
  3: { name: '稀有', color: '#f5c542', cls: 'r3' },
};

export const MAP_SUBTITLES: Record<string, { badge: string; desc: string }> = {
  yard:    { badge: '均衡开阔', desc: '集装箱与油桶错落，适合全流派拉扯' },
  lab:     { badge: '狭长防线', desc: '横向防爆墙与高密电容陷阱，易守难攻' },
  rooftop: { badge: '立体掩体', desc: '中轴重型掩体阻隔尸潮，雨夜视野紧张' },
};

export function schoolMeta(s: School): SchoolMeta {
  return SCHOOL_META[s] ?? SCHOOL_META.gun;
}

export function weatherMeta(w: WeatherId): WeatherMeta {
  return WEATHER_META[w] ?? WEATHER_META.clear;
}

export function rarityMeta(r: 1 | 2 | 3): RarityMeta {
  return RARITY_META[r] ?? RARITY_META[1];
}

export function zombieLabel(id: string): string {
  if (id === 'boss') return 'Boss 降临';
  return ZOMBIE_BY_ID[id]?.name ?? id;
}

export function comboLabel(id: string): { name: string; desc: string } {
  const c = COMBOS.find(x => x.id === id);
  return c ? { name: c.name, desc: c.desc } : { name: id, desc: '' };
}
