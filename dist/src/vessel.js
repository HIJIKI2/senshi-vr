// 穿刺対象の血管モデル
//  AVF: 手首の橈骨動脈–橈側皮静脈吻合（radiocephalic, 側端吻合）から肘・上腕へ向かう皮静脈ネットワーク
//       橈側皮静脈（前腕・上腕）、肘正中皮静脈、尺側皮静脈、前腕正中皮静脈、
//       動脈系: 上腕動脈 → 肘の 2 横指下で橈骨動脈・尺骨動脈に分岐、橈骨動脈は吻合部で静脈につながる。各動脈に伴走静脈 2 本（深部、圧迫でつぶれる）
//       静脈の径は一様ではなく、太い所（怒張・瘤状）と細い所（狭窄）がある（毎回位置が変わる）。エコーで見ると狭窄部は細く映る。
//       各枝の基本径は駆血時（怒張）の値で、非駆血では setDilation で細くなる（橈側皮静脈 4.5mm → 3.2mm）
//  AVG: 前腕ループグラフト（上腕動脈と尺側皮静脈に端側吻合。皮静脈・動脈系は AVF と共通）
// 皮静脈は皮膚からわずかに透けて見える半透明の筒として描画（深い血管モードでは非表示）。エコー用に線分リストも提供する
import * as THREE from 'three';
import * as C from './constants.js';

// 血管の走行を (x, theta, depth) の制御点で記述し、腕の表面座標へ変換する（theta: 真上 0、+z 母指側が正）
const P = (x, th, d) => { const p = C.armPoint(x, th, d); return new THREE.Vector3(p.x, p.y, p.z); };

// 吻合部（橈骨動脈–橈側皮静脈 側端吻合）の位置: 手首の母指側、皮膚から 6.5mm。皮膚の傷跡もここに置く
export const AVF_ANASTOMOSIS = { x: C.WRIST_X - 0.028, theta: 0.5, depth: 0.0065 };
// AVG の動脈側吻合部: 肘窩の上腕動脈（分岐の少し上）。グラフトはここから皮下へ上がる
export const AVG_ARTERIAL_ANASTOMOSIS = [C.ELBOW_X + 0.02, -0.14, 0.0175];

