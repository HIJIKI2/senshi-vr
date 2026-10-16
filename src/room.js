// 透析室（床・壁・天井・窓・カーテン・透析装置・ベッド・器具カート・備品・血液回路）
import * as THREE from 'three';
import * as C from './constants.js';
import { MAT, makeKidneyBasin, makeSharpsBox, makeSanitizer, fillMaterial } from './tools.js';
import { mergeGeometries, mergeVertices } from '../lib/BufferGeometryUtils.js';

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
  const steel = new THREE.MeshStandardMaterial({ map: T.stainless, normalMap: T.stainlessNormal, normalScale: new THREE.Vector2(0.35, 0.35), metalness: 0.9, roughness: 0.28 });
  const chrome = std(0xcfd4d9, { metalness: 0.95, roughness: 0.2 });
  const frameM = std(0x8c95a0, { metalness: 0.6, roughness: 0.45 });

  // ---------- 部屋（動かない物は fixtures にまとめ、最後に材質ごとに 1 メッシュへ結合して描画回数を減らす）
  const fixtures = new THREE.Group(); scene.add(fixtures);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: T.linoleum, normalMap: T.floorNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: T.floorRough, roughness: 0.75, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // 天井（岩綿吸音板）。法線マップは付けない（下向きの面に法線マップを付けると three.js の接線計算で真っ黒になる）
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: T.ceiling, roughness: 0.9 }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 2.7; fixtures.add(ceiling);
  const wallM = new THREE.MeshStandardMaterial({ map: T.wall, normalMap: T.wallNormal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.88 });
  fixtures.add(box(8, 2.7, 0.05, wallM, 0, 1.35, -3, false));
  fixtures.add(box(0.05, 2.7, 8, wallM, -4, 1.35, 0, false));
  fixtures.add(box(0.05, 2.7, 8, wallM, 4, 1.35, 0, false));
  fixtures.add(box(8, 2.7, 0.05, wallM, 0, 1.35, 3, false));
  const wainscot = new THREE.MeshPhysicalMaterial({ color: 0xbfd3cf, roughness: 0.45, clearcoat: 0.25, clearcoatRoughness: 0.4 });   // 腰壁（艶のある腰板）
  fixtures.add(box(8, 0.9, 0.02, wainscot, 0, 0.45, -2.97, false));
  fixtures.add(box(0.02, 0.9, 8, wainscot, -3.97, 0.45, 0, false));
  fixtures.add(box(0.02, 0.9, 8, wainscot, 3.97, 0.45, 0, false));
  fixtures.add(box(8, 0.08, 0.03, std(0x8d9aa3), 0, 0.04, -2.96, false));
  const lightM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 });
  for (const [x, z] of [[-1, -1], [1.5, -1], [-1, 1.5], [1.5, 1.5]]) { fixtures.add(box(1.2, 0.03, 0.3, lightM, x, 2.68, z, false)); fixtures.add(box(1.26, 0.02, 0.36, std(0xe9ecef, { metalness: 0.5, roughness: 0.4 }), x, 2.69, z, false)); }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), new THREE.MeshStandardMaterial({ map: T.window, emissive: 0xffffff, emissiveMap: T.window, emissiveIntensity: 0.55, roughness: 0.4 }));
  win.position.set(1.3, 1.7, -2.96); fixtures.add(win);
  fixtures.add(box(2.1, 0.06, 0.08, std(0xf5f5f5), 1.3, 1.05, -2.94));
  fixtures.add(box(2.1, 0.05, 0.05, std(0xf5f5f5), 1.3, 2.35, -2.95));
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshStandardMaterial({ map: T.clock, roughness: 0.4 }));
  clock.position.set(-1.6, 2.1, -2.96); fixtures.add(clock);
  fixtures.add(cyl(0.012, 0.012, 2.6, chrome, 0.4, 2.45, -1.75).rotateZ(Math.PI / 2));
  fixtures.add(buildCurtain(T, 0.55, 1.65, -1.75));

  // ---------- 透析装置（日機装 DCS-200Si 風: スリムな白い本体・上部の大型カラー液晶・前面コンソール・点滴ポール）
  const machine = buildMachine(T, steel, chrome);
  scene.add(machine.group);
  mergeStatic(scene, [machine.group]);   // ローター・運転キー・ダイアライザー以外の静的な部品を材質ごとに結合

  // ---------- ベッド
  const mattressM = new THREE.MeshStandardMaterial({ map: T.sheet, normalMap: T.sheetNormal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95 });
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
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.34, 8, 2, 8), new THREE.MeshStandardMaterial({ map: T.pillow, normalMap: T.sheetNormal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 }));
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
  mergeStatic(scene, [cart]);
  // 手指消毒薬（カート手前側の端。ノズルは穿刺者側を向く）
  const sani = makeSanitizer(); sani.position.fromArray(C.trayPos(0.45, 0, 0.12)); sani.rotation.y = Math.PI; scene.add(sani);
  fixtures.add(cyl(0.16, 0.14, 0.4, std(0xdfe3e6, { roughness: 0.6 }), 1.5, 0.2, -0.2));
  const stool = new THREE.Group(); stool.position.set(1.7, 0, -1.2);
  stool.add(cyl(0.18, 0.18, 0.05, std(0x3b4f6b, { roughness: 0.6 }), 0, 0.5, 0));
  stool.add(cyl(0.02, 0.02, 0.45, chrome, 0, 0.25, 0));
  for (let i = 0; i < 5; i++) { const lg = new THREE.Group(); lg.rotation.y = i / 5 * Math.PI * 2; lg.add(box(0.26, 0.025, 0.035, chrome, 0.13, 0.03, 0)); stool.add(lg); }
  fixtures.add(stool);

  // ---------- 奥の透析ステーション × 2（ベッド + 装置、患者なし）とプライバシーカーテン
  for (const sx of [-2.6, 2.6]) {
    const st = new THREE.Group(); st.position.set(sx, 0, -1.45);
    const b2 = bed.clone(); b2.position.set(0, 0, -0.95); st.add(b2);
    const m2 = buildMachine(T, steel, chrome).group; m2.position.set(-1.0, 0, -0.17); st.add(m2);
    const blanket2 = box(1.5, 0.12, 0.7, new THREE.MeshStandardMaterial({ map: T.blanket, normalMap: T.blanketNormal, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95 }), 0.2, C.BED_TOP + 0.05, -0.95); st.add(blanket2);
    const pil2 = box(0.4, 0.09, 0.32, new THREE.MeshStandardMaterial({ map: T.pillow, normalMap: T.sheetNormal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95 }), -0.75, C.BED_TOP + 0.045, -0.95); st.add(pil2);
    scene.add(st);
    st.traverse(o => { if (o.isMesh) o.castShadow = false; });   // 奥のステーションは影を落とさない（影マップの描画を減らす）
    mergeStatic(scene, [st]);
    fixtures.add(cyl(0.012, 0.012, 2.4, chrome, sx + 0.4, 2.45, -2.3).rotateZ(Math.PI / 2));
    fixtures.add(buildCurtain(T, sx - 0.6, 1.65, -2.3));
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
  fixtures.add(sink);
  fixtures.add(box(7.8, 0.05, 0.04, std(0xd8c8a8, { roughness: 0.6 }), 0, 0.95, -2.95));
  mergeStatic(scene, [fixtures, bed]);   // ベッドは奥のステーションへ複製した後に結合する

  // ---------- 血液回路
  const lines = buildBloodLines(scene, machine);

  let pumpRunning = false;
  return {
    lines, pumpButton: machine.pumpButton, sanitizer: sani,
    setPumpRunning(on) { pumpRunning = on; T.dcsScreen.draw(on); },
    // 装置内の回路の充填: stage = 'mA'（気泡検出器 → ポンプ → 動脈側チャンバー → ダイアライザー入口）, 'dialyzer'（上から下へ）, 'mV1'（出口 → 静脈側チャンバー）, 'chamber'（静脈側チャンバーの液が血液に）, 'mV2'（チャンバー → 気泡検出器 → 出口）
    setMachineFill(stage, p) { machine.setFill(stage, p); },
    resetMachineFill() { for (const s of ['mA', 'dialyzer', 'mV1', 'chamber', 'mV2']) machine.setFill(s, 0); },
    update(dt) { if (pumpRunning) for (const r of machine.rotors) r.rotation.y += dt * 4; },   // 前から見て反時計回り（回路は左下から入って右側を回り左上へ）
  };
}

