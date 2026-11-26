import { buildCharacter } from './characters';

/** 像素精灵：每帧是一张字符网格，逐字符=一个像素。
 *  好处是描边、明暗、轮廓在源码里就看得见，改一个字符就能改一个像素。
 *
 *  part 标记用于骨架动画：
 *   body  躯干与头（受步态起伏、受击后仰）
 *   armL / armR  双臂（步态两帧互换位置，攻击时前扑）
 *   legL / legR  双腿（步态两帧互换前后）
 *   weapon  手持武器（跟随朝向旋转）
 */
export type VectorPart = 'body' | 'armL' | 'armR' | 'legL' | 'legR' | 'weapon';

export interface PixelShape {
  x: number; y: number; w: number; h: number;
  fill: string;
  part?: VectorPart;
}

export interface SpriteArt {
  /** 网格边长（像素画基准分辨率） */
  view: number;
  /** 字符 → 颜色 */
  palette: Record<string, string>;
  /** 帧序列：0=静止，之后为步态循环帧。每帧行数须等于 view。 */
  frames: string[][];
}

/** 在基准帧上按行号打补丁，作者只需写出差异行 */
export function mod(base: string[], patch: Record<number, string>): string[] {
  const out = base.slice();
  for (const [row, text] of Object.entries(patch)) out[Number(row)] = text;
  return out;
}

/** 把整行按 dx 水平移动（正数右移），宽度不变，出界部分丢弃、空出的位置补 '.'。
 *  用位移而不是手写补丁行来生成步态，避免人工数格子导致宽度错位。 */
export function shiftRows(base: string[], rows: number[], dx: number): string[] {
  const out = base.slice();
  for (const y of rows) {
    const row = out[y];
    if (row === undefined) continue;
    out[y] = dx >= 0
      ? '.'.repeat(dx) + row.slice(0, row.length - dx)
      : row.slice(-dx) + '.'.repeat(-dx);
  }
  return out;
}

/** 只在 [x0, x0+w) 这段列内把该行右移/左移 dx（正数右移）。
 *  片段内的点会移出、片段外的内容原地不动，因此手臂能在身体侧面独立摆动
 *  而不会撕裂躯干轮廓。 */
function shiftSpan(base: string[], y: number, x0: number, w: number, dx: number): string {
  const row = base[y];
  if (row === undefined) return row;
  const seg = row.slice(x0, x0 + w);
  if (dx === 0) return row;
  const moved = dx > 0
    ? '.'.repeat(dx) + seg.slice(0, w - dx)
    : seg.slice(-dx) + '.'.repeat(-dx);
  return row.slice(0, x0) + moved + row.slice(x0 + w);
}

/** 生成三帧步态：静止 + 两帧交替。
 *  手臂只在自身列区间内左右错位，躯干轮廓不受影响；
 *  腿按离髋远近做阶梯位移，形成绕髋摆动。 */
function stride(base: string[],
  legs: { rows: number[]; x0: number; w: number },
  armL: { rows: number[]; x0: number; w: number },
  armR: { rows: number[]; x0: number; w: number }): string[][] {
  const limb = (from: string[], spec: { rows: number[]; x0: number; w: number },
    dir: number): string[] => {
    let out = from;
    spec.rows.forEach((y, i) => {
      // 离身体越远位移越大：阶梯 2,2,1,1,0…
      const d = Math.max(0, Math.ceil((spec.rows.length - i) / 2)) * dir;
      if (d === 0) return;
      const next = out.slice();
      next[y] = shiftSpan(out, y, spec.x0, spec.w, d);
      out = next;
    });
    return out;
  };
  // 两帧：左臂与右腿同侧前摆，形成对角步态
  const frame = (dir: number): string[] =>
    limb(limb(limb(base, legs, -dir), armL, dir), armR, -dir);
  return [base, frame(1), frame(-1)];
}

