// 患者モデル: 頭部〜肩は実写スキャンのバスト（Lee Perry-Smith head scan, Infinite-Realities, CC BY 3.0）+ 生成した髪、
// 手は WebXR generic-hand メッシュ + 爪、パジャマ姿の体幹と掛け布団、穿刺側（患者の右腕）の上腕・前腕はプロシージャル生成
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';
import * as C from './constants.js';
import { createVessel, AVF_ANASTOMOSIS } from './vessel.js';
import { loadHand } from './handmodel.js';

const UP = new THREE.Vector3(0, 1, 0);

function limb(start, end, profile, material, segments = 24) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const L = dir.length(); dir.normalize();
  const pts = profile.map(([t, r]) => new THREE.Vector2(r, t * L));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, segments), material);
  m.position.copy(start);
  m.quaternion.setFromUnitVectors(UP, dir);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function sphere(r, material, pos, scale) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), material);
  m.position.copy(pos);
  if (scale) m.scale.copy(scale);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function roundedBoxGeo(w, h, d, r, seg = 10) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const p = g.attributes.position, nrm = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = Math.max(0.0001, w / 2 - r), hy = Math.max(0.0001, h / 2 - r), hz = Math.max(0.0001, d / 2 - r);
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    c.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    v.sub(c);
    if (v.lengthSq() < 1e-12) v.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    v.normalize(); nrm.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(r).add(c); p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

