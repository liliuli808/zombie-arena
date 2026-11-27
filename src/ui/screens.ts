import { WEAPON_BY_ID } from '../data/weapons';
import { PASSIVE_BY_ID, CONSUMABLE_BY_ID } from '../data/shop';
import { CHARACTERS } from '../data/characters';
import { MAPS } from '../data/maps';
import { TALENTS, CURSES } from '../data/rules.content';
import { UNLOCKS } from '../game/meta';
import { priceOf } from '../game/economy';
import { iconFor } from './icons';
import {
  schoolMeta, weatherMeta, zombieLabel, rarityMeta, comboLabel, MAP_SUBTITLES,
} from './labels';
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

const UNLOCK_KIND_LABEL: Record<string, string> = {
  character: '新角色',
  map: '新地图',
  weapon: '商店武器',
};

export class Screens {
  constructor(private root: HTMLElement, private cb: ScreenCallbacks) {}

  private render(inner: string, cls = 'scr', bg?: string): void {
    const style = bg
      ? ` style="background-image:linear-gradient(95deg,rgba(8,10,16,0.92) 0%,rgba(10,14,22,0.72) 52%,rgba(8,10,16,0.52) 100%),linear-gradient(180deg,rgba(8,10,16,0.22) 0%,rgba(8,10,16,0.92) 86%),url('${bg}');"`
      : '';
    this.root.innerHTML = `<div class="${cls}"${style}>${inner}</div>`;
    this.root.querySelectorAll<HTMLElement>('[data-act]').forEach(el => {
      el.onclick = () => this.cb.onAction(JSON.parse(el.dataset.act!) as ScreenAction);
    });
  }

  clear(): void { this.root.innerHTML = ''; }

