// 器具モデル（聴診器・駆血帯・穿刺針・テープ・回路コネクタ・穿刺セット・設定パネル ほか）
import * as THREE from 'three';
import { makeFillTexture } from './textures.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
function mesh(geo, m, pos, rot) {
  const o = new THREE.Mesh(geo, m);
  if (pos) o.position.set(...pos);
  if (rot) o.rotation.set(...rot);
  o.castShadow = true;
  return o;
}
const box = (w, h, d, m, pos, rot) => mesh(new THREE.BoxGeometry(w, h, d), m, pos, rot);
const cyl = (rt, rb, h, m, pos, rot, seg = 20) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m, pos, rot);
const tube = (points, r, m, seg = 40) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), seg, r, 10, false), m);

export const MAT = {
  steel: std(0xd9dde2, { metalness: 0.95, roughness: 0.22 }),
  steelDark: std(0x9aa1a8, { metalness: 0.9, roughness: 0.35 }),
  rubber: std(0x1b1c21, { roughness: 0.55 }),
  plasticClear: std(0xffffff, { transparent: true, opacity: 0.45, roughness: 0.15 }),
  black: std(0x24272c, { roughness: 0.6 }),
  white: std(0xf7f7f7, { roughness: 1 }),
  tape: std(0xf3eee2, { roughness: 0.95, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
};
// 血液で満たされていくチューブ用マテリアル（テクスチャの u 方向 = チューブの長さ方向）
export function fillMaterial() {
  const fill = makeFillTexture();
  const m = new THREE.MeshStandardMaterial({ map: fill.texture, transparent: true, roughness: 0.25 });
  m.userData.fill = fill;
  return m;
}

// ---------------------------------------------------------------- 聴診器（Littmann 型の二面チェストピース、ゴム管、Y 字、金属バイノーラル、イヤーチップ）
//  chest   : 原点 = チェストピース中心、膜面 -y、ステムは +z へ
//  binaural: 原点 = 左右イヤーチップの中点（装着時は頭に付く）、Y 字（ゴム管の接続点）は (0,-0.2,0.06)
//  tray    : トレイに置いた状態の静的モデル
const STETH = {
  chrome: std(0xd8dde3, { metalness: 0.95, roughness: 0.18 }),
  tubing: std(0x1f2a3a, { roughness: 0.5 }),
  rim: std(0x2a2d31, { roughness: 0.6 }),
  diaphragm: std(0xeaeaea, { roughness: 0.25, metalness: 0.1 }),
  earTip: std(0x4a4f57, { roughness: 0.5 }),
};
function makeChestPiece() {
  const g = new THREE.Group();
  g.add(cyl(0.0225, 0.0225, 0.004, STETH.chrome, [0, 0.0, 0], null, 40));                     // ダイアフラム側ヘッド
  g.add(cyl(0.0235, 0.0235, 0.0015, STETH.rim, [0, -0.0025, 0], null, 40));                   // ノンチルリム
  g.add(cyl(0.0205, 0.0205, 0.001, STETH.diaphragm, [0, -0.0032, 0], null, 40));              // 膜
  g.add(cyl(0.012, 0.016, 0.008, STETH.chrome, [0, 0.006, 0], null, 32));                     // ベル側（小径）
  g.add(cyl(0.013, 0.013, 0.002, STETH.rim, [0, 0.0105, 0], null, 32));
  g.add(cyl(0.004, 0.004, 0.012, STETH.chrome, [0, 0.004, 0.025], [Math.PI / 2, 0, 0], 16));  // ステム（回転部）
  g.add(cyl(0.0055, 0.0055, 0.008, STETH.chrome, [0, 0.004, 0.015], [Math.PI / 2, 0, 0], 16));
  g.add(cyl(0.0045, 0.0045, 0.012, STETH.tubing, [0, 0.004, 0.036], [Math.PI / 2, 0, 0], 12)); // ゴム管の始まり
  g.userData.stemEnd = new THREE.Vector3(0, 0.004, 0.042);
  return g;
}
function makeBinaural() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    // 耳管: Y 字から上へ立ち上がり、外側へ開いて前方へカーブし、イヤーチップで終わる
    g.add(tube([[s * 0.012, -0.2, 0.06], [s * 0.03, -0.14, 0.06], [s * 0.058, -0.07, 0.045], [s * 0.072, -0.02, 0.02], [s * 0.072, 0.0, 0.0]], 0.0028, STETH.chrome, 30));
    const tip = mesh(new THREE.SphereGeometry(0.0075, 16, 12), STETH.earTip, [s * 0.066, 0.0, -0.004]); tip.scale.set(1, 1, 1.2); g.add(tip);
    g.add(cyl(0.0032, 0.0032, 0.008, STETH.chrome, [s * 0.071, 0.0, -0.001], [0, 0, Math.PI / 2], 12));
  }
  g.add(box(0.058, 0.003, 0.005, STETH.steelDark ?? MAT.steelDark, [0, -0.1, 0.058]));         // 耳管バネ
  g.add(cyl(0.009, 0.007, 0.03, STETH.tubing, [0, -0.205, 0.06], [0, 0, 0], 16));             // Y 字分岐部
  g.add(cyl(0.0045, 0.0045, 0.03, STETH.tubing, [0, -0.23, 0.06], [0, 0, 0], 12));
  g.userData.yoke = new THREE.Vector3(0, -0.245, 0.06);
  return g;
}
export function makeStethoscopeSet() {
  const chest = makeChestPiece();
  const binaural = makeBinaural();
  const tubeMat = STETH.tubing;
  // トレイ上の静的モデル（30cm 四方に収まるよう、ゴム管を巻いてバイノーラルを横たえる）
  const tray = new THREE.Group();
  const c2 = makeChestPiece(); c2.position.set(0, 0.0035, 0); tray.add(c2);
  tray.add(tube([[0, 0.008, 0.042], [0.05, 0.006, 0.1], [0.13, 0.006, 0.07], [0.15, 0.006, -0.03], [0.09, 0.006, -0.1], [0.0, 0.006, -0.11], [-0.05, 0.006, -0.02], [-0.03, 0.01, 0.1]], 0.0045, tubeMat, 70));
  const b2 = makeBinaural(); b2.position.set(-0.07, 0.012, -0.13); b2.rotation.x = -Math.PI / 2; tray.add(b2);
  return { tray, chest, binaural, tubeMat };
}