export function buildPatient(scene, T, vesselType = 'avf', vesselOpts = {}) {
  const group = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T.skin, normalMap: T.skinNormal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.58, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffd9c8), clearcoat: 0.04, clearcoatRoughness: 0.5 });
  const nailMat = new THREE.MeshPhysicalMaterial({ color: 0xf2cfc4, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const pajama = new THREE.MeshStandardMaterial({ color: 0xffffff, map: T.pajama, roughness: 0.92 });
  const pajamaTrim = new THREE.MeshStandardMaterial({ color: 0xdfe9f3, roughness: 0.9 });
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.35 });

  // ---------- 頭部・首・肩（スキャンモデル）: 仰臥位。モデルの +y（頭頂）→ 世界 -x、+z（顔）→ 世界 +y
  const bustRoot = new THREE.Group();
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
  bustRoot.quaternion.setFromRotationMatrix(basis);
  bustRoot.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.10));
  bustRoot.position.set(-0.62, 1.0, -0.9);
  bustRoot.scale.setScalar(0.053);
  group.add(bustRoot);
  const texLoader = new THREE.TextureLoader();
  const col = texLoader.load('./assets/lps/col.jpg'); col.colorSpace = THREE.SRGBColorSpace;
  const nrm = texLoader.load('./assets/lps/normal.jpg');
  const bustMat = new THREE.MeshPhysicalMaterial({ map: col, normalMap: nrm, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.66, metalness: 0, sheen: 0.2, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffd9c8) });
  const ready = new Promise(resolve => {
    new GLTFLoader().load('./assets/lps/LeePerrySmith.glb', g => {
      g.scene.traverse(o => { if (o.isMesh) { o.material = bustMat; o.castShadow = true; o.receiveShadow = true; } });
      bustRoot.add(g.scene);
      resolve(g.scene);
    }, undefined, () => resolve(null));
  });
  const hairMat = new THREE.MeshStandardMaterial({ map: T.hair, alphaMap: T.hairAlpha, transparent: true, alphaTest: 0.35, roughness: 0.85, side: THREE.DoubleSide });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 40), hairMat);
  hair.position.set(-0.07, 1.93, 0.1);
  hair.scale.set(1.74, 2.14, 2.26);
  hair.castShadow = true;
  bustRoot.add(hair);

  // ---------- パジャマ姿の体幹（胸〜腹は掛け布団の下へ）: 肩幅〜胸郭〜腹部の断面が変わる仰臥位の胴体（背面はマットレスで平ら）
  const torso = buildTorso(pajama, pajamaTrim, buttonMat);
  group.add(torso.mesh);
  for (const o of torso.extras) group.add(o);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.013, 12, 40, Math.PI * 1.5), pajamaTrim);   // 襟（首の付け根を囲む）
  collar.position.set(-0.5, 1.0, -0.9); collar.rotation.y = Math.PI / 2; collar.rotation.z = Math.PI * 0.75; collar.castShadow = true; group.add(collar);
  // 奥側（患者の左腕）: パジャマの長袖のまま布団の下へ
  group.add(limb(new THREE.Vector3(-0.47, 0.93, -1.14), new THREE.Vector3(-0.1, C.BED_TOP + 0.06, -1.22), [[0, 0.065], [0.5, 0.06], [1, 0.058]], pajama));
  group.add(sphere(0.07, pajama, new THREE.Vector3(-0.47, 0.95, -1.12)));

  // ---------- 手前側（患者の右腕・穿刺側）
  const S = new THREE.Vector3(C.SHOULDER.x, C.SHOULDER.y, C.SHOULDER.z);
  const E = new THREE.Vector3(C.ELBOW_X, C.ARM_Y, C.ARM_Z);
  const W = new THREE.Vector3(C.WRIST_X, C.ARM_Y + C.WRIST_LIFT, C.ARM_Z);
  group.add(sphere(0.07, pajama, new THREE.Vector3(S.x + 0.01, S.y + 0.005, S.z - 0.01)));
  const upperArm = limb(S, E, [[0, 0.05], [0.3, 0.053], [0.75, 0.047], [1, 0.043]], skin);
  group.add(upperArm);
  group.add(limb(S, new THREE.Vector3().lerpVectors(S, E, 0.36), [[0, 0.064], [0.9, 0.06], [1, 0.062]], pajama));
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.012, 12, 32), pajama);
  cuff.position.lerpVectors(S, E, 0.36); cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3().subVectors(E, S).normalize());
  cuff.castShadow = true; group.add(cuff);
  group.add(sphere(0.044, skin, E, new THREE.Vector3(1.05, 1, 1)));
  // 前腕（肘から先）・手・血管・消毒痕は肘を支点に回転できるグループに入れる（シーツを敷くときに持ち上げる）。
  // 子はワールド座標で作ってから肘の位置を引く。回転 0 のときはワールド座標と一致するので、穿刺などの判定は腕を下ろした状態で行う
  const forearm = new THREE.Group(); forearm.position.copy(E); group.add(forearm);
  const inF = o => { o.position.sub(E); forearm.add(o); return o; };
  const prof = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push([t, C.forearmRadius(C.ELBOW_X + t * (C.WRIST_X - C.ELBOW_X))]); }
  const forearmMesh = inF(limb(E, W, prof, skin, 40));
  // 消毒された範囲の表示: 皮膚の表面を 0.4mm 外側になぞる透明なレイヤーに、綿で拭いた所だけ薄く色（濡れた艶）を描く
  const overlays = [];
  function makeOverlay(start, end, profile, parent, segs) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 1024, 256);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
    const m = limb(start, end, profile.map(([t, r]) => [t, r + 0.0005]), new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, roughness: 0.12, clearcoat: 0.8, clearcoatRoughness: 0.15, depthWrite: false }), segs);
    m.castShadow = false; m.receiveShadow = false; m.renderOrder = 3;
    if (parent === forearm) inF(m); else parent.add(m);
    const L = end.distanceTo(start);
    const o = { mesh: m, canvas, ctx, tex, L, data: null, xMin: Math.min(start.x, end.x), xMax: Math.max(start.x, end.x) };
    overlays.push(o);
    return o;
  }
  makeOverlay(E, W, prof, forearm, 40);
  makeOverlay(new THREE.Vector3().lerpVectors(S, E, 0.36), E, [[0, 0.052], [0.6, 0.047], [1, 0.0435]], group, 24);   // 上腕の露出部（袖口より遠位）
  const _lp = new THREE.Vector3();
  // ワールド座標 → (overlay, u, v)。LatheGeometry の頂点は (x·sinφ, y, x·cosφ)、u = φ/2π、v = y/L
  function overlayUV(p) {
    const o = overlays.find(o => p.x >= o.xMin - 0.01 && p.x <= o.xMax + 0.01) || overlays[0];
    o.mesh.updateMatrixWorld(true);
    o.mesh.worldToLocal(_lp.copy(p));
    const phi = Math.atan2(_lp.x, _lp.z);
    return { o, u: ((phi / (Math.PI * 2)) % 1 + 1) % 1, v: THREE.MathUtils.clamp(_lp.y / o.L, 0, 1) };
  }
  function api_markSwab(p, radius = 0.012) {
    const { o, u, v } = overlayUV(p);
    const c = o.ctx, cx = u * o.canvas.width, cy = v * o.canvas.height;
    const circ = 2 * Math.PI * 0.042;
    const rx = radius / circ * o.canvas.width, ry = radius / o.L * o.canvas.height;
    // 拭いた所は薄い琥珀色（消毒済みの目印として見やすく。重ね塗りで濃くなる）
    c.fillStyle = 'rgba(255,196,96,0.3)';
    for (const dx of [-o.canvas.width, 0, o.canvas.width]) { c.beginPath(); c.ellipse(cx + dx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
    o.tex.needsUpdate = true; o.data = null;
  }
  function api_isDisinfected(p) {
    const { o, u, v } = overlayUV(p);
    if (!o.data) o.data = o.ctx.getImageData(0, 0, o.canvas.width, o.canvas.height).data;
    const x = Math.min(o.canvas.width - 1, Math.floor(u * o.canvas.width)), y = Math.min(o.canvas.height - 1, Math.floor(v * o.canvas.height));
    return o.data[(y * o.canvas.width + x) * 4 + 3] > 40;
  }
  function api_clearDisinfect() { for (const o of overlays) { o.ctx.clearRect(0, 0, o.canvas.width, o.canvas.height); o.tex.needsUpdate = true; o.data = null; } }
  inF(sphere(0.033, skin, W, new THREE.Vector3(1, 0.85, 1.15)));
  inF(sphere(0.009, skin, new THREE.Vector3(W.x - 0.005, W.y - 0.012, W.z - 0.03)));

  // 手（右手・回外位。モデル座標: 指先 -z, 手の甲 +y, 母指 -x → 世界: 指先 +x, 手の甲 -y, 母指 +z（ユーザー側））
  const hand = loadHand('right', skin);
  hand.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0)));
  hand.group.position.set(W.x + 0.012, W.y - 0.006, W.z);
  hand.ready.then(h => {
    h.setCurl({ thumb: 0.35, index: 0.22, middle: 0.28, ring: 0.33, pinky: 0.4 });
    for (const [finger, bones] of Object.entries(h.bones)) {
      const tip = bones[bones.length - 1];
      const w = finger === 'thumb' ? 0.011 : finger === 'pinky' ? 0.008 : 0.0095;
      const nail = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), nailMat);
      nail.scale.set(w / 2, 0.0012, 0.0065); nail.position.set(0, 0.0035, 0.0055); nail.rotation.x = 0.15;
      tip.add(nail);
    }
  });
  inF(hand.group);

  const scar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.0008, 0.004), new THREE.MeshStandardMaterial({ color: 0xd49a8c, roughness: 0.5 }));
  { const a = AVF_ANASTOMOSIS, sp = C.armPoint(a.x, a.theta, -0.0003); scar.position.set(sp.x, sp.y, sp.z); scar.rotation.set(a.theta, 0.3, 0); }   // 吻合部の手術痕（血管モデルの吻合位置に合わせる）
  inF(scar);

  // ---------- 血管（AVF / AVG 切り替え可。AVF は深い血管モードあり）
  const api = { group, forearm, vessel: null, ready, hand, lift: 0, wrist: W.clone(), markSwab: api_markSwab, isDisinfected: api_isDisinfected, clearDisinfect: api_clearDisinfect };
  // 前腕の持ち上げ角（rad, 0 = ベッドに下ろした状態）。肘を支点に手首側が上がる
  api.setLift = a => { api.lift = a; forearm.rotation.z = a; };
  api.wristNow = out => forearm.localToWorld(out.set(W.x - E.x, W.y - E.y, W.z - E.z));   // 現在の手首位置（ワールド）
  function setVesselType(type, opts = {}) {
    if (api.vessel) { forearm.remove(api.vessel.group); group.remove(api.vessel.upperGroup); api.vessel.dispose(); }
    const vessel = createVessel(type, opts);
    inF(vessel.group); group.add(vessel.upperGroup);
    scar.visible = type === 'avf';
    api.vessel = vessel;
  }
  api.setVesselType = setVesselType;

  const hematoma = new THREE.Mesh(new THREE.SphereGeometry(0.025, 18, 12),
    new THREE.MeshStandardMaterial({ color: 0x5a2a52, transparent: true, opacity: 0.7, roughness: 0.5 }));
  hematoma.scale.set(1.5, 0.3, 1); hematoma.visible = false; forearm.add(hematoma);
  api.hematoma = hematoma;

  const cushion = new THREE.Mesh(roundedBoxGeo(1.05, C.CUSHION_H, 0.2, 0.012), new THREE.MeshPhysicalMaterial({ color: 0x8fb4d9, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 }));
  cushion.position.set(0.02, C.BED_TOP + C.CUSHION_H / 2, C.ARM_Z); cushion.receiveShadow = true; cushion.castShadow = true; group.add(cushion);

  const sheetPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.34, 20, 10), new THREE.MeshStandardMaterial({ map: T.drape, roughness: 0.95, side: THREE.DoubleSide }));
  {
    const p = sheetPlane.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.002 * Math.sin(p.getX(i) * 40) * Math.cos(p.getY(i) * 30));
    sheetPlane.geometry.computeVertexNormals();
  }
  sheetPlane.rotation.x = -Math.PI / 2; sheetPlane.rotation.z = 0.02;
  sheetPlane.position.set(0.1, C.BED_TOP + C.CUSHION_H + 0.003, C.ARM_Z - 0.01);
  sheetPlane.visible = false; sheetPlane.receiveShadow = true; group.add(sheetPlane);
  api.sheetPlane = sheetPlane;

  const blanket = buildBlanket(T);
  group.add(blanket.mesh);
  api.blanketY = blanket.heightAt;   // 掛け布団の表面高さ（範囲外は null）

  api.tourniquet = {
    pos: new THREE.Vector3().lerpVectors(S, E, 0.6),
    quat: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3().subVectors(E, S).normalize()),
    r: 0.05,
  };

  scene.add(group);
  setVesselType(vesselType, vesselOpts);
  return api;
}

