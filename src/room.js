// 透析室（床・壁・天井・窓・カーテン・透析装置・ベッド・器具カート・備品・血液回路）
import * as THREE from 'three';
import * as C from './constants.js';
import { MAT, makeKidneyBasin, makeSharpsBox, makeTapeRoll, makeSanitizer, fillMaterial } from './tools.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
function box(w, h, d, m, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true;
  return o;
}
function cyl(rt, rb, h, m, x, y, z, seg = 24) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
  return o;
}
// 角丸ボックス: 分割した BoxGeometry の頂点を「内側ボックスから距離 r」の面へ投影し、法線は解析的に与える
function roundedBoxGeo(w, h, d, r, seg = 10) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position, nrm = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = Math.max(0.0001, w / 2 - r), hy = Math.max(0.0001, h / 2 - r), hz = Math.max(0.0001, d / 2 - r);
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    c.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    v.sub(c);
    if (v.lengthSq() < 1e-12) v.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    v.normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
function rbox(w, h, d, r, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(roundedBoxGeo(w, h, d, r), m);
  o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
  return o;
}

// 透析装置の位置（ベッドの頭側の真横、ユーザー側）。前面は +x（足側・ユーザー側）を向く
const MACHINE_POS = new THREE.Vector3(-1.0, 0, -0.17);