// ---------------------------------------------------------------- 駆血帯（coiled: トレイ上 / applied: 上腕に装着。applied は実寸で生成）
export function makeTourniquet(T, armR = 0.05) {
  const bandM = new THREE.MeshStandardMaterial({ map: T.band, roughness: 0.85, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const coiled = new THREE.Group();
  coiled.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 32, 1, true), bandM, [0, 0.0125, 0]));
  coiled.add(mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.025, 32, 1, true), bandM, [0, 0.0125, 0]));
  coiled.add(mesh(new THREE.RingGeometry(0.024, 0.03, 32), bandM, [0, 0.025, 0], [-Math.PI / 2, 0, 0]));
  coiled.add(box(0.09, 0.0025, 0.025, bandM, [0.07, 0.00125, 0.03]));
  coiled.add(box(0.032, 0.012, 0.03, MAT.black, [0.115, 0.006, 0.03]));
  g.add(coiled);
  const r0 = armR + 0.002, r1 = r0 + 0.006;
  const applied = new THREE.Group();
  applied.add(mesh(new THREE.CylinderGeometry(r0, r0, 0.03, 40, 1, true), bandM));
  applied.add(mesh(new THREE.CylinderGeometry(r1, r1, 0.03, 40, 1, true), bandM));
  applied.add(mesh(new THREE.RingGeometry(r0, r1, 40), bandM, [0, 0.015, 0], [-Math.PI / 2, 0, 0]));
  applied.add(mesh(new THREE.RingGeometry(r0, r1, 40), bandM, [0, -0.015, 0], [Math.PI / 2, 0, 0]));
  applied.add(box(0.016, 0.04, 0.034, MAT.black, [r1 + 0.006, 0, 0]));
  applied.add(box(0.0025, 0.025, 0.07, bandM, [r1 + 0.001, 0, 0.055]));
  applied.visible = false;
  g.add(applied);
  g.userData = { coiled, applied };
  return g;
}
export function setTourniquetApplied(g) { g.userData.coiled.visible = false; g.userData.applied.visible = true; }
export function setTourniquetCoiled(g) { g.userData.coiled.visible = true; g.userData.applied.visible = false; }