// 動かないメッシュを材質（と影の有無）ごとに 1 つのジオメトリへ結合する（描画回数を減らす = Quest の CPU 負荷の主因）。
// userData.dynamic を付けた物（とその子孫）は結合しない。結合したメッシュはワールド座標でシーン直下に置き、元のメッシュは外す
function mergeStatic(scene, roots) {
  if (location.search.includes('nomerge=1')) return;   // 描画回数の比較用
  const groups = new Map();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    const list = [];
    root.traverse(o => { if (o.isMesh) list.push(o); });
    for (const o of list) {
      let dyn = false; for (let p = o; p && p !== root.parent; p = p.parent) if (p.userData.dynamic) { dyn = true; break; }
      if (dyn || o.userData.dynamic || !o.geometry.attributes.position) continue;
      let g = o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.index) g = mergeVertices(g);
      g.applyMatrix4(o.matrixWorld);
      // 見た目が同じ材質（同じ種類・色・粗さ・テクスチャ）は 1 つにまとめる（std() は呼ぶたびに別のマテリアルを作るため）
      const m = o.material, mk = [m.type, m.color?.getHex(), m.roughness, m.metalness, m.emissive?.getHex(), m.emissiveIntensity, m.transparent, m.opacity, m.side, m.map?.uuid, m.normalMap?.uuid, m.emissiveMap?.uuid, m.roughnessMap?.uuid, m.clearcoat, m.alphaTest].join('|');
      const key = mk + (o.castShadow ? ':c' : ':n') + (o.receiveShadow ? 'r' : '');
      if (!groups.has(key)) groups.set(key, { material: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [], src: [] });
      const e = groups.get(key); e.geos.push(g); e.src.push(o);
    }
  }
  for (const e of groups.values()) {
    const merged = mergeGeometries(e.geos, false);
    if (!merged) continue;
    for (const g of e.geos) g.dispose();
    for (const o of e.src) o.removeFromParent();
    const m = new THREE.Mesh(merged, e.material); m.castShadow = e.cast; m.receiveShadow = e.recv; m.matrixAutoUpdate = false;
    scene.add(m);
  }
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
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.curtain, normalMap: T.curtainNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, side: THREE.DoubleSide }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// 日機装 DCS-200Si を参考にした多用途透析用監視装置（実機写真を参照して作成）
// 外観: 紺色の台座 + 4 輪キャスター、白い丸みのある本体。下部キャビネットの両側面に青い縦縞〜ドットの装飾帯、前面下部に DCS-200Si の銘板。
// 前面は急角度（水平から約 65°）に傾いた白いコンソール面で、上から: シリンジポンプ（ヘパリン）、動脈側圧力ポッド接続部、静脈側チャンバーホルダー（左）、
// 血液ポンプ（右上・紫がかった透明カバー、回路は左側から入って左側へ出る = 時計回り）、中央の返血/サンプルポート、ラインホルダー、
// 気泡検出器 + 静脈クランプ（左下）、補液ポンプ（右下・小）、最下部に透析液カプラ（赤・青）のホルダー。
// 上部に紺色ベゼルの 15 インチ タッチパネル（下縁に操作ボタン列: 電源・画面、NIKKISO ロゴ、警報ランプ、ボタン、赤い緊急停止）。
// 左側面にポールクランプで点滴ポール（上端 2 本フック）を立て、ポールにダイアライザーホルダー（DLC-05）と動脈側チャンバーホルダーを取り付ける。
// 血液回路（標準のチャンバー回路。導入施設の運転中の写真を参照）: A針 → 気泡検出器（向かって右の A 溝）→ 血液ポンプ（左下から入り反時計回りに回って左上へ）→
// 動脈側チャンバー（ポール上部・赤キャップ）→ ダイアライザー（赤キャップの上端から入り、青キャップの下端へ）→ いったん上へ上がって静脈側チャンバー
// （赤の向かって左隣・青キャップ）の上から入る → 気泡検出器（向かって左の V 溝）+ 静脈クランプ → V針。
// 気泡検出器には A・V の 2 本の回路が横並びで装着される。2 つのチャンバーは上から血液が入り下へ抜け、液面の上に少し空気があって気泡をトラップする。
// 回路は治療時にはすでに液（生食）で満たされていて、ポンプ開始で血液に置き換わっていく。各チャンバーの上部からは圧モニターラインが装置のポートへ。
// 透析液カプラは同じ色のキャップ側に接続（赤カプラ = 赤キャップ側の側面ポート、青 = 青側）。血液ポンプの運転は画面の「運転」キーで行う
// ローカル座標: 前面 = +z（世界では +x を向くよう回転）、幅 = x
function buildMachine(T, steel, chrome) {
  const g = new THREE.Group(); g.position.copy(MACHINE_POS); g.rotation.y = Math.PI / 2;
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf5f6f8, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.35 });   // 艶のある白い樹脂外装
  const whiteSoft = std(0xe9ecef, { roughness: 0.5 });
  const navy = std(0x1f2c52, { roughness: 0.5 });
  const grayL = std(0xd3d8de, { roughness: 0.5 });
  const gray = std(0xaab1b9, { roughness: 0.5 });
  const dark = std(0x24272c, { roughness: 0.5 });
  const cover = std(0x8d82e8, { transparent: true, opacity: 0.42, roughness: 0.08 });   // 紫がかった透明カバー
  const clear = std(0xf4f7fa, { transparent: true, opacity: 0.35, roughness: 0.1 });
  const metal = std(0xc9cfd6, { metalness: 0.85, roughness: 0.3 });
  const red = std(0xd9303a, { roughness: 0.4 }), blue = std(0x2f6fd0, { roughness: 0.4 });
  const hoseM = std(0xf2f2ee, { roughness: 0.5 });

  // 台座（紺。前後に脚が張り出す）と 4 輪キャスター
  g.add(rbox(0.46, 0.05, 0.62, 0.02, navy, 0, 0.05, 0));
  g.add(rbox(0.24, 0.05, 0.68, 0.02, navy, 0, 0.05, 0));
  for (const [x, z] of [[-0.19, -0.29], [0.19, -0.29], [-0.19, 0.29], [0.19, 0.29]]) {
    const w = cyl(0.038, 0.038, 0.03, std(0x33373d), x, 0.038, z); w.rotation.x = Math.PI / 2; g.add(w);
    g.add(box(0.03, 0.04, 0.05, std(0x8a9199), x, 0.06, z));
  }
  // 下部キャビネット（白、丸み）。両側面に青い装飾帯、前面下部に DCS-200Si の銘板、側面の取っ手
  g.add(rbox(0.40, 0.72, 0.50, 0.05, white, 0, 0.44, 0));
  for (const sx of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.44), new THREE.MeshStandardMaterial({ map: T.dcsSide, roughness: 0.45 }));
    band.position.set(sx * 0.2005, 0.42, 0.04); band.rotation.y = sx * Math.PI / 2; g.add(band);
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.036), new THREE.MeshStandardMaterial({ map: T.dcsLogo, transparent: true, roughness: 0.4 }));
  plate.position.set(0.0, 0.2, 0.2505); g.add(plate);
  const handle = cyl(0.008, 0.008, 0.22, grayL, 0.205, 0.95, 0.06, 10); handle.rotation.x = Math.PI / 2; g.add(handle);
  for (const z of [-0.05, 0.17]) g.add(box(0.03, 0.016, 0.016, grayL, 0.19, 0.95, z));
  // 透析液カプラ用のポート（前面下部）: 赤 = 供給、青 = 排液。ここからホースがダイアライザーのカプラへ
  for (const [x, m] of [[-0.07, red], [-0.02, blue]]) { const c = cyl(0.011, 0.011, 0.03, m, x, 0.7, 0.25, 12); c.rotation.x = Math.PI / 2; g.add(c); }

  // 上部シェル（コンソールの後ろの丸い本体。デッキの上端より手前に出ないようにして、シリンジポンプと血液ポンプ出口のチューブが見えるようにする）
  g.add(rbox(0.46, 0.42, 0.26, 0.07, white, 0, 0.97, -0.15));
  g.add(box(0.44, 0.06, 0.2, white, 0, 1.19, -0.08));   // デッキ上端の裏を支える段
  // コンソール面（デッキ）: 法線が前上方（水平から 25° 上向き）。デッキローカル: +y = 面の法線、+z = 面に沿って下（手前）、x = 幅
  const deck = new THREE.Group(); deck.position.set(0, 0.98, 0.115); deck.rotation.x = 1.13;
  deck.add(rbox(0.46, 0.08, 0.52, 0.03, white, 0, 0, 0));
  const top = 0.04;
  // --- 上段右: シリンジポンプ（ヘパリン）。20mL シリンジを横向きにセット（先端は左）。押し子をスライダーが押す。
  //     シリンジの先端からヘパリンラインが出て、血液ポンプの入口（左下）の手前で動脈側回路に合流する
  const SPX = 0.1, SPZ = -0.225, SY = top + 0.042;
  const sp = new THREE.Group(); sp.position.x = 0.02; deck.add(sp);   // 右へ 2cm 寄せる（左側を血液ポンプ出口のチューブが通る）
  sp.add(rbox(0.21, 0.03, 0.046, 0.006, whiteSoft, SPX, top + 0.015, SPZ));                                       // 台
  sp.add(box(0.19, 0.004, 0.006, metal, SPX, top + 0.031, SPZ + 0.016));                                           // スライダーのレール
  const syrClear = std(0xffffff, { transparent: true, opacity: 0.5, roughness: 0.12 });
  sp.add(cyl(0.0098, 0.0098, 0.09, syrClear, 0.055, SY, SPZ, 18).rotateZ(Math.PI / 2));                            // バレル（20mL: 外径 約 20mm・長さ 90mm）
  sp.add(cyl(0.0085, 0.0085, 0.05, std(0xeef3f8, { transparent: true, opacity: 0.55, roughness: 0.3 }), 0.035, SY, SPZ, 16).rotateZ(Math.PI / 2));   // 中のヘパリン液（半分）
  sp.add(cyl(0.0088, 0.0088, 0.006, dark, 0.06, SY, SPZ, 16).rotateZ(Math.PI / 2));                                // ガスケット（黒）
  sp.add(cyl(0.017, 0.017, 0.003, syrClear, 0.1, SY, SPZ, 20).rotateZ(Math.PI / 2));                               // バレルのフランジ
  sp.add(cyl(0.0035, 0.0035, 0.012, syrClear, 0.004, SY, SPZ, 12).rotateZ(Math.PI / 2));                           // 先端（ルアー）
  sp.add(box(0.003, 0.016, 0.003, grayL, 0.063, SY, SPZ)); sp.add(box(0.003, 0.003, 0.016, grayL, 0.063, SY, SPZ));   // 押し子（十字の軸）
  sp.add(box(0.1, 0.003, 0.012, grayL, 0.113, SY, SPZ)); sp.add(box(0.1, 0.012, 0.003, grayL, 0.113, SY, SPZ));
  sp.add(cyl(0.012, 0.012, 0.003, grayL, 0.165, SY, SPZ, 20).rotateZ(Math.PI / 2));                                // 押し子の頭
  sp.add(rbox(0.026, 0.034, 0.04, 0.005, grayL, 0.182, top + 0.036, SPZ));                                         // スライダー（押し子を押す）
  sp.add(box(0.008, 0.028, 0.036, whiteSoft, 0.098, top + 0.034, SPZ + 0.004));                                    // フランジを受ける溝
  sp.add(box(0.024, 0.004, 0.03, grayL, 0.03, SY + 0.013, SPZ));                                                   // バレルクランプ（上から押さえる）
  sp.add(cyl(0.003, 0.003, 0.03, grayL, 0.03, SY + 0.005, SPZ + 0.02, 8));
  { // 目盛りと「20mL」の表示（バレルの手前側）
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const c = cv.getContext('2d');
    c.clearRect(0, 0, 256, 64); c.fillStyle = '#1b2430'; c.font = 'bold 22px sans-serif'; c.textBaseline = 'middle'; c.fillText('20mL', 196, 20);
    for (let i = 0; i <= 20; i++) { const x = 16 + i * 8; c.fillRect(x, 36, 1.5, i % 5 ? 8 : 16); if (i % 5 === 0) { c.font = '14px sans-serif'; c.fillText(String(i), x - 6, 60); } }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.02), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    lab.position.set(0.055, SY + 0.004, SPZ + 0.0099); lab.rotation.x = -0.2; sp.add(lab);
  }
  // 圧モニターポート（左上: 動脈圧 = 赤、その下: 静脈圧 = 青）。各チャンバー上部からの細いモニターラインがここにつながる
  for (const [z, m] of [[-0.14, red], [-0.08, blue]]) {
    deck.add(cyl(0.014, 0.016, 0.012, grayL, -0.15, top + 0.006, z, 24));
    deck.add(cyl(0.005, 0.005, 0.016, m, -0.15, top + 0.016, z, 10));
    deck.add(cyl(0.009, 0.009, 0.006, whiteSoft, -0.15, top + 0.025, z, 14));
  }
  // 左中: 回路ガイド（白いパッド + 2 本のクリップ）
  deck.add(rbox(0.06, 0.012, 0.05, 0.01, whiteSoft, -0.15, top + 0.006, 0.0));
  for (const x of [-0.165, -0.135]) deck.add(box(0.012, 0.012, 0.03, grayL, x, top + 0.014, 0.0));
  // 血液ポンプ（右上・大）: 白い円形の座、回転ローター（金属ローラー 2 本）、紫がかった透明カバー。回路は左側の切り欠きから入り、左側へ出る
  const bpX = 0.12, bpZ = -0.11;
  deck.add(cyl(0.078, 0.082, 0.014, grayL, bpX, top + 0.007, bpZ, 40));
  deck.add(cyl(0.066, 0.066, 0.014, dark, bpX, top + 0.014, bpZ, 40));
  const rotor = new THREE.Group(); rotor.position.set(bpX, top + 0.03, bpZ);
  rotor.add(cyl(0.028, 0.03, 0.018, white, 0, 0, 0, 28));
  for (const a of [0, Math.PI]) { const arm = box(0.05, 0.012, 0.016, std(0xe6e9ed, { roughness: 0.4 })); arm.rotation.y = a; arm.position.set(Math.cos(a) * 0.03, 0, -Math.sin(a) * 0.03); rotor.add(arm); }
  for (const a of [0, Math.PI]) rotor.add(cyl(0.011, 0.011, 0.02, metal, Math.cos(a) * 0.052, 0, -Math.sin(a) * 0.052, 14));
  rotor.userData.dynamic = true; deck.add(rotor);
  // カバー・ヒンジ・赤い印・ラッチはポンプの中心を軸に 90° 反時計回りに回した向き（ヒンジは下、ラッチは右、赤い印 = 回路の入口は左下）
  const pumpParts = new THREE.Group(); pumpParts.position.set(bpX, 0, bpZ); pumpParts.rotation.y = Math.PI / 2; deck.add(pumpParts);
  pumpParts.add(rbox(0.16, 0.035, 0.15, 0.02, cover, 0, top + 0.034, 0));
  pumpParts.add(box(0.012, 0.03, 0.08, grayL, -0.085, top + 0.03, 0));                                              // ヒンジ（回転後は下側）
  pumpParts.add(cyl(0.006, 0.006, 0.002, red, -0.065, top + 0.053, -0.045, 12));                                    // 「A」の赤い印（回転後は左下 = 回路の入口）
  pumpParts.add(box(0.03, 0.01, 0.012, blue, 0.03, top + 0.053, 0.065));                                            // ラッチ（回転後は右側）
  // 中央: 返血/サンプルポート（丸い座にキャップ）と小さなライン固定具
  deck.add(cyl(0.02, 0.022, 0.014, white, 0.0, top + 0.007, -0.02, 24));
  deck.add(cyl(0.009, 0.009, 0.016, grayL, 0.0, top + 0.02, -0.02, 14));
  deck.add(rbox(0.03, 0.01, 0.03, 0.004, whiteSoft, -0.06, top + 0.005, 0.03));
  // 右中: ラインホルダー（白い角丸のパッド）、右端のクリップ
  deck.add(rbox(0.07, 0.012, 0.05, 0.01, whiteSoft, 0.16, top + 0.006, 0.01));
  deck.add(rbox(0.05, 0.02, 0.03, 0.006, white, 0.17, top + 0.01, 0.07));
  deck.add(box(0.03, 0.004, 0.004, dark, 0.17, top + 0.021, 0.07));
  // 左中: 補液ラインホルダー（溝付きのパッド）
  deck.add(rbox(0.07, 0.012, 0.05, 0.01, whiteSoft, -0.15, top + 0.006, 0.09));
  deck.add(box(0.05, 0.004, 0.006, dark, -0.15, top + 0.012, 0.09));
  // 気泡検出器 + 静脈クランプ（左下）: 白いブロックに縦の溝が 2 本横並び（左 = 動脈側、右 = 静脈側の回路を通して気泡を監視）、静脈側の溝の下部がクランプ
  const BD = { x: -0.11, z: 0.15, ax: -0.092, vx: -0.128 };   // 向かって右（+x）= 動脈側（赤）、左 = 静脈側（青）
  deck.add(rbox(0.11, 0.045, 0.1, 0.012, white, BD.x, top + 0.022, BD.z));
  for (const [x, m] of [[BD.ax, red], [BD.vx, blue]]) { deck.add(box(0.008, 0.046, 0.1, dark, x, top + 0.023, BD.z)); deck.add(box(0.012, 0.002, 0.006, m, x, top + 0.046, BD.z - 0.052)); }
  deck.add(box(0.03, 0.016, 0.02, dark, BD.vx, top + 0.045, BD.z + 0.035));
  // 補液ポンプ（右下・小）
  const spX = 0.14, spZ = 0.16;
  deck.add(cyl(0.052, 0.055, 0.012, grayL, spX, top + 0.006, spZ, 32));
  deck.add(cyl(0.042, 0.042, 0.012, dark, spX, top + 0.012, spZ, 32));
  const rotor2 = new THREE.Group(); rotor2.position.set(spX, top + 0.024, spZ);
  rotor2.add(cyl(0.018, 0.02, 0.014, white, 0, 0, 0, 20));
  for (const a of [0, Math.PI]) rotor2.add(cyl(0.008, 0.008, 0.016, metal, Math.cos(a) * 0.033, 0, -Math.sin(a) * 0.033, 12));
  rotor2.userData.dynamic = true; deck.add(rotor2);
  deck.add(rbox(0.11, 0.03, 0.1, 0.016, cover, spX, top + 0.026, spZ));
  deck.add(cyl(0.005, 0.005, 0.002, blue, spX + 0.04, top + 0.042, spZ + 0.035, 12));
  // 最下部: 透析液カプラのホルダー（空。カプラはダイアライザーに接続中）と赤・青の表示
  deck.add(rbox(0.09, 0.02, 0.03, 0.006, white, 0.02, top + 0.01, 0.235));
  for (const [x, m] of [[0.0, blue], [0.04, red]]) deck.add(cyl(0.012, 0.012, 0.016, m, x, top + 0.024, 0.235, 16));
  deck.add(box(0.03, 0.004, 0.006, grayL, 0.02, top + 0.012, 0.215));
  // 透析量モニター（吸光度センサー）の動作ランプ
  deck.add(cyl(0.004, 0.004, 0.003, std(0x33c46a, { emissive: 0x1a6b3a, emissiveIntensity: 1 }), -0.2, top + 0.0015, 0.2, 10));
  g.add(deck);

  // モニター（紺ベゼルの 15 インチ タッチパネル、白いシェル、下縁に操作ボタン列）: 本体上部後方の首に取り付け、やや上向き
  g.add(cyl(0.05, 0.07, 0.12, white, 0, 1.27, -0.09, 24));
  g.add(cyl(0.034, 0.034, 0.06, grayL, 0, 1.35, -0.09, 20));
  const monitor = new THREE.Group(); monitor.position.set(0, 1.52, -0.05); monitor.rotation.x = -0.16;
  monitor.add(rbox(0.45, 0.36, 0.05, 0.02, white, 0, 0, -0.012));
  monitor.add(rbox(0.425, 0.335, 0.016, 0.006, navy, 0, 0, 0.018));   // 前面は z = 0.026
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.2475), new THREE.MeshStandardMaterial({ map: T.dcsScreen.texture, emissive: 0xffffff, emissiveMap: T.dcsScreen.texture, emissiveIntensity: 0.85, roughness: 0.25 }));
  screen.position.set(0, 0.022, 0.0266); monitor.add(screen);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.41, 0.045), new THREE.MeshStandardMaterial({ map: T.dcsBezel, roughness: 0.5 }));
  strip.position.set(0, -0.128, 0.0266); monitor.add(strip);
  monitor.add(cyl(0.011, 0.011, 0.006, std(0xd8262e, { roughness: 0.4 }), 0.175, -0.128, 0.029, 16).rotateX(Math.PI / 2));   // 赤い緊急停止ボタン（立体）
  monitor.add(cyl(0.009, 0.009, 0.004, std(0xd9dde4, { roughness: 0.4 }), 0.135, -0.128, 0.028, 16).rotateX(Math.PI / 2));
  const nameplate = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.017), new THREE.MeshStandardMaterial({ map: T.dcsLogo, transparent: true, roughness: 0.4 }));
  nameplate.position.set(0, 0.158, 0.0266); monitor.add(nameplate);
  // 画面の「運転」キー = タッチ操作（指で押すと沈む薄いキャップ）
  const px = (937 / 1024 - 0.5) * 0.33, py = (0.5 - 299 / 768) * 0.2475 + 0.022;
  const pumpButton = box(0.046, 0.04, 0.003, std(0x39c46a, { transparent: true, opacity: 0.18, roughness: 0.3 }), px, py, 0.0285);
  pumpButton.castShadow = false;
  pumpButton.userData = { cap: pumpButton, topOffset: [0, 0, 0.0015], travel: 0.003, hitR: 0.026, axis: [0, 0, -1], dynamic: true };
  monitor.add(pumpButton);
  g.add(monitor);

  // 点滴ポール（左側面のポールクランプに立てる。上端は 2 本フック）
  const poleX = -0.265, poleZ = 0.06;
  g.add(box(0.05, 0.05, 0.06, grayL, -0.235, 1.0, poleZ));                                   // ポールクランプ
  g.add(cyl(0.012, 0.012, 0.03, dark, -0.235, 1.0, poleZ + 0.045, 10).rotateX(Math.PI / 2));   // クランプのノブ
  g.add(box(0.05, 0.04, 0.05, grayL, -0.235, 0.82, poleZ));
  g.add(cyl(0.0095, 0.0095, 1.6, chrome, poleX, 1.6, poleZ, 12));
  for (const s of [-1, 1]) {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 20, Math.PI), chrome);
    hook.position.set(poleX + s * 0.09, 2.37, poleZ); hook.rotation.z = Math.PI; g.add(hook);
    g.add(cyl(0.004, 0.004, 0.18, chrome, poleX + s * 0.09, 2.34, poleZ, 8).rotateZ(Math.PI / 2));
  }
  g.add(box(0.12, 0.2, 0.04, std(0xeaf4ff, { transparent: true, opacity: 0.75, roughness: 0.3 }), poleX + 0.09, 2.23, poleZ));   // 生食バッグ
  g.add(cyl(0.0025, 0.0025, 1.1, MAT.plasticClear, poleX - 0.03, 1.6, poleZ + 0.02, 8));                                  // 生食ライン（ポールに沿って垂れる）
  // ダイアライザーホルダー（DLC-05: ポールに固定するブラケット + 2 つのリングクランプ）とダイアライザー。
  // 動脈側（赤キャップ）が下、静脈側（青）が上で、血液は下から上へ流れる
  const DX = -0.33, DZ = 0.17, DY0 = 0.95, DY1 = 1.25;
  g.add(box(0.045, 0.2, 0.04, white, poleX - 0.005, 1.1, poleZ));
  g.add(cyl(0.011, 0.011, 0.03, dark, poleX - 0.03, 1.1, poleZ - 0.03, 10).rotateX(Math.PI / 2));
  const dlcLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.08), new THREE.MeshBasicMaterial({ color: 0xe9ecef }));
  dlcLabel.position.set(poleX - 0.028, 1.1, poleZ); dlcLabel.rotation.y = -Math.PI / 2; g.add(dlcLabel);
  for (const y of [1.0, 1.2]) {
    const arm = box(0.09, 0.016, 0.03, grayL, (poleX + DX) / 2 - 0.01, y, (poleZ + DZ) / 2); arm.rotation.y = -Math.atan2(DZ - poleZ, DX - poleX) - Math.PI; g.add(arm);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.004, 8, 28), grayL); ring.position.set(DX, y, DZ); ring.rotation.x = Math.PI / 2; g.add(ring);
  }
  const dialyzerFill = fillMaterial();
  const dialyzer = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(DX, DY0, DZ), new THREE.Vector3(DX, DY1, DZ)), 4, 0.027, 24, false), dialyzerFill);
  dialyzer.castShadow = true; dialyzer.userData.dynamic = true; g.add(dialyzer);
  g.add(cyl(0.0235, 0.0235, DY1 - DY0 - 0.002, std(0xf3f0ea, { roughness: 0.95 }), DX, (DY0 + DY1) / 2, DZ, 20));   // 中空糸束
  const dLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.07), new THREE.MeshBasicMaterial({ color: 0xf6f8fb }));
  dLabel.position.set(DX, (DY0 + DY1) / 2 - 0.02, DZ + 0.0272); g.add(dLabel);
  g.add(cyl(0.027, 0.029, 0.03, red, DX, DY1 + 0.013, DZ, 20));                     // 動脈側キャップ（上: 血液が入る）
  g.add(cyl(0.029, 0.027, 0.03, blue, DX, DY0 - 0.013, DZ, 20));                    // 静脈側キャップ（下: 血液が出る）
  g.add(cyl(0.005, 0.005, 0.02, red, DX, DY1 + 0.036, DZ, 10));                     // 血液ポート
  g.add(cyl(0.005, 0.005, 0.02, blue, DX, DY0 - 0.036, DZ, 10));
  // 透析液カプラは同じ色のキャップ側の側面ポートに接続（赤 = 上の赤キャップ側、青 = 下の青キャップ側）、ホースは前面下部の同色ポートへ
  for (const [y, m, px0] of [[DY1 - 0.03, red, -0.07], [DY0 + 0.03, blue, -0.02]]) {
    g.add(cyl(0.006, 0.006, 0.026, m, DX + 0.035, y, DZ, 10).rotateZ(Math.PI / 2));                              // ポート（本体側）
    g.add(cyl(0.017, 0.017, 0.05, m, DX + 0.07, y, DZ, 16).rotateZ(Math.PI / 2));                                // カプラ本体（レバー付き）
    g.add(box(0.012, 0.03, 0.01, m, DX + 0.07, y + 0.025, DZ));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(DX + 0.095, y, DZ), new THREE.Vector3(DX + 0.13, y - 0.02, DZ + 0.06), new THREE.Vector3(-0.2, 0.62, 0.34), new THREE.Vector3(px0 - 0.04, 0.58, 0.32), new THREE.Vector3(px0, 0.7, 0.27)]), 36, 0.006, 8), hoseM));
  }
  // チャンバー（動脈側 = ポール上部・赤キャップ、静脈側 = ポール下部・青キャップ）: ポールのチャンバーホルダー（前向きのクリップ）に縦に装着。
  // 上から血液が入り下へ抜ける。液面の上に少し空気がある（気泡トラップ）。治療前は生食で満たされ、ポンプ開始で血液に置き換わる。キャップの横から圧モニターライン
  // 2 つのチャンバーはポール上部に横並び: 動脈側（赤）はポールの前、静脈側（青）はその向かって左（-x）。どちらも上から入って下へ抜ける
  const CX = -0.27, CZ = 0.19, VX = CX - 0.065, LEVEL = 0.8;
  function makeChamber(x, y0, y1, capM, holder = true) {
    const yc = (y0 + y1) / 2;
    if (holder) { g.add(box(0.03, 0.03, 0.03, white, poleX, yc, poleZ)); g.add(box(0.025, 0.02, 0.1, grayL, (poleX + CX) / 2, yc, (poleZ + CZ) / 2)); }
    else g.add(box(Math.abs(CX - x) + 0.01, 0.02, 0.025, grayL, (CX + x) / 2, yc, CZ - 0.02));   // 隣のチャンバーのホルダーから横へ伸びる腕
    const clip = new THREE.Mesh(new THREE.TorusGeometry(0.0145, 0.003, 8, 20, Math.PI * 1.5), white); clip.rotation.x = Math.PI / 2; clip.position.set(x, yc, CZ); g.add(clip);
    g.add(cyl(0.012, 0.012, y1 - y0, clear, x, yc, CZ, 16));
    const h = (y1 - y0) * LEVEL;
    const liquid = cyl(0.0112, 0.0112, h, std(0xe3ebf1, { transparent: true, opacity: 0.55, roughness: 0.3 }), x, y0 + h / 2, CZ, 16);   // 液面まで液（生食 → 血液）
    liquid.castShadow = false; liquid.userData.dynamic = true; g.add(liquid);   // 色が個別に変わる（生食 → 血液）ので静的結合しない（結合すると 2 つのチャンバーが 1 つの材質を共有して同時に赤くなる）
    g.add(cyl(0.013, 0.013, 0.012, capM, x, y1 + 0.004, CZ, 12));                                               // 上キャップ（入口）
    g.add(cyl(0.004, 0.004, 0.014, whiteSoft, x + (holder ? 0.012 : -0.012), y1 - 0.006, CZ, 8).rotateZ(Math.PI / 2));   // 圧モニターラインのポート（外側）
    g.add(cyl(0.008, 0.008, 0.008, capM, x, y0 - 0.002, CZ, 12));                                                // 下端（出口）
    return liquid.material;
  }
  const AY0 = 1.33, AY1 = 1.44, VY0 = AY0, VY1 = AY1;
  const liqA = makeChamber(CX, AY0, AY1, red), liqV = makeChamber(VX, VY0, VY1, blue, false);
  const saline = new THREE.Color(0xe3ebf1), blood = new THREE.Color(0xa50816);
  const setLiquid = (m, p) => { m.color.copy(saline).lerp(blood, p); m.opacity = 0.55 + 0.4 * p; };

  // ---- 装置内の血液回路（装置ローカル座標で固定。治療前から液で満たされている。ポンプ開始の充填アニメーション用に区間ごとに分ける）
  // 流れ: A針 → [portA] 気泡検出器（右の A 溝を下から上へ）→ 血液ポンプ（左下から入り、反時計回りに回って左上へ）→ 動脈側チャンバー（ポール上部・赤）→
  //       ダイアライザー上端（赤）→ ダイアライザー（下へ）→ 下端（青）→ いったん上へ上がって静脈側チャンバー（赤の向かって左・青）の上から入る →
  //       チャンバー下端 → 気泡検出器（左の V 溝を上から下へ）/静脈クランプ → [portV] → V針
  deck.updateMatrix();
  const dl = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(deck.matrix);
  const mkLine = (pts, r = 0.0028, mat = null) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 100, r, 10, false), mat || fillMaterial()); m.castShadow = true; g.add(m); return m; };
  const portA = dl(BD.ax, top + 0.03, 0.215), portV = dl(BD.vx, top + 0.03, 0.215);
  const ptsA = [portA, dl(BD.ax, top + 0.03, 0.19), dl(BD.ax, top + 0.03, 0.1), dl(-0.06, top + 0.03, 0.03), dl(0.02, top + 0.03, -0.03), dl(bpX - 0.085, top + 0.03, bpZ + 0.075)];
  for (let i = 0; i <= 8; i++) { const a = (125 - i * 275 / 8) * Math.PI / 180; ptsA.push(dl(bpX + Math.cos(a) * 0.062, top + 0.03, bpZ + Math.sin(a) * 0.062)); }   // ローター周り（左下から入り、右側を回って左上へ = 反時計回り）
  ptsA.push(dl(bpX - 0.085, top + 0.03, bpZ - 0.07), dl(0.02, top + 0.03, -0.195), dl(-0.08, top + 0.03, -0.21), dl(-0.2, top + 0.03, -0.21),
    new THREE.Vector3(-0.26, 1.3, 0.1), new THREE.Vector3(CX - 0.01, AY1 + 0.05, CZ - 0.01), new THREE.Vector3(CX, AY1 + 0.012, CZ));   // ポンプ左上の出口 → デッキ左上の縁 → 動脈側チャンバー
  const lineMA1 = mkLine(ptsA);
  // ヘパリンライン: シリンジ先端 → 血液ポンプ出口のチューブをまたいで → 入口手前の動脈側回路に合流（Y コネクタ）
  const hepM = std(0xffffff, { transparent: true, opacity: 0.6, roughness: 0.2 });
  mkLine([dl(0.018, SY, SPZ), dl(-0.01, SY, SPZ - 0.004), dl(-0.03, top + 0.05, -0.2), dl(-0.02, top + 0.032, -0.1), dl(0.02, top + 0.03, -0.03)], 0.0015, hepM);
  deck.add(cyl(0.005, 0.005, 0.012, whiteSoft, 0.02, top + 0.03, -0.03, 10).rotateX(Math.PI / 2));
  // 動脈側チャンバー下端 → 前を回ってダイアライザー上端（赤）へ（隣の静脈側チャンバーを避けて手前側を通す）
  const lineMA2 = mkLine([new THREE.Vector3(CX, AY0 - 0.004, CZ), new THREE.Vector3(CX + 0.005, AY0 - 0.03, CZ + 0.04), new THREE.Vector3(DX + 0.01, DY1 + 0.075, DZ + 0.07), new THREE.Vector3(DX, DY1 + 0.046, DZ)]);
  // ダイアライザー下端（青）→ いったん下へ出てから左側面を上へ → 静脈側チャンバー（赤の左隣）の上から入る
  const lineMV1 = mkLine([new THREE.Vector3(DX, DY0 - 0.046, DZ), new THREE.Vector3(DX, DY0 - 0.075, DZ + 0.015), new THREE.Vector3(DX - 0.04, 0.95, DZ + 0.045), new THREE.Vector3(DX - 0.04, 1.4, DZ + 0.045), new THREE.Vector3(VX - 0.012, VY1 + 0.05, CZ), new THREE.Vector3(VX, VY1 + 0.012, CZ)]);
  // 静脈側チャンバー下端 → 前を通って下へ → 気泡検出器の左の溝（V）を上から下へ → [portV]
  // （チャンバーの出口からまっすぐ下に出て、ゆるく右（+x）へ寄りながら下り、デッキ左中の回路ガイド（2 本のクリップ）を通ってデッキ面に沿って下り、検出器の溝の真上から溝の向きに入る）
  const vIn = dl(BD.vx, top + 0.03, BD.z - 0.05);   // 気泡検出器 V 溝の上端
  const lineMV2 = mkLine([new THREE.Vector3(VX, VY0 - 0.004, CZ), new THREE.Vector3(VX, VY0 - 0.06, CZ), new THREE.Vector3(VX + 0.035, 1.19, CZ - 0.005), new THREE.Vector3(-0.2, 1.11, 0.16),
    dl(-0.15, top + 0.03, -0.05), dl(-0.15, top + 0.03, 0.0), dl(-0.14, top + 0.03, 0.05), vIn, dl(BD.vx, top + 0.03, 0.19), portV]);
  // 圧モニターライン（細い透明チューブ）: 各チャンバー上部のポートから装置の圧ポート（動脈圧 / 静脈圧）へ
  const monM = std(0xffffff, { transparent: true, opacity: 0.5, roughness: 0.2 });
  mkLine([new THREE.Vector3(CX + 0.02, AY1 - 0.006, CZ), new THREE.Vector3(-0.2, 1.38, 0.1), dl(-0.17, top + 0.04, -0.16), dl(-0.15, top + 0.03, -0.14)], 0.0015, monM);
  mkLine([new THREE.Vector3(VX - 0.02, VY1 - 0.006, CZ), new THREE.Vector3(VX - 0.03, VY1 + 0.03, CZ - 0.06), new THREE.Vector3(-0.2, 1.45, 0.05), dl(-0.2, top + 0.05, -0.06), dl(-0.15, top + 0.03, -0.08)], 0.0015, monM);
  const fills = { mA1: lineMA1.material.userData.fill, mA2: lineMA2.material.userData.fill, dialyzer: dialyzerFill.userData.fill, mV1: lineMV1.material.userData.fill, mV2: lineMV2.material.userData.fill };
  const clamp01 = v => Math.min(1, Math.max(0, v));
  function setFill(stage, p) {
    if (stage === 'chamber') setLiquid(liqV, p);                                   // 静脈側チャンバーの液が血液に
    else if (stage === 'dialyzer') fills.dialyzer.set(p, true);                     // 上（赤）から下（青）へ
    else if (stage === 'mA') {   // 気泡検出器 → ポンプ → 動脈側チャンバー（液が血液に）→ ダイアライザー入口
      fills.mA1.set(clamp01(p / 0.6));
      setLiquid(liqA, clamp01((p - 0.6) / 0.2));
      fills.mA2.set(clamp01((p - 0.8) / 0.2));
    }
    else fills[stage]?.set(p);
  }

  g.updateMatrixWorld(true);
  // ports = 患者側回路が装置に入る/出る位置（気泡検出器の下端: 向かって右 = A, 左 = V）、guide = コンソール左下前縁の回路ガイド、home = 未接続時にコネクタが垂れる位置
  const ports = { A: g.localToWorld(portA.clone()), V: g.localToWorld(portV.clone()) };
  const guide = { A: g.localToWorld(new THREE.Vector3(-0.1, 0.72, 0.3)), V: g.localToWorld(new THREE.Vector3(-0.16, 0.72, 0.3)) };
  const home = { A: g.localToWorld(new THREE.Vector3(-0.09, 0.62, 0.38)), V: g.localToWorld(new THREE.Vector3(-0.17, 0.62, 0.38)) };
  return { group: g, rotors: [rotor], dialyzer, pumpButton, ports, guide, home, setFill };   // 回るのは血液ポンプだけ（補液ポンプには回路が付いていない）
}