// ── 共享调色板：k 为描边，其余按材质分三阶 ─────────────────
const BASE: Record<string, string> = {
  k: '#14161c', // 描边（像素画的灵魂）
  // 僵尸皮肤
  s: '#7da05c', S: '#a8c47f', Z: '#4f6b34',
  // 人类皮肤
  f: '#e8b88a', F: '#ffd8ae', h: '#c08b5e',
  // 面部
  e: '#1d2129', M: '#4a2b23', b: '#e2e6ea', x: '#9e2b2b',
  // 红
  r: '#d8443c', R: '#8a3320',
  // 夹克
  j: '#3d5a80', J: '#2c425f', l: '#5f80a8',
  // 牛仔
  d: '#46506b', D: '#2b3346',
  // 布/木
  c: '#6d5b3f', C: '#443524', w: '#9c7142', W: '#5f4021',
  // 金属
  n: '#9aa5b1', N: '#5a6673', m: '#d4dce4',
  // 特效
  a: '#8fe06a', A: '#3f8f3f', v: '#b39ddb', V: '#6b4f9e',
  i: '#8fdcff', I: '#3d8fb5', o: '#ff8a3d', O: '#c9541c',
  g: '#ffd24a', y: '#ffe9a8', p: '#e8e2d0',
  // 浅色甲片与电光（尸潮之母的苍白甲板、电网的发光格）
  P: '#f2f0e4', Y: '#ffe066', G: '#fff7b0',
};

const art = (view: number, frames: string[][], palette: Record<string, string> = {}): SpriteArt =>
  ({ view, palette: { ...BASE, ...palette }, frames });

// ══════════════════════════════════════════════════════════
// 角色：24×24，每帧带描边与三阶明暗
// ══════════════════════════════════════════════════════════

// ── 玩家：红绒帽 + 围巾 + 深蓝夹克 ──────────────────────
// 三帧独立手绘：静止 / 左腿前迈（左臂后摆）/ 右腿前迈（右臂后摆）




// ── 普通僵尸：绿皮、前伸双臂、撕裂的嘴 ─────────────────


// ── 奔跑者：红色发带、灰背心、迈步姿态 ─────────────────


// ── 胖子：大肚子、撑破的衣服、芥末渍 ───────────────────


// ── 持盾僵尸：防暴头盔 + 正面防暴盾 ────────────────────


// ── 吐酸僵尸：鼓胀酸囊、滴落酸液 ───────────────────────


// ── 召唤者：紫色兜帽长袍 + 悬浮符文 ───────────────────
const SUMMONER_BASE = [
  '........................',
  '........................',
  '.........kkkkkk.........',
  '........kvvvvvvk........',
  '.......kvvVVVVvvk.......',
  '.......kvkkkkkkvk.......',
  '.......kvevkkvevk.......',
  '.......kvvvvvvvvk.......',
  '......kvvvVVVVvvvk......',
  '.....kvvvvvvvvvvvvk.....',
  '....kvvvvvVVVVvvvvvk....',
  '....kvvvvvVVVVvvvvvk....',
  '...kvvvvvvVVVVvvvvvvk...',
  '...kvvvvvvvvvvvvvvvvk...',
  '..kvvvvvvvvvvvvvvvvvvk..',
  '..kvvvvvvvvvvvvvvvvvvk..',
  '..kvVVVVVVVVVVVVVVVVvk..',
  '..kvvvvvvvvvvvvvvvvvvk..',
  '...kvvvvvvvvvvvvvvvvk...',
  '....kkvvvvvvvvvvvvkk....',
  '......kkvvvvvvvvkk......',
  '........kkkkkkkk........',
  '........................',
  '........................',
];


// ── 装甲僵尸：全覆盖板甲、面甲缝 ───────────────────────


// ── 屠夫 Boss：菜刀 + 血迹围裙（28 基准，比普通僵尸更壮）──


// ── 尸潮之母 Boss：苍白臃肿、卵囊、多只手臂 ────────────


// ══════════════════════════════════════════════════════════
// 武器 / 道具 / 部署物：单帧，24×24
// ══════════════════════════════════════════════════════════
const prop = (rows: string[], palette: Record<string, string> = {}): SpriteArt =>
  art(24, [rows], palette);