// 皮静脈（AVF/AVG 共通）。depth は皮膚表面から血管中心までの距離（deep モードは静脈をさらに深く）。avf=true のとき橈側皮静脈は吻合部から始まる
function nativeVeins(deep, avf) {
  // 皮静脈の深さ（皮膚表面から血管中心まで）: 駆血時の半径 + 0.8mm（怒張しても血管の上端は皮膚の下。エコーの上端で切れない）
  const dv = r => deep ? 0.0105 : r + 0.0008;
  const W = C.WRIST_X, E = C.ELBOW_X, A = AVF_ANASTOMOSIS;
  const sd = dv(0.0045), su = dv(0.004), sm = dv(0.0035), sb = dv(0.0035), sa = dv(0.0025);
  const ana = P(A.x, A.theta, A.depth);
  return [
    // 橈側皮静脈: 吻合部から始まり（吻合部直後の「スイングセグメント」は少し深い）、前腕の母指側を肘へ
    { id: 'cephF', name: '前腕 橈側皮静脈', kind: 'vein', r: 0.0045, cannulate: true, forearm: true, pts: [
      ...(avf ? [ana.clone(), P(W - 0.04, 0.56, (A.depth + sd) / 2)] : [P(W - 0.02, 0.6, sd)]), P(W - 0.06, 0.52, sd), P(W - 0.12, 0.42, sd), P(W - 0.19, 0.36, sd), P(W - 0.26, 0.38, sd), P(W - 0.32, 0.45, sd), P(E + 0.02, 0.52, sd), P(E - 0.02, 0.58, sd)],
      rPts: avf ? [[0, 0.0038], [0.08, 0.0045], [1, 0.0045]] : null },
    { id: 'cephU', name: '上腕 橈側皮静脈', kind: 'vein', r: 0.004, cannulate: true, forearm: false, pts: [
      P(E - 0.02, 0.58, su), P(E - 0.07, 0.66, su), P(E - 0.13, 0.76, su), P(E - 0.2, 0.86, su + 0.001), P(E - 0.26, 0.95, su + 0.003)] },
    { id: 'mcv', name: '肘正中皮静脈', kind: 'vein', r: 0.0035, cannulate: true, forearm: false, pts: [
      P(E + 0.05, 0.42, sm), P(E + 0.01, 0.2, sm), P(E - 0.03, -0.08, sm), P(E - 0.07, -0.36, sm), P(E - 0.1, -0.56, sm + 0.001)] },
    { id: 'basilic', name: '尺側皮静脈', kind: 'vein', r: 0.0035, cannulate: false, forearm: false, pts: [
      P(W - 0.12, -0.7, sb), P(W - 0.22, -0.66, sb), P(E + 0.02, -0.6, sb + 0.001), P(E - 0.1, -0.56, sb + 0.002), P(E - 0.18, -0.6, sb + 0.006), P(E - 0.26, -0.66, sb + 0.011)] },
    { id: 'mav', name: '前腕正中皮静脈', kind: 'vein', r: 0.0025, cannulate: false, forearm: true, pts: [
      P(W - 0.05, -0.12, sa), P(W - 0.15, -0.16, sa), P(W - 0.25, -0.22, sa), P(E + 0.0, -0.3, sa + 0.001)] },
  ];
}
function avfBranches(deep) { return [...nativeVeins(deep, true), ...arterialTree(true)]; }
// AVG: 前腕ループグラフト（6mm PTFE）。動脈側は肘窩の上腕動脈（分岐の少し上）に端側吻合し、皮下（標準 5.5mm, deep 12mm）へ上がって
// 母指側の脚を遠位へ、前腕中央で U ターンして小指側の脚を近位へ戻り、肘の尺側皮静脈に端側吻合する。各脚の長さ約 12cm、脚の間隔約 3.5cm
export const AVG_SITE_X = { A: C.ELBOW_X + 0.11, V: C.ELBOW_X + 0.07 };   // 穿刺部位: A は動脈側の脚、V は静脈側の脚（間隔 5cm 以上）
function avgBranches(deep) {
  const E = C.ELBOW_X, gd = deep ? 0.012 : C.VESSEL_TYPES.avg.depth;
  const sb = deep ? 0.0105 : 0.0035 + 0.0008;                           // 尺側皮静脈の深さ（nativeVeins と同じ式）
  const AA = AVG_ARTERIAL_ANASTOMOSIS, VA = P(E + 0.02, -0.6, sb + 0.001);   // VA = 尺側皮静脈の制御点（曲線が必ず通る）
  const tup = arr => arr.map(([x, th, d]) => P(x, th, d));
  const pts = [
    P(AA[0], AA[1], AA[2]), ...tup([[E + 0.035, 0.05, (AA[2] + gd) / 2], [E + 0.055, 0.38, gd], [E + 0.08, 0.45, gd], [E + 0.11, 0.45, gd], [E + 0.135, 0.42, gd],
      [E + 0.15, 0.25, gd], [E + 0.158, 0.0, gd], [E + 0.15, -0.25, gd], [E + 0.135, -0.42, gd], [E + 0.11, -0.45, gd], [E + 0.08, -0.45, gd], [E + 0.055, -0.45, gd],
      [E + 0.035, -0.55, (gd + sb) / 2]]), VA,
  ];
  return [...nativeVeins(deep, false),
    { id: 'graft', name: '人工血管（ループグラフト）', kind: 'graft', r: C.GRAFT_R, cannulate: true, forearm: true, pts },
    ...arterialTree(false)];
}
// 動脈系（AVF/AVG 共通）: 上腕動脈は肘窩のやや内側を下り、肘の 2 横指（約 3.5cm）下で橈骨動脈と尺骨動脈に分岐する。
// 橈骨動脈は前腕の母指側を浅くなりながら手首へ（AVF では吻合部で静脈につながり、側端吻合なので手側へも続く）、尺骨動脈は小指側を手首へ。
// 各動脈の両脇には伴走静脈（深部静脈、圧迫でつぶれる。穿刺対象ではない）が 2 本ずつ走る。エコーで分岐部・伴走静脈を探す練習用
function arterialTree(withAnastomosis) {
  const W = C.WRIST_X, E = C.ELBOW_X, A = AVF_ANASTOMOSIS;
  const BIF = [E + 0.035, -0.12, 0.017];
  const brachial = [[E - 0.26, -0.42, 0.022], [E - 0.14, -0.35, 0.02], [E - 0.05, -0.22, 0.019], [E + 0.005, -0.16, 0.018], ...(withAnastomosis ? [] : [AVG_ARTERIAL_ANASTOMOSIS]), BIF];
  const radialProx = [BIF, [W - 0.25, 0.1, 0.0175], [W - 0.18, 0.24, 0.0155], [W - 0.12, 0.3, 0.014], [W - 0.06, 0.42, 0.010]];
  const radialDist = withAnastomosis
    ? [[W - 0.04, 0.47, 0.0078], [A.x, A.theta, A.depth], [W - 0.016, 0.53, 0.0085], [W + 0.002, 0.56, 0.011]]
    : [[W - 0.03, 0.47, 0.0075], [W - 0.005, 0.5, 0.0065], [W + 0.01, 0.52, 0.007]];
  const ulnar = [BIF, [W - 0.26, -0.34, 0.02], [W - 0.18, -0.55, 0.017], [W - 0.1, -0.68, 0.012], [W - 0.04, -0.76, 0.0085], [W + 0.0, -0.8, 0.007]];
  const tup = arr => arr.map(([x, th, d]) => P(x, th, d));
  // 伴走静脈: 動脈の走行を θ 方向に ±3.2mm ずらした 2 本
  const comitans = (id, name, arr, r, forearm) => [-1, 1].map(sgn => ({
    id: id + (sgn < 0 ? 'a' : 'b'), name, kind: 'vein', comitant: true, r, cannulate: false, forearm,
    pts: arr.map(([x, th, d]) => { const a = C.armAt(x); return P(x, th + sgn * 0.0032 / Math.max(0.01, a.r - d), d); }),
  }));
  return [
    { id: 'brachialA', name: '上腕動脈', kind: 'artery', r: 0.002, cannulate: false, forearm: false, pts: tup(brachial) },
    { id: 'radialA', name: '橈骨動脈', kind: 'artery', r: 0.0015, cannulate: false, forearm: true, pts: tup([...radialProx, ...radialDist]),
      rPts: withAnastomosis ? [[0, 0.0014], [0.55, 0.0015], [0.85, 0.0019], [0.9, 0.0017], [1, 0.0011]] : [[0, 0.0014], [1, 0.0012]] },
    { id: 'ulnarA', name: '尺骨動脈', kind: 'artery', r: 0.0014, cannulate: false, forearm: true, pts: tup(ulnar), rPts: [[0, 0.0015], [1, 0.0011]] },
    ...comitans('brachialV', '上腕動脈の伴走静脈', brachial, 0.0015, false),
    ...comitans('radialV', '橈骨動脈の伴走静脈', radialProx, 0.0011, true),
    ...comitans('ulnarV', '尺骨動脈の伴走静脈', ulnar, 0.0011, true),
  ];
}
// 穿刺部位の候補（A = 脱血側は遠位、V = 返血側は近位。5cm 以上離す）。毎回ランダムに選ぶ
const AVF_SITE_SETS = [
  { A: ['cephF', 0.2, '前腕 橈側皮静脈（手首寄り）'], V: ['cephF', 0.62, '前腕 橈側皮静脈（肘寄り）'] },
  { A: ['cephF', 0.35, '前腕 橈側皮静脈（中央）'], V: ['cephF', 0.8, '前腕 橈側皮静脈（肘の手前）'] },
  { A: ['cephF', 0.55, '前腕 橈側皮静脈（肘寄り）'], V: ['mcv', 0.55, '肘正中皮静脈'] },
  { A: ['cephF', 0.25, '前腕 橈側皮静脈（手首寄り）'], V: ['cephU', 0.38, '上腕 橈側皮静脈'] },
  { A: ['cephF', 0.45, '前腕 橈側皮静脈（中央）'], V: ['cephU', 0.24, '上腕 橈側皮静脈（肘の上）'] },
  { A: ['cephF', 0.2, '前腕 橈側皮静脈（手首寄り）'], V: ['mcv', 0.3, '肘正中皮静脈（外側）'] },
];


