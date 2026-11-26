import { WEAPON_BY_ID } from '../data/weapons';
import { PASSIVE_BY_ID, CONSUMABLE_BY_ID } from '../data/shop';
import { CHARACTERS } from '../data/characters';
import { MAPS } from '../data/maps';
import { TALENTS, CURSES } from '../data/rules.content';
import { UNLOCKS } from '../game/meta';
import { priceOf } from '../game/economy';
import { iconFor } from './icons';
import type { RunState, SaveData, Loadout } from '../core/types';

export type ScreenAction =
  | { t: 'start'; characterId: string; mapId: string }
  | { t: 'selectMap'; mapId: string } | { t: 'repair' }
  | { t: 'buy'; index: number; replaceSlot?: number }
  | { t: 'refresh' } | { t: 'lock'; index: number } | { t: 'sell'; slot: number }
  | { t: 'beginWave' } | { t: 'talent'; id: string } | { t: 'curse'; id: string | null }
  | { t: 'continue' } | { t: 'unlock'; id: string } | { t: 'restart' };

export interface ScreenCallbacks { onAction(a: ScreenAction): void }
const esc = (s: string) => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class Screens {
  constructor(private root: HTMLElement, private cb: ScreenCallbacks) {}
  private html(inner: string, bg?: string): void {
    const background = bg
      ? `background:linear-gradient(#0d0f14cc,#0d0f14ee),url('${bg}') center/cover;`
      : 'background:#0d0f14ee;';
    this.root.innerHTML = `<div style="position:absolute;inset:0;${background}overflow:auto;padding:24px 32px">${inner}</div>`;
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach(el => {
      el.onclick = () => this.cb.onAction(JSON.parse(el.dataset.act!) as ScreenAction);
    });
  }
  clear(): void { this.root.innerHTML = ''; }
  private btn(act: ScreenAction, label: string, disabled = false): string {
    return `<button data-act='${esc(JSON.stringify(act))}' ${disabled ? 'disabled' : ''}
      style="background:#2b3a55;color:#e8e6df;border:1px solid #4a6080;padding:6px 12px;margin:3px;cursor:pointer;font:inherit">${esc(label)}</button>`;
  }

  private btnRaw(act: ScreenAction, inner: string, disabled = false): string {
    return `<button data-act='${esc(JSON.stringify(act))}' ${disabled ? 'disabled' : ''}
      style="background:#2b3a55;color:#e8e6df;border:1px solid #4a6080;padding:6px 12px;margin:3px;cursor:pointer;font:inherit">${inner}</button>`;
  }

  private iconImg(kind: 'weapon' | 'passive' | 'consumable', id: string): string {
    const src = iconFor(kind, id);
    if (!src) return '';
    return `<img src="${src}" width="32" height="32" draggable="false"
      onerror="this.style.display='none'" style="image-rendering:pixelated;vertical-align:middle;margin-right:6px">`;
  }
  title(save: SaveData): void {
    this.html(`<h1 style="color:#ffe066">僵尸竞技场</h1>
      <p>最高波次 ${save.bestWave} · 点数 ${save.points} · 总击杀 ${save.totalKills}</p>
      ${this.btn({ t: 'continue' }, '开始新的一局')}
      <h3>局外解锁</h3>
      ${UNLOCKS.map(u => `${esc(u.name)} (${u.cost} 点) ${this.btn({ t: 'unlock', id: u.id },
        save.unlockedCharacters.includes(u.id) || save.unlockedMaps.includes(u.id)
          || save.unlockedWeapons.includes(u.id) ? '已解锁' : '解锁',
        save.points < u.cost || save.unlockedCharacters.includes(u.id)
          || save.unlockedMaps.includes(u.id) || save.unlockedWeapons.includes(u.id))}`).join('<br>')}`,
      '/assets/art/title.png');
  }
  characterSelect(save: SaveData, mapId = 'yard'): void {
    const maps = MAPS.filter(m => save.unlockedMaps.includes(m.id));
    const mapBtns = maps.map(m => this.btn({ t: 'selectMap', mapId: m.id },
      m.id === mapId ? `【${m.name}】` : m.name)).join('');
    this.html(`<h2>选择角色 / 地图</h2>
      <h3>地图</h3>${mapBtns}
      <h3>角色</h3>
      ${CHARACTERS.map(c => this.btnRaw({ t: 'start', characterId: c.id, mapId },
        `<img src="/assets/portraits/${c.id}.png" width="64" height="64" draggable="false"
          onerror="this.style.display='none'"
          style="image-rendering:pixelated;vertical-align:middle;margin-right:8px">
         ${esc(c.name)} — ${esc(c.desc)}`,
        !save.unlockedCharacters.includes(c.id))).join('<br>')}
      <p style="color:#889">当前地图：${esc(MAPS.find(m => m.id === mapId)?.name ?? '废弃货场')} · 其余地图在标题页解锁。</p>`);
  }
  shop(run: RunState, loadout: Loadout, options?: { needReplace?: number }): void {
    const need = options?.needReplace;
    const items = run.shop.items.map((it, i) => {
      const name = it.kind === 'weapon' ? WEAPON_BY_ID[it.id]?.name
        : it.kind === 'passive' ? PASSIVE_BY_ID[it.id]?.name : CONSUMABLE_BY_ID[it.id]?.name;
      const school = it.kind === 'weapon' ? ` [${WEAPON_BY_ID[it.id]?.school}]` : '';
      return `<div style="border:1px solid #33405a;padding:8px;margin:6px 0;max-width:620px">
        ${this.iconImg(it.kind, it.id)}
        <b>${esc(name ?? it.id)}</b>${esc(school)} — ${priceOf(run, it)} 金 ${it.locked ? '🔒' : ''}
        ${this.btn({ t: 'buy', index: i }, '购买')}
        ${this.btn({ t: 'lock', index: i }, it.locked ? '解锁' : '锁定')}</div>`;
    }).join('');
    const slots = run.slots.map((s, i) => s
      ? `${i + 1}. ${WEAPON_BY_ID[s.weaponId].name} ★${s.star} ${this.btn({ t: 'sell', slot: i }, '售出')}`
      : `${i + 1}. (空)`).join('<br>');
    const replace = need === undefined ? '' :
      `<p style="color:#ff9a3c">装备栏已满，选择要替换的格子：${[0,1,2].map(i =>
        this.btn({ t: 'buy', index: need, replaceSlot: i }, `替换 ${i + 1}`)).join('')}</p>`;
    this.html(`<h2>商店 · 第 ${run.wave} 波前</h2>
      <p>金币 <b style="color:#ffe066">${run.gold}</b> · 下波预告 <b>${esc(run.nextWavePreview.join(' / '))}</b>
      · 利息上限 ${loadout.stats.interestCap} · 天气 ${esc(run.weather)}</p>
      <div style="display:flex;gap:40px"><div><h3>装备栏</h3>${slots}
      <h3>被动 (${run.passives.length}/3)</h3>${run.passives.map(p =>
        `${this.iconImg('passive', p)}${esc(PASSIVE_BY_ID[p]?.name ?? p)}`).join(' / ') || '—'}
      <h3>消耗品</h3>${Object.entries(run.consumables).map(([k, v]) =>
        `${this.iconImg('consumable', k)}${esc(CONSUMABLE_BY_ID[k]?.name ?? k)} x${v}`).join(' / ') || '—'}
      <h3>套装 / 组合技</h3><span style="color:#8fdcff">${esc(loadout.setBonuses.map(b => `${b.school}×${b.count}`).join(' ') || '无')}
      | ${esc(loadout.combos.join(' ') || '无')}</span>
      <h3>地图工事</h3>${this.btn({ t: 'repair' }, '修补路障 (5 金/处)')}</div>
      <div><h3>货架 ${this.btn({ t: 'refresh' }, `刷新 (${run.shop.freeRefresh ? '免费' : '2 金'})`)}</h3>${items}${replace}</div></div>
      <p>${this.btn({ t: 'beginWave' }, '开始战斗 →')}</p>`);
  }
  waveEnd(run: RunState, talentIds: string[], curseIds: string[], clearedWave: number,
    pickedTalent: boolean, pickedCurse: boolean): void {
    const talents = talentIds.map(id => {
      const t = TALENTS.find(x => x.id === id)!;
      return `${this.btn({ t: 'talent', id }, `${t.name} — ${t.desc}`, pickedTalent)}`;
    }).join('');
    const curses = curseIds.map(id => {
      const c = CURSES.find(x => x.id === id)!;
      return `${this.btn({ t: 'curse', id }, `${c.name} (+${c.gold} 金) — ${c.desc}`, pickedCurse)}`;
    }).join('');
    this.html(`<h2>第 ${clearedWave} 波结束 · 金币 ${run.gold}</h2>
      <h3>天赋三选一</h3>${talents}
      <h3>诅咒契约（可选，换金币 / 稀有装备）</h3>${curses}
      ${this.btn({ t: 'curse', id: null }, '拒绝契约', pickedCurse)}
      <p>${this.btn({ t: 'continue' }, '进入商店 →', !pickedTalent)}</p>`);
  }
  gameOver(run: RunState, save: SaveData): void {
    this.html(`<h1 style="color:#ff7a6a">你倒下了</h1>
      <p>到达波次 <b>${run.wave}</b> · 击杀 ${run.kills} · Boss ${run.bossKills} · 种子 ${run.seed}</p>
      <p>累计点数 ${save.points}（本局 +${run.wave * 2 + Math.floor(run.kills / 10) + run.bossKills * 5}）</p>
      ${this.btn({ t: 'restart' }, '返回标题')}`);
  }
}
