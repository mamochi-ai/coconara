import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDim, fmt, evaluateDims, analyze, diffOrders, sampleDoc, emptyOrder, emptyDoc, summarizeChanges, fieldValues,
  cloneOrder, serializeDoc, parseBackup, hasContent,
} from '../../docs/js/model.js';
import { buildScene, buildCompareScene, sceneToSvg, geometry } from '../../docs/js/diagram.js';

const order = (dims, extra = {}) => ({ ...emptyOrder(), ...extra, dims: { ...emptyOrder().dims, ...dims } });

test('数値の解釈：空欄と0を区別する', () => {
  assert.deepEqual(parseDim(''), { status: 'empty' });
  assert.deepEqual(parseDim('   '), { status: 'empty' });
  assert.deepEqual(parseDim('0'), { status: 'ok', value: 0 });
  assert.deepEqual(parseDim('0.0'), { status: 'ok', value: 0 });
});

test('数値の解釈：40 と 40.0 は同じ値、全角も受け付ける', () => {
  assert.equal(parseDim('40').value, 400);
  assert.equal(parseDim('40.0').value, 400);
  assert.equal(parseDim('40.00').value, 400);
  assert.equal(parseDim('４０．５').value, 405);
  assert.equal(parseDim('40.').value, 400);
  assert.equal(parseDim('.5').value, 5);
});

test('数値の解釈：不正な入力', () => {
  assert.equal(parseDim('abc').status, 'invalid');
  assert.equal(parseDim('-3').status, 'invalid');
  assert.equal(parseDim('40.55').status, 'invalid');
  assert.equal(parseDim('1e3').status, 'invalid');
  assert.equal(parseDim('.').status, 'invalid');
  assert.equal(parseDim('4 0').value, 400); // 空白は除去
});

test('表示形式', () => {
  assert.equal(fmt(400), '40');
  assert.equal(fmt(405), '40.5');
  assert.equal(fmt(0), '0');
  assert.equal(fmt(5), '0.5');
});

test('底幅＝袋口幅−マチ（サンプル 40−10=30）', () => {
  const ev = evaluateDims({ height: '30', mouthWidth: '40', gusset: '10', handleHeight: '15' });
  assert.equal(ev.bottomWidth.status, 'ok');
  assert.equal(ev.bottomWidth.value, 300);
});

test('マチが袋口幅以上ならエラーで、底幅は計算しない（負の底幅を作らない）', () => {
  for (const [m, g] of [['40', '40'], ['40', '40.0'], ['20', '25'], ['30', '35.5']]) {
    const ev = evaluateDims({ height: '30', mouthWidth: m, gusset: g, handleHeight: '15' });
    assert.equal(ev.gusset.status, 'invalid', `${m}/${g}`);
    assert.match(ev.gusset.error, /袋口幅/);
    assert.equal(ev.bottomWidth.status, 'invalid');
    assert.equal(ev.bottomWidth.value, undefined);
  }
  const ok = evaluateDims({ height: '30', mouthWidth: '40', gusset: '39.9', handleHeight: '15' });
  assert.equal(ok.bottomWidth.value, 1);
});

test('入力範囲', () => {
  const ev = evaluateDims({ height: '4.9', mouthWidth: '100.1', gusset: '0', handleHeight: '50' });
  assert.equal(ev.height.status, 'invalid');
  assert.equal(ev.mouthWidth.status, 'invalid');
  assert.equal(ev.gusset.status, 'ok');
  assert.equal(ev.handleHeight.status, 'ok');
  assert.equal(evaluateDims({ gusset: '40.1' }).gusset.status, 'invalid');
  assert.equal(evaluateDims({ handleHeight: '2.9' }).handleHeight.status, 'invalid');
});

test('マチ0（空欄でない）は確定値、空欄は要確認', () => {
  const a = analyze(order({ height: '30', mouthWidth: '40', gusset: '0', handleHeight: '15' }));
  assert.equal(a.dims.gusset.status, 'ok');
  assert.equal(a.dims.bottomWidth.value, 400);
  assert.ok(!a.pending.some((p) => p.key === 'gusset'));
  const b = analyze(order({ height: '30', mouthWidth: '40', gusset: '', handleHeight: '15' }));
  assert.ok(b.pending.some((p) => p.key === 'gusset'));
  assert.equal(b.dims.bottomWidth.status, 'empty');
  assert.equal(b.errors.length, 0);
});

test('未定・未入力は要確認として列挙する（勝手に補完しない）。メモ空欄は要確認にしない', () => {
  const a = analyze(emptyOrder());
  const keys = a.pending.map((p) => p.key);
  assert.deepEqual(keys, ['orderNo', 'height', 'mouthWidth', 'gusset', 'handleHeight', 'outerColor', 'lining', 'pocket']);
  assert.ok(!keys.includes('memo'));
  const b = analyze(order({}, { lining: 'yes' }));
  assert.ok(b.pending.some((p) => p.key === 'liningColor'));
  const c = analyze(order({}, { lining: 'none', liningColor: '' }));
  assert.ok(!c.pending.some((p) => p.key === 'liningColor'));
});