// ---------------------------------------------------------------- 透析用穿刺針。原点 = ハブ中心、針先は -z
export function makeNeedle(color, type = 'metal') {
  const g = new THREE.Group();
  const plastic = std(color, { roughness: 0.35, transparent: true, opacity: 0.85 });
  const solid = std(color, { roughness: 0.4 });
  const flashMat = std(0xffffff, { transparent: true, opacity: 0.5, roughness: 0.15 });

  if (type === 'metal') {
    g.add(cyl(0.00085, 0.00085, 0.03, MAT.steel, [0, 0, -0.0225], [Math.PI / 2, 0, 0], 10));
    g.add(mesh(new THREE.ConeGeometry(0.00085, 0.003, 8), MAT.steel, [0, 0, -0.036], [-Math.PI / 2, 0, 0]));
    g.add(cyl(0.0032, 0.0038, 0.015, plastic, [0, 0, 0], [Math.PI / 2, 0, 0], 14));
    // 翼: ハブ下部の付け根で折り畳める（持つときは親指と人差し指で挟むため上に折る）
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(s * 0.003, -0.0025, 0.002);
      w.add(box(0.015, 0.001, 0.009, plastic, [s * 0.0075, 0, 0]));
      w.add(box(0.013, 0.0018, 0.0016, plastic, [s * 0.0075, 0.0004, -0.0035]));   // 補強リブ
      w.add(box(0.013, 0.0018, 0.0016, plastic, [s * 0.0075, 0.0004, 0.0035]));
      w.rotation.z = s * 0.12;
      g.add(w); wings.push(w);
    }
    const flash = cyl(0.0025, 0.0025, 0.02, flashMat, [0, 0, 0.0175], [Math.PI / 2, 0, 0], 12);
    g.add(flash);
    const tubeMat = fillMaterial();
    g.add(tube([[0, 0, 0.028], [0, -0.003, 0.06], [0.004, -0.008, 0.1], [0.002, -0.006, 0.14], [0, 0, 0.17]], 0.0018, tubeMat, 30));
    const clamp = new THREE.Group(); clamp.position.set(0.003, -0.007, 0.11);
    clamp.add(box(0.012, 0.004, 0.018, solid, [0, -0.004, 0]));
    const jaw = box(0.012, 0.004, 0.018, solid, [0, 0.004, 0]); clamp.add(jaw);
    g.add(clamp);
    g.add(cyl(0.0035, 0.004, 0.014, solid, [0, 0, 0.176], [Math.PI / 2, 0, 0], 12));
    g.userData = { flash, type, tipZ: -0.0375, lineEndZ: 0.183, stylet: null, clamp, jaw, clampOpen: false, fill: tubeMat.userData.fill, hasTube: true, tapeZ: 0.002, hubR: 0.0038, hubLift: 0.0045,
      wings, pinch: [0, 0.006, 0.002] };   // pinch: 持つときに親指と人差し指で挟む位置（折った翼の中ほど）
    return g;
  }

  const teflon = std(0xf4f4f0, { transparent: true, opacity: 0.8, roughness: 0.3 });
  g.add(cyl(0.0012, 0.0012, 0.028, teflon, [0, 0, -0.0215], [Math.PI / 2, 0, 0], 12));
  g.add(cyl(0.0032, 0.0042, 0.014, plastic, [0, 0, 0], [Math.PI / 2, 0, 0], 14));
  g.add(cyl(0.0042, 0.0042, 0.003, solid, [0, 0, 0.0065], [Math.PI / 2, 0, 0], 14));
  const stylet = new THREE.Group();
  stylet.add(cyl(0.0008, 0.0008, 0.044, MAT.steel, [0, 0, -0.016], [Math.PI / 2, 0, 0], 10));
  stylet.add(mesh(new THREE.ConeGeometry(0.0008, 0.0025, 8), MAT.steel, [0, 0, -0.0385], [-Math.PI / 2, 0, 0]));
  stylet.add(cyl(0.003, 0.0034, 0.012, solid, [0, 0, 0.014], [Math.PI / 2, 0, 0], 12));
  const flash = cyl(0.0028, 0.0028, 0.022, flashMat, [0, 0, 0.031], [Math.PI / 2, 0, 0], 12);
  stylet.add(flash);
  stylet.add(cyl(0.0036, 0.0036, 0.004, solid, [0, 0, 0.044], [Math.PI / 2, 0, 0], 12));
  g.add(stylet);
  g.userData = { flash, type, tipZ: -0.0398, cannulaTipZ: -0.0355, lineEndZ: 0.008, stylet, clamp: null, clampOpen: true, fill: null, hasTube: false, tapeZ: 0.0, hubR: 0.0042, hubLift: 0.0048,
    wings: null, pinch: [0, 0, 0.016] };   // pinch: 内筒（金属針）ハブの根元を親指と人差し指で挟む
  return g;
}
// 金属針の翼を折る（持つとき）/ 広げる（留置・トレイ）
export function setWingsFolded(needle, folded) {
  const w = needle.userData.wings;
  if (!w) return;
  w[0].rotation.z = folded ? -1.3 : -0.12;
  w[1].rotation.z = folded ? 1.3 : 0.12;
}
export function setClampOpen(needle, open) {
  const ud = needle.userData;
  if (!ud.clamp) return;
  ud.clampOpen = open;
  ud.jaw.rotation.x = open ? -1.1 : 0;
  ud.jaw.position.y = open ? 0.009 : 0.004;
}

