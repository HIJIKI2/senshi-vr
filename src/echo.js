// エコーガイド下穿刺: 富士フイルム iViz air（10.1 インチ タブレット + ワイヤレス リニアプローブ L10-5）を模した
// プローブ・タブレットのモデルと、B モード画像のリアルタイム生成（GPU シェーダー）。
//
// 画像は「プローブの走査面で腕を切った断面」を物理的な見え方に寄せて合成する:
//  - 皮膚（高輝度の線）→ 皮下脂肪（低輝度 + 線状の隔壁）→ 筋膜（高輝度線）→ 筋（中等度輝度・羽状の筋線維）。
//    シミュレーターなので骨などの構造は描かず、設定された血管（静脈ネットワーク・動脈・吻合部）だけが構造として映る
//  - 血管: 内腔は無エコー、静脈壁は薄く、動脈は壁が厚く拍動する。静脈はプローブで圧迫すると扁平化。後方エコー増強・側方陰影。
//    径は走行に沿って変わる（狭窄部は細く映る）。線分の継ぎ目が輪として映らないよう、表面までの符号付き距離が最小の線分だけで内腔/壁を決める
//  - 針: 金属は高輝度の点（短軸）/ 線（長軸）+ 真下に伸びる黒い音響陰影。プラスチック外筒は 2 本の壁の線（短軸では輪）。ビームと直交するほど明瞭
//  - スペックル（軸方向に細かく横方向に粗い粒状）、深部減衰、プローブが皮膚から浮いた列は信号なし（空気）
//  - 押し込むと皮膚はレンズ面に密着したまま浅い組織が圧縮され（画像の上端は切れない）、静脈（伴走静脈も）は強く押すほど扁平化（軽い接触ではつぶれない）、
//    駆血で怒張した静脈はほとんどつぶれない、動脈はつぶれない
// 走査面: 幅 38mm（リニア）、深さ 30mm。プローブの原点 = 音響レンズ面の中心、+y = 持ち手方向、-y = ビーム方向、x = 横方向
import * as THREE from 'three';
import * as C from './constants.js';