test('サンプル：底幅と変更点', () => {
  const s = sampleDoc();
  assert.equal(evaluateDims(s.baseline.dims).bottomWidth.value, 300);
  assert.equal(evaluateDims(s.current.dims).bottomWidth.value, 350);
  const texts = summarizeChanges(s.baseline, s.current).map((c) => c.text);
  assert.deepEqual(texts, [
    '袋口幅：40 → 45cm',
    '底幅：30 → 35cm（袋口幅変更に伴う）',
    '内ポケット：なし → あり',
  ]);
  // 確認事項の変更はお客様用の一覧には出さない（作家向けの画面では出す）
  assert.ok(summarizeChanges(s.baseline, s.current, { questions: true }).some((c) => c.text === 'お客様に確認したいこと：内容を変更'));
  assert.equal(s.baselineVersion, 1);
  assert.equal(s.version, 2);
  assert.equal(s.isSample, true);
});

test('40 と 40.0 は変更扱いにしない', () => {
  const a = order({ mouthWidth: '40' });
  const b = order({ mouthWidth: '40.0' });
  assert.equal(diffOrders(a, b).length, 0);
  const c = order({ mouthWidth: '４０' });
  assert.equal(diffOrders(a, c).length, 0);
});

test('元の値に戻すと変更が消える', () => {
  const s = sampleDoc();
  s.current.dims.mouthWidth = '40';
  s.current.pocket = 'none';
  s.current.questions = '';
  assert.deepEqual(diffOrders(s.baseline, s.current), []);
});

test('未定→確定、あり→なし、空欄→値 も変更として扱う', () => {
  const a = order({ height: '' }, { lining: 'undecided', pocket: 'yes', outerColor: '' });
  const b = order({ height: '30' }, { lining: 'none', pocket: 'none', outerColor: 'navy' });
  const t = summarizeChanges(a, b).map((c) => c.text);
  assert.ok(t.includes('本体高さ：未入力 → 30cm'));
  assert.ok(t.includes('裏地：未定 → なし'));
  assert.ok(t.includes('内ポケット：あり → なし'));
  assert.ok(t.includes('表地：未定 → ネイビー'));
});

test('裏地の色は裏地ありのときだけ比較対象', () => {
  const a = order({}, { lining: 'none', liningColor: 'navy' });
  const b = order({}, { lining: 'none', liningColor: 'olive' });
  assert.equal(diffOrders(a, b).length, 0);
  const c = order({}, { lining: 'yes', liningColor: 'olive' });
  // 裏地の追加と色はまとめて1行
  assert.deepEqual(summarizeChanges(a, c).map((x) => x.text), ['裏地：なし → あり〈オリーブ〉']);
  // 裏地ありのまま色だけ変えた場合
  const d = order({}, { lining: 'yes', liningColor: 'beige' });
  const e = order({}, { lining: 'yes', liningColor: 'navy' });
  assert.deepEqual(summarizeChanges(d, e).map((x) => x.text), ['裏地の色：ベージュ → ネイビー']);
  // 色未選択のまま裏地を追加
  assert.deepEqual(summarizeChanges(a, order({}, { lining: 'yes' })).map((x) => x.text), ['裏地：なし → あり〈色は未定〉']);
});

test('裏地なし・裏地未定・色未選択を区別して表示する（まとめた「なし／未定」は使わない）', () => {
  const lc = (lining, liningColor = '') => fieldValues(order({}, { lining, liningColor })).find((f) => f.key === 'liningColor').text;
  assert.equal(lc('none', 'navy'), '対象外');
  assert.equal(lc('undecided', 'navy'), '未定');
  assert.equal(lc('yes'), '未定');
  assert.equal(lc('yes', 'navy'), 'ネイビー');
  for (const l of ['none', 'undecided', 'yes']) assert.ok(!/なし／未定/.test(lc(l)));
});

test('マチだけ変えた場合の底幅の説明', () => {
  const a = order({ mouthWidth: '40', gusset: '10' });
  const b = order({ mouthWidth: '40', gusset: '12' });
  assert.deepEqual(summarizeChanges(a, b).map((c) => c.text), ['マチ：10 → 12cm', '底幅：30 → 28cm（マチ変更に伴う）']);
});

test('比較元はコピーなので、現在の内容を編集しても変わらない', () => {
  const doc = emptyDoc();
  doc.current.dims.mouthWidth = '40';
  doc.baseline = cloneOrder(doc.current);
  doc.current.dims.mouthWidth = '50';
  assert.equal(doc.baseline.dims.mouthWidth, '40');
});

test('JSON：比較元を含めて往復できる', () => {
  const s = sampleDoc();
  const text = JSON.stringify(serializeDoc(s));
  const back = parseBackup(text);
  assert.deepEqual(back, s);
  assert.equal(JSON.parse(text).schema_version, 2);
  // 出力設定と確認事項も往復する
  s.output = { audience: 'maker', side: true, interior: false, memo: true };
  s.current.questions = '確認事項';
  assert.deepEqual(parseBackup(JSON.stringify(serializeDoc(s))), s);
});