export function buildRoom(scene, T) {
  const steel = new THREE.MeshStandardMaterial({ map: T.stainless, metalness: 0.9, roughness: 0.3 });
  const chrome = std(0xcfd4d9, { metalness: 0.95, roughness: 0.2 });
  const frameM = std(0x8c95a0, { metalness: 0.6, roughness: 0.45 });

  // ---------- 部屋
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: T.linoleum, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: T.ceiling, roughness: 0.9 }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 2.7; scene.add(ceiling);
  const wallM = new THREE.MeshStandardMaterial({ map: T.wall, roughness: 0.9 });
  scene.add(box(8, 2.7, 0.05, wallM, 0, 1.35, -3, false));
  scene.add(box(0.05, 2.7, 8, wallM, -4, 1.35, 0, false));
  scene.add(box(0.05, 2.7, 8, wallM, 4, 1.35, 0, false));
  scene.add(box(8, 2.7, 0.05, wallM, 0, 1.35, 3, false));
  const wainscot = std(0xbfd3cf, { roughness: 0.6 });
  scene.add(box(8, 0.9, 0.02, wainscot, 0, 0.45, -2.97, false));
  scene.add(box(0.02, 0.9, 8, wainscot, -3.97, 0.45, 0, false));
  scene.add(box(0.02, 0.9, 8, wainscot, 3.97, 0.45, 0, false));
  scene.add(box(8, 0.08, 0.03, std(0x8d9aa3), 0, 0.04, -2.96, false));
  const lightM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 });
  for (const [x, z] of [[-1, -1], [1.5, -1], [-1, 1.5], [1.5, 1.5]]) scene.add(box(1.2, 0.03, 0.3, lightM, x, 2.68, z, false));
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), new THREE.MeshStandardMaterial({ map: T.window, emissive: 0xffffff, emissiveMap: T.window, emissiveIntensity: 0.55, roughness: 0.4 }));
  win.position.set(1.3, 1.7, -2.96); scene.add(win);
  scene.add(box(2.1, 0.06, 0.08, std(0xf5f5f5), 1.3, 1.05, -2.94));
  scene.add(box(2.1, 0.05, 0.05, std(0xf5f5f5), 1.3, 2.35, -2.95));
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshStandardMaterial({ map: T.clock, roughness: 0.4 }));
  clock.position.set(-1.6, 2.1, -2.96); scene.add(clock);
  scene.add(cyl(0.012, 0.012, 2.6, chrome, 0.4, 2.45, -1.75).rotateZ(Math.PI / 2));
  scene.add(buildCurtain(T, 0.55, 1.65, -1.75));

  // ---------- 透析装置（日機装 DCS-200Si 風: スリムな白い本体・上部の大型カラー液晶・前面コンソール・点滴ポール）
  const machine = buildMachine(T, steel, chrome);
  scene.add(machine.group);

  // ---------- ベッド
  const mattressM = new THREE.MeshStandardMaterial({ map: T.sheet, roughness: 0.95 });
  const bed = new THREE.Group(); bed.position.set(0, 0, -0.95);
  bed.add(box(2.1, 0.12, 1.0, mattressM, 0, C.BED_TOP - 0.06, 0));
  bed.add(box(2.14, 0.06, 1.04, std(0x8ea0b0, { roughness: 0.6 }), 0, C.BED_TOP - 0.15, 0));
  bed.add(box(1.9, 0.05, 0.08, frameM, 0, C.BED_TOP - 0.35, 0.4));
  bed.add(box(1.9, 0.05, 0.08, frameM, 0, C.BED_TOP - 0.35, -0.4));
  bed.add(box(0.5, 0.3, 0.6, std(0x7d8893, { metalness: 0.4, roughness: 0.5 }), 0, 0.3, 0));
  bed.add(box(1.4, 0.08, 0.7, std(0x7d8893, { metalness: 0.4, roughness: 0.5 }), 0, 0.1, 0));
  for (const [x, z] of [[-0.85, 0.42], [0.85, 0.42], [-0.85, -0.42], [0.85, -0.42]]) {
    const wheel = cyl(0.06, 0.06, 0.04, std(0x2a2d31), x, 0.06, z); wheel.rotation.x = Math.PI / 2; bed.add(wheel);
  }
  bed.add(box(0.06, 0.55, 1.0, new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.6 }), -1.08, C.BED_TOP + 0.12, 0));
  bed.add(box(0.06, 0.35, 1.0, new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.6 }), 1.08, C.BED_TOP + 0.02, 0));
  for (const y of [C.BED_TOP + 0.12, C.BED_TOP + 0.3]) { const r = cyl(0.012, 0.012, 1.4, chrome, 0.05, y, -0.52); r.rotation.z = Math.PI / 2; bed.add(r); }
  for (const x of [-0.6, 0.05, 0.7]) bed.add(cyl(0.012, 0.012, 0.25, chrome, x, C.BED_TOP + 0.21, -0.52));
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.34, 8, 2, 8), new THREE.MeshStandardMaterial({ map: T.pillow, roughness: 0.95 }));
  softenBox(pillow.geometry, 0.03);
  pillow.position.set(-0.72, C.BED_TOP + 0.05, 0.05); pillow.castShadow = true; pillow.receiveShadow = true; bed.add(pillow);
  scene.add(bed);

  // ---------- 器具カート
  const cart = new THREE.Group(); cart.position.set(C.TRAY.x, 0, C.TRAY.z); cart.rotation.y = C.TRAY.yaw;
  const CW = C.TRAY_W, CD = C.TRAY_D;
  cart.add(box(CW, 0.02, CD, steel, 0, C.TRAY.y - 0.01, 0));
  cart.add(box(CW + 0.02, 0.025, 0.02, steel, 0, C.TRAY.y + 0.005, CD / 2));
  cart.add(box(CW + 0.02, 0.025, 0.02, steel, 0, C.TRAY.y + 0.005, -CD / 2));
  cart.add(box(0.02, 0.025, CD, steel, CW / 2, C.TRAY.y + 0.005, 0));
  cart.add(box(0.02, 0.025, CD, steel, -CW / 2, C.TRAY.y + 0.005, 0));
  cart.add(box(CW - 0.02, 0.015, CD - 0.02, steel, 0, 0.45, 0));
  for (const [x, z] of [[-CW / 2 + 0.02, -0.23], [CW / 2 - 0.02, -0.23], [-CW / 2 + 0.02, 0.23], [CW / 2 - 0.02, 0.23]]) {
    cart.add(cyl(0.012, 0.012, C.TRAY.y - 0.06, chrome, x, (C.TRAY.y - 0.06) / 2 + 0.05, z));
    const wheel = cyl(0.035, 0.035, 0.025, std(0x2a2d31), x, 0.035, z); wheel.rotation.x = Math.PI / 2; cart.add(wheel);
  }
  const handle = cyl(0.01, 0.01, CD, chrome, CW / 2 + 0.05, C.TRAY.y + 0.06, 0); handle.rotation.x = Math.PI / 2; cart.add(handle);
  scene.add(cart);
  const basin = makeKidneyBasin(); basin.position.set(-0.15, 0.46, 0.1); cart.add(basin);     // 下段（カートローカル座標）
  const sharps = makeSharpsBox(); sharps.position.set(0.2, 0.46, 0.08); cart.add(sharps);
  const tape = makeTapeRoll(); tape.position.set(-0.2, 0.46, -0.1); cart.add(tape);
  // 手指消毒薬（カート手前側の端。ノズルは穿刺者側を向く）
  const sani = makeSanitizer(); sani.position.fromArray(C.trayPos(0.45, 0, 0.12)); sani.rotation.y = Math.PI; scene.add(sani);
  scene.add(cyl(0.16, 0.14, 0.4, std(0xdfe3e6, { roughness: 0.6 }), 1.5, 0.2, -0.2));
  const stool = new THREE.Group(); stool.position.set(1.7, 0, -1.2);
  stool.add(cyl(0.18, 0.18, 0.05, std(0x3b4f6b, { roughness: 0.6 }), 0, 0.5, 0));
  stool.add(cyl(0.02, 0.02, 0.45, chrome, 0, 0.25, 0));
  for (let i = 0; i < 5; i++) { const lg = new THREE.Group(); lg.rotation.y = i / 5 * Math.PI * 2; lg.add(box(0.26, 0.025, 0.035, chrome, 0.13, 0.03, 0)); stool.add(lg); }
  scene.add(stool);

  // ---------- 奥の透析ステーション × 2（ベッド + 装置、患者なし）とプライバシーカーテン
  for (const sx of [-2.6, 2.6]) {
    const st = new THREE.Group(); st.position.set(sx, 0, -1.45);
    const b2 = bed.clone(); b2.position.set(0, 0, -0.95); st.add(b2);
    const m2 = buildMachine(T, steel, chrome).group; m2.position.set(-1.0, 0, -0.17); st.add(m2);
    const blanket2 = box(1.5, 0.12, 0.7, new THREE.MeshStandardMaterial({ map: T.blanket, roughness: 0.95 }), 0.2, C.BED_TOP + 0.05, -0.95); st.add(blanket2);
    const pil2 = box(0.4, 0.09, 0.32, new THREE.MeshStandardMaterial({ map: T.pillow, roughness: 0.95 }), -0.75, C.BED_TOP + 0.045, -0.95); st.add(pil2);
    scene.add(st);
    scene.add(cyl(0.012, 0.012, 2.4, chrome, sx + 0.4, 2.45, -2.3).rotateZ(Math.PI / 2));
    scene.add(buildCurtain(T, sx - 0.6, 1.65, -2.3));
  }
  // 手洗いシンク（壁際）と壁の手すり
  const sink = new THREE.Group(); sink.position.set(-2.4, 0, 2.6);
  sink.add(box(0.6, 0.85, 0.5, std(0xe9edf0, { roughness: 0.6 }), 0, 0.425, 0));
  sink.add(box(0.62, 0.04, 0.52, steel, 0, 0.87, 0));
  const basin2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ map: T.stainless, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
  basin2.scale.set(1, 0.5, 0.8); basin2.position.set(0, 0.89, 0); sink.add(basin2);
  sink.add(cyl(0.012, 0.012, 0.22, chrome, 0, 0.98, -0.18));
  sink.add(cyl(0.01, 0.01, 0.2, chrome, 0, 1.09, -0.08).rotateX(Math.PI / 2));
  sink.add(box(0.15, 0.2, 0.08, std(0xffffff, { roughness: 0.5 }), 0.4, 1.15, -0.2));   // 手指消毒ディスペンサー
  scene.add(sink);
  scene.add(box(7.8, 0.05, 0.04, std(0xd8c8a8, { roughness: 0.6 }), 0, 0.95, -2.95));

  // ---------- 血液回路
  const lines = buildBloodLines(scene, machine);

  let pumpRunning = false;
  return {
    lines, pumpButton: machine.pumpButton, sanitizer: sani,
    setPumpRunning(on) { pumpRunning = on; T.dcsScreen.draw(on); },
    // 装置内の回路の充填: stage = 'mA'（ピロー → ポンプ → ダイアライザー入口）, 'dialyzer'（下から上へ）, 'mV1'（出口 → チャンバー）, 'chamber'（液面）, 'mV2'（チャンバー → 気泡検出器 → 出口）
    setMachineFill(stage, p) { machine.setFill(stage, p); },
    resetMachineFill() { for (const s of ['mA', 'dialyzer', 'mV1', 'chamber', 'mV2']) machine.setFill(s, 0); },
    update(dt) { if (pumpRunning) for (const r of machine.rotors) r.rotation.y += dt * 4; },
  };
}