const KNIFE = prop([
  '........................',
  '........................',
  '........................',
  '................kkkk....',
  '...............kmmmNk...',
  '..............kmmmNk....',
  '.............kmmmNk.....',
  '............kmmmNk......',
  '...........kmmmNk.......',
  '..........kmmmNk........',
  '.........kgggggk........',
  '........kgggggk.........',
  '.......kcWccWk..........',
  '......kcWccWk...........',
  '......kcWcWk............',
  '......kkkkk.............',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const KATANA = prop([
  '........................',
  '........................',
  '.................kkk....',
  '................kmmNk...',
  '...............kmmNk....',
  '..............kmmNk.....',
  '.............kmmNk......',
  '............kmmNk.......',
  '...........kmmNk........',
  '..........kmmNk.........',
  '.........kmmNk..........',
  '........kggggk..........',
  '.......kggggk...........',
  '......kcWWck............',
  '.....kcWWck.............',
  '....kcWWck..............',
  '....kkkkk...............',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const SAW = prop([
  '........................',
  '........................',
  '.........kkkkkkkk.......',
  '........kmmmmmmmmk......',
  '........kmkmkmkmkk......',
  '........kmmmmmmmmk......',
  '.....kkkkkkkkkkkkkkk....',
  '....kOOOOOOOOOOOOOOOk...',
  '....kOoooooooooooooOk...',
  '....kOOkkkkkkkkkkkOOk...',
  '....kOoooooooooooooOk...',
  '....kOOkkkkkkkkkkkOOk...',
  '....kkkkkkkkkkkkkkkkk...',
  '.....kWwk......kWwk.....',
  '.....kWwk......kWwk.....',
  '.....kkkk......kkkk.....',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const PISTOL = prop([
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.........kkkkkkkkkkk....',
  '........kmmmmmmmmmmmk...',
  '........knnnnnnnnnnnk...',
  '........kkkknnnkkkkkk...',
  '...........knnk.........',
  '...........knnk.........',
  '..........knNk..........',
  '..........knNk..........',
  '..........knNk..........',
  '..........kNNk..........',
  '..........kkkk..........',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const SHOTGUN = prop([
  '........................',
  '........................',
  '........................',
  '........................',
  '....kkkkkkkkkkkkkkkkkk..',
  '...kmmmmmmmmmmmmmmmmmk..',
  '...knnnnnnnnnnnnnnnnnk..',
  '...kkkkkkkkkkkkkkkkkkk..',
  '......kWwwwwwwwwwwk.....',
  '......kWwwwwwwwwwwk.....',
  '.......kwwwwwwwwwk......',
  '.......kWwwwwwwwWk......',
  '........kwwwwwwwk.......',
  '........kWwwwwwWk.......',
  '.........kwwwwwk........',
  '.........kkkkkkk........',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const SNIPER = prop([
  '........................',
  '........................',
  '........................',
  '........................',
  '.........kkkkkkkk.......',
  '........kNNNNNNNNk......',
  '.......kNkkkkkkkkNk.....',
  '.......kNkmkkmkkkNk.....',
  '.......kNkkkkkkkkNk.....',
  '....kkkkkkkkkkkkkkkkk...',
  '...kmmmmmmmmmmmmmmmmmk..',
  '...knnnnnnnnnnnnnnnnnk..',
  '...kkkkkkkkkkkkkkkkkkk..',
  '......kWwwwwwwwwwwk.....',
  '......kWwwwwwwwwwwk.....',
  '.......kwwwwwwwwwk......',
  '.......kkkkkkkkkkk......',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const BAT = prop([
  '........................',
  '........................',
  '.................kkkk...',
  '................kwwwWk..',
  '...............kwwwWk...',
  '..............kwwwWk....',
  '.............kwwwWk.....',
  '............kwwwWk......',
  '...........kwwwWk.......',
  '..........kwwwWk........',
  '.........kwwwWk.........',
  '........kwwwWk..........',
  '.......kwwwwk...........',
  '......kwwwwk............',
  '.....kWwwwk.............',
  '....kWxxWk..............',
  '....kWxxWk..............',
  '.....kWwk...............',
  '......kkk...............',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const HAMMER = prop([
  '........................',
  '........................',
  '.....kkkkkkkkkkk........',
  '....kmmmmmmmmmmk........',
  '....knnnnnnnnnnk........',
  '....kmmmmmmmmmmk........',
  '....knnnnnnnnnnk........',
  '....kkkkkkkkkkk.........',
  '.........kWWWk..........',
  '.........kWWWk..........',
  '.........kwwWk..........',
  '.........kwwWk..........',
  '.........kwwWk..........',
  '.........kwwWk..........',
  '.........kwwWk..........',
  '.........kwwWk..........',
  '.........kwwWk..........',
  '.........kWWWk..........',
  '.........kkkkk..........',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const MACE = prop([
  '........................',
  '........................',
  '........................',
  '..........kkkkk.........',
  '.........kNmmmnk........',
  '........kNmmmkmmk.......',
  '........kNmmkkmmk.......',
  '........kkmmmkmmk.......',
  '.........kNmmmnk........',
  '..........kkkkk.........',
  '...........kNk..........',
  '...........kNk..........',
  '..........kWWk..........',
  '..........kWWk..........',
  '..........kWWk..........',
  '..........kWWk..........',
  '..........kWWk..........',
  '..........kWWk..........',
  '.........kWwwk..........',
  '.........kkkkk..........',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const TURRET = prop([
  '........................',
  '........................',
  '........................',
  '.........kkkkkk.........',
  '........kNmmmmNk........',
  '........kNnnnnNk........',
  '........kkNNNNkk........',
  '.........kNmmNk.........',
  '........kNmmmmNk........',
  '.......kNmmmmmmNk.......',
  '.......kNmggggmNk.......',
  '.......kNmmmmmmNk.......',
  '........kNmmmmNk........',
  '........kkNNNNkk........',
  '.......kNk....kNk.......',
  '......kNk......kNk......',
  '.....kNk........kNk.....',
  '....kNk..........kNk....',
  '....kkk..........kkk....',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const GRID = prop([
  '........................',
  '........................',
  '........................',
  '....kkkkkkkkkkkkkkkk....',
  '....kggkkkkkkkkkkgGk....',
  '....kkYGYYYYYYYYGYkk....',
  '....kYGYYYYYYYYYYGYk....',
  '....kYYYYYkkYYYYYYYk....',
  '....kYYYYkYYkYYYYYYk....',
  '....kYYYYkYYkYYYYYYk....',
  '....kYYYkYYYYkYYYYYk....',
  '....kYYYkYYYYkYYYYYk....',
  '....kYYkYYYYYYkYYYYk....',
  '....kYYYYkkkkYYYYYYk....',
  '....kYYYYYYYYYYYYYYk....',
  '....kyyyyyyyyyyyyyyk....',
  '....kggkkkkkkkkkkggk....',
  '....kkkkkkkkkkkkkkkk....',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const DRONE = prop([
  '........................',
  '........................',
  '..kkkkk.......kkkkk.....',
  '..kNNNk.......kNNNk.....',
  '..kNNNkkkkkkkkkNNNk.....',
  '...kkkkmmmmmmkkkk.......',
  '......kNmmmmNk..........',
  '......kNmiiNNk..........',
  '......kNmmmmNk..........',
  '.......kNNNNk...........',
  '........kkkk............',
  '..kNNk........kNNk......',
  '..kNNk........kNNk......',
  '..kkkk........kkkk......',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const FIRESTAFF = prop([
  '........................',
  '........................',
  '........................',
  '..........kkkk..........',
  '.........koooOk.........',
  '........koyyyyok........',
  '........koyyyyok........',
  '.........koooOk.........',
  '..........kkkk..........',
  '..........kWwk..........',
  '..........kwwk..........',
  '..........kWwk..........',
  '..........kwwk..........',
  '..........kWwk..........',
  '..........kwwk..........',
  '..........kWwk..........',
  '..........kwwk..........',
  '..........kWwk..........',
  '..........kwwk..........',
  '.........kkkkkk.........',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const FROSTTOME = prop([
  '........................',
  '........................',
  '.....kkkkkkkkkkkkk......',
  '....kiiiiIiiiiiiIk......',
  '....kiiiiIiiiiiiIk......',
  '....kiibbiIbbiibIk......',
  '....kiiibbiibbbIk.......',
  '....kiiiiIiiiiiiIk......',
  '....kiiiibbbbbiiIk......',
  '....kiiibbiibiiIIk......',
  '....kiiibbiibiiIIk......',
  '....kiiiiIiiiiiiIk......',
  '....kiiiiIiiiiiiIk......',
  '....kiiiiIiiiiiiIk......',
  '....kiiiiIiiiiiiIk......',
  '....kiiiiIiiiiiiIk......',
  '....kiIIIiIIIIIiIk......',
  '....kkkkkkkkkkkkk.......',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const RING = prop([
  '........................',
  '........................',
  '..........kkkk..........',
  '.........kggggk.........',
  '........kgkkkkkk........',
  '........kgk....k........',
  '........kgk....k........',
  '........kgk..kkk........',
  '........kgk.kgygk.......',
  '........kgk.kgyyk.......',
  '........kgk.kgygk.......',
  '........kgk..kkk........',
  '........kgk....k........',
  '........kgk....k........',
  '........kgk....k........',
  '........kgkkkkkk........',
  '.........kggggk.........',
  '..........kkkk..........',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const BARREL = prop([
  '........................',
  '........................',
  '........................',
  '.......kkkkkkkkkk.......',
  '......kRRRRRRRRRRk......',
  '.....krrrrrrrrrrrrk.....',
  '.....krRRRRRRRRRRrk.....',
  '.....kggggggggggggk.....',
  '.....krRRRRRRRRRRrk.....',
  '.....krrrrrrrrrrrrk.....',
  '.....krrrkkkkkkrrrk.....',
  '.....krrrkkkkkkrrrk.....',
  '.....krrrkkkkkkrrrk.....',
  '.....krrrrrrrrrrrrk.....',
  '.....kggggggggggggk.....',
  '.....krRRRRRRRRRRrk.....',
  '.....krrrrrrrrrrrrk.....',
  '......kRRRRRRRRRRk......',
  '.......kkkkkkkkkk.......',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

const CRATE = prop([
  '........................',
  '........................',
  '........................',
  '.....kkkkkkkkkkkkkk.....',
  '.....kwwwwwwwwwwwwk.....',
  '.....kwWwwwwwwwwWwk.....',
  '.....kwwWwwwwwwWwwk.....',
  '.....kwwwWwwwwWwwwk.....',
  '.....kwwwwWwwWwwwwk.....',
  '.....kwwwwwWWwwwwwk.....',
  '.....kwwwwwWWwwwwwk.....',
  '.....kwwwwWwwWwwwwk.....',
  '.....kwwwWwwwwWwwwk.....',
  '.....kwwWwwwwwwWwwk.....',
  '.....kwWwwwwwwwwWwk.....',
  '.....kwwwwwwwwwwwwk.....',
  '.....kWWWWWWWWWWWWk.....',
  '.....kkkkkkkkkkkkkk.....',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
]);

export const SPRITES: Record<string, SpriteArt> = {
  knife: KNIFE, katana: KATANA, saw: SAW, pistol: PISTOL, shotgun: SHOTGUN,
  sniper: SNIPER, bat: BAT, hammer: HAMMER, mace: MACE,
  turret: TURRET, grid: GRID,
  firestaff: FIRESTAFF, frosttome: FROSTTOME, ring: RING,
  barrel: BARREL, crate: CRATE,
};

export function vectorIds(): string[] { return Object.keys(SPRITES); }

// 角色改由骨架渲染：关节角度驱动每一帧，保证步态连贯且描边不会破洞。
// 单个角色源码里只留尺寸与配色，不再手写 66 行字符网格。
Object.assign(SPRITES, {
  player: buildCharacter('player'),
  walker: buildCharacter('walker'),
  runner: buildCharacter('runner'),
  fatty: buildCharacter('fatty'),
  shield: buildCharacter('shield'),
  spitter: buildCharacter('spitter'),
  summoner: buildCharacter('summoner'),
  armored: buildCharacter('armored'),
  butcher: buildCharacter('butcher'),
  mother: buildCharacter('mother'),
  drone: buildCharacter('drone'),
});
