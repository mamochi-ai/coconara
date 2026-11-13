import { useState } from 'react';
import type { Product } from '../data/products';

// ハンガーと服を一体で描く。原点（0,0）はフックがレールに掛かる点。
// 要素自体の大きさは 0×0 で、子要素を原点からの位置に置く（親が transform で動かす）。

export interface FigureMetrics {
  garmentH: number;
  hookLen: number;
  barDrop: number;
}

export function figureBox(p: Product, m: FigureMetrics) {
  const h = m.garmentH * p.scale;
  const w = h * p.aspect;
  const barY = p.hanger === 'none' ? 0 : m.hookLen + m.barDrop;
  const top = barY - p.anchor.y * h;
  const left = -p.anchor.x * w;
  return { w, h, barY, top, left };
}

const BASE = import.meta.env.BASE_URL;

interface Props {
  product: Product;
  metrics: FigureMetrics;
  /** 影を描くか（コーデラックの小さい表示では軽くする） */
  shadow?: boolean;
  shadowRef?: (el: HTMLDivElement | null) => void;
  /** タップ判定に使う領域（服の中央部）に付ける属性 */
  hitProps?: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>;
}

export function GarmentFigure({ product, metrics, shadow = true, shadowRef, hitProps }: Props) {
  const [failed, setFailed] = useState(false);
  const { w, h, barY, top, left } = figureBox(product, metrics);
  return (
    <>
      {shadow && (
        <div
          ref={shadowRef}
          className="g-shadow"
          aria-hidden="true"
          style={{ left: left + w * 0.06, top: top + h * 0.04, width: w * 0.96, height: h * 0.96 }}
        />
      )}
      {product.hanger !== 'none' && <HangerBack type={product.hanger} w={w} metrics={metrics} barY={barY} />}
      {failed ? (
        <FallbackGarment product={product} style={{ left, top, width: w, height: h }} />
      ) : (
        <img
          className="g-img"
          src={`${BASE}${product.image}`}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setFailed(true)}
          style={{ left, top, width: w, height: h }}
        />
      )}
      {product.hanger === 'clip' && <ClipFront w={w} barY={barY} />}
      {hitProps && (
        <div
          className="g-hit"
          {...hitProps}
          style={{ left: left + w * 0.16, top: Math.min(-4, top), width: w * 0.68, height: top + h * 0.9 - Math.min(-4, top) }}
        />
      )}
    </>
  );
}

/** フック（金属）とハンガー本体の奥側 */
function HangerBack({ type, w, metrics, barY }: { type: 'shoulder' | 'clip'; w: number; metrics: FigureMetrics; barY: number }) {
  const hk = metrics.hookLen;
  const r = Math.max(5, hk * 0.24);
  const hook = `M0 ${hk + 2} V${hk * 0.42} C0 ${-r * 0.9} ${-r * 2} ${-r * 1.1} ${-r * 2} ${r * 0.4}`;
  if (type === 'shoulder') {
    const bw = w * 0.7;
    const t = Math.max(5, metrics.barDrop * 0.55);
    const body = `M${-bw / 2} ${barY + t * 0.6} Q${-bw * 0.18} ${hk - 1} 0 ${hk - 2} Q${bw * 0.18} ${hk - 1} ${bw / 2} ${barY + t * 0.6}
      Q${bw / 2 + 3} ${barY + t * 1.5} ${bw / 2 - 6} ${barY + t * 1.4} Q0 ${hk + t * 1.6} ${-bw / 2 + 6} ${barY + t * 1.4} Q${-bw / 2 - 3} ${barY + t * 1.5} ${-bw / 2} ${barY + t * 0.6} Z`;
    return (
      <svg className="g-hanger" aria-hidden="true" style={{ left: -bw / 2 - 8, top: -r * 2, width: bw + 16, height: barY + t * 2 + r * 2 }}
        viewBox={`${-bw / 2 - 8} ${-r * 2} ${bw + 16} ${barY + t * 2 + r * 2}`}>
        <path d={body} className="hanger-wood" />
        <path d={hook} className="hanger-hook" />
      </svg>
    );
  }
  const bw = w * 0.56;
  return (
    <svg className="g-hanger" aria-hidden="true" style={{ left: -bw / 2 - 8, top: -r * 2, width: bw + 16, height: barY + 14 + r * 2 }}
      viewBox={`${-bw / 2 - 8} ${-r * 2} ${bw + 16} ${barY + 14 + r * 2}`}>
      <path d={hook} className="hanger-hook" />
      <rect x={-bw / 2} y={barY - 9} width={bw} height={7} rx={3.5} className="hanger-bar" />
    </svg>
  );
}

/** クリップ（服の手前側で、ウエストを挟む） */
function ClipFront({ w, barY }: { w: number; barY: number }) {
  const cx = w * 0.21;
  const cw = Math.max(8, w * 0.045);
  const ch = Math.max(16, w * 0.09);
  return (
    <svg className="g-clips" aria-hidden="true" style={{ left: -cx - cw, top: barY - 10, width: cx * 2 + cw * 2, height: ch + 4 }}
      viewBox={`${-cx - cw} ${barY - 10} ${cx * 2 + cw * 2} ${ch + 4}`}>
      {[-cx, cx].map((x) => (
        <g key={x}>
          <rect x={x - cw / 2} y={barY - 8} width={cw} height={ch} rx={2} className="clip" />
          <rect x={x - cw / 2 + 2} y={barY - 8 + ch * 0.55} width={cw - 4} height={2} className="clip-line" />
        </g>
      ))}
    </svg>
  );
}

/** 画像を読み込めなかったときの代わり（服の形の輪郭だけ） */
function FallbackGarment({ product, style }: { product: Product; style: React.CSSProperties }) {
  const bottom = product.hanger === 'clip';
  return (
    <div className="g-fallback" style={style} role="img" aria-label={`${product.name}（画像を読み込めませんでした）`}>
      <svg viewBox="0 0 400 600" width="100%" height="100%" aria-hidden="true">
        {bottom ? (
          <path d="M130 30 L270 30 L310 560 L210 560 L200 170 L190 560 L90 560 Z" />
        ) : (
          <path d="M150 30 Q200 50 250 30 L330 60 L360 330 L320 336 L304 160 L306 520 L94 520 L96 160 L80 336 L40 330 L70 60 Z" />
        )}
      </svg>
      <span>{product.category}</span>
    </div>
  );
}
