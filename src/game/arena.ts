import { MAP_BY_ID } from '../data/maps';
import type { WeatherId } from '../core/types';

export interface ArenaObject { x: number; y: number; w: number; h: number; hp: number; maxHp: number; kind: string }
export interface FirePatch { x: number; y: number; time: number }

export class Arena {
  mapId: string;
  barriers: ArenaObject[] = [];
  barrels: ArenaObject[] = [];
  boxes: ArenaObject[] = [];
  traps: { x: number; y: number }[] = [];
  gold = 0;
  weather: WeatherId = 'clear';
  safeRadius = 460;
  visionRadius = 960;
  fires: FirePatch[] = [];
  time = 0;

  constructor(mapId: string) {
    const m = MAP_BY_ID[mapId] ?? MAP_BY_ID['yard'];
    this.mapId = m.id;
    this.barriers = m.barriers.map(b => ({ ...b, hp: 60, maxHp: 60, kind: 'barrier' }));
    this.barrels = m.barrels.map(p => ({ x: p.x, y: p.y, w: 16, h: 16, hp: 12, maxHp: 12, kind: 'barrel' }));
    this.boxes = m.boxes.map(p => ({ x: p.x, y: p.y, w: 20, h: 20, hp: 40, maxHp: 40, kind: 'box' }));
    this.traps = m.traps.map(t => ({ ...t }));
  }
  setWeather(w: WeatherId): void {
    this.weather = w;
    this.safeRadius = 460; this.visionRadius = w === 'night' ? 220 : 960;
    this.fires = [];
    this.time = 0; // 每波重新计时，否则毒雾缩圈会跨波累积
    if (w === 'fire') this.fires = fireSpread(this);
  }
  tick(dt: number): void {
    this.time += dt;
    if (this.weather === 'fog') this.safeRadius = Math.max(140, 460 - this.time * 8);
    if (this.weather === 'fire') {
      for (const f of this.fires) f.time -= dt;
      if (this.fires.length < 6 && this.time % 3 < dt) this.fires.push(...fireSpread(this).slice(0, 1));
      this.fires = this.fires.filter(f => f.time > 0);
    }
  }
  solidObjects(): ArenaObject[] {
    return [...this.barriers.filter(b => b.hp > 0), ...this.boxes.filter(b => b.hp > 0)];
  }
}
export function damageObject(o: ArenaObject, amount: number): string | null {
  o.hp -= amount;
  if (o.hp > 0) return null;
  o.hp = 0;
  return o.kind === 'barrel' ? 'explosion' : o.kind === 'box' ? 'shock' : null;
}
export function repairBarriers(a: Arena, costPer = 5): number {
  let repaired = 0;
  for (const b of a.barriers) {
    if (b.hp < b.maxHp && a.gold >= costPer) { a.gold -= costPer; b.hp = b.maxHp; repaired++; }
  }
  return repaired;
}
export function trapBonusAt(a: Arena, x: number, y: number): number {
  const near = a.traps.some(t => Math.hypot(t.x - x, t.y - y) < 46);
  return near ? 1.5 : 1;
}
export function fireSpread(a: Arena): FirePatch[] {
  const seeds = a.barrels.map(b => ({ x: b.x, y: b.y }));
  return seeds.map((s, i) => ({ x: s.x + i * 24 - 12, y: s.y + i * 12, time: 6 }));
}