// ---------------------------------------------------------------- 固定用テープ
export function makeTapeStrip() {
  const g = new THREE.Group();
  const flat = box(0.07, 0.0006, 0.016, MAT.tape);
  g.add(flat);
  g.userData.flat = flat;
  return g;
}
// 貼ったテープ: 皮膚面に沿わせた形状（geo は app 側で皮膚の曲面に合わせて生成）
export function setTapeApplied(tapeObj, geo) {
  tapeObj.userData.flat.visible = false;
  const m = new THREE.Mesh(geo, MAT.tape);
  m.castShadow = true; m.receiveShadow = true;
  tapeObj.add(m);
  tapeObj.userData.applied = m;
}
export function resetTape(tapeObj) {
  tapeObj.userData.flat.visible = true;
  if (tapeObj.userData.applied) { tapeObj.remove(tapeObj.userData.applied); tapeObj.userData.applied.geometry.dispose(); tapeObj.userData.applied = null; }
}

// ---------------------------------------------------------------- 血液回路のコネクタ（原点 = 針に差し込む先端, +z = チューブ側）
export function makeConnector(color) {
  const g = new THREE.Group();
  g.add(cyl(0.0035, 0.004, 0.012, std(color, { roughness: 0.4 }), [0, 0, 0.006], [Math.PI / 2, 0, 0], 12));
  g.add(cyl(0.0055, 0.0055, 0.01, std(0xffffff, { transparent: true, opacity: 0.6, roughness: 0.2 }), [0, 0, 0.014], [Math.PI / 2, 0, 0], 12));
  g.add(box(0.012, 0.005, 0.014, std(color, { roughness: 0.4 }), [0, 0, 0.03]));
  g.userData.tubeStartZ = 0.038;
  return g;
}

// ---------------------------------------------------------------- 設定パネル
export function makeSettingsPanel(T) {
  const g = new THREE.Group();
  g.add(box(0.3, 0.02, 0.16, std(0x2b3038, { roughness: 0.6 }), [0, 0.01, 0]));
  g.add(mesh(new THREE.PlaneGeometry(0.28, 0.03), new THREE.MeshBasicMaterial({ map: T.settingsTitle, transparent: true }), [0, 0.0205, -0.06], [-Math.PI / 2, 0, 0]));
  const buttons = [];
  const keys = [['vessel', 0x3a7bd5, 0x2b5fa8], ['needle', 0x2ea58a, 0x227d68], ['depth', 0xb06ad0, 0x7d4a96]];
  const KW = 0.09, GAP = 0.008;
  keys.forEach(([name, col, rim], i) => {
    // 押し込み可能なキー（b 自体が沈む。沈み込み量は app.js の物理ボタン処理が制御）
    const x = (i - (keys.length - 1) / 2) * (KW + GAP);
    const b = new THREE.Group(); b.position.set(x, 0.02, 0.015);
    b.add(box(KW, 0.012, 0.08, std(col, { roughness: 0.4 }), [0, 0.006, 0]));
    b.add(box(KW + 0.004, 0.004, 0.084, std(rim, { roughness: 0.5 }), [0, 0.002, 0]));   // 段差（側面の暗い縁）
    b.add(mesh(new THREE.PlaneGeometry(KW - 0.004, 0.075), new THREE.MeshBasicMaterial({ map: T.labels[name].texture, transparent: true }), [0, 0.0125, 0], [-Math.PI / 2, 0, 0]));
    g.add(b);
    // キー穴（沈んだときに見える暗い縁）
    g.add(box(KW + 0.008, 0.003, 0.088, std(0x15181d, { roughness: 0.8 }), [x, 0.0205, 0.015]));
    buttons.push({ name, obj: b, cap: b, topOffset: [0, 0.0125, 0], travel: 0.007, hitR: 0.04 });
  });
  return { group: g, buttons };
}

