import { RASTER_META } from './rasterMeta.generated';

export type ClipId = 'idle' | 'walk' | 'attack' | 'hit' | 'death';

export interface RasterMeta {
  src: string;
  view: number;
  frames: number;
  walkFps: number;
  clips: Record<ClipId, number[]>;
}

export interface LoadedSheet extends RasterMeta {
  id: string;
  image: CanvasImageSource;
}

export interface ClipState {
  dead?: boolean;
  hitT?: number;
  atkT?: number;
  moving?: boolean;
}

const loaded = new Map<string, LoadedSheet>();

/** 测试用：清空/注入已加载的表。 */
export function __resetRasterForTest(): void { loaded.clear(); }
export function __setRasterForTest(id: string, sheet: LoadedSheet): void {
  loaded.set(id, sheet);
}

export async function preloadRasterSheets(
  ids: string[] = Object.keys(RASTER_META),
): Promise<void> {
  if (typeof Image === 'undefined') return;
  await Promise.all(ids.map(async (id) => {
    const meta = RASTER_META[id];
    if (!meta) return;
    const image = new Image();
    image.src = meta.src;
    try {
      await image.decode();
      loaded.set(id, { ...meta, id, image });
    } catch {
      // 单张失败只回退该角色，不阻塞其余资源
    }
  }));
}

export function rasterFor(id: string): LoadedSheet | undefined {
  return loaded.get(id);
}

export function pickClip(s: ClipState): ClipId {
  if (s.dead) return 'death';
  if ((s.hitT ?? 0) > 0) return 'hit';
  if ((s.atkT ?? 0) > 0) return 'attack';
  return s.moving ? 'walk' : 'idle';
}

export function clipFrame(sheet: LoadedSheet, clip: ClipId, phase: number): number {
  const frames = sheet.clips[clip];
  if (!frames || frames.length === 0) return 0;
  if (clip === 'idle' || clip === 'hit' || clip === 'death') return frames[0]!;
  if (clip === 'walk') {
    const i = Math.floor(phase * sheet.walkFps) % frames.length;
    return frames[i]!;
  }
  const i = Math.min(frames.length - 1, Math.floor(phase * frames.length));
  return frames[i]!;
}

export function drawRasterFrame(
  ctx: CanvasRenderingContext2D, sheet: LoadedSheet, frame: number,
  x: number, y: number, size: number, flip: boolean,
): void {
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  if (flip) ctx.scale(-1, 1);
  const sx = frame * sheet.view;
  ctx.drawImage(sheet.image, sx, 0, sheet.view, sheet.view,
    -size / 2, -size / 2, size, size);
  ctx.restore();
  ctx.imageSmoothingEnabled = smoothing;
}