const NSEG = 80;
export const PROBE_W = 0.038, IMG_DEPTH = 0.03;
export const PRESS_MAX = 0.005;   // レンズ面が皮膚に沈み込める最大量 [m]
// 静脈の扁平化は押し込みに対して非線形: 押し込みが PRESS_MAX の 50%（2.5mm）まではつぶれず、強く押すほどつぶれて最大で 70% 扁平化（駆血時は最大 10%）。
// 針先の確認（長軸）は軽い接触で、血管の同定（圧迫法）は強く押す、という使い分けができる
export const veinFlatten = (press, turgor = 0) => 0.7 * (t => t * t * (3 - 2 * t))(Math.min(1, Math.max(0, (press - 0.5) / 0.5))) * (1 - 0.85 * turgor);

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
function box(w, h, d, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; }
function rbox(w, h, d, r, m, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 6, 6), p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = Math.max(1e-4, w / 2 - r), hy = Math.max(1e-4, h / 2 - r), hz = Math.max(1e-4, d / 2 - r);
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    c.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    v.sub(c); if (v.lengthSq() < 1e-12) v.set(n.getX(i), n.getY(i), n.getZ(i));
    v.normalize(); n.setXYZ(i, v.x, v.y, v.z); v.multiplyScalar(r).add(c); p.setXYZ(i, v.x, v.y, v.z);
  }
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o;
}
function textTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------------------------------------------------------------- プローブ（富士フイルム iViz air リニアプローブ FWTL10-5 の製品写真を参考）
// 形: 黒いグラファイト調の本体。先端のヘッドは幅広（58mm）で薄く（8mm）、握りは細く（40mm 幅・14mm 厚）、下端は丸い。全長 約 165mm。
// 前面（親指側）: ヘッドに「10-5」の表示と白い▼のセンターマーク、握りに縦長の親指の溝、丸いくぼみ、電源・フリーズの 2 つの丸ボタン、
// バッテリー LED、FUJIFILM ロゴ、無線マーク。センターマークはヘッドの前面・背面と両側面の中央にあり、走査面の中心（画像の中央の▼）を示す。
// エコー下穿刺ではこのマークに針を合わせる（短軸: マークの位置で刺すと針が画像の中央に出る。長軸: マークの面に沿って刺す）
// 原点 = 音響レンズ面の中心、+y = 持ち手方向、x = 走査面の横方向（幅、+x = 画面の F マーク側）、z = 厚み方向（+z = 前面）
export function makeProbe() {
  const g = new THREE.Group();
  const body = std(0x24262a, { roughness: 0.55 });
  const bodyL = std(0x3a3d43, { roughness: 0.5 });
  const lensM = std(0x9ea3aa, { roughness: 0.3 });
  const white = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
  const extrude = (shape, depth, bevel, m) => {
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 14 }), m);
    mesh.position.z = -depth / 2; mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
  };
  // ヘッド（先端部）: 幅 58mm → 握りの幅 40mm へ曲線ですぼまる。厚さ 19mm
  const hs = new THREE.Shape();
  hs.moveTo(-0.026, 0.002); hs.lineTo(0.026, 0.002); hs.lineTo(0.026, 0.024);
  hs.bezierCurveTo(0.026, 0.04, 0.017, 0.044, 0.017, 0.06); hs.lineTo(-0.017, 0.06);
  hs.bezierCurveTo(-0.017, 0.044, -0.026, 0.04, -0.026, 0.024); hs.closePath();
  g.add(extrude(hs, 0.005, 0.0015, body));                                    // ヘッドの厚み 8mm
  // 握り: 幅 40mm、厚さ 28mm、下端は丸い
  const gs = new THREE.Shape(); const hw = 0.017, y0 = 0.05, y1 = 0.165, r = 0.015;
  gs.moveTo(-hw, y0); gs.lineTo(hw, y0); gs.lineTo(hw, y1 - r); gs.quadraticCurveTo(hw, y1, hw - r, y1); gs.lineTo(-hw + r, y1); gs.quadraticCurveTo(-hw, y1, -hw, y1 - r); gs.closePath();
  g.add(extrude(gs, 0.011, 0.0015, body));                                    // 握りの厚み 14mm
  // 音響レンズ（先端の少し明るいグレーの面）
  g.add(rbox(0.05, 0.004, 0.007, 0.001, lensM, 0, 0.001, 0));
  // センターマーク ▼（白）: 前面・背面はヘッドの下端中央で下（レンズ面）を指す。両側面は細い縦線
  const tri = new THREE.Shape(); tri.moveTo(-0.0035, 0.0145); tri.lineTo(0.0035, 0.0145); tri.lineTo(0, 0.006); tri.closePath();
  for (const sz of [1, -1]) { const m = new THREE.Mesh(new THREE.ShapeGeometry(tri), white); m.position.z = sz * 0.0041; if (sz < 0) m.rotation.y = Math.PI; g.add(m); }
  for (const sx of [1, -1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.0014, 0.008), white); m.position.set(sx * 0.0276, 0.011, 0); m.rotation.y = sx * Math.PI / 2; g.add(m); }   // 側面（ベベル込みの外側 x = ±0.0275）に密着
  // 向きのマーク（+x 側）: ヘッド側面の小さな突起 = 画面の F マーク側
  g.add(rbox(0.004, 0.008, 0.006, 0.001, bodyL, 0.0275, 0.02, 0));           // 側面に半分食い込ませて密着（浮かない）
  // 「10-5」の表示（ヘッド前面の右上）
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.0065), new THREE.MeshBasicMaterial({ map: textTex(256, 92, (c, w, h) => { c.fillStyle = '#24262a'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8e8e8'; c.font = 'bold 60px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('10-5', w / 2 + 10, h / 2); c.beginPath(); c.moveTo(22, 20); c.lineTo(40, 20); c.lineTo(31, 70); c.closePath(); c.fill(); }) }));
  label.position.set(0.012, 0.03, 0.0041); g.add(label);
  // 前面の造形（握り前面 z = +0.014）: 親指の縦溝、丸いくぼみ、電源・フリーズボタン、LED、ロゴ、無線マーク
  g.add(rbox(0.011, 0.03, 0.004, 0.003, bodyL, 0, 0.082, 0.0065));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 20), bodyL).rotateX(Math.PI / 2).translateY(0.0075).translateZ(-0.104));
  const icon = (txt, y) => {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.002, 20), bodyL); btn.rotation.x = Math.PI / 2; btn.position.set(0, y, 0.0075); g.add(btn);
    if (txt === '⏯') g.userData.freezeBtn = btn;   // フリーズ／解除のボタン（指で押せる物理ボタンとして app 側で登録）
    const ic = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.006), new THREE.MeshBasicMaterial({ map: textTex(64, 64, (c, w, h) => { c.fillStyle = '#3a3d43'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8e8e8'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, h / 2 + 2); }) }));
    ic.position.set(0, y, 0.0086); g.add(ic);
  };
  icon('⏻', 0.117); icon('⏯', 0.129);
  for (let i = 0; i < 3; i++) g.add(new THREE.Mesh(new THREE.CircleGeometry(0.0007, 8), new THREE.MeshBasicMaterial({ color: i === 0 ? 0x3ad17a : 0x6a6e75 })).translateX(-0.004 + i * 0.003).translateY(0.1385).translateZ(0.0072));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.0035, 0.0018), new THREE.MeshBasicMaterial({ color: 0xbfc3c8 })).translateX(0.006).translateY(0.1385).translateZ(0.0072));   // 電池マーク
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.022, 0.0042), new THREE.MeshBasicMaterial({ map: textTex(256, 50, (c, w, h) => { c.fillStyle = '#24262a'; c.fillRect(0, 0, w, h); c.fillStyle = '#d8dbe0'; c.font = 'bold 36px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('FUJIFILM', w / 2, h / 2); }) }));
  logo.position.set(0, 0.147, 0.0072); g.add(logo);
  const wifi = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.005), new THREE.MeshBasicMaterial({ map: textTex(96, 60, (c, w, h) => { c.fillStyle = '#24262a'; c.fillRect(0, 0, w, h); c.fillStyle = '#d8dbe0'; c.font = 'bold 34px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('T·))', w / 2, h / 2); }) }));
  wifi.position.set(0, 0.156, 0.0072); g.add(wifi);
  return g;
}
// プローブ立てとゼリー
export function makeProbeHolder() {
  const g = new THREE.Group();
  const m = std(0xd9dde2, { metalness: 0.8, roughness: 0.3 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 24, 1, true), m).translateY(0.025));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(0.034, 24), m).rotateX(-Math.PI / 2).translateZ(0.001));
  const gel = new THREE.Group(); gel.position.set(0.085, 0, 0);
  gel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.11, 20), std(0xeaf4ff, { transparent: true, opacity: 0.8, roughness: 0.3 })).translateY(0.055));
  gel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.03, 12), std(0x3a7bd5)).translateY(0.125));
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.04), new THREE.MeshBasicMaterial({ map: textTex(128, 170, (c, w, h) => { c.fillStyle = '#3a7bd5'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('エコー', w / 2, 60); c.fillText('ゼリー', w / 2, 105); }) }));
  lab.position.set(0, 0.06, 0.0235); gel.add(lab);
  g.add(gel);
  return g;
}

