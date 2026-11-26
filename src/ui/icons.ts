import { drawShapes, frameShapes, SPRITES } from './sprites';
import { WEAPON_BY_ID } from '../data/weapons';

const cache = new Map<string, string>();

/** 商店武器 id → 矢量精灵名（如 shortknife → knife）。 */
export function weaponSpriteId(id: string): string {
  return WEAPON_BY_ID[id]?.sprite ?? id;
}

/** 商店图标：消耗品/被动用后处理好的 PNG；武器用现有矢量帧离屏渲染。 */
export function iconFor(kind: 'weapon' | 'passive' | 'consumable', id: string): string {
  if (kind !== 'weapon') return `/assets/icons/${id}.png`;
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return '';
  // 商店传入的是武器 id（如 shortknife），矢量精灵按 sprite 名索引（如 knife）
  const spriteId = weaponSpriteId(id);
  const sp = SPRITES[spriteId];
  if (!sp) return '';
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.imageSmoothingEnabled = false;
  // 矢量帧坐标以 view 为边长、中心为原点；缩放到 40px 内容并居中
  const k = 40 / sp.view;
  ctx.translate(24, 24);
  ctx.scale(k, k);
  drawShapes(ctx, frameShapes(spriteId, 0), sp.view);
  const url = canvas.toDataURL();
  cache.set(id, url);
  return url;
}