// 半径が走行に沿って変わるチューブ（TubeGeometry の可変半径版）。t は弧長パラメータ
function varTube(curve, n, rAt, radial = 14) {
  const frames = curve.computeFrenetFrames(n, false);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = curve.getPointAt(t), r = rAt(t), N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const v = j / radial * Math.PI * 2, cs = -Math.cos(v), sn = Math.sin(v);
      const nx = cs * N.x + sn * B.x, ny = cs * N.y + sn * B.y, nz = cs * N.z + sn * B.z;
      nor.push(nx, ny, nz); pos.push(p.x + r * nx, p.y + r * ny, p.z + r * nz); uv.push(t, j / radial);
    }
  }
  for (let j = 1; j <= n; j++) for (let i = 1; i <= radial; i++) {
    const a = (radial + 1) * (j - 1) + (i - 1), b = (radial + 1) * j + (i - 1), c = (radial + 1) * j + i, d = (radial + 1) * (j - 1) + i;
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
// 簡易乱数（seed 指定で再現可能）
function rng(seed) {
  let s = (seed ?? Math.floor(Math.random() * 1e9)) >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const lerpPts = (pts, t) => {
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, r0] = pts[i - 1], [t1, r1] = pts[i]; return r0 + (r1 - r0) * (t - t0) / Math.max(1e-6, t1 - t0); }
  return pts[pts.length - 1][1];
};