test('JSON：壊れたもの・不正な値は拒否する', () => {
  const good = serializeDoc(sampleDoc());
  assert.throws(() => parseBackup('{"schema_version":1,'), /JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ ...good, schema_version: 99 })), /対応していない/);
  const bad1 = structuredClone(good); bad1.data.current.dims.height = 'abc';
  assert.throws(() => parseBackup(JSON.stringify(bad1)), /本体高さ/);
  const bad2 = structuredClone(good); bad2.data.current.outerColor = 'red';
  assert.throws(() => parseBackup(JSON.stringify(bad2)), /表地/);
  const bad3 = structuredClone(good); bad3.data.baseline_version = 5;
  assert.throws(() => parseBackup(JSON.stringify(bad3)), /版番号/);
  const bad4 = structuredClone(good); bad4.data.baseline.dims.gusset = '40';
  assert.throws(() => parseBackup(JSON.stringify(bad4)), /比較元/);
  const bad5 = structuredClone(good); bad5.data.current.pocket = 'maybe';
  assert.throws(() => parseBackup(JSON.stringify(bad5)), /内ポケット/);
});

test('内容の有無の判定', () => {
  assert.equal(hasContent(emptyDoc()), false);
  const d = emptyDoc(); d.current.dims.height = '0';
  assert.equal(hasContent(d), true);
});

test('図：極端な寸法や未入力・不正値でも有限の座標で収まる', () => {
  const cases = [
    order({ height: '80', mouthWidth: '5', gusset: '4.9', handleHeight: '50' }),
    order({ height: '5', mouthWidth: '100', gusset: '40', handleHeight: '3' }),
    order({ height: '', mouthWidth: '', gusset: '', handleHeight: '' }),
    order({ height: 'x', mouthWidth: '40', gusset: '60', handleHeight: '-1' }),
    order({ height: '30', mouthWidth: '40', gusset: '0', handleHeight: '15' }),
  ];
  for (const o of cases) {
    const g = geometry(o);
    assert.ok(g.cm.B > 0, 'bottom width must be positive in drawing');
    const sc = buildScene(o);
    for (const it of sc.items) {
      // 絶対座標のコマンド（大文字）だけを範囲チェックする
      const nums = it.t === 'path'
        ? [...it.d.matchAll(/([MLHVQ])([^A-Za-z]*)/g)].flatMap((m) => (m[2].match(/-?\d+(\.\d+)?/g) || []).map(Number))
        : [it.x, it.y];
      for (const v of nums) {
        assert.ok(Number.isFinite(v), `finite ${JSON.stringify(it)}`);
        assert.ok(v >= -2 && v <= Math.max(sc.width, sc.height) + 2, `in bounds ${v} ${JSON.stringify(it).slice(0, 120)}`);
      }
    }
    assert.ok(sceneToSvg(sc).startsWith('<svg'));
  }
});

test('図：未入力は「？」で示し、未定の色は塗らない', () => {
  const svg = sceneToSvg(buildScene(emptyOrder()));
  assert.match(svg, /？cm（未入力）/);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, /表地：未定/);
  assert.match(svg, /裏地：未定/);
  assert.match(svg, /clip-path/); // 未定はハッチングで示す
  assert.ok(!/fill="#FFFFFF"/i.test(svg), '白い塗りを指定色として使わない');
});

test('図：比較では同じ縮尺を使い、変更箇所に（変更）を付ける', () => {
  const s = sampleDoc();
  const sc = buildCompareScene(s.baseline, s.current);
  const svg = sceneToSvg(sc);
  assert.match(svg, /袋口幅 45cm（変更）/);
  assert.match(svg, /袋口幅 40cm</);
  assert.match(svg, /内ポケット：あり（変更）/);
  assert.deepEqual(sc.changes, ['mouthWidth', 'bottomWidth', 'pocket', 'questions']);
});

test('図：裏地・ポケットの未定／なし／ありが反映される', () => {
  const t = (lining, pocket, liningColor = '') => sceneToSvg(buildScene(order({}, { lining, pocket, liningColor })));
  assert.match(t('none', 'none'), /裏地：なし（表地の裏側）/);
  assert.match(t('none', 'none'), /内ポケット：なし/);
  assert.match(t('yes', 'yes', 'navy'), /裏地：あり〈ネイビー〉/);
  assert.match(t('yes', 'yes', 'navy'), /片面中央に1個・色と大きさは未指定/);
  assert.match(t('yes', 'undecided'), /裏地：あり〈色は未定〉/);
  assert.match(t('yes', 'undecided'), /内ポケット：未定/);
  assert.match(t('undecided', 'none'), /裏地：未定/);
});

test('図：狭い画面用の縦積みでも同じ縮尺・範囲内', () => {
  const s = sampleDoc();
  const sc = buildCompareScene(s.baseline, s.current, { narrow: true });
  assert.equal(sc.width, 420);
  assert.match(sceneToSvg(sc), /袋口幅 45cm（変更）/);
  const one = buildScene(order({ height: '80', mouthWidth: '5', gusset: '4.9', handleHeight: '50' }), { narrow: true });
  for (const it of one.items) if (it.t === 'text') assert.ok(it.x >= 0 && it.x <= 420 && it.y <= one.height);
});
