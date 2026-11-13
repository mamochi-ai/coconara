import type { Product } from '../data/products';
import { COORD_LIMIT } from '../data/products';
import { GarmentFigure } from './GarmentFigure';

interface Props {
  items: Product[];
  open: boolean;
  onToggle: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  saved: boolean;
}

// 自分だけのコーデ用ラック（下から引き出す小さなラック）。最大3着をハンガーに掛けて並べる。
export function CoordRack({ items, open, onToggle, onRemove, onClear, saved }: Props) {
  const metrics = { garmentH: 150, hookLen: 13, barDrop: 6 };
  const slots = Array.from({ length: COORD_LIMIT }, (_, i) => items[i] ?? null);
  return (
    <section className={`coord${open ? ' is-open' : ''}`} aria-label="コーデラック">
      <button type="button" className="coord-tab" onClick={onToggle} aria-expanded={open} aria-controls="coordBody">
        <span className="coord-tab-icon" aria-hidden="true" />
        コーデラック <span className="coord-count">{items.length}/{COORD_LIMIT}</span>
        <span className="coord-chevron" aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
      <div className="coord-body" id="coordBody" hidden={!open}>
        <div className="coord-rack">
          <div className="coord-rail" aria-hidden="true" />
          <ul className="coord-slots">
            {slots.map((p, i) => (
              <li key={p ? p.id : `empty-${i}`} className={`coord-slot${p ? '' : ' is-empty'}`}>
                <div className="coord-figure" aria-hidden={!p}>
                  {p ? (
                    <div className="coord-anchor">
                      <GarmentFigure product={p} metrics={metrics} shadow />
                    </div>
                  ) : (
                    <span className="coord-empty">空き</span>
                  )}
                </div>
                {p && (
                  <div className="coord-meta">
                    <span className="coord-name">{p.name}</span>
                    <span className="coord-color"><span className="swatch" style={{ background: p.swatch }} aria-hidden="true" />{p.color}</span>
                    <button type="button" className="btn btn-small" onClick={() => onRemove(p.id)} aria-label={`${p.name}をコーデラックから外す`}>外す</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="coord-foot">
          <p className="coord-hint">
            {items.length === 0 ? '服を選んで「コーデラックに掛ける」と、ここに並びます。' : '色と組み合わせを並べて比べられます。'}
            {!saved && ' （この端末に保存できないため、ページを閉じると消えます）'}
          </p>
          <button type="button" className="btn btn-small" onClick={onClear} disabled={items.length === 0}>すべて戻す</button>
        </div>
      </div>
    </section>
  );
}