// ---------------------------------------------------------------- 血液回路（装置 ↔ 針）
// 自由端（コネクタ）の位置と向きを app 側から更新する。mode: 'home' | 'held' | 'attached'
function buildBloodLines(scene, machine) {
  const PORT = machine.ports, HOLDER = machine.guide;   // 装置コンソール前縁の出入口と、棚前縁の回路ガイド
  const HOME = {
    A: { pos: machine.home.A, dir: new THREE.Vector3(0, 1, 0) },
    V: { pos: machine.home.V, dir: new THREE.Vector3(0, 1, 0) },
  };
  // 患者の手（右手・回外位）の母指と示指の間。母指はユーザー側 (+z)。腕の基準姿勢の座標なので、api.hookAt で現在の腕の姿勢へ変換する
  const HOOK = { A: new THREE.Vector3(0.36, 0.958, -0.515), V: new THREE.Vector3(0.37, 0.965, -0.505) };
  const api = { hookAt: null };
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
        new THREE.Vector3(-0.2, 0.884 + yo, -0.466 + zo), new THREE.Vector3(0.12, 0.884 + yo, -0.466 + zo), new THREE.Vector3(0.3, 0.9 + yo, -0.49 + zo), api.hookAt ? api.hookAt(HOOK[site], new THREE.Vector3()) : HOOK[site].clone());
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
  Object.assign(api, { update, reset, home: HOME, setFill: (site, p, fromEnd) => mats[site].userData.fill.set(p, fromEnd) });
  return api;
}