export function createVessel(type, opts = {}) {
  const cfg = C.VESSEL_TYPES[type];
  const deep = !!opts.deep;
  const branches = type === 'avf' ? avfBranches(deep) : avgBranches(deep);
  const group = new THREE.Group();         // 前腕側の血管（前腕を持ち上げると一緒に動く）
  const upperGroup = new THREE.Group();    // 上腕側の血管
  // 皮静脈の表示: AVF 標準のみ透けて見える。deep モードと AVG では見えない（AVG はグラフトの畝だけ。エコーには全部映る）
  const veinVisible = !deep && type === 'avf';
  const veinMat = new THREE.MeshPhysicalMaterial({ color: 0x8a5f8e, roughness: 0.35, transparent: true, opacity: veinVisible ? 0.62 : 0, clearcoat: 0.3, clearcoatRoughness: 0.4, depthWrite: false, side: THREE.DoubleSide });
  // グラフトは皮下にあり、皮膚の盛り上がり（皮膚色の畝）としてだけ見える。deep モードでは見えない（エコーで探す）
  const graftMat = new THREE.MeshPhysicalMaterial({ color: 0xe8b9a2, roughness: 0.62, transparent: true, opacity: deep ? 0 : 0.95, depthWrite: false, sheen: 0.2, sheenColor: new THREE.Color(0xffd9c8) });
  const arteryMat = new THREE.MeshStandardMaterial({ color: 0xa83a3a, roughness: 0.5, transparent: true, opacity: 0.0, depthWrite: false });   // 動脈は深いので見えない（エコーのみ）
  const lumenMat = new THREE.MeshStandardMaterial({ color: 0x5a0d18, roughness: 0.6, transparent: true, opacity: veinVisible ? 0.55 : 0, depthWrite: false });

  // 各枝: 曲線、等間隔サンプル（closest 用）、メッシュ。半径は rAt(t)（基本径 × 走行に沿った変化 × 狭窄 × 怒張）
  const samples = [];   // { p, t, tangent, branch }
  for (const b of branches) {
    b.curve = new THREE.CatmullRomCurve3(b.pts, false, 'centripetal');
    b.len = b.curve.getLength();
    b.scale = (type === 'avg' && b.kind === 'vein') ? C.VESSEL_R_NORMAL / C.VESSEL_R_DILATED : 1;   // 怒張（駆血）倍率（静脈のみ。AVG は駆血しないので非駆血の径）
    b.sten = null;                                // 狭窄 { t, w (曲線パラメータ幅), f (狭窄率 0..1) }
    b.wave = { amp: 0, freq: 0, phase: 0 };       // 緩やかな径の変化（怒張部・細い部分）
    // 基本径（走行に沿った変化込み、怒張・狭窄なし）
    b.rBase = t => (b.rPts ? lerpPts(b.rPts, t) : b.r);
    // 狭窄率（0 = 正常, 1 = 完全閉塞）
    b.stenosisAt = t => (b.sten ? b.sten.f * Math.exp(-(((t - b.sten.t) / b.sten.w) ** 2)) : 0);
    b.rAt = t => {
      let r = b.rBase(t) * (1 + b.wave.amp * Math.sin(t * b.wave.freq + b.wave.phase));
      if (b.kind === 'vein') r *= b.scale * (1 - 0.6 * b.stenosisAt(t));    // 狭窄部は 60% 細い（最も細い所で）
      return r;
    };
    const n = Math.max(12, Math.round(b.len / 0.004));
    const sp = b.curve.getSpacedPoints(n);
    for (let i = 0; i < sp.length; i++) {
      const prev = sp[Math.max(0, i - 1)], next = sp[Math.min(sp.length - 1, i + 1)];
      samples.push({ p: sp[i], t: i / n, tangent: new THREE.Vector3().subVectors(next, prev).normalize(), branch: b });
    }
    const parent = b.forearm ? group : upperGroup;
    b.mesh = new THREE.Mesh(new THREE.BufferGeometry(), b.kind === 'artery' ? arteryMat : b.kind === 'graft' ? graftMat : veinMat);
    b.mesh.renderOrder = 2; parent.add(b.mesh);
    if (b.kind !== 'artery') { b.lumen = new THREE.Mesh(new THREE.BufferGeometry(), lumenMat); b.lumen.renderOrder = 1; parent.add(b.lumen); }
  }
  let geomVersion = 0;
  const rebuild = () => {
    for (const b of branches) {
      const n = Math.max(24, Math.round(b.len / 0.004));
      // 表示用の筒は実際の径より 2.2mm 太い（皮膚の下 0.8mm にある静脈が、駆血で怒張すると皮膚から盛り上がって透けて見える。判定・エコーは rAt の径）
      const rShow = (b.kind === 'vein' && !b.comitant) ? (t => b.rAt(t) + 0.0022) : b.kind === 'graft' ? (t => b.rAt(t) + 0.0036) : b.rAt;
      b.mesh.geometry.dispose(); b.mesh.geometry = varTube(b.curve, n, rShow, 14);
      if (b.lumen) { b.lumen.geometry.dispose(); b.lumen.geometry = varTube(b.curve, Math.max(24, Math.round(b.len / 0.006)), t => b.rAt(t) * 0.45, 8); }
    }
    geomVersion++;
  };
  let dilation = 1;
  // 駆血による怒張: 静脈の半径を倍率で変える（互換用に setRadius(r) も受け付ける）
  function setDilation(f) {
    if (Math.abs(f - dilation) < 0.003) return;
    dilation = f;
    for (const b of branches) if (b.kind === 'vein') b.scale = f;
    rebuild();
  }
  function setRadius(r) { setDilation(type === 'avf' ? r / C.VESSEL_R_DILATED : 1); }   // 基本径 = 駆血時なので、非駆血では 1 未満

  // 穿刺部位
  const sites = { A: null, V: null };
  function siteAt(id, t, label) {
    const b = branches.find(x => x.id === id);
    const p = b.curve.getPointAt(t), tan = b.curve.getTangentAt(t);
    return { x: p.x, y: C.skinY(p.x, p.z), z: p.z, depth: C.skinY(p.x, p.z) - p.y, label, branch: b, t, tangent: tan, clone() { return new THREE.Vector3(this.x, this.y, this.z); } };
  }
  // 静脈の径のばらつきと狭窄を決める（部位ごとに毎回変える）。狭窄は穿刺対象の枝で、穿刺部位から 2.5〜3.5cm 離れた所に置く
  // （部位そのものは正常径だが、少しずれた所を刺すと細い血管に当たる。エコーで細くなっているのが見える）
  function layoutCaliber(rand) {
    for (const b of branches) {
      b.sten = null;
      if (b.kind !== 'vein') continue;
      b.wave = { amp: 0.06 + 0.08 * rand(), freq: 6 + 8 * rand(), phase: rand() * 6.28 };
    }
    if (type !== 'avf') return;
    const targets = [sites.V, sites.A].filter(s => s && s.branch.kind === 'vein');
    const usedBranch = new Set();
    for (const s of targets) {
      const b = s.branch;
      if (usedBranch.has(b)) continue;
      usedBranch.add(b);
      const other = targets.find(o => o !== s && o.branch === b);
      const dist = 0.025 + 0.01 * rand();
      let dir = rand() < 0.5 ? -1 : 1;
      let t = s.t + dir * dist / b.len;
      const okT = tt => tt > 0.08 && tt < 0.92 && (!other || Math.abs(tt - other.t) * b.len > 0.025);
      if (!okT(t)) { dir = -dir; t = s.t + dir * dist / b.len; }
      if (!okT(t)) continue;
      b.sten = { t, w: 0.009 / b.len, f: 0.75 + 0.25 * rand(), x: b.curve.getPointAt(t).x };
    }
    // 穿刺対象でない静脈にもときどき狭窄（エコーで見比べる練習用）
    for (const b of branches) if (b.kind === 'vein' && b.cannulate && !b.sten && rand() < 0.4) b.sten = { t: 0.2 + 0.6 * rand(), w: 0.009 / b.len, f: 0.8 };
  }
  function pickSites(seed) {
    const rand = rng(seed);
    if (type === 'avg') {
      // 動脈側の脚（母指側, 0..0.5）と静脈側の脚（小指側, 0.5..1）で、指定の x に最も近い点
      const g = branches.find(b => b.id === 'graft');
      const tNear = (x, lo, hi) => { let best = lo, bd = 1; for (let i = 0; i <= 200; i++) { const t = lo + (hi - lo) * i / 200, d = Math.abs(g.curve.getPointAt(t).x - x); if (d < bd) { bd = d; best = t; } } return best; };
      sites.A = siteAt('graft', tNear(AVG_SITE_X.A, 0.08, 0.45), 'グラフト 動脈側の脚（母指側）'); sites.V = siteAt('graft', tNear(AVG_SITE_X.V, 0.55, 0.92), 'グラフト 静脈側の脚（小指側）');
    } else {
      const set = AVF_SITE_SETS[(seed ?? Math.floor(rand() * AVF_SITE_SETS.length)) % AVF_SITE_SETS.length];   // ?seed=N で組み合わせを固定
      sites.A = siteAt(...set.A); sites.V = siteAt(...set.V);
    }
    layoutCaliber(rand);
    rebuild();
  }
  pickSites(opts.siteSeed);

  // 最近傍（血管内判定用）: 全枝のサンプルから最も近い点。r = その点の現在の半径、sten = 狭窄率、kind = 'vein' | 'artery' | 'graft'
  const _tmp = new THREE.Vector3();
  function closest(p) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < samples.length; i++) {
      const d = samples[i].p.distanceToSquared(p);
      if (d < best) { best = d; bi = i; }
    }
    const s = samples[bi];
    _tmp.set(p.x - s.p.x, 0, p.z - s.p.z);
    return { d: Math.sqrt(best), point: s.p, horiz: _tmp.length(), index: bi, tangent: s.tangent, r: s.branch.rAt(s.t), sten: s.branch.stenosisAt(s.t), kind: s.branch.kind, branch: s.branch };
  }

  // エコー描画用の線分リスト（全枝、約 6mm 刻み）: { a, b, rA, rB, kind, mid }。描画側で走査面の近くのものだけ使う
  function segments() {
    const out = [];
    for (const b of branches) {
      const n = Math.max(6, Math.round(b.len / 0.006));
      const sp = b.curve.getSpacedPoints(n);
      for (let i = 0; i < n; i++) out.push({ a: sp[i], b: sp[i + 1], rA: b.rAt(i / n), rB: b.rAt((i + 1) / n), kind: b.kind, mid: new THREE.Vector3().addVectors(sp[i], sp[i + 1]).multiplyScalar(0.5) });
    }
    return out;
  }

  return {
    type, cfg, deep, group, upperGroup, branches, sites, pickSites, setRadius, setDilation, closest, segments,
    get radius() { return C.VESSEL_R_DILATED * dilation; },
    get dilation() { return dilation; },
    get version() { return geomVersion; },
    dispose() { for (const b of branches) { b.mesh.geometry.dispose(); b.lumen?.geometry.dispose(); } },
  };
}