function softenBox(geo, amount) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const l = v.length();
    v.multiplyScalar(1 - amount / Math.max(l, 0.001) * 0.6 * (Math.abs(v.x) > 0.19 || Math.abs(v.z) > 0.15 ? 1 : 0));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

function buildCurtain(T, x0, y0, z) {
  const W = 1.3, H = 2.2, NX = 60, NY = 2;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const x = x0 + W * i / NX, y = y0 - H / 2 + H * j / NY;
    pos.push(x, y, z + 0.04 * Math.sin(i / NX * Math.PI * 14) * (0.6 + 0.4 * j / NY)); uv.push(i / NX * 4, j / NY);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.curtain, roughness: 0.95, side: THREE.DoubleSide }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// 日機装 DCS-200Si を参考にした透析用監視装置（外形 W330×D465×H1345mm、ポール込み H1850mm）
// 参考写真の特徴: 紺色の台座、白いスリムな本体、中段前縁の紺色デカール帯（DCS-200Si ロゴ）、前方へ傾いた白いコンソール
// （紫がかった透明カバーの血液ポンプ・補液ポンプ、シリンジポンプ、チャンバーホルダー、気泡検出器）、紺ベゼルの 15 インチ
// タッチパネル（下縁に操作ボタン列）、左前の点滴ポール。血液ポンプの運転は画面の「運転」キーで行う
// ローカル座標: 前面 = +z（世界では +x を向くよう回転）、幅 = x
function buildMachine(T, steel, chrome) {
  const g = new THREE.Group(); g.position.copy(MACHINE_POS); g.rotation.y = Math.PI / 2;
  const white = std(0xf4f5f7, { roughness: 0.32 });
  const whiteSoft = std(0xe8ebee, { roughness: 0.5 });
  const navy = std(0x1f2c52, { roughness: 0.5 });
  const grayL = std(0xd3d8de, { roughness: 0.5 });
  const dark = std(0x24272c, { roughness: 0.5 });
  const cover = std(0x9b8fe0, { transparent: true, opacity: 0.42, roughness: 0.12 });   // 紫がかった透明カバー
  const clear = std(0xffffff, { transparent: true, opacity: 0.4, roughness: 0.12 });
  const metal = std(0xc9cfd6, { metalness: 0.85, roughness: 0.3 });
  const blue = std(0x3a7bd5, { roughness: 0.4 });

  // 台座（紺、H 形）とキャスター
  g.add(rbox(0.5, 0.06, 0.6, 0.02, navy, 0, 0.055, 0));
  g.add(rbox(0.3, 0.06, 0.62, 0.02, navy, 0, 0.055, 0));
  for (const [x, z] of [[-0.21, -0.26], [0.21, -0.26], [-0.21, 0.26], [0.21, 0.26]]) {
    const w = cyl(0.035, 0.035, 0.03, std(0x3a3f47), x, 0.035, z); w.rotation.x = Math.PI / 2; g.add(w);
    g.add(box(0.03, 0.04, 0.045, std(0x8a9199), x, 0.055, z));
  }
  // 本体（白いスリムなタワー）。前面下部はスライド式パネル（薄いグレーの縁と目地）、側面に縦溝
  g.add(rbox(0.33, 0.8, 0.46, 0.035, white, 0, 0.485, 0));
  g.add(box(0.29, 0.62, 0.006, whiteSoft, 0, 0.44, 0.229));
  g.add(box(0.006, 0.6, 0.006, grayL, 0, 0.44, 0.233));
  g.add(box(0.29, 0.006, 0.006, grayL, 0, 0.76, 0.233));
  for (const s of [-1, 1]) g.add(box(0.004, 0.55, 0.3, grayL, s * 0.166, 0.45, -0.03));
  // 透析液カプラ・濃厚液ポート（下部前面）と白いホースのループ
  for (const [x, c] of [[-0.09, 0x2f7fd0], [-0.04, 0xd9303a]]) g.add(cyl(0.011, 0.011, 0.03, std(c), x, 0.8, 0.24, 12).rotateX(Math.PI / 2));
  for (const [x, zz] of [[-0.09, 0.26], [-0.04, 0.27]]) {
    const pts = [[x, 0.8, zz], [x - 0.02, 0.6, zz + 0.05], [x - 0.03, 0.35, zz + 0.03], [x + 0.01, 0.25, zz - 0.02], [x + 0.06, 0.3, zz - 0.04], [x + 0.07, 0.6, zz - 0.03], [x + 0.05, 0.78, zz - 0.02]].map(p => new THREE.Vector3(...p));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.006, 8), std(0xf2f2ee, { roughness: 0.5 })));
  }
  // 中段の棚（前へ張り出す）。前縁に紺色のデカール帯と DCS-200Si ロゴ
  g.add(rbox(0.36, 0.075, 0.5, 0.025, white, 0, 0.905, 0.02));
  const band = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.044), new THREE.MeshStandardMaterial({ map: T.dcsBand, roughness: 0.4 }));
  band.position.set(0, 0.905, 0.2705); g.add(band);
  // 棚の上の透析液カプラ（赤・青のハンドル、ホルダーに掛けた状態）
  const coupler = new THREE.Group(); coupler.position.set(-0.1, 0.96, 0.2);
  coupler.add(box(0.07, 0.03, 0.04, grayL, 0, 0, 0));
  coupler.add(cyl(0.012, 0.012, 0.05, std(0x2f7fd0, { roughness: 0.4 }), -0.018, 0.035, 0, 12));
  coupler.add(cyl(0.012, 0.012, 0.05, std(0xd9303a, { roughness: 0.4 }), 0.018, 0.035, 0, 12));
  g.add(coupler);

  // コンソール（前方へ約 40° 傾いた白いデッキ）。デッキローカル: +y = デッキ法線、+z = 手前（下）側
  const deck = new THREE.Group(); deck.position.set(0, 1.07, 0.03); deck.rotation.x = 0.72;
  deck.add(rbox(0.34, 0.1, 0.44, 0.035, white, 0, 0, 0));
  const top = 0.05;
  // 血液ポンプ（右下、大）: 金属ローラー・ローター、紫がかった透明ドームカバー、ラッチ
  const bpX = 0.075, bpZ = 0.1;
  deck.add(cyl(0.072, 0.075, 0.016, grayL, bpX, top + 0.008, bpZ, 40));
  deck.add(cyl(0.06, 0.06, 0.02, dark, bpX, top + 0.02, bpZ, 40));
  const rotor = new THREE.Group(); rotor.position.set(bpX, top + 0.034, bpZ);
  rotor.add(cyl(0.02, 0.02, 0.018, metal, 0, 0, 0, 24));
  for (const a of [0, Math.PI / 2]) { const bar = box(0.1, 0.014, 0.012, std(0x9aa1a8, { metalness: 0.8, roughness: 0.3 })); bar.rotation.y = a; rotor.add(bar); }
  for (const a of [Math.PI / 4, -Math.PI / 4, Math.PI * 3 / 4, -Math.PI * 3 / 4]) rotor.add(cyl(0.013, 0.013, 0.02, metal, Math.cos(a) * 0.045, 0, Math.sin(a) * 0.045, 12));
  deck.add(rotor);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.078, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), cover); dome.scale.set(1, 0.5, 1); dome.position.set(bpX, top + 0.014, bpZ); deck.add(dome);
  deck.add(box(0.04, 0.012, 0.016, blue, bpX, top + 0.014, bpZ + 0.085));
  deck.add(cyl(0.004, 0.004, 0.03, clear, bpX + 0.075, top + 0.03, bpZ, 8).rotateZ(Math.PI / 2));
  // 補液ポンプ（右上、小）
  const spX = 0.07, spZ = -0.135;
  deck.add(cyl(0.05, 0.052, 0.014, grayL, spX, top + 0.007, spZ, 32));
  deck.add(cyl(0.04, 0.04, 0.016, dark, spX, top + 0.016, spZ, 32));
  const rotor2 = new THREE.Group(); rotor2.position.set(spX, top + 0.028, spZ);
  rotor2.add(cyl(0.012, 0.012, 0.014, metal, 0, 0, 0, 16));
  for (const a of [0, Math.PI / 2]) { const bar = box(0.06, 0.01, 0.009, std(0x9aa1a8, { metalness: 0.8, roughness: 0.3 })); bar.rotation.y = a; rotor2.add(bar); }
  deck.add(rotor2);
  const dome2 = new THREE.Mesh(new THREE.SphereGeometry(0.054, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), cover); dome2.scale.set(1, 0.5, 1); dome2.position.set(spX, top + 0.012, spZ); deck.add(dome2);
  // シリンジポンプ（左上）: ヘパリン用シリンジを横向きに装着、スライダーと固定ノブ
  deck.add(rbox(0.13, 0.034, 0.05, 0.008, whiteSoft, -0.09, top + 0.017, -0.145));
  deck.add(cyl(0.009, 0.009, 0.085, clear, -0.085, top + 0.038, -0.14, 14).rotateZ(Math.PI / 2));
  deck.add(box(0.012, 0.03, 0.03, blue, -0.04, top + 0.04, -0.14));
  deck.add(box(0.02, 0.024, 0.024, grayL, -0.135, top + 0.04, -0.14));
  deck.add(cyl(0.012, 0.012, 0.02, dark, -0.015, top + 0.01, -0.165, 16));
  // 静脈側ドリップチャンバーホルダー（中央）: 白いブラケット + 透明チャンバー（血液面）+ レベル検出器
  deck.add(rbox(0.06, 0.1, 0.04, 0.01, white, -0.01, top + 0.05, -0.03));
  deck.add(cyl(0.014, 0.014, 0.11, clear, -0.01, top + 0.06, 0.0, 16));
  const chamberLevel = cyl(0.0132, 0.0132, 1, std(0xb01020, { transparent: true, opacity: 0.75, roughness: 0.3 }), -0.01, top + 0.006, 0.0, 16);   // 血液面（高さをスケール）
  chamberLevel.scale.y = 0.001; deck.add(chamberLevel);
  deck.add(box(0.07, 0.03, 0.012, grayL, -0.01, top + 0.07, 0.02));
  // 動脈側圧力ピロー（血液ポンプ手前のホルダーに装着、脱血圧を検知）
  deck.add(box(0.032, 0.01, 0.06, grayL, -0.04, top + 0.005, 0.15));
  deck.add(rbox(0.022, 0.014, 0.05, 0.006, std(0xf3dede, { transparent: true, opacity: 0.8, roughness: 0.3 }), -0.04, top + 0.015, 0.15));
  deck.add(box(0.008, 0.02, 0.012, blue, -0.058, top + 0.014, 0.15));
  // 動脈側圧力ポッドホルダー（左中、空）
  deck.add(rbox(0.05, 0.07, 0.036, 0.008, white, -0.125, top + 0.035, -0.02));
  // 気泡検出器 + 静脈側クランプ（左下、グレーの角丸ブロックにチューブ溝）
  deck.add(rbox(0.055, 0.05, 0.034, 0.01, std(0xc5ccd3, { roughness: 0.45 }), -0.105, top + 0.025, 0.125));
  deck.add(box(0.008, 0.05, 0.036, dark, -0.105, top + 0.026, 0.125));
  deck.add(box(0.03, 0.012, 0.02, dark, -0.105, top + 0.056, 0.125));
  // 透析量モニター（吸光度センサー）のブロックと動作ランプ
  deck.add(rbox(0.04, 0.02, 0.03, 0.006, grayL, 0.14, top + 0.01, 0.17));
  deck.add(cyl(0.005, 0.005, 0.004, std(0x33c46a, { emissive: 0x1a6b3a, emissiveIntensity: 1 }), -0.15, top + 0.002, 0.19, 10));
  g.add(deck);
  // コンソール後方の肩（モニター支柱の土台）
  g.add(rbox(0.3, 0.12, 0.22, 0.03, white, 0, 1.22, -0.13));

  // モニター（紺ベゼルの 15 インチ タッチパネル、白いシェル、下縁に操作ボタン列）: 首で後方上部に取り付け、やや上向き
  g.add(cyl(0.028, 0.034, 0.16, white, 0, 1.36, -0.09, 20));
  g.add(cyl(0.035, 0.035, 0.03, grayL, 0, 1.445, -0.09, 20));
  const monitor = new THREE.Group(); monitor.position.set(0, 1.61, -0.05); monitor.rotation.x = -0.2;
  monitor.add(rbox(0.44, 0.345, 0.04, 0.015, white, 0, 0, 0));
  monitor.add(box(0.41, 0.315, 0.004, navy, 0, 0, 0.021));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.2475), new THREE.MeshStandardMaterial({ map: T.dcsScreen.texture, emissive: 0xffffff, emissiveMap: T.dcsScreen.texture, emissiveIntensity: 0.85, roughness: 0.25 }));
  screen.position.set(0, 0.022, 0.0235); monitor.add(screen);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.41, 0.045), new THREE.MeshStandardMaterial({ map: T.dcsBezel, roughness: 0.5 }));
  strip.position.set(0, -0.128, 0.0235); monitor.add(strip);
  monitor.add(cyl(0.011, 0.011, 0.006, std(0xd8262e, { roughness: 0.4 }), 0.175, -0.128, 0.025, 16).rotateX(Math.PI / 2));   // 赤い緊急停止ボタン（立体）
  monitor.add(cyl(0.009, 0.009, 0.004, std(0xd9dde4, { roughness: 0.4 }), 0.135, -0.128, 0.024, 16).rotateX(Math.PI / 2));
  // 画面の「運転」キー = タッチ操作（指で押すと沈む薄いキャップ）
  const px = (937 / 1024 - 0.5) * 0.33, py = (0.5 - 299 / 768) * 0.2475 + 0.022;
  const pumpButton = box(0.046, 0.04, 0.003, std(0x39c46a, { transparent: true, opacity: 0.18, roughness: 0.3 }), px, py, 0.0255);
  pumpButton.castShadow = false;
  pumpButton.userData = { cap: pumpButton, topOffset: [0, 0, 0.0015], travel: 0.003, hitR: 0.026, axis: [0, 0, -1] };
  monitor.add(pumpButton);
  g.add(monitor);

  // 点滴ポール（左前のポールホルダーに立てる、上部は 2 本フック）と生食バッグ
  const poleX = -0.2, poleZ = 0.16;
  g.add(box(0.05, 0.05, 0.05, grayL, poleX + 0.04, 0.95, poleZ));
  g.add(cyl(0.02, 0.02, 0.12, grayL, poleX, 0.97, poleZ, 12));
  g.add(cyl(0.012, 0.012, 0.025, dark, poleX - 0.025, 0.99, poleZ, 10).rotateZ(Math.PI / 2));
  g.add(cyl(0.009, 0.009, 1.55, chrome, poleX, 1.72, poleZ, 12));
  for (const s of [-1, 1]) {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 20, Math.PI), chrome);
    hook.position.set(poleX + s * 0.09, 2.47, poleZ); hook.rotation.z = Math.PI; g.add(hook);
    g.add(cyl(0.004, 0.004, 0.18, chrome, poleX + s * 0.09, 2.44, poleZ, 8).rotateZ(Math.PI / 2));
  }
  g.add(box(0.12, 0.2, 0.04, std(0xeaf4ff, { transparent: true, opacity: 0.75, roughness: 0.3 }), poleX + 0.09, 2.33, poleZ));
  g.add(cyl(0.0025, 0.0025, 1.0, MAT.plasticClear, poleX - 0.03, 1.75, poleZ + 0.02, 8));   // 生食ライン（ポールに沿って垂れる）
  // ダイアライザーホルダー（コンソール左側面、ポールの奥）とダイアライザー。動脈側（赤キャップ）が下、静脈側（青）が上で、血液は下から上へ流れる
  const DX = -0.25, DZ = 0.02, DY0 = 0.925, DY1 = 1.215;
  for (const y of [0.975, 1.165]) {
    g.add(box(0.07, 0.02, 0.03, grayL, -0.2, y, DZ));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.004, 8, 28), grayL); ring.position.set(DX, y, DZ); ring.rotation.x = Math.PI / 2; g.add(ring);
    g.add(cyl(0.008, 0.008, 0.02, dark, -0.2, y + 0.018, DZ, 10));   // 固定ノブ
  }
  const dialyzerFill = fillMaterial();
  const dialyzer = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(DX, DY0, DZ), new THREE.Vector3(DX, DY1, DZ)), 4, 0.027, 24, false), dialyzerFill);
  dialyzer.castShadow = true; g.add(dialyzer);
  g.add(cyl(0.0235, 0.0235, DY1 - DY0 - 0.002, std(0xf3f0ea, { roughness: 0.95 }), DX, (DY0 + DY1) / 2, DZ, 20));   // 中空糸束
  g.add(cyl(0.029, 0.027, 0.03, std(0xd9303a, { roughness: 0.4 }), DX, DY0 - 0.013, DZ, 20));                     // 動脈側キャップ（下）
  g.add(cyl(0.027, 0.029, 0.03, std(0x2f6fd0, { roughness: 0.4 }), DX, DY1 + 0.013, DZ, 20));                     // 静脈側キャップ（上）
  g.add(cyl(0.005, 0.005, 0.02, std(0xd9303a, { roughness: 0.4 }), DX, DY0 - 0.036, DZ, 10));                     // 血液ポート
  g.add(cyl(0.005, 0.005, 0.02, std(0x2f6fd0, { roughness: 0.4 }), DX, DY1 + 0.036, DZ, 10));
  for (const [y, c] of [[DY1 - 0.025, 0xd9303a], [DY0 + 0.025, 0x2f6fd0]]) g.add(cyl(0.006, 0.006, 0.026, std(c, { roughness: 0.4 }), DX + 0.035, y, DZ, 10).rotateZ(Math.PI / 2));   // 透析液ポート（本体側）
  // 透析液ホース: 赤 = 供給（上の静脈側ポートへ）、青 = 排液（下の動脈側ポートから）— 血液と向流
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.04, 0.8, 0.25), new THREE.Vector3(-0.12, 0.83, 0.3), new THREE.Vector3(-0.2, 1.0, 0.1), new THREE.Vector3(-0.2, 1.19, DZ)]), 24, 0.005, 8), std(0xd9303a)));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-0.09, 0.8, 0.25), new THREE.Vector3(-0.17, 0.78, 0.26), new THREE.Vector3(-0.2, 0.9, 0.1), new THREE.Vector3(-0.2, 0.95, DZ)]), 24, 0.005, 8), std(0x2f6fd0)));
  // 右側面の取っ手
  const handle = cyl(0.008, 0.008, 0.22, grayL, 0.19, 1.0, 0.08, 10); handle.rotation.x = Math.PI / 2; g.add(handle);
  for (const z of [-0.03, 0.19]) g.add(box(0.03, 0.016, 0.016, grayL, 0.175, 1.0, z));

  // ---- 装置内の血液回路（装置ローカル座標で固定。充填アニメーション用に区間ごとに分ける）
  // 流れ: A針 → [portA] ピロー → 血液ポンプ（ローター周りを半周）→ ダイアライザー下端 → ダイアライザー（上へ）→ 静脈側チャンバー → 気泡検出器/静脈クランプ → [portV] → V針
  deck.updateMatrix();
  const dl = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(deck.matrix);
  const mkLine = pts => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 90, 0.0028, 10, false), fillMaterial()); m.castShadow = true; g.add(m); return m; };
  const portA = dl(-0.04, top + 0.006, 0.222), portV = dl(-0.105, top + 0.006, 0.222);
  const ptsA = [portA, dl(-0.04, top + 0.012, 0.178), dl(-0.04, top + 0.012, 0.122), dl(-0.02, top + 0.03, 0.105)];
  for (let i = 0; i <= 4; i++) { const a = Math.PI + i / 4 * Math.PI; ptsA.push(dl(bpX + Math.cos(a) * 0.064, top + 0.03, bpZ + Math.sin(a) * 0.064)); }   // ローター周り（奥側を半周）
  ptsA.push(dl(bpX + 0.072, top + 0.026, bpZ + 0.07), dl(bpX + 0.06, top + 0.01, 0.222),
    new THREE.Vector3(bpX + 0.06, 0.957, 0.252), new THREE.Vector3(-0.05, 0.957, 0.256), new THREE.Vector3(-0.17, 0.95, 0.235), new THREE.Vector3(-0.255, 0.9, 0.13),
    new THREE.Vector3(DX, DY0 - 0.06, DZ + 0.02), new THREE.Vector3(DX, DY0 - 0.046, DZ));
  const lineMA = mkLine(ptsA);
  const chamberTop = dl(-0.01, top + 0.115, 0.0), chamberBottom = dl(-0.01, top + 0.005, 0.0);
  const lineMV1 = mkLine([new THREE.Vector3(DX, DY1 + 0.046, DZ), new THREE.Vector3(DX, DY1 + 0.075, DZ + 0.03), new THREE.Vector3(-0.19, 1.3, 0.1), new THREE.Vector3(-0.09, 1.27, 0.14), chamberTop.clone().add(new THREE.Vector3(0, 0.03, 0.01)), chamberTop]);
  const lineMV2 = mkLine([chamberBottom, dl(-0.035, top + 0.012, 0.04), dl(-0.08, top + 0.02, 0.095), dl(-0.105, top + 0.03, 0.125), dl(-0.105, top + 0.02, 0.17), portV]);
  const fills = { mA: lineMA.material.userData.fill, dialyzer: dialyzerFill.userData.fill, mV1: lineMV1.material.userData.fill, mV2: lineMV2.material.userData.fill };
  function setFill(stage, p) {
    if (stage === 'chamber') { const h = 0.06 * Math.max(0.001, p); chamberLevel.scale.y = h; chamberLevel.position.y = top + 0.006 + h / 2; }
    else fills[stage]?.set(p);
  }

  g.updateMatrixWorld(true);
  // ports = 患者側回路が装置に入る/出る位置（コンソール前縁）、guide = 棚前縁の回路ガイド、home = 未接続時にコネクタが垂れる位置
  const ports = { A: g.localToWorld(portA.clone()), V: g.localToWorld(portV.clone()) };
  const guide = { A: g.localToWorld(new THREE.Vector3(-0.03, 0.95, 0.31)), V: g.localToWorld(new THREE.Vector3(-0.11, 0.95, 0.31)) };
  const home = { A: g.localToWorld(new THREE.Vector3(-0.03, 0.84, 0.4)), V: g.localToWorld(new THREE.Vector3(-0.11, 0.84, 0.4)) };
  return { group: g, rotors: [rotor, rotor2], dialyzer, pumpButton, ports, guide, home, setFill };
}

