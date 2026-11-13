import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { Product } from '../data/products';
import { GarmentFigure } from './GarmentFigure';
import {
  type Layout, clamp, computeLayout, itemPose, projectTarget, rubberBand, settled, stepSpring,
} from '../lib/rackMath';

// 洋服ラック。動きは requestAnimationFrame で、各服の transform / opacity だけを書き換える。
// 動いているものがなくなったらループを止める（隠れている服まで常に動かさない）。

export interface RackHandle {
  step: (dir: -1 | 1) => void;
  center: () => number;
  focus: () => void;
}

interface Props {
  products: Product[];
  selected: number | null;
  onSelect: (index: number) => void;
  onDeselect: () => void;
  onCenterChange: (index: number) => void;
  onInteract: () => void;
  panelWidth: number;
  sheetHeight: number;
  reducedMotion: boolean;
}

interface ItemPhys {
  s: number; sv: number; // 手前に出ている量
  o: number; ov: number; // 左右に開く量（px）
  th: number; om: number; // 揺れ（度）
}

const TAP_SLOP = 8; // これ以上動いたらタップではない（px）
const START_INDEX = 3;

export const Rack = forwardRef<RackHandle, Props>(function Rack(props, ref) {
  const { products, selected, panelWidth, sheetHeight, reducedMotion } = props;
  const n = products.length;
  const stageRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);
  const shadowEls = useRef<(HTMLDivElement | null)[]>([]);
  const cb = useRef(props);
  cb.current = props;

  const [layout, setLayout] = useState<Layout | null>(null);
  const L = useRef<Layout | null>(null);
  const phys = useRef({
    p: START_INDEX, v: 0, target: START_INDEX as number | null,
    dragging: false, dragV: 0,
    items: products.map((): ItemPhys => ({ s: 0, sv: 0, o: 0, ov: 0, th: 0, om: 0 })),
    dim: 0, dimV: 0,
    sel: null as number | null,
    raf: 0, last: 0, running: false, lastCenter: -1,
    reduced: reducedMotion,
  });

  // ---------- 配置の計算（画面サイズ・詳細パネルに合わせる） ----------
  const measure = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sheetTop = panelWidth === 0 ? Math.max(0, window.innerHeight - sheetHeight - r.top) : null;
    const next = computeLayout({ width: r.width, height: r.height, panelWidth, sheetTop, reducedMotion });
    L.current = next;
    setLayout(next);
  }, [panelWidth, sheetHeight, reducedMotion]);

  useLayoutEffect(() => {
    measure();
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure]);

  // ---------- 描画（transform / opacity だけ） ----------
  const paint = useCallback(() => {
    const lay = L.current;
    if (!lay) return;
    const ph = phys.current;
    for (let i = 0; i < n; i++) {
      const el = itemEls.current[i];
      if (!el) continue;
      const it = ph.items[i];
      const pose = itemPose(i - ph.p, it.s, it.o, ph.dim, lay, ph.reduced);
      el.style.transform = `translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0) rotateY(${pose.rotY.toFixed(2)}deg) rotateZ(${it.th.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`;
      el.style.opacity = pose.opacity.toFixed(3);
      el.style.zIndex = String(pose.z);
      el.style.visibility = pose.opacity < 0.01 ? 'hidden' : 'visible';
      const sh = shadowEls.current[i];
      if (sh) {
        sh.style.transform = `translate3d(${(lay.garmentH * 0.03 + pose.shadowY * 0.4).toFixed(1)}px, ${pose.shadowY.toFixed(1)}px, 0) scale(${pose.shadowScale.toFixed(3)})`;
        sh.style.opacity = pose.shadowOpacity.toFixed(3);
      }
    }
    const c = clamp(Math.round(ph.p), 0, n - 1);
    if (c !== ph.lastCenter) {
      ph.lastCenter = c;
      cb.current.onCenterChange(c);
    }
  }, [n]);

  // ---------- 物理（ばね）の1コマ ----------
  const frame = useCallback((now: number) => {
    const ph = phys.current;
    const lay = L.current;
    const dt = Math.min(0.05, Math.max(0.001, (now - ph.last) / 1000));
    ph.last = now;
    let active = ph.dragging;
    const reduced = ph.reduced;

    if (!ph.dragging && ph.target !== null) {
      const k = reduced ? 220 : 120;
      [ph.p, ph.v] = stepSpring(ph.p, ph.v, ph.target, k, 2 * Math.sqrt(k) * 0.96, dt);
      if (settled(ph.p, ph.v, ph.target, 0.0008)) { ph.p = ph.target; ph.v = 0; } else active = true;
    }
    const rackV = ph.dragging ? ph.dragV : ph.v;
    if (ph.dragging) ph.dragV *= Math.exp(-dt * 6); // 指を止めたら揺れも落ち着く

    const sel = ph.sel;
    const spread = lay ? lay.spread : 0;
    for (let i = 0; i < n; i++) {
      const it = ph.items[i];
      const sT = sel === i ? 1 : 0;
      const ks = reduced ? 260 : 150;
      [it.s, it.sv] = stepSpring(it.s, it.sv, sT, ks, 2 * Math.sqrt(ks) * (reduced ? 1 : 0.86), dt);
      if (settled(it.s, it.sv, sT)) { it.s = sT; it.sv = 0; } else active = true;
      const oT = sel === null || sel === i ? 0 : Math.sign(i - sel) * spread;
      [it.o, it.ov] = stepSpring(it.o, it.ov, oT, 140, 2 * Math.sqrt(140) * 0.9, dt);
      if (settled(it.o, it.ov, oT, 0.05)) { it.o = oT; it.ov = 0; } else active = true;
      // 揺れ：移動の向きと速さに応じて小さく。中央から遠い服・手前に出た服は揺らさない
      const near = Math.abs(i - ph.p) < 4.5;
      const thT = reduced || !near ? 0 : clamp(-rackV * 2.6 * products[i].sway * (1 - it.s), -6, 6);
      [it.th, it.om] = stepSpring(it.th, it.om, thT, 70, 5.2, dt);
      if (settled(it.th, it.om, thT, 0.01)) { it.th = thT; it.om = 0; } else active = true;
    }
    const dT = sel === null ? 0 : 1;
    [ph.dim, ph.dimV] = stepSpring(ph.dim, ph.dimV, dT, 120, 2 * Math.sqrt(120), dt);
    if (settled(ph.dim, ph.dimV, dT)) { ph.dim = dT; ph.dimV = 0; } else active = true;

    paint();
    if (active) ph.raf = requestAnimationFrame(frame);
    else ph.running = false;
  }, [n, paint, products]);

  const kick = useCallback(() => {
    const ph = phys.current;
    if (ph.running) return;
    ph.running = true;
    ph.last = performance.now();
    ph.raf = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(() => () => cancelAnimationFrame(phys.current.raf), []);
  useEffect(() => { phys.current.reduced = reducedMotion; kick(); }, [reducedMotion, kick]);
  useEffect(() => { paint(); kick(); }, [layout, paint, kick]);
  // 選択の変更は物理側へ（連続して操作しても、それぞれのばねが今の位置から続きを動く）
  useEffect(() => { phys.current.sel = selected; kick(); }, [selected, kick]);

  // ---------- 移動 ----------
  const goTo = useCallback((i: number) => {
    const ph = phys.current;
    ph.target = clamp(i, 0, n - 1);
    kick();
  }, [n, kick]);

  useImperativeHandle(ref, () => ({
    step: (dir) => {
      const ph = phys.current;
      const base = ph.target ?? Math.round(ph.p);
      goTo(base + dir);
    },
    center: () => clamp(Math.round(phys.current.target ?? phys.current.p), 0, n - 1),
    focus: () => stageRef.current?.focus({ preventScroll: true }),
  }), [goTo, n]);

  // ---------- 指・マウス ----------
  const gesture = useRef({
    id: -1, x0: 0, y0: 0, t0: 0, p0: 0, mode: 'idle' as 'idle' | 'pending' | 'drag' | 'scroll',
    caught: false, index: null as number | null, samples: [] as { x: number; t: number }[],
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const g = gesture.current;
    const ph = phys.current;
    cb.current.onInteract();
    const hit = (e.target as HTMLElement).closest('[data-index]');
    // 動いている最中に触れたら「止める」だけ（その指を離しても選ばない）
    const moving = Math.abs(ph.v) > 0.6 || (ph.target !== null && Math.abs(ph.target - ph.p) > 0.08);
    g.id = e.pointerId; g.x0 = e.clientX; g.y0 = e.clientY; g.t0 = performance.now(); g.p0 = ph.p;
    g.mode = 'pending'; g.caught = moving && ph.sel === null; g.index = hit ? Number((hit as HTMLElement).dataset.index) : null;
    g.samples = [{ x: e.clientX, t: g.t0 }];
    if (g.caught) { ph.target = null; ph.v = 0; g.p0 = ph.p; }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (e.pointerId !== g.id || g.mode === 'idle' || g.mode === 'scroll') return;
    const ph = phys.current;
    const lay = L.current;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.mode === 'pending') {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) { g.mode = 'scroll'; return; } // 縦はページのスクロールに任せる
      if (ph.sel !== null) { g.mode = 'scroll'; return; } // 選んでいる間はラックを動かさない
      g.mode = 'drag';
      ph.dragging = true;
      ph.target = null;
      ph.v = 0;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 無視 */ }
      kick();
    }
    if (g.mode !== 'drag' || !lay) return;
    const raw = g.p0 - dx / lay.spacing;
    ph.p = rubberBand(raw, n);
    const now = performance.now();
    g.samples.push({ x: e.clientX, t: now });
    while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
    const a = g.samples[0];
    const dtS = Math.max(0.008, (now - a.t) / 1000);
    ph.dragV = -((e.clientX - a.x) / lay.spacing) / dtS;
  };

  const endGesture = (e: React.PointerEvent, cancelled: boolean) => {
    const g = gesture.current;
    if (e.pointerId !== g.id) return;
    const ph = phys.current;
    const mode = g.mode;
    g.mode = 'idle';
    g.id = -1;
    if (mode === 'drag') {
      ph.dragging = false;
      const v = cancelled ? 0 : ph.dragV;
      ph.v = clamp(v, -14, 14);
      ph.target = projectTarget(ph.p, ph.v, n);
      kick();
      return; // ドラッグの終わりは選択にしない
    }
    if (g.caught) { // 止めただけ：近くの服に収める
      ph.target = clamp(Math.round(ph.p), 0, n - 1);
      kick();
      return;
    }
    if (cancelled || mode !== 'pending') return;
    if (performance.now() - g.t0 > 650) return; // 長押しは選択しない
    if (g.index !== null) {
      if (ph.sel !== g.index) cb.current.onSelect(g.index);
    } else if (ph.sel !== null) {
      cb.current.onDeselect();
    }
  };

  // ---------- トラックパッドの横スクロール（PC） ----------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || phys.current.sel !== null || !L.current) return;
      e.preventDefault();
      const ph = phys.current;
      ph.target = null;
      ph.v = 0;
      ph.p = rubberBand(ph.p + e.deltaX / L.current.spacing, n);
      ph.dragV = clamp(e.deltaX / L.current.spacing * 30, -8, 8);
      paint();
      kick();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { ph.target = projectTarget(ph.p, 0, n); kick(); }, 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); window.clearTimeout(timer); };
  }, [n, kick, paint]);

  // ---------- キーボード ----------
  const onKeyDown = (e: React.KeyboardEvent) => {
    const ph = phys.current;
    cb.current.onInteract();
    if (e.key === 'Escape' && ph.sel !== null) { e.preventDefault(); cb.current.onDeselect(); return; }
    if (ph.sel !== null) return;
    const base = ph.target ?? Math.round(ph.p);
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(base + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(base - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
    else if (e.key === 'End') { e.preventDefault(); goTo(n - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cb.current.onSelect(clamp(Math.round(base), 0, n - 1)); }
  };

  const metrics = layout ? { garmentH: layout.garmentH, hookLen: layout.hookLen, barDrop: layout.barDrop } : null;

  return (
    <div
      ref={stageRef}
      className={`stage${selected !== null ? ' has-selection' : ''}`}
      tabIndex={0}
      role="group"
      aria-roledescription="洋服ラック"
      aria-label="洋服ラック。左右の矢印キーで服を移動、Enter で手前に出す、Escape でラックへ戻す"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endGesture(e, false)}
      onPointerCancel={(e) => endGesture(e, true)}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="wall" aria-hidden="true" />
      {layout && (
        <div className="rack-frame" aria-hidden="true" style={{ top: layout.railY }}>
          <div className="rail" />
          <div className="post post-l" />
          <div className="post post-r" />
        </div>
      )}
      <div className="floor" aria-hidden="true" />
      {layout && metrics && (
        <div className="items" style={{ top: layout.railY }}>
          {products.map((p, i) => (
            <div
              key={p.id}
              ref={(el) => { itemEls.current[i] = el; }}
              className={`item${selected === i ? ' is-selected' : ''}`}
              data-id={p.id}
            >
              <GarmentFigure
                product={p}
                metrics={metrics}
                shadowRef={(el) => { shadowEls.current[i] = el; }}
                hitProps={{ 'data-index': i, 'aria-hidden': true } as Record<string, unknown>}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