// 仰臥位の胴体。x（頭→足）方向の各断面を超楕円（上側は丸い胸・腹、下側はマットレスに押されて平ら）で作り、
// 肩幅 → 大胸筋のふくらみ → 胸郭の下で細くなる → 腹部、と断面の幅・厚みを変える。パジャマの前立て・ボタンは表面に沿わせる
function buildTorso(pajama, trim, buttonMat) {
  const zc = -0.9, y0 = C.BED_TOP + 0.006;
  // [x, 半幅 hz, 上側の厚み Ht, 背面側の厚み Hb]
  const ST = [
    [-0.62, 0.11, 0.08, 0.03], [-0.56, 0.18, 0.115, 0.03], [-0.50, 0.225, 0.15, 0.035], [-0.41, 0.222, 0.165, 0.035], [-0.31, 0.207, 0.165, 0.035],
    [-0.21, 0.19, 0.15, 0.035], [-0.11, 0.18, 0.136, 0.03], [0.01, 0.175, 0.13, 0.03], [0.13, 0.18, 0.134, 0.03], [0.24, 0.172, 0.122, 0.03],
  ];
  const stationAt = x => {
    if (x <= ST[0][0]) return ST[0].slice(1);
    for (let i = 1; i < ST.length; i++) if (x <= ST[i][0]) {
      const a = ST[i - 1], b = ST[i], u = (x - a[0]) / (b[0] - a[0]), w = 0.5 - 0.5 * Math.cos(u * Math.PI);
      return [1, 2, 3].map(k => a[k] + (b[k] - a[k]) * w);
    }
    return ST[ST.length - 1].slice(1);
  };
  const NT = 2.3, NB = 3.6;   // 超楕円の指数（上: 丸い、下: 平ら）
  const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  // 断面上の点（phi: 0 = 母指側（+z）, π/2 = 上）
  const surf = (x, phi) => {
    const [hz, Ht, Hb] = stationAt(x);
    const c = Math.cos(phi), s = Math.sin(phi);
    const zr = hz * sgnPow(c, 2 / NT);
    let y = y0 + Hb + (s >= 0 ? Ht * Math.pow(s, 2 / NT) : -Hb * Math.pow(-s, 2 / NB));
    if (s > 0) {
      const g = (v, m, w) => Math.exp(-(((v - m) / w) ** 2));
      y += 0.011 * g(x, -0.36, 0.075) * (g(zr, 0.085, 0.055) + g(zr, -0.085, 0.055)) * s;       // 大胸筋のふくらみ
      y -= 0.004 * g(x, -0.33, 0.12) * g(zr, 0, 0.022) * s;                                        // 胸骨のくぼみ
      y += 0.0025 * Math.sin(phi * 9 + x * 31) * Math.sin(x * 23 + 1.3) * s;                        // 布のしわ
    }
    return [y, zc + zr];
  };
  // 表面の上側で z のずれが zr になる点の高さ（前立て・ボタン用）
  const topAt = (x, zr) => { const hz = stationAt(x)[0]; const phi = Math.acos(THREE.MathUtils.clamp(sgnPow(zr / hz, NT / 2), -1, 1)); return surf(x, phi)[0]; };
  const X0 = ST[0][0], X1 = ST[ST.length - 1][0], NX = 64, NP = 56;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const x = X0 + (X1 - X0) * i / NX;
    for (let j = 0; j <= NP; j++) {
      const phi = j / NP * Math.PI * 2;
      const [y, z] = surf(x, phi);
      pos.push(x, y, z); uv.push(x * 2.5, j / NP * 4);
    }
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NP; j++) {
    const a = i * (NP + 1) + j, b = a + NP + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);   // 外向き（法線が外を向く巻き順。裏面は描かれないので内側が透けない）
  }
  // 両端のふた
  for (const [i, flip] of [[0, false], [NX, true]]) {
    const x = X0 + (X1 - X0) * i / NX, cidx = pos.length / 3;
    pos.push(x, y0 + stationAt(x)[2], zc); uv.push(0, 0);
    for (let j = 0; j < NP; j++) { const a = i * (NP + 1) + j; if (flip) idx.push(cidx, a + 1, a); else idx.push(cidx, a, a + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, pajama); mesh.castShadow = true; mesh.receiveShadow = true;
  // 前立て（表面に沿う帯）とボタン
  const extras = [];
  {
    const n = 24, pp = [], ii = [];
    for (let i = 0; i <= n; i++) {
      const x = -0.48 + (0.36) * i / n;
      for (const zr of [-0.018, 0.018]) pp.push(x, topAt(x, zr) + 0.0025, zc + zr);
    }
    for (let i = 0; i < n; i++) { const a = i * 2; ii.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); g.setIndex(ii); g.computeVertexNormals();
    const placket = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: trim.color, roughness: 0.9, side: THREE.DoubleSide })); placket.receiveShadow = true;
    extras.push(placket);
    for (const x of [-0.42, -0.33, -0.24, -0.15]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.002, 16), buttonMat);
      b.position.set(x, topAt(x, 0) + 0.0038, zc); extras.push(b);
    }
  }
  return { mesh, extras, topAt };
}

