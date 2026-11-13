import { describe, expect, it } from 'vitest';
import {
  computeLayout, itemPose, projectTarget, rubberBand, stepSpring, settled,
  addToCoord, removeFromCoord, sanitizeCoord, GARMENT_ASPECT,
} from './rackMath';
import { PRODUCTS, COORD_LIMIT } from '../data/products';

const ipad = computeLayout({ width: 1180, height: 760, panelWidth: 360, sheetTop: null, reducedMotion: false });
const phone = computeLayout({ width: 390, height: 780, panelWidth: 0, sheetTop: 470, reducedMotion: false });

describe('配置', () => {
  it('隣の服が少し重なる間隔（服の幅より狭い）', () => {
    for (const L of [ipad, phone]) {
      const w = L.garmentH * GARMENT_ASPECT;
      expect(L.spacing).toBeLessThan(w);
      expect(L.spacing).toBeGreaterThan(w * 0.4);
    }
  });
  it('スマホでも中央の服の左右に次の服が見える', () => {
    const w = phone.garmentH * GARMENT_ASPECT;
    expect(w).toBeLessThan(phone.width * 0.7);
    expect(phone.spacing + w / 2).toBeLessThan(phone.width / 2 + w); // 隣の服が画面内にかかる
  });
  it('iPad横向き：選んだ服は詳細パネルを除いた領域の中央へ', () => {
    expect(ipad.frontX).toBe(-180);
    expect(ipad.narrow).toBe(false);
  });
  it('スマホ：選んだ服は下の詳細シートの上に収まる', () => {
    const totalH = phone.hookLen + phone.barDrop + phone.garmentH * 1.12;
    expect(phone.railY + phone.frontY + totalH * phone.frontScale).toBeLessThanOrEqual(470);
  });
});

describe('姿勢', () => {
  it('中央は正面・最前面、端ほど横向きで小さい', () => {
    const c = itemPose(0, 0, 0, 0, ipad, false);
    const r = itemPose(2, 0, 0, 0, ipad, false);
    const l = itemPose(-2, 0, 0, 0, ipad, false);
    expect(c.rotY).toBe(0);
    expect(r.rotY).toBeGreaterThan(0);
    expect(l.rotY).toBeLessThan(0);
    expect(c.scale).toBeGreaterThan(r.scale);
    expect(c.z).toBeGreaterThan(r.z);
    expect(Math.abs(r.rotY)).toBeLessThanOrEqual(45);
  });
  it('選んだ服は手前（大きく・影が広く・最前面）、ほかは控えめ', () => {
    const sel = itemPose(1, 1, 0, 1, ipad, false);
    const other = itemPose(0, 0, -ipad.spread, 1, ipad, false);
    expect(sel.x).toBe(ipad.frontX);
    expect(sel.scale).toBeGreaterThan(1);
    expect(sel.shadowScale).toBeGreaterThan(1.2);
    expect(sel.z).toBeGreaterThan(other.z);
    expect(other.opacity).toBeLessThan(0.7);
  });
  it('動きを減らす設定では横向きを弱める', () => {
    expect(Math.abs(itemPose(2, 0, 0, 0, ipad, true).rotY)).toBeLessThan(Math.abs(itemPose(2, 0, 0, 0, ipad, false).rotY));
  });
});

describe('移動', () => {
  it('離したら近くの服に収まる。速く払うと少し先まで（最大3着）', () => {
    expect(projectTarget(2.3, 0, 8)).toBe(2);
    expect(projectTarget(2.3, 10, 8)).toBe(4);
    expect(projectTarget(2, 100, 8)).toBe(5);
    expect(projectTarget(6.8, 10, 8)).toBe(7);
    expect(projectTarget(0.2, -10, 8)).toBe(0);
  });
  it('端では抵抗がかかる', () => {
    expect(rubberBand(-1, 8)).toBeGreaterThan(-1);
    expect(rubberBand(8, 8)).toBeLessThan(8);
    expect(rubberBand(3.5, 8)).toBe(3.5);
  });
  it('ばねは目標に収まり、行き過ぎない（ラックの移動）', () => {
    let x = 0; let v = 0; let max = 0;
    for (let i = 0; i < 240; i++) { [x, v] = stepSpring(x, v, 1, 120, 2 * Math.sqrt(120) * 0.96, 1 / 60); max = Math.max(max, x); }
    expect(settled(x, v, 1)).toBe(true);
    expect(max).toBeLessThan(1.02);
  });
  it('大きな時間刻みでも発散しない', () => {
    let x = 0; let v = 0;
    for (let i = 0; i < 30; i++) [x, v] = stepSpring(x, v, 1, 150, 20, 0.05);
    expect(Number.isFinite(x)).toBe(true);
    expect(Math.abs(x - 1)).toBeLessThan(0.01);
  });
});

describe('コーデラック', () => {
  it('追加・重複防止・上限・削除', () => {
    let r = addToCoord([], 'a', 3);
    expect(r).toEqual({ list: ['a'], result: 'added' });
    r = addToCoord(r.list, 'a', 3);
    expect(r.result).toBe('duplicate');
    expect(r.list).toEqual(['a']);
    r = addToCoord(['a', 'b', 'c'], 'd', 3);
    expect(r.result).toBe('full');
    expect(r.list).toEqual(['a', 'b', 'c']);
    expect(removeFromCoord(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
  it('保存データを検証する（不明なID・重複・上限超え・壊れたデータ）', () => {
    const ids = PRODUCTS.map((p) => p.id);
    expect(sanitizeCoord([ids[0], 'unknown', ids[0], ids[1], ids[2], ids[3]], ids, COORD_LIMIT)).toEqual([ids[0], ids[1], ids[2]]);
    expect(sanitizeCoord('broken', ids, COORD_LIMIT)).toEqual([]);
    expect(sanitizeCoord(null, ids, COORD_LIMIT)).toEqual([]);
  });
});

describe('商品データ', () => {
  it('8着・IDが重複しない・輪郭の違う種類が混ざる・表示の調整値が正しい範囲', () => {
    expect(PRODUCTS.length).toBe(8);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(8);
    expect(new Set(PRODUCTS.map((p) => p.category)).size).toBeGreaterThanOrEqual(6);
    expect(PRODUCTS.some((p) => p.hanger === 'clip')).toBe(true);
    for (const p of PRODUCTS) {
      expect(p.anchor.x).toBeGreaterThanOrEqual(0);
      expect(p.anchor.x).toBeLessThanOrEqual(1);
      expect(p.anchor.y).toBeGreaterThanOrEqual(0);
      expect(p.anchor.y).toBeLessThan(0.5);
      expect(p.scale).toBeGreaterThan(0.5);
      expect(p.aspect).toBeGreaterThan(0.2);
      expect(p.name && p.category && p.color && p.description).toBeTruthy();
    }
  });
});