// ---------------------------------------------------------------- 血液回路（装置 ↔ 針）
// 自由端（コネクタ）の位置と向きを app 側から更新する。mode: 'home' | 'held' | 'attached'
function buildBloodLines(scene, machine) {
  const PORT = machine.ports, HOLDER = machine.guide;   // 装置コンソール前縁の出入口と、棚前縁の回路ガイド
  const HOME = {
    A: { pos: machine.home.A, dir: new THREE.Vector3(0, 1, 0) },
    V: { pos: machine.home.V, dir: new THREE.Vector3(0, 1, 0) },
  };
  // 患者の手（右手・回外位）の母指と示指の間。母指はユーザー側 (+z)
  const HOOK = { A: new THREE.Vector3(0.36, 0.958, -0.515), V: new THREE.Vector3(0.37, 0.965, -0.505) };
  const mats = { A: fillMaterial(), V: fillMaterial() };
  const meshes = { A: null, V: null };
  function setLine(site, pts) {
    if (meshes[site]) { scene.remove(meshes[site]); meshes[site].geometry.dispose(); }
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 100, 0.0028, 10, false), mats[site]);
    m.castShadow = true; scene.add(m); meshes[site] = m;
  }
  function update(site, end, dir, mode) {
    const p = PORT[site], h = HOLDER[site];
    const pts = [p.clone(), new THREE.Vector3(p.x + 0.02, p.y - 0.03, p.z), h.clone()];
    if (mode === 'attached') {
      // 装置前面から垂れ下がり、ベッド縁（アームレストの手前縁）に沿って手元へ。A と V は並走（1cm ずらす）
      const zo = site === 'A' ? 0 : -0.012, yo = site === 'A' ? 0 : 0.003;
      pts.push(new THREE.Vector3(-0.63, 0.86, -0.33 + zo), new THREE.Vector3(-0.49, 0.884 + yo, -0.462 + zo),
        new THREE.Vector3(-0.2, 0.884 + yo, -0.466 + zo), new THREE.Vector3(0.12, 0.884 + yo, -0.466 + zo), new THREE.Vector3(0.3, 0.9 + yo, -0.49 + zo), HOOK[site].clone());
      // 手の上を通ったあとはゆとりを持たせて針のルアーへ（針の軸方向から入る）
      pts.push(end.clone().addScaledVector(dir, 0.09).add(new THREE.Vector3(0.02, 0.03, 0.04)));
      pts.push(end.clone().addScaledVector(dir, 0.035));
      pts.push(end.clone());
    } else {
      const mid = new THREE.Vector3().addVectors(h, end).multiplyScalar(0.5); mid.y -= 0.08;
      pts.push(mid, end.clone().addScaledVector(dir, 0.03), end.clone());
    }
    setLine(site, pts);
  }
  function reset() {
    for (const s of ['A', 'V']) { update(s, HOME[s].pos, HOME[s].dir, 'home'); mats[s].userData.fill.set(0); }
  }
  reset();
  return { update, reset, home: HOME, setFill: (site, p, fromEnd) => mats[site].userData.fill.set(p, fromEnd) };
}
