export interface PixelMap { w: number; h: number; rows: string[]; palette: Record<string, string>; scale: number }
const P = (rows: string[], palette: Record<string, string>, scale = 3): PixelMap =>
  ({ w: rows[0].length, h: rows.length, rows, palette, scale });

const base: Record<string, string> = { f: '#8fae6a', d: '#3d4a2c', e: '#ff5555',
  c: '#5a4a63', m: '#b9c2cc', h: '#ff9a3c', i: '#8fdcff', a: '#ffe066' };

export const SPRITE_MAPS: Record<string, PixelMap> = {
  player: P(['..cccc..','.cffffc.','.cfeefc.','.cffffc.','..cmmc..','..m..m..','..m..m..','.bb..bb.'],
    { ...base, b: '#2b2b38' }),
  walker: P(['..ffff..','.ffeeff.','.ffffff.','..dddd..','.d.dd.d.','..d..d..','.d....d.','........'], base),
  runner: P(['..ffff..','.ffeeff.','.ffffff.','.dddddd.','d..dd..d','.d....d.','d......d','........'],
    { ...base, f: '#b9d17a' }),
  fatty: P(['.ffffff.','ffeeeff.','ffffffff','fddddddf','fddddddf','.fddddf.','.d.d.d.d','..d..d..'], base),
  shield: P(['..ffff..','.ffeeff.','.ffffff.','mmmmmmmm','mmddddmm','mmddddmm','.d.d.d.d','..d..d..'], base),
  spitter: P(['..ffff..','.ffeeff.','.hhffhh.','.ffffff.','..dddd..','.d.dd.d.','..d..d..','........'], base),
  summoner: P(['..cccc..','.cceecc.','.cffffc.','.cccccc.','ccddddcc','.d.d.d.d','..d..d..','........'], base),
  armored: P(['.mmmmmm.','mmfeefmm','mmffffmm','mmmmmmmm','mmddddmm','mmddddmm','.m.m.m.m','..m..m..'], base),
  butcher: P(['mmffffmm','mffeeffm','ffffffff','ffddddff','ffddddff','mmffffmm','.m.m.m.m','..m..m..'], base),
  mother: P(['.ccffcc.','cceeeecc','cffffffc','ccffffcc','cccccccc','cddddddc','.d.d.d.d','..d..d..'], base),
  knife: P(['......m.','.....mm.','....mm..','...mm...','..mm....','.cc.....','cc......','........'], base),
  katana: P(['......m.','.....mm.','....mm..','...mm...','..mm....','.mm.....','cc......','........'], base),
  saw: P(['mmmmmm..','mhmmhmm.','cccccccc','cddddddc','cccccccc','.c....c.','........','........'], base),
  pistol: P(['..mmmm..','.mmmmmm.','.ccmmm..','..cc....','..cc....','........','........','........'], base),
  shotgun: P(['mmmmmmmm','ccccmmmm','..cc....','..cc....','........','........','........','........'], base),
  sniper: P(['mmmmmmmm','.ccmmmmm','..cc..c.','..cc....','........','........','........','........'], base),
  bat: P(['......mm','.....mm.','....mm..','...mm...','..mm....','.cc.....','cc......','........'], base),
  hammer: P(['..mmmm..','..mmmm..','...cc...','...cc...','...cc...','...cc...','........','........'], base),
  mace: P(['..mmmm..','.mhmmhm.','mmmmmmmm','...cc...','...cc...','...cc...','........','........'], base),
  turret: P(['..mmmm..','.mmccmm.','mmcmmcmm','.mmmmmm.','..cccc..','.cc..cc.','........','........'], base),
  grid: P(['ahahahah','hahahaha','ahahahah','hahahaha','........','........','........','........'], base),
  drone: P(['..a..a..','.aammaa.','aammmmaa','..mmmm..','..a..a..','........','........','........'], base),
  firestaff: P(['......h.','.....hh.','....hh..','...hh...','..hh....','.cc.....','cc......','........'], base),
  frosttome: P(['.iiiiii.','iccciicc','icccciic','icccciic','.iiiiii.','........','........','........'], base),
  ring: P(['..aaaa..','.a....a.','a..aa..a','a..aa..a','.a....a.','..aaaa..','........','........'], base),
  barrel: P(['.hhhhhh.','hddddddh','hdhddhdh','hddddddh','hdhddhdh','hddddddh','.hhhhhh.','........'], base),
  crate: P(['.cccccc.','cdcdcdcc','cccccccc','cdcdcdcc','cccccccc','.cccccc.','........','........'], base),
};
export function spriteIds(): string[] { return Object.keys(SPRITE_MAPS); }
export function drawSprite(ctx: CanvasRenderingContext2D, id: string, x: number, y: number): void {
  const m = SPRITE_MAPS[id] ?? SPRITE_MAPS['walker'];
  for (let r = 0; r < m.rows.length; r++) {
    for (let c = 0; c < m.w; c++) {
      const ch = m.rows[r][c];
      if (ch === '.') continue;
      ctx.fillStyle = m.palette[ch] ?? '#ffffff';
      ctx.fillRect(x + (c - m.w / 2) * m.scale, y + (r - m.h / 2) * m.scale, m.scale, m.scale);
    }
  }
}
