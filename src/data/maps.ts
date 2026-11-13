import type { MapDef } from '../core/types';

export const MAPS: MapDef[] = [
  { id: 'yard', name: '废弃货场', cost: 0,
    barriers: [{ x: 300, y: 200, w: 20, h: 120 }, { x: 640, y: 320, w: 20, h: 120 }],
    barrels: [{ x: 200, y: 140 }, { x: 760, y: 500 }],
    boxes: [{ x: 480, y: 100 }, { x: 480, y: 540 }],
    traps: [{ x: 420, y: 320 }, { x: 540, y: 320 }, { x: 480, y: 240 }] },
  { id: 'lab', name: '地下实验室', cost: 50,
    barriers: [{ x: 200, y: 300, w: 160, h: 20 }, { x: 600, y: 300, w: 160, h: 20 }],
    barrels: [{ x: 120, y: 120 }, { x: 840, y: 520 }, { x: 480, y: 320 }],
    boxes: [{ x: 100, y: 560 }, { x: 860, y: 80 }, { x: 480, y: 60 }],
    traps: [{ x: 340, y: 200 }, { x: 620, y: 440 }, { x: 480, y: 480 }] },
  { id: 'rooftop', name: '雨夜天台', cost: 90,
    barriers: [{ x: 460, y: 80, w: 40, h: 140 }, { x: 460, y: 420, w: 40, h: 140 }],
    barrels: [{ x: 300, y: 320 }, { x: 660, y: 320 }],
    boxes: [{ x: 160, y: 160 }, { x: 800, y: 480 }],
    traps: [{ x: 480, y: 320 }, { x: 360, y: 480 }, { x: 600, y: 160 }] },
];
export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAPS.map(m => [m.id, m]));
