import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCTS, COORD_LIMIT } from './data/products';
import { Rack, type RackHandle } from './components/Rack';
import { DetailPanel } from './components/DetailPanel';
import { CoordRack } from './components/CoordRack';
import { addToCoord, removeFromCoord, sanitizeCoord } from './lib/rackMath';
import { KEYS, readJSON, writeJSON } from './lib/storage';

const PANEL_W = 360;
const ids = PRODUCTS.map((p) => p.id);

function useMedia(query: string) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

/** 下に出す詳細シートの高さ（画面の高さに合わせる） */
function useSheetHeight() {
  const calc = () => Math.round(Math.min(380, Math.max(250, window.innerHeight * 0.4)));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const on = () => setH(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

export default function App() {
  const side = useMedia('(min-width: 900px) and (orientation: landscape)');
  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)');
  const sheetHeight = useSheetHeight();
  const rack = useRef<RackHandle>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [center, setCenter] = useState(3);
  const [coord, setCoord] = useState<string[]>(() => sanitizeCoord(readJSON<unknown>(KEYS.coord, []), ids, COORD_LIMIT));
  const [coordSaved, setCoordSaved] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [hint, setHint] = useState(() => !readJSON<boolean>(KEYS.hintSeen, false));
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);

  const say = (t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  };

  const dismissHint = useCallback(() => {
    if (!hint) return;
    setHint(false);
    writeJSON(KEYS.hintSeen, true);
  }, [hint]);

  const saveCoord = (list: string[]) => {
    setCoord(list);
    setCoordSaved(writeJSON(KEYS.coord, list));
  };

  const select = useCallback((i: number) => { setSelected(i); setDrawer(false); }, []);
  const deselect = useCallback(() => {
    setSelected(null);
    // 戻したらラックにフォーカスを戻す（キーボードで続けて選べる）
    requestAnimationFrame(() => rack.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && selected !== null) deselect(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, deselect]);

  const product = selected !== null ? PRODUCTS[selected] : null;
  const coordItems = useMemo(() => coord.map((id) => PRODUCTS.find((p) => p.id === id)!).filter(Boolean), [coord]);

  const addSelected = () => {
    if (!product) return;
    const r = addToCoord(coord, product.id, COORD_LIMIT);
    if (r.result === 'duplicate') { say('すでにコーデラックに掛かっています'); return; }
    if (r.result === 'full') { say(`コーデラックは${COORD_LIMIT}着までです`); return; }
    saveCoord(r.list);
    say(`コーデラックに掛けました（${r.list.length}/${COORD_LIMIT}）`);
  };

  return (
    <div className={`app${side ? ' is-side' : ' is-narrow'}${selected !== null ? ' has-selection' : ''}`}
      style={{ ['--sheet-h' as string]: `${sheetHeight}px`, ['--panel-w' as string]: `${PANEL_W}px` }}>
      <header className="top">
        <div className="brand">
          <span className="brand-mark">HANG</span>
          <span className="brand-sub">ハング　セレクトショップ</span>
        </div>
        <p className="top-note">架空のショップのサンプルです</p>
      </header>

      <main className="main">
        <Rack
          ref={rack}
          products={PRODUCTS}
          selected={selected}
          onSelect={select}
          onDeselect={deselect}
          onCenterChange={setCenter}
          onInteract={dismissHint}
          panelWidth={side ? PANEL_W : 0}
          sheetHeight={sheetHeight}
          reducedMotion={reducedMotion}
        />

        {hint && selected === null && (
          <div className="hint" role="note">
            <span className="hint-swipe" aria-hidden="true" />
            左右にスワイプ　／　服をタップ
          </div>
        )}

        <nav className="controls" aria-label="ラックの操作">
          <button type="button" className="btn btn-round" aria-label="前の服へ" onClick={() => { dismissHint(); rack.current?.step(-1); }} disabled={selected !== null || center === 0}>
            <span aria-hidden="true">‹</span>
          </button>
          <p className="counter" aria-live="polite">
            <span className="counter-name">{PRODUCTS[center].category}</span>
            <span className="counter-num">{center + 1} / {PRODUCTS.length}</span>
          </p>
          <button type="button" className="btn btn-round" aria-label="次の服へ" onClick={() => { dismissHint(); rack.current?.step(1); }} disabled={selected !== null || center === PRODUCTS.length - 1}>
            <span aria-hidden="true">›</span>
          </button>
        </nav>

        <DetailPanel
          product={product}
          index={selected}
          total={PRODUCTS.length}
          inCoord={!!product && coord.includes(product.id)}
          coordFull={coord.length >= COORD_LIMIT}
          onAdd={addSelected}
          onClose={deselect}
        />

        {selected !== null && (
          <button type="button" className="close-x" onClick={deselect} aria-label="ラックへ戻す">
            <span aria-hidden="true">×</span>
          </button>
        )}
      </main>

      <CoordRack
        items={coordItems}
        open={drawer}
        onToggle={() => setDrawer((v) => !v)}
        onRemove={(id) => { saveCoord(removeFromCoord(coord, id)); say('コーデラックから外しました'); }}
        onClear={() => { saveCoord([]); say('すべてメインのラックに戻しました'); }}
        saved={coordSaved}
      />

      <div className={`toast${toast ? ' is-shown' : ''}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
