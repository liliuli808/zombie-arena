export interface InputState {
  keys: Set<string>;
  mouse: { x: number; y: number };
  mouseDown: boolean; rightDown: boolean;
  slotRequest: number | null;
  reload: boolean; useConsumable: boolean; refresh: boolean;
}
export function createInput(canvas: HTMLCanvasElement): InputState {
  const s: InputState = { keys: new Set(), mouse: { x: 480, y: 320 },
    mouseDown: false, rightDown: false, slotRequest: null,
    reload: false, useConsumable: false, refresh: false };
  window.addEventListener('keydown', e => {
    s.keys.add(e.key.toLowerCase());
    if ('123'.includes(e.key)) s.slotRequest = Number(e.key) - 1;
    if (e.key.toLowerCase() === 'r') s.reload = true;
    if (e.key.toLowerCase() === 'q') s.useConsumable = true;
    if (e.key.toLowerCase() === 'f') s.refresh = true;
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) e.preventDefault();
  });
  window.addEventListener('keyup', e => s.keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    s.mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
    s.mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
  });
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) s.mouseDown = true;
    if (e.button === 2) s.rightDown = true;
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) s.mouseDown = false;
    if (e.button === 2) s.rightDown = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  return s;
}
export function consumeEdges(s: InputState): void {
  s.slotRequest = null; s.reload = false; s.useConsumable = false; s.refresh = false;
}
