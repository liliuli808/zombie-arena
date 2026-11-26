import { SPRITES, vectorIds, type PixelShape, type SpriteArt, type VectorPart } from './vector';

export { SPRITES, vectorIds };
export type { PixelShape, SpriteArt };

/** 各精灵在画面上的显示高度（像素），约为碰撞半径的 2.6 倍。
 *  帧网格是 48×48，显示时缩到 0.75 ~ 2.3 倍，仍在屏幕上保持硬边像素。 */
const SPRITE_SIZE: Record<string, number> = {
  veteran: 48, wizard: 48, engineer: 48, ronin: 48, jailer: 48,
  player: 48, walker: 48, runner: 48, fatty: 54, shield: 48, spitter: 48,
  summoner: 52, armored: 54, butcher: 72, mother: 72,
  barrel: 48, crate: 48, turret: 48, grid: 48, drone: 44,
};

const VECTOR_FALLBACK: Record<string, string> = {
  veteran: 'player', wizard: 'player', engineer: 'player',
  ronin: 'player', jailer: 'player',
};

/** 职业 id 没有独立矢量骨架，回退到通用幸存者。 */
export function vectorIdFor(id: string): string {
  return VECTOR_FALLBACK[id] ?? id;
}

export function spriteIds(): string[] { return vectorIds(); }

export function spriteDrawSize(id: string): number {
  return SPRITE_SIZE[id] ?? 72;
}

export function spriteFrameCount(id: string): number {
  return (SPRITES[id] ?? SPRITES['walker']).frames.length;
}

/** 把字符网格解析成像素块。相同颜色的相邻像素横向合并，减少 fillRect 次数。
 *  part 按行段指定：不同行的同一角色可能属于不同部位（头/腿）。 */
const frameCache = new Map<string, PixelShape[]>();
export function frameShapes(id: string, frame = 0): PixelShape[] {
  const key = `${id}:${frame}`;
  const hit = frameCache.get(key);
  if (hit) return hit;
  const sp = SPRITES[id] ?? SPRITES['walker'];
  const rows = sp.frames[Math.min(frame, sp.frames.length - 1)] ?? sp.frames[0];
  const shapes: PixelShape[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let run = 0;
    while (run < row.length) {
      const ch = row[run];
      if (ch === '.' || ch === ' ') { run++; continue; }
      let w = 1;
      while (run + w < row.length && row[run + w] === ch) w++;
      const fill = sp.palette[ch];
      if (fill) shapes.push({ x: run, y, w, h: 1, fill, part: partOf(y, sp.view) });
      run += w;
    }
  }
  frameCache.set(key, shapes);
  return shapes;
}

/** 按行归部位：头部与躯干算 body，腿部单独分组以便步态交换。 */
function partOf(y: number, view: number): VectorPart {
  const legLine = Math.round(view * 0.78);
  return y >= legLine ? 'legL' : 'body';
}

/** 在已缩放好的坐标系里画一帧（调用方负责缩放与关闭平滑） */
export function drawShapes(ctx: CanvasRenderingContext2D, shapes: PixelShape[],
  view: number): void {
  for (const s of shapes) {
    ctx.fillStyle = s.fill;
    ctx.fillRect(s.x - view / 2, s.y - view / 2, s.w, s.h);
  }
}

/** 绘制单个精灵（以 x,y 为中心，整数倍放大，保持硬边） */
export function drawSprite(ctx: CanvasRenderingContext2D, id: string,
  x: number, y: number, scale = 1, frame = 0): void {
  const sp = SPRITES[id] ?? SPRITES['walker'];
  const size = spriteDrawSize(id) * scale;
  const k = size / sp.view;
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(k, k);
  drawShapes(ctx, frameShapes(id, frame), sp.view);
  ctx.restore();
  ctx.imageSmoothingEnabled = smoothing;
}

/** 按部位拆分当前帧：body / legL / legR 等，供骨架动画逐层变换 */
export function spriteParts(id: string, frame = 0): Record<string, PixelShape[]> {
  const out: Record<string, PixelShape[]> = {};
  for (const s of frameShapes(id, frame)) (out[s.part ?? 'body'] ??= []).push(s);
  return out;
}

export { SPRITE_SIZE };