// ---------------------------------------------------------------- 穿刺セット ほか
export function makeSetBox(T) {
  const g = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ map: T.paper, roughness: 0.9 });
  const inner = std(0xdfe8f2, { roughness: 0.6 });
  g.add(box(0.26, 0.004, 0.18, inner, [0, 0.002, 0]));
  g.add(box(0.26, 0.055, 0.004, paper, [0, 0.0295, -0.088]));
  g.add(box(0.26, 0.055, 0.004, paper, [0, 0.0295, 0.088]));
  g.add(box(0.004, 0.055, 0.18, paper, [-0.128, 0.0295, 0]));
  g.add(box(0.004, 0.055, 0.18, paper, [0.128, 0.0295, 0]));
  const lid = new THREE.Group(); lid.position.set(0, 0.058, -0.09);
  lid.add(box(0.266, 0.005, 0.186, new THREE.MeshStandardMaterial({ map: T.setLabel, roughness: 0.9 }), [0, 0, 0.093]));
  lid.add(box(0.266, 0.012, 0.004, paper, [0, -0.006, 0.186]));
  lid.add(box(0.004, 0.012, 0.186, paper, [-0.131, -0.006, 0.093]));
  lid.add(box(0.004, 0.012, 0.186, paper, [0.131, -0.006, 0.093]));
  g.add(lid);
  g.userData.lid = lid;
  return g;
}
export function makeFoldedDrape(T) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ map: T.drape, roughness: 0.95 });
  g.add(box(0.11, 0.008, 0.1, m, [0, 0.004, 0]));
  g.add(box(0.1, 0.008, 0.09, m, [0.004, 0.012, -0.003]));
  g.add(box(0.1, 0.006, 0.05, m, [-0.002, 0.019, 0.01]));
  return g;
}
// 個包装のアルコール綿パウチ。原点 = パウチ中心（天面は +y）、長辺 = x、開封口 = +x 端。
// tear() で開封口の帯が千切れて中の綿が顔を出し、takePad() で綿を取り出す（綿本体は別の器具 makeSwab）
export function makeAlcoholPouch(T) {
  const g = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ map: T.pouch, metalness: 0.45, roughness: 0.35 });
  const foilPlain = std(0xdde1e6, { metalness: 0.5, roughness: 0.35 });
  const body = box(0.052, 0.0045, 0.045, foil, [-0.004, 0.00225, 0]); g.add(body);
  const flap = box(0.014, 0.0035, 0.045, foilPlain, [0.029, 0.00175, 0]); g.add(flap);                       // 開封口の帯（千切れる）
  const tornEdge = mesh(new THREE.PlaneGeometry(0.004, 0.045, 1, 12), foilPlain, [0.023, 0.0025, 0], [0, Math.PI / 2, 0]);
  { const p = tornEdge.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + (Math.random() - 0.5) * 0.003); }   // ギザギザ
  tornEdge.material = new THREE.MeshStandardMaterial({ color: 0xdde1e6, metalness: 0.5, roughness: 0.35, side: THREE.DoubleSide });
  tornEdge.visible = false; g.add(tornEdge);
  const padM = std(0xffffff, { roughness: 1 });
  const pad = box(0.03, 0.003, 0.03, padM, [0.026, 0.0035, 0]); pad.visible = false; g.add(pad);              // 顔を出した綿
  g.userData = { flap, tornEdge, pad, torn: false, taken: false };
  return g;
}
export function setPouchTorn(g, torn) {
  const u = g.userData; u.torn = torn; u.flap.visible = !torn; u.tornEdge.visible = torn; u.pad.visible = torn && !u.taken;
}
export function setPouchTaken(g, taken) { g.userData.taken = taken; g.userData.pad.visible = g.userData.torn && !taken; }
// 小型のアルコール綿（折り畳んだ不織布）。原点 = 綿の中心、消毒は綿の位置で判定
export function makeSwab() {
  const g = new THREE.Group();
  const m = std(0xffffff, { roughness: 1 });
  g.add(box(0.03, 0.003, 0.03, m, [0, 0.0015, 0]));
  g.add(box(0.028, 0.003, 0.026, m, [0.001, 0.0045, 0.002], [0, 0.08, 0]));
  return g;
}
// 手袋の箱（天面に取り出し口）。原点 = 箱の底中心。slot = 次の手袋が顔を出す位置
export function makeGloveBox(T) {
  const g = new THREE.Group();
  const card = new THREE.MeshStandardMaterial({ map: T.gloveLabel, roughness: 0.85 });
  const cardPlain = std(0xf4f6f8, { roughness: 0.85 });
  g.add(box(0.12, 0.09, 0.24, cardPlain, [0, 0.045, 0]));
  for (const s of [-1, 1]) g.add(mesh(new THREE.PlaneGeometry(0.236, 0.086), card, [s * 0.0602, 0.045, 0], [0, s * Math.PI / 2, 0]));   // 長辺のラベル
  g.add(mesh(new THREE.PlaneGeometry(0.116, 0.086), card, [0, 0.045, 0.1202], [0, 0, 0]));
  const hole = mesh(new THREE.CircleGeometry(0.03, 24), std(0x15181d, { roughness: 1 }), [0, 0.0905, -0.02], [-Math.PI / 2, 0, 0]); hole.scale.set(1, 1.6, 1); g.add(hole);
  g.userData.slot = new THREE.Vector3(0, 0.06, -0.02);
  return g;
}
// 1 枚の手袋（箱から引き出した状態: 手首側を持つので指先が垂れ下がる）。原点 = 手首口の中心、指先は -y
// 箱から引き出した手袋 = くしゃくしゃに丸まった塊（手袋と同じ材質）。原点 = 塊の中心。反対の手に近づけると装着される
export function makeGlove(mat) {
  const g = new THREE.Group();
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lump = (r, sx, sy, sz, pos, amp) => {
    const geo = new THREE.IcosahedronGeometry(r, 3), p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {   // 表面を不規則に凹ませて布のしわに
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 180 + 1) * Math.cos(v.y * 150 + 2) * Math.sin(v.z * 170 + 3);
      v.multiplyScalar(1 + amp * n + 0.06 * (rnd() - 0.5)); p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; return m;
  };
  g.add(lump(0.028, 1.25, 0.7, 1.0, [0, 0, 0], 0.16));
  g.add(lump(0.02, 1.1, 0.7, 0.9, [0.022, 0.008, 0.012], 0.18));
  g.add(lump(0.017, 1.0, 0.75, 1.2, [-0.02, 0.006, -0.01], 0.18));
  g.add(lump(0.012, 1.3, 0.6, 1.0, [0.004, 0.016, -0.014], 0.2));
  return g;
}
export function makeGauze() {
  const g = new THREE.Group();
  const m = std(0xffffff, { roughness: 1 });
  for (let i = 0; i < 4; i++) g.add(box(0.075, 0.004, 0.075, m, [i * 0.001, 0.002 + i * 0.004, -i * 0.001], [0, i * 0.05, 0]));
  return g;
}
export function makeTapeRoll() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(0.02, 0.009, 10, 32), std(0xf3f0e6, { roughness: 0.9 }), [0, 0.009, 0], [Math.PI / 2, 0, 0]));
  return g;
}
export function makeKidneyBasin() {
  const g = new THREE.Group();
  const basin = mesh(new THREE.SphereGeometry(0.12, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.95, roughness: 0.25, side: THREE.DoubleSide }), [0, 0.035, 0]);
  basin.scale.set(1, 0.3, 0.6);
  g.add(basin);
  return g;
}
export function makeSharpsBox() {
  const g = new THREE.Group();
  g.add(box(0.12, 0.14, 0.09, std(0xf2c534, { roughness: 0.5 }), [0, 0.07, 0]));
  g.add(box(0.125, 0.02, 0.095, std(0xd9303a, { roughness: 0.5 }), [0, 0.15, 0]));
  g.add(box(0.05, 0.004, 0.03, MAT.black, [0, 0.161, 0]));
  g.add(box(0.08, 0.05, 0.002, MAT.white, [0, 0.08, 0.046]));
  return g;
}
export function makeResetButton(T, label = T.resetLabel) {
  const g = new THREE.Group();
  g.add(box(0.08, 0.02, 0.08, std(0x2b3038, { roughness: 0.6 }), [0, 0.01, 0]));
  g.add(mesh(new THREE.PlaneGeometry(0.06, 0.03), new THREE.MeshBasicMaterial({ map: label }), [0, 0.0205, 0.023], [-Math.PI / 2, 0, 0]));
  g.add(cyl(0.026, 0.026, 0.006, std(0x8a9199, { metalness: 0.8, roughness: 0.35 }), [0, 0.023, -0.012]));   // 金属リング（押しボタンの座）
  g.add(cyl(0.021, 0.021, 0.002, std(0x15181d), [0, 0.0265, -0.012]));                                       // ボタン穴
  // 押し込みキャップ（物理ボタン: 指で押すと沈む）
  const cap = new THREE.Group(); cap.position.set(0, 0.027, -0.012);
  cap.add(cyl(0.02, 0.021, 0.014, std(0xd9303a, { roughness: 0.4, emissive: 0x3a0000 }), [0, 0, 0]));
  cap.add(cyl(0.016, 0.02, 0.003, std(0xe8474f, { roughness: 0.35, emissive: 0x3a0000 }), [0, 0.0085, 0]));   // 上面の丸み
  g.add(cap);
  g.userData.cap = cap; g.userData.topOffset = [0, 0.01, 0]; g.userData.travel = 0.007; g.userData.hitR = 0.03;
  return g;
}
// 操作説明パネルの OK ボタン（大きな緑の押しボタン。面は +z 側、押し込み方向は -z。指先でも掌でも押せる）
export function makeOkButton(T) {
  const g = new THREE.Group();
  g.add(box(0.26, 0.15, 0.02, std(0x2b3038, { roughness: 0.6 }), [0, 0, 0]));
  g.add(cyl(0.062, 0.062, 0.008, std(0x8a9199, { metalness: 0.8, roughness: 0.35 }), [0, 0, 0.013], [Math.PI / 2, 0, 0], 32));
  const cap = new THREE.Group(); cap.position.set(0, 0, 0.016);
  cap.add(cyl(0.052, 0.054, 0.024, std(0x2ea58a, { roughness: 0.4, emissive: 0x0b3a2e }), [0, 0, 0.012], [Math.PI / 2, 0, 0], 32));
  cap.add(mesh(new THREE.PlaneGeometry(0.085, 0.085), new THREE.MeshBasicMaterial({ map: T.okLabel, transparent: true }), [0, 0, 0.0245]));
  g.add(cap);
  g.userData = { cap, topOffset: [0, 0, 0.024], travel: 0.012, hitR: 0.065, axis: [0, 0, -1] };
  return g;
}
export function makeSanitizer() {
  const g = new THREE.Group();
  g.add(cyl(0.028, 0.03, 0.14, std(0xf2f5f7, { roughness: 0.6, transparent: true, opacity: 0.9 }), [0, 0.07, 0]));
  g.add(cyl(0.012, 0.012, 0.04, std(0x3a7bd5, { roughness: 0.5 }), [0, 0.16, 0]));
  // ポンプヘッド（押すと沈む）
  const cap = new THREE.Group(); cap.position.set(0, 0.18, 0);
  cap.add(box(0.05, 0.012, 0.025, std(0x3a7bd5, { roughness: 0.5 }), [0.02, 0, 0]));
  cap.add(cyl(0.004, 0.004, 0.012, std(0x3a7bd5), [0.042, -0.006, 0]));   // ノズル
  g.add(cap);
  g.userData.cap = cap; g.userData.topOffset = [0.02, 0.006, 0]; g.userData.travel = 0.012; g.userData.hitR = 0.035;
  return g;
}
