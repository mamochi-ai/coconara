import { useEffect, useRef } from 'react';
import type { Product } from '../data/products';
import { COORD_LIMIT } from '../data/products';

interface Props {
  product: Product | null;
  index: number | null;
  total: number;
  inCoord: boolean;
  coordFull: boolean;
  onAdd: () => void;
  onClose: () => void;
}

// 選んだ服の情報。横向きの iPad・PC では右側、縦長の画面では下に出す。
export function DetailPanel({ product, index, total, inCoord, coordFull, onAdd, onClose }: Props) {
  const headRef = useRef<HTMLHeadingElement>(null);
  const open = product !== null;
  useEffect(() => {
    // 開いたら見出しへ（キーボード・読み上げで内容に移れる）
    if (open) headRef.current?.focus({ preventScroll: true });
  }, [open, product?.id]);

  return (
    <aside className={`detail${open ? ' is-open' : ''}`} aria-hidden={!open} aria-label="選んだ服">
      {product && (
        <div className="detail-inner">
          <div className="detail-top">
            <span className="detail-cat">{product.category}</span>
            <span className="detail-count">{(index ?? 0) + 1} / {total}</span>
          </div>
          <h2 className="detail-name" ref={headRef} tabIndex={-1}>
            {/* 名前は空白の位置でだけ改行する（語の途中で折り返さない） */}
            {product.name.split(' ').map((w, i) => <span key={i} className="nowrap">{i ? ' ' : ''}{w}</span>)}
          </h2>
          <p className="detail-color">
            <span className="swatch" style={{ background: product.swatch }} aria-hidden="true" />
            {product.color}
          </p>
          <p className="detail-desc">{product.description}</p>
          <div className="detail-actions">
            <button type="button" className="btn btn-primary" onClick={onAdd} disabled={inCoord || coordFull}>
              {inCoord ? 'コーデラックに掛けています' : coordFull ? `コーデラックは${COORD_LIMIT}着まで` : 'コーデラックに掛ける'}
            </button>
            <button type="button" className="btn" onClick={onClose}>ラックへ戻す</button>
          </div>
          {coordFull && !inCoord && <p className="detail-note">コーデラックの服を外すと掛けられます。</p>}
        </div>
      )}
    </aside>
  );
}
