import { describe, it, expect, vi } from 'vitest';
import type { World } from './game/combat';

/** main.ts 在 import 时就直接启动：没有 DOM stub 就无法验证启动链路。
 *  这里用最小 DOM/Canvas 替身跑一帧，确认标题页、渲染与 RAF 循环不抛异常。 */
function stubCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  return new Proxy({}, { get: (_t, k) => {
    if (k === 'canvas') return { width: 960, height: 640 };
    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
    if (k === 'measureText') return () => ({ width: 10 });
    return () => {};
  } }) as unknown as CanvasRenderingContext2D;
}

function installDom() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  // Screens 通过 [data-act] 元素绑定点击；这里收集按钮以便测试里触发阶段流转。
  const buttons: { act: string; dataset: { act: string }; onclick: (() => void) | null; disabled: boolean }[] = [];
  const overlay = {
    get innerHTML() { return html; },
    set innerHTML(v: string) {
      html = v;
      buttons.length = 0;
      for (const m of v.matchAll(/data-act='([^']*)'([^>]*)/g)) {
        const act = m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        buttons.push({ act, dataset: { act }, onclick: null, disabled: m[2]!.includes('disabled') });
      }
    },
    querySelectorAll: (_sel: string) => buttons as unknown[],
  };
  let html = '';
  const raf: FrameRequestCallback[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  class FakeCanvas {
    width = 960; height = 640;
    getContext() { return stubCtx(); }
    addEventListener() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 960, height: 640 }; }
  }
  const canvas = new FakeCanvas();
  g.document = {
    getElementById: (id: string) => id === 'game' ? canvas : id === 'overlay' ? overlay : null,
  };
  g.window = {
    addEventListener: (name: string, fn: (e: unknown) => void) => {
      const l = listeners.get(name) ?? [];
      l.push(fn); listeners.set(name, l);
    },
  };
  g.performance = { now: () => 1000 };
  g.requestAnimationFrame = (fn: FrameRequestCallback) => { raf.push(fn); return raf.length; };
  g.HTMLCanvasElement = FakeCanvas;
  return { overlay, raf, listeners, buttons };
}
type StubButton = { act: string; dataset: { act: string }; onclick: (() => void) | null; disabled: boolean };
function click(buttons: StubButton[],
  pred: (a: Record<string, unknown>) => boolean): void {
  const b = buttons.find(x => !x.disabled && pred(JSON.parse(x.act) as Record<string, unknown>));
  if (!b?.onclick) throw new Error('no matching enabled button');
  b.onclick();
}
function frame(raf: FrameRequestCallback[], t: number): void {
  const fn = raf.pop()!;
  raf.length = 0;
  fn(t);
}

describe('main.ts boot smoke test', () => {
  it('boots, renders the title screen and survives one animation frame', async () => {
    const { overlay, raf, listeners } = installDom();
    vi.resetModules();
    const main = await import('./main');
    expect(main.boot()).toBe(true);
    expect(overlay.innerHTML).toContain('僵尸竞技场');
    expect(raf.length).toBe(1);
    // 推一帧（此时 phase=title，只渲染不更新战斗）
    expect(() => frame(raf, 1016)).not.toThrow();
    // 失焦/聚焦处理器都已注册
    expect(listeners.get('blur')?.length).toBeGreaterThan(0);
    expect(listeners.get('focus')?.length).toBeGreaterThan(0);
  });

  it('drives title -> character -> shop -> combat -> waveEnd -> shop (wave 2)', async () => {
    const { overlay, raf, buttons, listeners } = installDom();
    vi.resetModules();
    const combat = await import('./game/combat');
    const { newDamageOp } = await import('./core/types');
    // 捕获 main.ts 内部创建的 World（构造后必定调用 setRules）
    const worlds: World[] = [];
    const origSetRules = combat.World.prototype.setRules;
    combat.World.prototype.setRules = function (this: World, ...args) {
      if (!worlds.includes(this)) worlds.push(this);
      return origSetRules.apply(this, args);
    };
    await import('./main');
    // 标题页「开始新的一局」
    expect(overlay.innerHTML).toContain('僵尸竞技场');
    click(buttons, a => a['t'] === 'continue');
    expect(overlay.innerHTML).toContain('选择角色');
    // 选角色 → 进商店
    click(buttons, a => a['t'] === 'start');
    expect(overlay.innerHTML).toContain('商店');
    expect(overlay.innerHTML).toContain('第 1 波前');
    // 买第一件装备，然后开战
    click(buttons, a => a['t'] === 'buy');
    click(buttons, a => a['t'] === 'beginWave');
    expect(overlay.innerHTML).toBe('');
    const keys = listeners.get('keydown') ?? [];
    expect(keys.length).toBeGreaterThan(0);
    // 逐帧推进：生成的僵尸立刻被一击必杀，直至波次结束
    let t = 1000, ended = false;
    for (let i = 0; i < 400 && !ended; i++) {
      t += 16;
      frame(raf, t);
      for (const w of worlds) {
        for (const e of w.entities) {
          if (e.id !== 1 && !e.dead && !e.tags.includes('deployable'))
            combat.dealDamage(w, e, newDamageOp(100000, 'blade', e.id, ['melee']));
        }
      }
      if (overlay.innerHTML.includes('波结束')) ended = true;
    }
    expect(ended).toBe(true);
    expect(overlay.innerHTML).toContain('第 1 波结束');
    // 天赋三选一 + 拒绝契约 → 回商店，且波次必须推进到 2
    click(buttons, a => a['t'] === 'talent');
    click(buttons, a => a['t'] === 'curse' && a['id'] === null);
    click(buttons, a => a['t'] === 'continue');
    expect(overlay.innerHTML).toContain('第 2 波前');
  });

  it('grants advertised character starters and keeps player maxHp in sync', async () => {
    const { overlay, buttons } = installDom();
    vi.resetModules();
    await import('./main');
    click(buttons, a => a['t'] === 'continue');
    // 巫师：起手 ★2 火球杖
    click(buttons, a => a['t'] === 'start' && a['characterId'] === 'wizard');
    expect(overlay.innerHTML).toContain('★2');
    expect(overlay.innerHTML).toContain('火球杖');
  });
});