function buildBlanket(T) {
  const X0 = -0.12, X1 = 1.17, Z0 = -1.43, Z1 = -0.63, NX = 100, NZ = 56, zc = -0.93;
  const pos = [], uv = [], idx = [];
  const h = (x, z) => {
    const torso = x < 0.25 ? 0.19 : 0.19 - 0.05 * Math.min(1, (x - 0.25) / 0.4);
    const wz = x < 0.25 ? 0.22 : 0.19;
    let v = torso * Math.exp(-(((z - zc) / wz) ** 4));
    if (x > 0.3) v += 0.02 * (Math.exp(-(((z - zc - 0.085) / 0.05) ** 2)) + Math.exp(-(((z - zc + 0.085) / 0.05) ** 2))) * Math.min(1, (x - 0.3) / 0.2);
    v += 0.07 * Math.exp(-(((x - 1.02) / 0.06) ** 2)) * Math.exp(-(((z - zc) / 0.16) ** 2));
    v *= Math.min(1, (X1 - x) / 0.08);
    v += 0.004 * Math.sin(x * 41 + z * 23) + 0.003 * Math.sin(z * 57 - x * 17) + 0.002 * Math.sin(x * 90);
    v += 0.012 * Math.exp(-(((x - X0) / 0.05) ** 2)) * Math.exp(-(((z - zc) / 0.3) ** 4));
    return Math.max(0.004, v);
  };
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = X0 + (X1 - X0) * i / NX, z = Z0 + (Z1 - Z0) * j / NZ;
    pos.push(x, C.BED_TOP + h(x, z), z); uv.push(i / NX * 6, j / NZ * 3);
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const blanket = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: T.blanket, roughness: 0.95, side: THREE.DoubleSide }));
  blanket.castShadow = true; blanket.receiveShadow = true;
  return { mesh: blanket, heightAt: (x, z) => (x >= X0 && x <= X1 && z >= Z0 && z <= Z1) ? C.BED_TOP + h(x, z) : null };
}