// ---------------------------------------------------------------- B モード画像のシェーダー
const VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec3 uO, uX, uD;                 // レンズ面中心、横方向、ビーム方向（単位ベクトル）
uniform float uW, uDepth, uTime, uPulse, uGain, uTurgor;   // uTurgor: 駆血による静脈の怒張 0..1（怒張した静脈は圧迫してもほとんどつぶれない）
uniform int uN;
uniform vec4 uSegA[${NSEG}];             // 血管線分 始点 xyz, 始点半径
uniform vec4 uSegB[${NSEG}];             // 終点 xyz, 種類 (0 静脈, 1 動脈, 2 グラフト) + 終点半径×10（小数部）
uniform vec4 uNdlA[4];                   // 針線分 始点 xyz, 輝度 (0 = なし)
uniform vec4 uNdlB[4];                   // 終点 xyz, 半径
uniform vec4 uArmA[2];                   // 腕の軸 始点 xyz, 半径   [0] 前腕 (肘→手首)  [1] 上腕 (肩→肘)
uniform vec4 uArmB[2];                   // 終点 xyz, 半径
uniform float uElbowX;

float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
// 点と線分の距離（最近点も返す）
float segDist(vec3 p, vec3 a, vec3 b, out vec3 q, out float t){ vec3 ab = b - a; t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0); q = a + ab * t; return length(p - q); }
// ビーム線 (F + s·D) と線分 ab の最短距離。s = ビーム上の深さ、lat = 横ずれ
void beamSeg(vec3 F, vec3 D, vec3 a, vec3 b, out float s, out float lat){
  vec3 ab = b - a, w = F - a; float A = dot(ab, ab), B = dot(ab, D), Cc = 1.0, Dd = dot(ab, w), E = dot(D, w);
  float den = A * Cc - B * B; float t = (den > 1e-9) ? clamp((Cc * Dd - B * E) / den, 0.0, 1.0) : 0.0;
  s = dot(a + ab * t - F, D); vec3 q = a + ab * t; lat = length((q - F) - D * s);
}
// 針用: 線分パラメータ t をクランプせずに返す（t > 1 は針先より先 = 何も描かない。先端を丸く閉じない）
void beamSegT(vec3 F, vec3 D, vec3 a, vec3 b, out float s, out float lat, out float t){
  vec3 ab = b - a, w = F - a; float A = dot(ab, ab), B = dot(ab, D), Dd = dot(ab, w), E = dot(D, w);
  float den = A - B * B; t = (den > 1e-9) ? (Dd - B * E) / den : 0.0;
  float tc = clamp(t, 0.0, 1.0);
  s = dot(a + ab * tc - F, D); vec3 q = a + ab * tc; lat = length((q - F) - D * s);
}
// 腕の軸までの距離と局所半径（前腕/上腕）。半径は constants.js の forearmRadius / armAt と同じ式
float armDepth(vec3 p, out vec3 axisPt, out float rr){
  int k = (p.x >= uElbowX) ? 0 : 1;
  vec3 a = (k == 0) ? uArmA[0].xyz : uArmA[1].xyz, b = (k == 0) ? uArmB[0].xyz : uArmB[1].xyz;
  vec3 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  axisPt = a + ab * t;
  if (k == 0) rr = uArmA[0].w * (1.0 + 0.05 * sin(t * 3.14159265)) - 0.010 * t * t;          // 前腕: 肘 0.045 → 手首 0.035（わずかに膨らむ）
  else { float tu = 1.0 - t; rr = 0.043 + 0.007 * tu + 0.004 * sin(3.14159265 * tu); }       // 上腕: 肘 0.043 → 肩側 0.05
  return rr - length(p - axisPt);            // 正 = 皮膚の内側
}
void main(){
  float u = (vUv.x - 0.5) * uW;              // 横位置 [m]
  float d = (1.0 - vUv.y) * uDepth;          // 深さ [m]
  vec3 F = uO + uX * u;                      // この列のレンズ面上の点
  vec3 P = F + uD * d;
  // --- 列ごとの皮膚位置（レンズ面から皮膚までの距離 t0。負 = 押し込み）
  vec3 ax; float rr; float sDummy = armDepth(F, ax, rr);
  vec3 n = normalize((F.x >= uElbowX) ? (uArmB[0].xyz - uArmA[0].xyz) : (uArmB[1].xyz - uArmA[1].xyz));
  vec3 w = F - ax; vec3 wp = w - n * dot(w, n); vec3 dp = uD - n * dot(uD, n);
  float qa = dot(dp, dp), qb = dot(wp, dp), qc = dot(wp, wp) - rr * rr;
  float disc = qb * qb - qa * qc;
  float t0 = 1.0; bool hit = false;
  if (disc > 0.0 && qa > 1e-6) { t0 = (-qb - sqrt(disc)) / qa; hit = true; }
  // 皮膚から浮いている列（ゼリーで 2mm 程度までは届く）: 信号なし + ノイズ、面の多重反射。密着していなければ何も映らない
  float gapW = hit ? (1.0 - smoothstep(0.0012, 0.003, t0)) : 0.0;
  if (gapW <= 0.001) {
    float nz = hash(vec3(vUv * 400.0, floor(uTime * 20.0))) * 0.06;
    float rev = (d < 0.004) ? 0.25 * exp(-d * 600.0) * (0.5 + 0.5 * cos(d * 6283.0 / 0.0009)) : 0.0;
    gl_FragColor = vec4(vec3(nz + rev), 1.0); return;
  }
  float pin = clamp(-t0, 0.0, ${PRESS_MAX});   // 押し込み量 [m]
  float press = pin / ${PRESS_MAX};             // 圧迫の強さ 0..1
  // --- 組織の圧縮: 押し込んでも皮膚はレンズ面に密着したまま（画像の上端が切れない）。浅い組織ほど詰まり、深部は動かない
  //     画像の深さ d に映る組織 = 元の深さ d + pin·(1 - e^{-d/12mm})。ワールド座標ではレンズ面から d - pin·e^{-d/12mm}
  float dTrue = d - pin * exp(-d / 0.012);   // この画素に映る組織の真の深さ（押し込みで浅い組織が詰まる）
  vec3 Pt = F + uD * dTrue;
  // --- 組織（皮膚からの深さ s）
  float s = armDepth(Pt, ax, rr);
  float b = 0.0;
  if (abs(s) < 0.0005) b = 0.9;                                                  // 皮膚表面の高輝度線
  else if (s < 0.0) b = 0.02;
  else {
    float fatD = 0.0055 + 0.0018 * vnoise(vec3(Pt.x * 60.0, Pt.z * 60.0, 1.0)) + 0.001 * sin(Pt.x * 45.0);
    if (s < 0.0013) b = 0.55 + 0.15 * vnoise(Pt * 2500.0);                      // 真皮
    else if (s < fatD) {                                                         // 皮下脂肪: 低輝度 + 途切れた細い隔壁（皮膚にほぼ平行）
      float sept = fract((s - 0.0013) / 0.0026 + 0.7 * vnoise(vec3(Pt.x * 150.0, Pt.z * 150.0, 3.0)) + 0.1 * sin(Pt.x * 90.0 + Pt.z * 70.0));
      float brk = vnoise(vec3(Pt.x * 380.0, Pt.y * 380.0, Pt.z * 380.0) + 11.0);
      b = 0.14 + 0.08 * vnoise(Pt * 1800.0);
      if (sept < 0.1 && brk > 0.5) b = 0.34 + 0.3 * vnoise(Pt * 900.0) * (brk - 0.4);
    } else if (abs(s - fatD) < 0.0004) b = 0.5 + 0.3 * vnoise(vec3(Pt.x * 200.0, Pt.z * 200.0, 5.0));   // 筋膜（途切れ気味）
    else {                                                                       // 筋: 筋線維（腕の長軸方向）の羽状テクスチャ
      float fib = vnoise(vec3(Pt.x * 70.0, Pt.y * 1400.0, Pt.z * 1400.0));
      float fib2 = vnoise(vec3(Pt.x * 25.0, Pt.y * 600.0, Pt.z * 600.0) + 7.0);
      b = 0.2 + 0.18 * fib + 0.1 * fib2;
    }
    // 深さで減衰（TGC 後も深部はやや暗い）。表層 1.5mm は近距離音場でやや明るい
    b *= (1.0 - 0.28 * d / uDepth) * (1.0 + 0.25 * exp(-d / 0.0015));
  }
  // --- 血管: 走査面の近くの線分（CPU 側で選別）について、表面までの符号付き距離が最小の線分だけで内腔/壁を決める
  //     （隣接線分の端の球面が内腔の中に「輪」として映らない）。半径は線分内で線形補間（狭窄部は細く映る）
  float enh = 1.0, sdMin = 1.0, kMin = 0.0, specMin = 0.0;
  for (int i = 0; i < ${NSEG}; i++) {
    if (i >= uN) break;
    vec3 a = uSegA[i].xyz, bb = uSegB[i].xyz; float rA = uSegA[i].w; float kind = floor(uSegB[i].w + 0.001); float rB = (uSegB[i].w - kind) * 0.1;
    vec3 q; float tt; float dist = segDist(Pt, a, bb, q, tt);
    float r = mix(rA, rB, tt);
    if (dist > r + 0.004) {                                                      // 遠いが、同じ列の上に血管があれば後方増強/側方陰影（滑らかに）
      float sv, lv; beamSeg(F, uD, a, bb, sv, lv);
      float rm = 0.5 * (rA + rB);
      if (d > sv + rm * 0.5 && sv > 0.0) {
        float wIn = 1.0 - smoothstep(rm * 0.6, rm * 1.05, lv);
        float fade = exp(-(d - sv) / 0.012);
        enh = max(enh, 1.0 + 0.32 * wIn * fade);
        float wEdge = 1.0 - smoothstep(0.0, 0.0007, abs(lv - rm * 1.02));
        enh = min(enh, 1.0 - 0.3 * wEdge * fade);
      }
      continue;
    }
    float rEff = r;
    if (kind > 0.5 && kind < 1.5) rEff *= 1.0 + 0.1 * uPulse;                   // 動脈の拍動
    vec3 v = Pt - q; float vd = dot(v, uD); vec3 vl = v - uD * vd;
    float comp = (kind < 0.5) ? (1.0 - 0.7 * smoothstep(0.5, 1.0, press) * (1.0 - 0.85 * uTurgor)) : 1.0;   // 静脈の圧迫（軽い接触ではつぶれず、強く押すほど扁平化。駆血で怒張しているとほぼつぶれない）
    float de = sqrt(dot(vl, vl) + (vd / comp) * (vd / comp));
    float sd = de - rEff;
    if (sd < sdMin) { sdMin = sd; kMin = kind; specMin = abs(vd) / max(de, 1e-6); }
  }
  if (sdMin < 0.01) {
    bool art = kMin > 0.5 && kMin < 1.5, grf = kMin > 1.5;
    if (grf) {
      // PTFE グラフトの壁（double-track sign）: 内側と外側の 2 本の高輝度線に挟まれたやや暗い層（壁厚 約 0.9mm）。自己血管の薄い壁との違いが吻合部で分かる
      if (sdMin < 0.0) b = 0.012 + 0.02 * vnoise(Pt * 1500.0 + vec3(0.0, uTime * 0.6, 0.0));
      else if (sdMin < 0.0011) {
        float spec = 0.5 + 0.5 * specMin;
        float l1 = 1.0 - smoothstep(0.0, 0.00024, abs(sdMin - 0.00012)), l2 = 1.0 - smoothstep(0.0, 0.00024, abs(sdMin - 0.00088));
        b = max(b, spec * max(0.95 * max(l1, l2), 0.28));
      }
    } else {
      float wallT = art ? 0.0006 : 0.00035;
      float wallB = art ? 0.8 : 0.5;
      if (sdMin < -wallT * 0.5) { b = 0.012 + 0.03 * vnoise(Pt * 1500.0 + vec3(0.0, uTime * 0.6, 0.0)); if (!art) b += 0.015 * vnoise(Pt * 900.0 + uTime * 0.3); }   // 内腔（静脈はわずかな流動エコー）
      else if (sdMin < wallT) { float spec = 0.4 + 0.6 * specMin; float edge = 1.0 - smoothstep(wallT * 0.6, wallT, sdMin); b = max(b, wallB * spec * edge); }   // 壁（前後壁が明るい）
    }
  }
  b *= enh;
  // --- 針: 金属は高輝度の本体（短軸では点、長軸では細い線）と、その真下に伸びる針の幅の黒い音響陰影（深くなるにつれ徐々に薄れる）。
  //     多重反射はごく弱く針のすぐ後ろだけ。プラスチックの外筒（半径を負で渡す）は前壁・後壁が 2 本の線（短軸では輪）として
  //     金属より暗く映り、内腔は暗く、陰影はごく弱い。ビームと直交するほど明瞭で、急角度では弱い
  //     先端: 金属針は刃面（ベベル、約 2.5mm）で先細りに尖る。プラスチック外筒は先端が開いていて（丸く閉じない）、先端 1.5mm だけ少しすぼまる。
  //     スライス厚（ビームの厚み）は約 ±2.5mm あるので、走査面に完全に入る少し前から針が映り始める
  float nb = 0.0, nshadow = 1.0, nlumen = 1.0;
  for (int i = 0; i < 4; i++) {
    float inten = uNdlA[i].w; if (inten <= 0.0) continue;
    vec3 a = uNdlA[i].xyz, bb = uNdlB[i].xyz; float rw = uNdlB[i].w; bool hollow = rw < 0.0; float r = abs(rw);
    float sn, ln, tn; beamSegT(F, uD, a, bb, sn, ln, tn);
    float L = length(bb - a);
    if (tn > 1.0 || tn < 0.0) continue;                                          // 針の先より先（ハブより手前）には何もない = 先端は閉じない
    float lw = r * 1.3 + 0.0015;                                                 // スライス厚（横方向に見える幅: 半幅 約 2.5mm）
    if (ln > lw + r) continue;
    vec3 nd = normalize(bb - a);
    float ang = 1.0 - abs(dot(nd, uD));                                          // 1 = 直交
    float vis = inten * clamp((ang - 0.2) / 0.5, 0.3, 1.0);
    float latW = 1.0 - smoothstep(r * 0.8, lw, ln);                              // 横方向の重み（針の真下ほど強い）
    float dz = dTrue - sn;   // 針も組織と一緒に圧縮方向へ動いて見える（血管だけつぶれて針が外に出たように見えない）
    float toTip = (1.0 - tn) * L;                                                // 針先までの距離
    float rEff = hollow ? r * (0.6 + 0.4 * clamp(toTip / 0.0015, 0.0, 1.0)) : r * clamp(toTip / 0.0025, 0.08, 1.0);   // 先細り（金属: ベベル、外筒: わずか）
    float dist = length(vec2(min(ln, lw), dz));
    if (hollow) {
      float wall = 1.0 - smoothstep(0.00022, 0.00045, abs(dist - rEff));
      if (wall > 0.0) nb = max(nb, 0.8 * vis * wall * latW * (0.85 + 0.15 * hash(vec3(u * 2500.0, d * 2500.0, 2.0))));
      else if (dist < rEff) nlumen = min(nlumen, 0.2);
      if (dz > r && ln < r) nshadow = min(nshadow, 1.0 - 0.22 * vis * exp(-(dz - r) / 0.02));
    } else {
      float core = 1.0 - smoothstep(rEff * 0.5, rEff * 0.95 + 0.00005, dist);
      if (core > 0.0) nb = max(nb, 1.6 * vis * core * max(latW, 0.35) * (0.9 + 0.1 * hash(vec3(u * 3000.0, d * 3000.0, 1.0))));
      else if (dz > 0.0 && latW > 0.0) {
        nshadow = min(nshadow, 1.0 - 0.92 * vis * latW * exp(-dz / 0.05));     // 音響陰影（黒い帯）
        float period = max(2.0 * r, 0.0009);
        nb = max(nb, 0.2 * vis * latW * exp(-dz / 0.0028) * pow(0.5 + 0.5 * cos(6.2831853 * dz / period), 3.0));   // 弱い多重反射
      }
    }
  }
  b *= nshadow * nlumen;
  if (nb > 0.0) b = max(b, nb);
  // --- スペックル（軸方向に細かく、横方向に粗い。2 オクターブ）とゲイン
  vec2 sc = vec2(dot(Pt, uX) / 0.0009, dot(Pt, uD) / 0.00032);
  float spk = 0.65 * vnoise(vec3(sc, uTime * 0.7)) + 0.35 * vnoise(vec3(sc * 2.3, uTime * 0.9 + 3.0));
  spk = 0.36 + 1.3 * spk * spk;
  spk *= 0.74 + 0.52 * hash(floor(vec3(sc * 2.2, floor(uTime * 12.0))));         // 細かい粒状（やや強め）
  if (nb > 0.3) spk = mix(spk, 1.0, 0.7);
  b *= spk * gapW;
  b *= 1.0 - 0.15 * pow(abs(vUv.x - 0.5) * 2.0, 4.0);                           // 画像端はわずかに暗い
  // 対数圧縮（実機のダイナミックレンジ圧縮に相当: 低輝度の組織が持ち上がり、高輝度は飽和に近づく）
  float lin = clamp(b * uGain * 0.6, 0.0, 1.2);
  b = log(1.0 + 24.0 * lin) / log(25.0);
  gl_FragColor = vec4(vec3(clamp(b, 0.0, 1.0)), 1.0);
}`;

// ---------------------------------------------------------------- タブレット（10.1 インチ、横置き）と画像生成
export function createEcho(renderer, T) {
  const api = {};
  // ---- レンダーターゲットと走査面シェーダー
  const RT_W = 320, RT_H = Math.round(320 * IMG_DEPTH / PROBE_W);   // 低めの解像度 + 線形補間で少しぼけた実機らしい画質
  const rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const z4 = n => Array.from({ length: n }, () => new THREE.Vector4());
  const uniforms = {
    uO: { value: new THREE.Vector3() }, uX: { value: new THREE.Vector3(1, 0, 0) }, uD: { value: new THREE.Vector3(0, -1, 0) },
    uW: { value: PROBE_W }, uDepth: { value: IMG_DEPTH }, uTime: { value: 0 }, uPulse: { value: 0 }, uGain: { value: 1.0 }, uTurgor: { value: 0 },
    uN: { value: 0 }, uSegA: { value: z4(NSEG) }, uSegB: { value: z4(NSEG) },
    uNdlA: { value: z4(4) }, uNdlB: { value: z4(4) },
    uArmA: { value: z4(2) }, uArmB: { value: z4(2) }, uElbowX: { value: C.ELBOW_X },
  };
  {
    const e = C.armAt(C.ELBOW_X), wv = C.armAt(C.WRIST_X), s = C.armAt(C.ARM_X_MIN - 0.2);
    uniforms.uArmA.value[0].set(C.ELBOW_X, e.y, e.z, e.r); uniforms.uArmB.value[0].set(C.WRIST_X, wv.y, wv.z, wv.r);
    uniforms.uArmA.value[1].set(C.ARM_X_MIN - 0.2, s.y, s.z, s.r); uniforms.uArmB.value[1].set(C.ELBOW_X, e.y, e.z, e.r);
  }
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, depthTest: false, depthWrite: false })));

  // ---- タブレット本体（約 250×165×9mm, 黒ベゼル）。画面 = UI キャンバス + B モード画像 + 計測オーバーレイ
  const tablet = new THREE.Group();
  tablet.add(rbox(0.252, 0.168, 0.009, 0.004, std(0x1d1f22, { roughness: 0.4 })));
  tablet.add(box(0.246, 0.162, 0.001, std(0x0a0b0c, { roughness: 0.2 }), 0, 0, 0.0045));   // ガラス面（この上に画面を重ねる）
  const SW = 0.218, SH = 0.136;   // 表示領域 10.1 インチ 16:10
  const ui = document.createElement('canvas'); ui.width = 1280; ui.height = 800;
  const uic = ui.getContext('2d');
  const uiTex = new THREE.CanvasTexture(ui); uiTex.colorSpace = THREE.SRGBColorSpace; uiTex.anisotropy = 8;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: uiTex })); screen.position.z = 0.0054; tablet.add(screen);
  // B モード画像の領域（画面内の px）: 幅 38mm : 深さ 30mm
  const IMG = { x: 300, y: 64, h: 676 }; IMG.w = Math.round(IMG.h * PROBE_W / IMG_DEPTH);
  const img = new THREE.Mesh(new THREE.PlaneGeometry(IMG.w / 1280 * SW, IMG.h / 800 * SH), new THREE.MeshBasicMaterial({ map: rt.texture }));
  img.position.set(((IMG.x + IMG.w / 2) / 1280 - 0.5) * SW, (0.5 - (IMG.y + IMG.h / 2) / 800) * SH, 0.0057); tablet.add(img);
  const ov = document.createElement('canvas'); ov.width = 1024; ov.height = Math.round(1024 * IMG.h / IMG.w);
  const ovc = ov.getContext('2d');
  const ovTex = new THREE.CanvasTexture(ov); ovTex.colorSpace = THREE.SRGBColorSpace;
  const overlay = new THREE.Mesh(img.geometry, new THREE.MeshBasicMaterial({ map: ovTex, transparent: true })); overlay.position.copy(img.position); overlay.position.z += 0.0003; tablet.add(overlay);
  screen.renderOrder = 1; img.renderOrder = 2; overlay.renderOrder = 3;
  api.tablet = tablet;

  const state = { active: false, contact: false, press: 0, turgor: 0, centerVein: null, depthMm: 0, diaMm: 0, frozen: false };
  function drawUI() {
    const c = uic, W = ui.width, H = ui.height;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#121416'; c.fillRect(0, 0, W, 56);                                         // 上バー
    c.fillStyle = '#2b2e33'; c.fillRect(0, 56, 258, H - 56 - 60);                               // 左サイドバー
    c.fillStyle = '#121416'; c.fillRect(0, H - 60, W, 60);                                      // 下バー
    c.textBaseline = 'middle'; c.fillStyle = '#e8eaed'; c.font = '26px sans-serif'; c.textAlign = 'left';
    // 上バー: バッテリー/無線/プローブ電池、時刻、患者、プリセット
    c.strokeStyle = '#cfd3d8'; c.lineWidth = 3; c.strokeRect(24, 18, 34, 20); c.fillRect(30, 22, 18, 12); c.fillRect(58, 24, 4, 8);
    c.beginPath(); c.arc(90, 36, 8, Math.PI * 1.2, Math.PI * 1.8); c.stroke(); c.beginPath(); c.arc(90, 36, 15, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
    c.strokeRect(118, 18, 34, 20); c.fillRect(124, 22, 24, 12);
    c.fillText(new Date().toTimeString().slice(0, 5), 172, 29);
    c.fillText('00001  透析 患者', 260, 29);
    c.textAlign = 'right'; c.fillText('Venous', W - 90, 29); c.font = 'bold 30px sans-serif'; c.fillText('≡', W - 30, 28);
    c.font = '22px sans-serif'; c.fillText('⎯⎯', W - 170, 28);
    // サイドバー: プローブ/モード、Freeze、計測値
    c.textAlign = 'left'; c.fillStyle = '#3a3e45'; c.fillRect(30, 90, 90, 54); c.fillRect(140, 90, 90, 54);
    c.fillStyle = '#e8eaed'; c.font = 'bold 26px sans-serif'; c.fillText('L', 62, 117);
    c.fillStyle = '#39c46a'; c.fillRect(140, 90, 90, 54); c.fillStyle = '#0d2b18'; c.font = 'bold 20px sans-serif'; c.fillText('PV穿刺', 152, 117);
    c.strokeStyle = state.frozen ? '#39c46a' : '#8fe3b0'; c.lineWidth = 5; c.beginPath(); c.arc(129, 300, 62, 0, Math.PI * 2); c.stroke();
    if (state.frozen) { c.fillStyle = '#39c46a'; c.fillRect(110, 286, 10, 28); c.fillRect(138, 286, 10, 28); }                 // フリーズ中: 一時停止マーク
    else { c.fillStyle = '#e8eaed'; c.beginPath(); c.moveTo(116, 284); c.lineTo(148, 300); c.lineTo(116, 316); c.closePath(); c.fill(); }   // 動作中: 再生マーク（右向きの三角）
    c.fillStyle = state.frozen ? '#39c46a' : '#9aa0a8'; c.font = state.frozen ? 'bold 20px sans-serif' : '20px sans-serif'; c.fillText(state.frozen ? 'Freeze' : 'Live', state.frozen ? 100 : 112, 395);
    c.fillStyle = '#e8eaed'; c.font = '22px sans-serif'; c.fillText('⌖ Depth to center', 28, 560);
    c.font = 'bold 32px sans-serif'; c.textAlign = 'right'; c.fillText(state.centerVein ? `${state.depthMm.toFixed(1)} mm` : '--', 230, 600);
    c.textAlign = 'left'; c.font = '22px sans-serif'; c.fillText('⊖ Diameter', 28, 650);
    c.font = 'bold 32px sans-serif'; c.textAlign = 'right'; c.fillText(state.centerVein ? `${state.diaMm.toFixed(1)} mm` : '--', 230, 690);
    // 画像周辺: プローブ名、センターライン、F マーク、深度目盛
    c.textAlign = 'left'; c.fillStyle = '#e8eaed'; c.font = '26px sans-serif'; c.fillText('L10-5', IMG.x + 10, IMG.y + 26);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(IMG.x + IMG.w / 2 - 10, IMG.y + 6); c.lineTo(IMG.x + IMG.w / 2 + 10, IMG.y + 6); c.lineTo(IMG.x + IMG.w / 2, IMG.y + 20); c.closePath(); c.fill();
    c.fillStyle = '#1f9d63'; c.fillRect(IMG.x + IMG.w - 44, IMG.y + 8, 32, 32); c.fillStyle = '#fff'; c.font = 'bold 28px sans-serif'; c.fillText('F', IMG.x + IMG.w - 36, IMG.y + 25);
    c.fillStyle = '#e8eaed'; c.font = '22px sans-serif';
    for (let cm = 0; cm <= 3; cm++) { const y = IMG.y + IMG.h * cm / 3; c.beginPath(); c.arc(IMG.x + IMG.w + 24, y, cm === 0 ? 7 : 5, 0, Math.PI * 2); c.fill(); c.fillText(String(cm), IMG.x + IMG.w + 40, y); }
    // 下バー: アイコンと PV 穿刺モードの凡例
    c.fillStyle = '#cfd3d8'; c.fillRect(30, H - 42, 22, 22); c.fillRect(70, H - 42, 22, 22);
    c.font = '20px sans-serif'; c.fillStyle = '#e8eaed'; c.textAlign = 'left';
    c.fillText('Artery', IMG.x, H - 30); c.fillStyle = '#e04a6a'; c.beginPath(); c.arc(IMG.x + 80, H - 30, 9, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#e8eaed'; c.fillText('Vein   ○:〜1.9mm  ○:〜2.8mm  ○:〜3.3mm  ○:3.4mm〜', IMG.x + 110, H - 30);
    uiTex.needsUpdate = true;
  }
  drawUI();
  let uiTimer = 0;
  function drawOverlay() {
    const c = ovc; c.clearRect(0, 0, ov.width, ov.height);
    if (state.active && state.frozen) { c.fillStyle = 'rgba(57,196,106,0.85)'; c.fillRect(ov.width - 170, 12, 158, 40); c.fillStyle = '#062a16'; c.font = 'bold 26px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('FREEZE', ov.width - 91, 32); }
    if (!state.active || !state.contact || !state.centerVein) { ovTex.needsUpdate = true; return; }
    const v = state.centerVein;
    const px = (0.5 + v.lateral / PROBE_W) * ov.width, py = (v.depthCenter / IMG_DEPTH) * ov.height;
    const rx = v.r / PROBE_W * ov.width, ry = v.r * (1 - (v.kind === 'vein' ? veinFlatten(state.press, state.turgor) : 0)) / IMG_DEPTH * ov.height;
    c.strokeStyle = v.kind === 'artery' ? '#e04a6a' : '#39c46a'; c.lineWidth = 3;
    c.beginPath(); c.ellipse(px, py, rx + 6, ry + 6, 0, 0, Math.PI * 2); c.stroke();
    c.fillStyle = c.strokeStyle; c.font = 'bold 22px sans-serif'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText(`dep ${state.depthMm.toFixed(1)}mm`, px + rx + 14, py - 6); c.fillText(`dia ${state.diaMm.toFixed(1)}mm`, px + rx + 14, py + 20);
    // センターライン（点線）
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.setLineDash([6, 10]); c.beginPath(); c.moveTo(ov.width / 2, 0); c.lineTo(ov.width / 2, ov.height); c.stroke(); c.setLineDash([]);
    ovTex.needsUpdate = true;
  }

  // ---- 血管・針データの更新
  let segVersion = -1;
  api.setVessel = (vessel, version) => {
    if (version === segVersion) return;
    segVersion = version;
    api._all = vessel.segments();     // 全線分（約 6mm 刻み）。毎フレーム、走査面の近くのものだけをシェーダーへ渡す
  };
  const kindCode = k => (k === 'artery' ? 1 : k === 'graft' ? 2 : 0);
  function uploadNear(O) {
    const all = api._all || [];
    const near = [];
    for (const s of all) { const d = s.mid.distanceToSquared(O); if (d < 0.07 * 0.07) near.push([d, s]); }
    if (near.length > NSEG) near.sort((p, q) => p[0] - q[0]);
    const n = Math.min(NSEG, near.length);
    for (let i = 0; i < n; i++) { const s = near[i][1]; uniforms.uSegA.value[i].set(s.a.x, s.a.y, s.a.z, s.rA); uniforms.uSegB.value[i].set(s.b.x, s.b.y, s.b.z, kindCode(s.kind) + s.rB * 10); }
    uniforms.uN.value = n;
    api._segs = near.slice(0, n).map(p => p[1]);
  }
  api.setNeedle = (i, a, b, radius, intensity) => { uniforms.uNdlA.value[i].set(a.x, a.y, a.z, intensity); uniforms.uNdlB.value[i].set(b.x, b.y, b.z, radius); };
  api.clearNeedles = () => { for (const v of uniforms.uNdlA.value) v.w = 0; };
  api.setTurgor = t => { state.turgor = t; uniforms.uTurgor.value = t; };   // 駆血による怒張（0..1）

  // ---- 毎フレーム: プローブ姿勢から画像を生成し、センターライン上の血管を計測
  const _f = new THREE.Vector3(), _q = new THREE.Vector3(), _ab = new THREE.Vector3(), _w = new THREE.Vector3();
  let ovTimer = 0, lastKey = '';
  // render=false のフレームは画像を生成しない（接触判定・計測だけ更新）。呼び出し側で 1 フレームおきにして GPU 負荷を半分にする
  api.update = (probeObj, dt, pulse, t, render = true) => {
    if (!state.active) return state;
    if (state.frozen) return state;   // フリーズ中: 画像・計測・接触判定をそのまま保つ（画面は静止）
    probeObj.updateMatrixWorld(true);
    const O = probeObj.getWorldPosition(uniforms.uO.value);
    const qw = probeObj.getWorldQuaternion(new THREE.Quaternion());
    const X = uniforms.uX.value.set(1, 0, 0).applyQuaternion(qw).normalize();
    const D = uniforms.uD.value.set(0, -1, 0).applyQuaternion(qw).normalize();
    uniforms.uTime.value = t; uniforms.uPulse.value = pulse;
    uploadNear(O);
    // 接触判定・圧迫（中心列）: レンズ面中心から皮膚までの距離
    const a = C.armAt(O.x); const dz = O.z - a.z;
    let t0 = 1;
    if (C.onArm(O.x) && Math.abs(dz) < a.r) { const sy = a.y + Math.sqrt(a.r * a.r - dz * dz); t0 = (O.y - sy) / Math.max(0.2, -D.y); }
    state.contact = t0 < 0.0025 && t0 > -0.03;
    state.press = THREE.MathUtils.clamp(-t0, 0, PRESS_MAX) / PRESS_MAX;
    // センターラインの血管（PV 穿刺モードの自動計測）
    state.centerVein = null;
    if (state.contact && api._segs) {
      let best = null;
      for (const s of api._segs) {
        _ab.subVectors(s.b, s.a); _w.subVectors(O, s.a);
        const A = _ab.dot(_ab), B = _ab.dot(D), Dd = _ab.dot(_w), E = D.dot(_w);
        const den = A - B * B; const tt = den > 1e-9 ? THREE.MathUtils.clamp((Dd - B * E) / den, 0, 1) : 0;
        _q.copy(s.a).addScaledVector(_ab, tt);
        const sdep = _q.clone().sub(O).dot(D); _f.copy(_q).sub(O).addScaledVector(D, -sdep);
        const lat = _f.length();
        const r = s.rA + (s.rB - s.rA) * tt;
        if (!(lat < r + 0.004 && sdep > 0 && sdep < IMG_DEPTH)) continue;
        // センターライン上（横ずれ 2.5mm 以内）に複数あれば最も浅い血管（穿刺対象の表在血管。その下の動脈・伴走静脈ではない）、なければ最も中央に近いもの
        const onLine = lat < 0.0025, bestOn = best && best.latAbs < 0.0025;
        const better = !best || (onLine && bestOn ? sdep < best.depthCenter : onLine && !bestOn ? true : !onLine && bestOn ? false : lat < best.latAbs);
        if (better) best = { lat: lat * Math.sign(_f.dot(X)), latAbs: lat, depthCenter: sdep, r, kind: s.kind };
      }
      if (best) { state.centerVein = best; state.depthMm = (best.depthCenter - Math.max(0, t0)) * 1000; state.diaMm = best.r * 2000; }
    }
    // 画像生成（オフスクリーン描画）。XR 中は XR を一時的に無効にし、描画先（XR のフレームバッファ）を必ず元に戻す
    if (render) {
      const xr = renderer.xr.enabled, prevTarget = renderer.getRenderTarget(), prevAutoClear = renderer.autoClear;
      renderer.xr.enabled = false; renderer.autoClear = true;
      renderer.setRenderTarget(rt); renderer.render(quadScene, quadCam);
      renderer.setRenderTarget(prevTarget); renderer.autoClear = prevAutoClear; renderer.xr.enabled = xr;
    }
    uiTimer += dt; ovTimer += dt;
    // 計測値が変わったら（血管が中央に入った/外れた、深さ・径の変化）すぐ描き直し、それ以外は画面の枠は 1 秒ごと・オーバーレイは 10 回/秒（キャンバス転送を減らす）
    const key = state.centerVein ? `${state.depthMm.toFixed(1)}/${state.diaMm.toFixed(1)}/${state.centerVein.kind}` : '';
    const changed = key !== lastKey; lastKey = key;
    if (changed || uiTimer > 1.0) { uiTimer = 0; drawUI(); }
    if (changed || ovTimer > 0.1) { ovTimer = 0; drawOverlay(); }
    return state;
  };
  api.setActive = on => { state.active = on; if (!on) { state.contact = false; state.centerVein = null; state.frozen = false; drawOverlay(); drawUI(); } };
  // フリーズ（画像を静止）／解除。プローブを持つ手のグリップ、またはプローブの ⏯ ボタンを指で押す
  api.toggleFreeze = () => { if (!state.active) return false; state.frozen = !state.frozen; drawUI(); drawOverlay(); return state.frozen; };
  api.state = state;
  api.PROBE_W = PROBE_W; api.IMG_DEPTH = IMG_DEPTH;
  return api;
}
