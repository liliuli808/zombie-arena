import { drawSprite } from './sprites';
import type { RunState, PlayerStats, Phase, Loadout } from '../core/types';
import type { World } from '../game/combat';
import type { Arena } from '../game/arena';
import { WEAPON_BY_ID } from '../data/weapons';
import { GAME_W, GAME_H } from '../core/constants';

export interface RenderInput {
  run: RunState; world: World; arena: Arena; stats: PlayerStats;
  mouse: { x: number; y: number }; phase: Phase; dt: number; loadout: Loadout;
}

export function renderFrame(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
  const { run, world, arena, stats, mouse, phase } = inp;
  ctx.clearRect(0, 0, GAME_W, GAME_H);
  ctx.fillStyle = '#161a22'; ctx.fillRect(0, 0, GAME_W, GAME_H);
  ctx.strokeStyle = '#1f2632'; ctx.lineWidth = 1;
  for (let x = 0; x <= GAME_W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GAME_H); ctx.stroke(); }
  for (let y = 0; y <= GAME_H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GAME_W, y); ctx.stroke(); }
  ctx.fillStyle = '#2a3550';
  for (const t of arena.traps) ctx.fillRect(t.x - 10, t.y - 10, 20, 20);
  for (const o of [...arena.barriers, ...arena.barrels, ...arena.boxes]) {
    if (o.hp <= 0) continue;
    const id = o.kind === 'barrel' ? 'barrel' : 'crate';
    ctx.globalAlpha = o.hp / o.maxHp * 0.5 + 0.5;
    if (o.kind === 'barrier') {
      ctx.fillStyle = '#6b5330'; ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.globalAlpha = 1;
    } else drawSprite(ctx, id, o.x + o.w / 2, o.y + o.h / 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ff7a2f';
  for (const f of arena.fires) { ctx.globalAlpha = 0.5; ctx.fillRect(f.x - 12, f.y - 12, 24, 24); }
  ctx.globalAlpha = 1;
  for (const e of world.entities) {
    if (e.dead) continue;
    drawSprite(ctx, e.id === 1 ? 'player' : e.kind, e.x, e.y);
    if (e.hp < e.maxHp) {
      ctx.fillStyle = '#000'; ctx.fillRect(e.x - 14, e.y - 20, 28, 3);
      ctx.fillStyle = '#e05050'; ctx.fillRect(e.x - 14, e.y - 20, 28 * Math.max(0, e.hp / e.maxHp), 3);
    }
  }
  ctx.font = '12px monospace'; ctx.textAlign = 'center';
  for (const f of world.floating) { ctx.fillStyle = '#ffe9a8'; ctx.fillText(f.text, f.x, f.y); }
  ctx.textAlign = 'left';
  if (arena.weather === 'night' || arena.weather === 'fog') {
    const px = world.entities.find(e => e.id === 1)?.x ?? GAME_W / 2;
    const py = world.entities.find(e => e.id === 1)?.y ?? GAME_H / 2;
    const r = arena.weather === 'night' ? arena.visionRadius : arena.safeRadius;
    const g = ctx.createRadialGradient(px, py, r * 0.55, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(4,6,10,0.96)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_W, GAME_H);
  }
  if (phase === 'combat') {
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mouse.x - 11, mouse.y); ctx.lineTo(mouse.x - 4, mouse.y);
    ctx.moveTo(mouse.x + 4, mouse.y); ctx.lineTo(mouse.x + 11, mouse.y); ctx.stroke();
  }
  drawHud(ctx, inp);
}

function drawHud(ctx: CanvasRenderingContext2D, inp: RenderInput): void {
  const { run, stats, loadout, phase } = inp;
  ctx.fillStyle = '#0d0f14cc'; ctx.fillRect(0, 0, GAME_W, 34);
  ctx.font = '13px monospace'; ctx.fillStyle = '#e8e6df';
  ctx.fillText(`波次 ${run.wave}`, 12, 22);
  ctx.fillText(`金币 ${run.gold}`, 100, 22);
  ctx.fillText(`HP ${Math.ceil(run.hp)}/${stats.maxHp}`, 190, 22);
  ctx.fillText(`击杀 ${run.kills}`, 310, 22);
  ctx.fillText(`天气 ${run.weather}`, 400, 22);
  if (phase === 'combat') ctx.fillText(`剩余 ${inp.world.entities.filter(e => !e.dead && e.id !== 1).length}`, 510, 22);
  ctx.fillStyle = '#ffe066';
  ctx.fillText(`预告: ${run.nextWavePreview.join(' / ') || '—'}`, 620, 22);
  for (let i = 0; i < 3; i++) {
    const x = 12 + i * 118, y = GAME_H - 62;
    ctx.fillStyle = i === run.activeSlot ? '#3a4a6a' : '#1b2130';
    ctx.fillRect(x, y, 110, 52);
    ctx.strokeStyle = i === run.activeSlot ? '#ffe066' : '#445'; ctx.strokeRect(x, y, 110, 52);
    const s = run.slots[i];
    if (s) {
      const d = WEAPON_BY_ID[s.weaponId];
      ctx.fillStyle = '#e8e6df'; ctx.fillText(`${i + 1} ${d.name} ${'★'.repeat(s.star)}`, x + 5, y + 16);
      ctx.fillStyle = '#9fb0c8'; ctx.fillText(`${d.school} | ${resourceText(s.res, d.school)}`, x + 5, y + 33);
    } else { ctx.fillStyle = '#667'; ctx.fillText(`${i + 1} (空)`, x + 5, y + 20); }
  }
  ctx.fillStyle = '#8fdcff';
  ctx.fillText(`套装:${loadout.setBonuses.map(b => `${b.school}${b.count}`).join(' ')}  组合:${loadout.combos.join(' ')}`,
    12, GAME_H - 70);
}
function resourceText(r: { ammo: number; combo: number; charge: number; mana: number; energy: number },
  school: string): string {
  if (school === 'gun') return `弹 ${r.ammo}`;
  if (school === 'blade') return `连击 ${r.combo}`;
  if (school === 'blunt') return `蓄力 ${r.charge.toFixed(1)}`;
  if (school === 'magic') return `法力 ${Math.round(r.mana)}`;
  return `能量 ${Math.round(r.energy)}`;
}