  /** 注意：data-act 使用单引号，且 disabled 必须位于 data-act 之后（供测试解析器识别）。 */
  private btn(act: ScreenAction, label: string, cls = 'btn', disabled = false): string {
    return `<button class="${cls}" data-act='${esc(JSON.stringify(act))}' ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
  }

  private btnRaw(act: ScreenAction, inner: string, cls = 'btn', disabled = false, extraStyle = ''): string {
    const st = extraStyle ? ` style="${extraStyle}"` : '';
    return `<button class="${cls}"${st} data-act='${esc(JSON.stringify(act))}' ${disabled ? 'disabled' : ''}>${inner}</button>`;
  }

  private iconTag(kind: 'weapon' | 'passive' | 'consumable', id: string): string {
    const src = iconFor(kind, id);
    if (!src) return '';
    return `<img src="${src}" draggable="false" onerror="this.style.display='none'" alt="">`;
  }

  title(save: SaveData): void {
    const unlockCards = UNLOCKS.map(u => {
      const owned = save.unlockedCharacters.includes(u.id)
        || save.unlockedMaps.includes(u.id)
        || save.unlockedWeapons.includes(u.id);
      const canBuy = !owned && save.points >= u.cost;
      return `<div class="unlock-card ${owned ? 'done' : ''}">
        <div class="unlock-info">
          <div class="unlock-name">${esc(u.name)}</div>
          <div class="unlock-meta">${UNLOCK_KIND_LABEL[u.kind] ?? u.kind} · ${u.cost} 点</div>
        </div>
        ${this.btn({ t: 'unlock', id: u.id }, owned ? '已解锁' : '解锁',
          owned ? 'btn btn-sm btn-ghost' : 'btn btn-sm', !canBuy)}
      </div>`;
    }).join('');

    this.render(`
      <div class="title-hero">
        <span class="eyebrow">Tactical Roguelike Arena</span>
        <h1 class="title-logo">僵尸竞技场</h1>
        <p class="title-sub">五流派构筑 · 跨流派组合技 · 动态天气与尸潮 Boss 攻坚。在霓虹与废墟中活过下一波。</p>
        <div class="stat-strip">
          <span class="stat-pill">最高波次 <strong>${save.bestWave}</strong></span>
          <span class="stat-pill gold">局外点数 <strong>${save.points}</strong></span>
          <span class="stat-pill">累计击杀 <strong>${save.totalKills}</strong></span>
        </div>
        <div class="title-cta-row">
          ${this.btn({ t: 'continue' }, '开始新的一局', 'btn btn-primary')}
        </div>
      </div>
      <div class="unlock-panel">
        <div class="section-head">
          <h3 class="section-title">局外军械库解锁</h3>
          <span class="section-hint">每局结算自动累计点数 · 解锁角色 / 地图 / 稀有武器池</span>
        </div>
        <div class="unlock-grid">${unlockCards}</div>
      </div>
    `, 'scr scr-title', '/assets/art/title.png');
  }

  characterSelect(save: SaveData, mapId = 'yard'): void {
    const mapCards = MAPS.map(m => {
      const unlocked = save.unlockedMaps.includes(m.id);
      const active = m.id === mapId;
      const sub = MAP_SUBTITLES[m.id] ?? { badge: '竞技场', desc: '' };
      return this.btnRaw(
        { t: 'selectMap', mapId: m.id },
        `<div class="map-head">
          <span class="map-name">${esc(m.name)}</span>
          <span class="map-badge">${unlocked ? esc(sub.badge) : `需 ${m.cost} 点解锁`}</span>
        </div>
        <span class="map-desc">${esc(sub.desc)}</span>`,
        `map-card ${active ? 'active' : ''}`,
        !unlocked,
      );
    }).join('');

    const charCards = CHARACTERS.map(c => {
      const unlocked = save.unlockedCharacters.includes(c.id);
      const sm = schoolMeta(c.school);
      const starter = WEAPON_BY_ID[c.start.weapon];
      const starterText = starter
        ? `${starter.name}${c.start.star > 1 ? ` ★${c.start.star}` : ''}`
        : c.start.weapon;
      return this.btnRaw(
        { t: 'start', characterId: c.id, mapId },
        `<div class="portrait-frame">
          <img src="/assets/portraits/${c.id}.png" width="72" height="72" draggable="false"
            onerror="this.style.display='none'" alt="${esc(c.name)}">
        </div>
        <div class="char-name">${esc(c.name)}</div>
        <span class="school-tag">${esc(sm.name)} · ${esc(sm.tag)}</span>
        <div class="char-desc">${esc(c.desc)}</div>
        <div class="char-foot">${unlocked ? `起手：${esc(starterText)}` : `标题页 ${c.cost} 点解锁`}</div>`,
        'char-card',
        !unlocked,
        `--accent:${sm.color};--accent-soft:${sm.soft};`,
      );
    }).join('');

    const curMap = MAPS.find(m => m.id === mapId)?.name ?? '废弃货场';
    this.render(`
      <div class="top-bar">
        <h2>选择角色与战场</h2>
        <div class="telemetry">
          <span class="chip">当前战场 <strong>${esc(curMap)}</strong></span>
          ${this.btn({ t: 'restart' }, '← 返回标题', 'btn btn-sm btn-ghost')}
        </div>
      </div>
      <div class="section-head">
        <h3 class="section-title">1. 选择作战地图</h3>
        <span class="section-hint">未解锁地图可在标题页军械库开启</span>
      </div>
      <div class="map-grid">${mapCards}</div>
      <div class="section-head">
        <h3 class="section-title">2. 选择幸存者出击</h3>
        <span class="section-hint">点击角色卡片直接进入战前商店</span>
      </div>
      <div class="char-grid">${charCards}</div>
    `);
  }

  shop(run: RunState, loadout: Loadout, options?: { needReplace?: number }): void {
    const need = options?.needReplace;
    const wm = weatherMeta(run.weather);

    // 装备栏
    const slotRows = run.slots.map((s, i) => {
      if (!s) {
        return `<div class="slot-row empty">
          <span class="slot-num">${i + 1}</span>
          <span>空武器槽位</span>
        </div>`;
      }
      const def = WEAPON_BY_ID[s.weaponId];
      const sm = schoolMeta(def.school);
      const sellVal = Math.floor(def.price * (1 + (s.star - 1) * 0.5) / 2);
      return `<div class="slot-row" style="--accent:${sm.color};">
        <span class="slot-num">${i + 1}</span>
        <div class="slot-icon">${this.iconTag('weapon', def.id)}</div>
        <div class="slot-info">
          <div class="slot-title">${esc(def.name)} <span class="stars">★${s.star}</span></div>
          <div class="slot-sub">${esc(sm.name)} · 伤害 ${def.baseDamage}</div>
        </div>
        ${this.btn({ t: 'sell', slot: i }, `售 +${sellVal}`, 'btn btn-sm btn-danger')}
      </div>`;
    }).join('');

    // 被动与消耗品
    const passiveChips = run.passives.length
      ? run.passives.map(p => `<span class="bag-chip">${this.iconTag('passive', p)}${esc(PASSIVE_BY_ID[p]?.name ?? p)}</span>`).join('')
      : '<span class="section-hint">暂无被动道具</span>';

    const consEntries = Object.entries(run.consumables).filter(([, v]) => v > 0);
    const consChips = consEntries.length
      ? consEntries.map(([k, v]) => `<span class="bag-chip">${this.iconTag('consumable', k)}${esc(CONSUMABLE_BY_ID[k]?.name ?? k)} ×${v}</span>`).join('')
      : '<span class="section-hint">暂无消耗品（战中按 Q 使用）</span>';

    // 套装与组合技
    const synergyPills = [
      ...loadout.setBonuses.map(b => {
        const sm = schoolMeta(b.school);
        return `<span class="synergy-chip" style="color:${sm.color};border-color:${sm.color}55;background:${sm.soft};">${esc(sm.name)}×${b.count}${b.tier > 0 ? ` (${b.tier}件激活)` : ''}</span>`;
      }),
      ...loadout.combos.map(cid => {
        const c = comboLabel(cid);
        return `<span class="synergy-chip combo" title="${esc(c.desc)}">✦ ${esc(c.name)}</span>`;
      }),
    ].join('') || '<span class="section-hint">装备同流派或跨流派武器以激活羁绊</span>';

    // 货架商品卡片
    const itemCards = run.shop.items.map((it, i) => {
      const price = priceOf(run, it);
      const affordable = run.gold >= price;
      const wDef = it.kind === 'weapon' ? WEAPON_BY_ID[it.id] : undefined;
      const pDef = it.kind === 'passive' ? PASSIVE_BY_ID[it.id] : undefined;
      const cDef = it.kind === 'consumable' ? CONSUMABLE_BY_ID[it.id] : undefined;
      const name = wDef?.name ?? pDef?.name ?? cDef?.name ?? it.id;
      const desc = wDef?.desc ?? pDef?.desc ?? cDef?.desc ?? '';
      const rarity = wDef ? rarityMeta(wDef.rarity) : null;
      const sm = wDef ? schoolMeta(wDef.school) : null;
      const typeBadge = sm
        ? `<span class="school-tag" style="--accent:${sm.color};--accent-soft:${sm.soft};">${esc(sm.name)}</span>`
        : `<span class="map-badge">${it.kind === 'passive' ? '被动' : '消耗品'}</span>`;
      const rarityBadge = rarity
        ? `<span class="map-badge" style="color:${rarity.color};">${rarity.name}</span>`
        : '';
      const ownedSlot = wDef ? run.slots.find(s => s?.weaponId === wDef.id) : undefined;
      const buyLabel = ownedSlot && ownedSlot.star < 3 ? `升星 → ★${ownedSlot.star + 1}` : '购买';

      return `<div class="item-card ${rarity?.cls ?? 'r1'} ${it.locked ? 'locked' : ''}">
        <div class="item-top">
          <div class="item-icon">${this.iconTag(it.kind, it.id)}</div>
          <div class="item-meta">
            <div class="item-name-row">
              <span class="item-name">${esc(name)}${it.locked ? ' 🔒' : ''}</span>
              <span class="item-price ${affordable ? '' : 'unaffordable'}">${price} 金</span>
            </div>
            <div class="item-tags">${typeBadge}${rarityBadge}</div>
          </div>
        </div>
        <div class="item-desc">${esc(desc)}</div>
        <div class="item-actions">
          ${this.btn({ t: 'buy', index: i }, buyLabel, 'btn btn-sm btn-buy', !affordable)}
          ${this.btn({ t: 'lock', index: i }, it.locked ? '取消锁定' : '锁定',
            it.locked ? 'btn btn-sm btn-lock-on' : 'btn btn-sm btn-ghost')}
        </div>
      </div>`;
    }).join('');

    const replaceBanner = need === undefined ? '' : `
      <div class="replace-banner">
        <span>装备栏已满，请选择要替换的武器槽位：</span>
        <div>${[0, 1, 2].map(i =>
          this.btn({ t: 'buy', index: need, replaceSlot: i }, `替换 ${i + 1}`, 'btn btn-sm')).join(' ')}
        </div>
      </div>`;

    const forecastPills = run.nextWavePreview
      .map(id => `<span class="enemy-pill">${esc(zombieLabel(id))}</span>`)
      .join('') || '<span class="section-hint">未知</span>';

    this.render(`
      <div class="top-bar">
        <h2>战前商店 <span class="chip">第 ${run.wave} 波前</span></h2>
        <div class="telemetry">
          <span class="chip chip-gold">🪙 金币 <strong>${run.gold}</strong></span>
          <span class="chip">利息上限 <strong>${loadout.stats.interestCap}</strong></span>
          <span class="chip" style="color:${wm.color};">${wm.icon} ${esc(wm.name)} · ${esc(wm.desc)}</span>
        </div>
      </div>

      <div class="shop-layout">
        <div class="panel">
          <div class="section-head">
            <h3 class="section-title">当前构筑</h3>
            <span class="section-hint">HP ${Math.ceil(run.hp)}/${Math.round(loadout.stats.maxHp)}</span>
          </div>
          <div class="slot-list">${slotRows}</div>
          <div class="mini-section">
            <span class="mini-label">套装与跨流派组合</span>
            <div class="bag-chips">${synergyPills}</div>
          </div>
          <div class="mini-section">
            <span class="mini-label">被动 (${run.passives.length}/3)</span>
            <div class="bag-chips">${passiveChips}</div>
          </div>
          <div class="mini-section">
            <span class="mini-label">消耗品</span>
            <div class="bag-chips">${consChips}</div>
          </div>
          <div class="mini-section" style="margin-top:auto;">
            ${this.btn({ t: 'repair' }, '🔧 修补战场地堡路障 (5 金/处)', 'btn btn-sm btn-ghost')}
          </div>
        </div>

        <div class="panel">
          <div class="section-head">
            <h3 class="section-title">补给货架</h3>
            <div>
              ${this.btn({ t: 'refresh' },
                `↻ 刷新货架 (${run.shop.freeRefresh ? '免费' : `${run.shop.refreshCost} 金`})`,
                'btn btn-sm')}
            </div>
          </div>
          ${replaceBanner}
          <div class="shelf-grid">${itemCards}</div>
        </div>
      </div>

      <div class="shop-footer">
        <div class="wave-forecast">
          <span>下波敌情预告：</span>
          ${forecastPills}
        </div>
        ${this.btn({ t: 'beginWave' }, `开始第 ${run.wave} 波战斗 →`, 'btn btn-fight')}
      </div>
    `);
  }

  waveEnd(run: RunState, talentIds: string[], curseIds: string[], clearedWave: number,
    pickedTalent: boolean, pickedCurse: boolean): void {
    const talentCards = talentIds.map(id => {
      const t = TALENTS.find(x => x.id === id)!;
      return this.btnRaw(
        { t: 'talent', id },
        `<div class="choice-head">
          <span class="choice-name">${esc(t.name)}</span>
          <span class="choice-badge">天赋</span>
        </div>
        <span class="choice-desc">${esc(t.desc)}</span>`,
        'choice-card',
        pickedTalent,
      );
    }).join('');

    const curseCards = curseIds.map(id => {
      const c = CURSES.find(x => x.id === id)!;
      return this.btnRaw(
        { t: 'curse', id },
        `<div class="choice-head">
          <span class="choice-name">${esc(c.name)}</span>
          <span class="choice-badge">+${c.gold} 金</span>
        </div>
        <span class="choice-desc">${esc(c.desc)}</span>`,
        'choice-card curse',
        pickedCurse,
      );
    }).join('');

    this.render(`
      <div class="top-bar">
        <h2>第 ${clearedWave} 波结束 <span class="chip chip-gold">波次清剿完成</span></h2>
        <div class="telemetry">
          <span class="chip chip-gold">🪙 当前金币 <strong>${run.gold}</strong></span>
          <span class="chip">累计击杀 <strong>${run.kills}</strong></span>
        </div>
      </div>

      <div class="section-head">
        <h3 class="section-title">1. 选择一项强化天赋（必选）</h3>
        <span class="section-hint">${pickedTalent ? '已完成选择' : '三选一永久强化本局属性'}</span>
      </div>
      <div class="reward-grid-3">${talentCards}</div>

      <div class="section-head">
        <h3 class="section-title">2. 血色诅咒契约（可选）</h3>
        <span class="section-hint">${pickedCurse ? '已做出抉择' : '承担额外风险换取丰厚金币或稀有武器'}</span>
      </div>
      <div class="reward-grid-2">${curseCards}</div>

      <div class="shop-footer" style="margin-top:auto;">
        ${this.btn({ t: 'curse', id: null }, '拒绝契约，稳妥前进', 'btn btn-ghost', pickedCurse)}
        ${this.btn({ t: 'continue' }, '进入战前商店 →', 'btn btn-primary', !pickedTalent)}
      </div>
    `);
  }

  gameOver(run: RunState, save: SaveData): void {
    const gained = run.wave * 2 + Math.floor(run.kills / 10) + run.bossKills * 5;
    this.render(`
      <div class="gameover-wrap">
        <h1 class="gameover-title">你倒下了</h1>
        <p class="gameover-sub">防线失守 · 战局种子 #${run.seed}</p>
        <div class="debrief-grid">
          <div class="debrief-cell">
            <div class="debrief-val">${run.wave}</div>
            <div class="debrief-lbl">坚持波次</div>
          </div>
          <div class="debrief-cell">
            <div class="debrief-val">${run.kills}</div>
            <div class="debrief-lbl">击杀丧尸</div>
          </div>
          <div class="debrief-cell">
            <div class="debrief-val">${run.bossKills}</div>
            <div class="debrief-lbl">讨伐 Boss</div>
          </div>
        </div>
        <div class="meta-gain">本局获得 +${gained} 局外点数 · 当前累计 ${save.points} 点</div>
        ${this.btn({ t: 'restart' }, '返回标题军械库', 'btn btn-primary')}
      </div>
    `);
  }
}
