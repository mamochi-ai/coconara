// 商品データ（ここを書き換えるだけで、服と表示の調整ができる）
//
// 画像について
// - image は public/ からの相対パス。背景透過の PNG / WebP / SVG を想定。
// - hanger:
//     'shoulder' … 服だけの画像。肩用ハンガーをコードで描く（トップス・アウター）
//     'clip'     … 服だけの画像。クリップハンガーをコードで描く（パンツ・スカート）
//     'none'     … 画像にハンガーが写っている。コードではハンガーを描かない（二重にしない）
// - anchor: 画像の中で「ハンガーが掛かる点」の位置（0〜1。左上が 0,0）
//     shoulder / clip … ハンガーのバー（肩・ウエスト）の中央
//     none           … フックの頂点（レールに掛かる点）
// - aspect: 画像の 横 ÷ 縦。透過余白を含めた画像全体の比率
// - scale: 服の見かけの大きさ（1 = 標準。丈の長いコートは大きめ、余白の多い画像は大きめにする）
// - sway: 揺れやすさ（1 = 標準。重い服は小さく）

export type HangerType = 'shoulder' | 'clip' | 'none';

export interface Product {
  id: string;
  name: string;
  category: string;
  color: string;
  /** 色見本（表示用） */
  swatch: string;
  description: string;
  image: string;
  hanger: HangerType;
  anchor: { x: number; y: number };
  aspect: number;
  scale: number;
  sway: number;
}

const garment = (file: string) => `garments/${file}`;
const ASPECT = 400 / 600;

export const PRODUCTS: Product[] = [
  {
    id: 'oxford-shirt',
    name: 'オックスフォード ボタンダウンシャツ',
    category: 'シャツ',
    color: 'オフホワイト',
    swatch: '#EEF0F1',
    description: '目の詰んだオックスフォード地。洗うほど柔らかくなり、一枚でもジャケットの下にも。',
    image: garment('shirt.svg'),
    hanger: 'shoulder',
    anchor: { x: 0.5, y: 0.075 },
    aspect: ASPECT,
    scale: 1,
    sway: 1,
  },
  {
    id: 'cable-knit',
    name: 'ケーブル編み クルーネックニット',
    category: 'ニット',
    color: 'オートミール',
    swatch: '#D9CBB0',
    description: 'ふっくらとしたウール混の縄編み。少しゆとりのある身幅で、重ね着しやすい長さ。',
    image: garment('knit.svg'),
    hanger: 'shoulder',
    anchor: { x: 0.5, y: 0.08 },
    aspect: ASPECT,
    scale: 0.94,
    sway: 0.8,
  },
  {
    id: 'tailored-jacket',
    name: 'ウールフランネル テーラードジャケット',
    category: 'ジャケット',
    color: 'チャコール',
    swatch: '#43464B',
    description: '肩パッドを薄くした柔らかな仕立て。フランネルの起毛感で、季節の始まりから着られる一着。',
    image: garment('jacket.svg'),
    hanger: 'shoulder',
    anchor: { x: 0.5, y: 0.075 },
    aspect: ASPECT,
    scale: 1.04,
    sway: 0.6,
  },
  {
    id: 'wide-trousers',
    name: 'タック入りワイドトラウザー',
    category: 'パンツ',
    color: 'キャメル',
    swatch: '#B78A5B',
    description: '二本タックで腰回りにゆとり。落ち感のある生地が、歩くたびにきれいに揺れます。',
    image: garment('trousers.svg'),
    hanger: 'clip',
    anchor: { x: 0.5, y: 0.035 },
    aspect: ASPECT,
    scale: 1,
    sway: 0.9,
  },
  {
    // 写真素材（背景を取り除いた画像。木製ハンガーとフックが写っているため hanger: 'none'）
    id: 'camel-chester-coat',
    name: 'ウールメルトン チェスターコート',
    category: 'コート',
    color: 'キャメル',
    swatch: '#B58A63',
    description: '肩に沿うすっきりとしたシルエットに、ふくらみのあるウールメルトン。膝下まで届く丈で、ニットにもジャケットにも重ねられます。',
    image: garment('chester-coat.webp'),
    hanger: 'none',
    // フックの内側（レールが通る位置）。切り抜いた画像 810×1518 px の (391, 19) 付近
    anchor: { x: 0.4827, y: 0.0125 },
    aspect: 810 / 1518,
    scale: 1.24,
    sway: 0.5,
  },
  {
    id: 'mock-cardigan',
    name: 'ミドルゲージ Vネックカーディガン',
    category: 'ニット',
    color: 'モス',
    swatch: '#7C8256',
    description: '羽織りとしても前を留めても。くるみボタン風の釦と、締まりのあるリブ。',
    image: garment('cardigan.svg'),
    hanger: 'shoulder',
    anchor: { x: 0.5, y: 0.08 },
    aspect: ASPECT,
    scale: 0.96,
    sway: 0.85,
  },
  {
    id: 'trench-coat',
    name: 'コットンギャバジン トレンチコート',
    category: 'コート',
    color: 'サンドベージュ',
    swatch: '#C8B18A',
    description: '撥水性のある綿ギャバジン。ベルトを後ろで結べば、肩の力が抜けた雰囲気に。',
    image: garment('coat.svg'),
    hanger: 'shoulder',
    anchor: { x: 0.5, y: 0.065 },
    aspect: ASPECT,
    scale: 1.2,
    sway: 0.5,
  },
  {
    id: 'pleated-skirt',
    name: 'ナロープリーツ ミディスカート',
    category: 'スカート',
    color: 'ミッドナイトネイビー',
    swatch: '#323C57',
    description: '細かなプリーツが光を受けて表情を変えるミディ丈。ウエストは後ろゴムで楽に。',
    image: garment('skirt.svg'),
    hanger: 'clip',
    anchor: { x: 0.5, y: 0.035 },
    aspect: ASPECT,
    scale: 0.92,
    sway: 1.2,
  },
  {
    id: 'heavy-tee',
    name: 'ヘビーウェイト ポケットなしTシャツ',
    category: 'カットソー',
    color: 'テラコッタ',
    swatch: '#B26A4B',
    description: '肉厚な天竺で、一枚でも透けにくい。首まわりは詰まりすぎない丸首。',
    image: garment('tee.svg'),
    hanger: 'shoulder',
    anchor: { x: 0.5, y: 0.08 },
    aspect: ASPECT,
    scale: 0.92,
    sway: 1.1,
  },
];

export const COORD_LIMIT = 3;
