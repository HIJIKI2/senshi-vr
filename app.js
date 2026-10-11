// 透析室 穿刺トレーニングVR  (Quest 3 / WebXR / Three.js) — メインロジック
import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';
import { RoomEnvironment } from './lib/RoomEnvironment.js';
import * as C from './src/constants.js';
import { createTextures } from './src/textures.js';
import { buildRoom } from './src/room.js';
import { buildPatient } from './src/patient.js';
import { loadHand, gripPose } from './src/handmodel.js';
import {
  makeStethoscopeSet, makeTourniquet, setTourniquetApplied, setTourniquetCoiled, makeNeedle, setClampOpen, setWingsFolded,
  makeTapeStrip, setTapeApplied, resetTape, makeConnector, makeSetBox, makeFoldedDrape, makeGauze,
  makeAlcoholPouch, setPouchTorn, setPouchTaken, makeSwab, makeGloveBox, makeGlove,
  makeResetButton, makeSettingsPanel,
} from './src/tools.js';
import { createEcho, makeProbe, makeProbeHolder, PRESS_MAX } from './src/echo.js';

const GRAB_DIST = 0.13;
// 針を持つときの指の曲げ（親指と人差し指でつまむ「ピンチ」姿勢）
// （親指は中手骨を Y 軸回りに対立させて人差し指の指先に合わせる。左手は鏡像なので符号が逆）
// 針の持ち方（臨床の標準）: 金属翼状針は翼を折り畳んで親指と人差し指の腹で両側から挟む。留置針は内筒ハブ（後端の硬い部分）を同様に挟む。
// 針の軸は人差し指の向きに沿って指先の先へ出し、刃面（翼の面）は手の甲側が上。中指以降は軽く曲げて患者の腕に「支え」を作れる程度に緩める
// （値は ?debug=hand で親指先と人差し指先の距離を計測して決定: index 0.65 / thumbOpp 右 0.3・左 -0.15 で指先同士が約 9mm = 指の腹が触れ合う）
const PINCH_CURL = {
  right: { thumb: 1.0, index: 0.65, middle: 0.62, ring: 0.6, pinky: 0.6, thumbOpp: 0.3, thumbOppAxis: 'y' },
  left: { thumb: 1.0, index: 0.65, middle: 0.62, ring: 0.6, pinky: 0.6, thumbOpp: -0.15, thumbOppAxis: 'y' },
};
const NO_OPP = { thumbOpp: 0 };
// エコープローブを持つ姿勢: 手全体で本体を握る（親指は手前の広い面、他の指は向こう側へ回り込み、掌に広い面が当たる）。
// 小指側がレンズ面に近く、指はすべてレンズ面より上にある（参考: us-ism.com のプローブの持ち方の写真）
const PROBE_CURL = {
  right: { thumb: 0.6, index: 0.88, middle: 0.9, ring: 0.9, pinky: 0.9, thumbOpp: 0 },
  left: { thumb: 0.6, index: 0.88, middle: 0.9, ring: 0.9, pinky: 0.9, thumbOpp: 0 },
};
const PROBE_HOLD_L = 0.058;   // 握りの中心からレンズ面までの距離: 握った手の小指側の下 2cm ほどにレンズ面が来る
// 握りの中心（gripSpace 座標）: 手のモデルの掌面は原点から掌側へ 23mm、曲げた指の先は 65mm にあるので、その間にプローブ本体（厚み 28mm）を置く
const PROBE_FIST = { palm: 0.038, up: 0.005, thumb: 0.005 };
// 手の中でのプローブの向き（持ち手軸まわり）: 0 = 広い面が掌に当たり、走査面は手の長さ方向（実機で試してこちらが操作しやすいとのこと）。
// π/2 にすると広い面が指先側を向き、走査面は掌の法線方向になる
const PROBE_YAW = 0;
// 持ち手の向き: 親指の方向（gripSpace -Z）= 手を自然に構えた（握手の形: 指先が前、親指が上）ときの真上。
// こうすると手首をひねらなくてもプローブは垂直に垂れ下がり、レンズ面は真下を向く。PROBE_TILT は持ち手を手首側（+Y）へ少し倒す角（rad）
let PROBE_TILT = 0.1;
// 指差し姿勢（物理ボタンを押す）
const POINT_CURL = { thumb: 0.8, index: 0.18, middle: 0.96, ring: 0.96, pinky: 0.96 };
// 患者の手首を軽く握る姿勢（腕を持ち上げる）
const WRIST_CURL = { thumb: 0.6, index: 0.7, middle: 0.75, ring: 0.75, pinky: 0.75 };
const MAX_LIFT = 0.42;   // 前腕の持ち上げ上限（rad ≈ 24°）

// ---------------------------------------------------------------- 設定（血管タイプ・針タイプ）と手順
const config = { vessel: 'avf', needle: 'metal', deep: false };   // deep: 深い血管（透けて見えない。エコー下穿刺の練習）
{
  const qs = new URLSearchParams(location.search);
  if (C.VESSEL_TYPES[qs.get('vessel')]) config.vessel = qs.get('vessel');
  if (C.NEEDLE_TYPES[qs.get('needle')]) config.needle = qs.get('needle');
  if (qs.get('deep') === '1') config.deep = true;
}
let STEPS = [];
function buildSteps() {
  const avg = config.vessel === 'avg', cannula = config.needle === 'cannula';
  const vcfg = C.VESSEL_TYPES[config.vessel];
  const target = avg ? '人工血管（U字グラフト）' : '怒張した血管';
  const angle = `${vcfg.idealAngle[0]}〜${vcfg.idealAngle[1]}°`;
  const nd = C.NEEDLE_TYPES[config.needle].short;
  const tq = vcfg.usesTourniquet, deep = config.deep && !avg;
  const needlePre = ['auscult', 'palpate', 'disinfect', ...(tq ? ['tourniquet'] : []), ...(deep ? ['echo'] : [])];
  const siteLabel = site => P?.vessel?.sites?.[site]?.label || (avg ? (site === 'A' ? '手前側の脚（動脈側）' : '奥側の脚（静脈側）') : (site === 'A' ? '手首寄り' : '肘寄り'));
  const needleHint = site => `${site === 'A' ? '赤い針（A）' : '青い針（V）'}を持ち、反対の手で皮膚を伸展・固定しながら「${siteLabel(site)}」の${deep ? '血管（透けて見えないのでエコーで位置と深さを確認）' : target}へ ${deep ? '30〜45°' : angle} で刺入。逆血（フラッシュバック）を確認したら針を寝かせて 2〜3mm 進め、トリガーを離すと針は刺さったまま留置されます。` + (deep ? '' : 'エコー（カートのプローブ）を当てると画面で血管の深さを確認できます。');
  const tapeHint = (cannula ? 'テープを持ち、留置した外筒のハブの上で離すと皮膚に密着させて固定されます（2 枚目はハブ後端）。' : 'テープを持ち、針の翼の上で離すと翼を皮膚に密着させて横一文字に固定されます（2 枚目はチューブの上に Ω 固定）。') + 'テープはカートから直接持つか、あらかじめ反対の手の甲（手袋の上）に貼っておき、穿刺後にそこから剥がして使えます。';
  // 穿刺は原則 V（返血側）から。A は V の固定が済んでから
  const per = site => cannula ? [
    { id: 'needle' + site, label: `${site}側（${site === 'A' ? '脱血' : '返血'}側）穿刺 — ${nd}`, hint: needleHint(site), requires: site === 'V' ? needlePre : ['tapeV'] },
    { id: 'stylet' + site, label: `${site}針の内筒（金属針）を抜去`, hint: '留置した針の内筒ハブ（後端の色付き部分）に手を近づけてトリガーを引くと内筒が抜け、テフロン外筒だけが血管内に残ります（針を持ったままならグリップボタンでも抜けます）。', requires: ['needle' + site] },
    { id: 'tape' + site, label: `${site}針をテープで固定`, hint: tapeHint, requires: ['stylet' + site] },
  ] : [
    { id: 'needle' + site, label: `${site}側（${site === 'A' ? '脱血' : '返血'}側）穿刺 — ${nd}`, hint: needleHint(site), requires: site === 'V' ? needlePre : ['tapeV'] },
    { id: 'tape' + site, label: `${site}針をテープで固定`, hint: tapeHint, requires: ['needle' + site] },
    { id: 'bleed' + site, label: `${site}針 クランプを開いて逆血を確認し、再び閉じる`, hint: '針のチューブのクランプに手を近づけてトリガーを引くと開き、逆血がチューブ先端近くまで上がってきます。確認したらもう一度トリガーでクランプを閉じます（開けたままだと血液が流出）。', requires: ['tape' + site] },
  ];
  const lastA = cannula ? 'tapeA' : 'bleedA', lastV = cannula ? 'tapeV' : 'bleedV';
  STEPS = [
    { id: 'hygiene',    label: '手指衛生（速乾性手指消毒薬）', hint: '右のカートの端（ベッドから遠い側の開始セット）にある手指消毒薬のポンプヘッドを、手（掌や指先）で押し込みます（標準予防策）。' },
    { id: 'gloves',     label: '手袋を装着（両手）', hint: '開始セットの手袋の箱から手袋を引き出し（トリガーで持つ）、反対の手に近づけるとその手に装着されます。もう一方の手も同様に。', requires: ['hygiene'] },
    { id: 'auscult',    label: avg ? '聴診器でグラフト音を聴取' : '聴診器でシャント音を聴取', hint: 'カートの聴診器（チェストピース）を持ち、垂れ下がったイヤーチップを自分の頭に近づけて装着し、ダイアフラムを前腕の血管に当てて 3 秒間聴診します。' + (avg ? '' : '手首側（吻合部）ほど音が大きくなります。'), requires: ['gloves'] },
    { id: 'palpate',    label: avg ? 'グラフトを触知（スリル・走行確認）' : 'シャント血管を触知（スリル）', hint: '何も持っていない手の人差し指で前腕の血管に触れます。拍動に同期した振動（スリル）を 2〜3 秒確認します。', requires: ['gloves'] },
    { id: 'open',       label: '穿刺セットを開封',           hint: '穿刺セットの箱に手を近づけてトリガーを引くと蓋が開きます。' },
    { id: 'sheet',      label: '滅菌シーツを腕の下に敷く',   hint: 'セット内の滅菌シーツ（緑）を持ち、患者の前腕の上で手を離すと腕の下に敷かれます。反対の手で患者の手首を持つ（トリガー）と前腕を持ち上げられるので、持ち上げて敷くとスムーズです。', requires: ['open'] },
    { id: 'disinfect',  label: '穿刺部をアルコール綿で消毒', hint: '開始セットのアルコール綿のパウチを持ち、反対の手で開封口に触れてトリガーを引くと破れます。もう一度トリガーで中の綿を取り出し、穿刺予定部位を中心に外側へ円を描くように（直径 5〜7cm）消毒します。乾燥を待ってから穿刺。', requires: ['sheet'] },
    ...(tq ? [{ id: 'tourniquet', label: '駆血帯を上腕に巻く', hint: '駆血帯を持ち、患者の上腕の上で手を離すと巻かれ、シャント血管が怒張します。駆血は 1 分以内に。', requires: ['disinfect'] }] : []),
    ...(deep ? [{ id: 'echo', label: 'エコーで穿刺血管を描出（短軸で画面中央に）', hint: 'タブレットは手で持って見やすい所（ベッドの上や患者の体側に立て掛ける）に置けます。カートのプローブ（持ち手を握る）を持ち、ゼリーを付けたつもりで穿刺予定部位の皮膚に当てます。血管を横切る向き（短軸）で、血管の黒い円がセンターライン（画面上の▼）の下に来るようにプローブを動かし、深さ・径の表示を確認します（2 秒保持）。', requires: ['disinfect'] }] : []),
    ...per('V'), ...per('A'),
    ...(tq ? [{ id: 'tourniquetOff', label: '駆血帯を外す（両針の穿刺後・回路接続前）', hint: '両方の穿刺・固定が終わったら、上腕の駆血帯に手を近づけてトリガーを引いて外します。駆血したまま回路を接続しないこと。', requires: [lastA, lastV] }] : []),
    { id: 'connectA',   label: 'A針に血液回路（赤）を接続',  hint: '透析装置から垂れている赤い回路のコネクタを持ち、A針の' + (cannula ? 'ハブ後端（逆止弁付きなのでそのまま接続可）' : 'ルアーコネクタ（クランプは閉じた状態で）') + 'に合わせて離すと接続されます。', requires: [lastA, ...(tq ? ['tourniquetOff'] : [])] },
    { id: 'connectV',   label: 'V針に血液回路（青）を接続',  hint: '青い回路のコネクタを持ち、V針に接続します。', requires: [lastV, ...(tq ? ['tourniquetOff'] : [])] },
    ...(cannula ? [] : [
      { id: 'clampA', label: 'A針のクランプを開放', hint: '回路接続後、A針のクランプをトリガーで開きます。', requires: ['connectA'] },
      { id: 'clampV', label: 'V針のクランプを開放', hint: 'V針のクランプも開放します。', requires: ['connectV'] },
    ]),
    { id: 'pump',       label: '血液ポンプを開始（回路を血液で満たす）', hint: '透析装置（ベッド頭側）のタッチパネル右側の「運転」キーを指で押すと血液ポンプが回り、A針 → 回路 → ピロー → ポンプ → ダイアライザ（下から上）→ 静脈側チャンバー → V針 の順に血液で満たされます。', requires: cannula ? ['connectA', 'connectV'] : ['clampA', 'clampV'] },
  ];
}
// （STEPS は init() で患者・血管を作ってから buildSteps() で生成する）

// ---------------------------------------------------------------- 状態
const state = {};
function resetState() {
  Object.assign(state, {
    done: {}, score: 100, log: [], finished: false,
    listenTime: 0, palpateTime: 0, setOpen: false, sheetPlaced: false, tourniquetOn: false, tourniquetAt: 0, tourniquetWarned: false,
    swabDistance: 0, swabPts: [], disinfected: false, vesselR: C.VESSEL_R_NORMAL, info: '',
    taped: { A: 0, V: 0 }, connected: { A: false, V: false }, bleed: { A: 0, V: 0 }, bleedLeak: { A: 0, V: 0 },
    pumpOn: false, flowT: -1, flowDone: false, stethWorn: false, stethHint: false,
    gloved: { right: false, left: false }, gloveWarned: false, liftedForSheet: false,
    echoTime: 0, echoUsed: false, arteryHit: false,
  });
}
resetState();
const currentStep = () => STEPS.find(s => !state.done[s.id]);
function addLog(msg, kind = 'info') {
  state.log.push({ msg, kind });
  if (state.log.length > 6) state.log.shift();
  uiDirty = true;
}
function completeStep(id) {
  const idx = STEPS.findIndex(s => s.id === id);
  if (idx < 0 || state.done[id]) return;
  const missing = (STEPS[idx].requires || []).filter(r => STEPS.some(s => s.id === r) && !state.done[r]);
  state.done[id] = true;
  if (missing.length) { state.score -= 5; addLog(`手順の順番が違います（先に「${STEPS.find(s => s.id === missing[0]).label}」）−5`, 'warn'); }
  addLog(`✔ ${STEPS[idx].label}`, 'ok');
  checkFinished();
  uiDirty = true;
}
function checkFinished() {
  if (!state.finished && state.flowDone && STEPS.every(s => state.done[s.id])) {
    state.finished = true; state.score = Math.max(0, state.score);
    addLog(`トレーニング終了  スコア ${state.score} 点`, 'ok');
  }
}
const penalty = (pts, msg) => { state.score -= pts; addLog(`${msg} −${pts}`, 'bad'); };

// ---------------------------------------------------------------- セットアップ
let renderer, scene, camera, dolly, clock, orbit, uiDirty = true, T, P, room, setBox, settings, gloveMat, skinMat, steth, gloveBox, echo;
const controllers = [];
const tools = {}, toolList = [], interactables = [], pressables = [];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q = new THREE.Quaternion();

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe6ec);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 50);
  camera.position.set(0.45, 1.5, 0.55);
  dolly = new THREE.Group();
  dolly.add(camera);
  scene.add(dolly);
  clock = new THREE.Clock();
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0.1, 0.95, C.ARM_Z);
  orbit.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a949c, 0.35));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(1.2, 3.2, 1.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 9;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -3.2;
  sun.shadow.camera.right = sun.shadow.camera.top = 3.2;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.01;
  scene.add(sun);
  const fill = new THREE.PointLight(0xfff2e0, 0.5, 6, 1.5); fill.position.set(-0.5, 2.3, 0.8); scene.add(fill);

  T = createTextures();
  gloveMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T.glove, normalMap: T.skinNormal, normalScale: new THREE.Vector2(0.15, 0.15), roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.35 });
  // 術者の素手（開始時。手袋を装着すると gloveMat に切り替わる）
  skinMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T.skin, normalMap: T.skinNormal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.58, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffd9c8), clearcoat: 0.04, clearcoatRoughness: 0.5 });
  room = buildRoom(scene, T);
  P = buildPatient(scene, T, config.vessel, { deep: config.deep });
  echo = createEcho(renderer, T);
  buildTools();
  { const seed = new URLSearchParams(location.search).get('seed'); if (seed !== null) P.vessel.pickSites(Number(seed)); }   // 穿刺部位の組み合わせを固定（確認用）
  buildSteps();
  buildUI();
  setupControllers();
  setupVRButton();
  updateSettingLabels();

  const qs = new URLSearchParams(location.search);
  if (qs.get('cam')) {
    const a = qs.get('cam').split(',').map(Number);
    camera.position.set(a[0], a[1], a[2]); orbit.target.set(a[3], a[4], a[5]); orbit.update();
  }
  if (qs.get('debug') === 'pinch') {
    // ピンチ把持の確認: 右手に金属針、左手に留置針（gripSpace 相当のグループに手を載せ、同じ計算で針を配置）
    // 手は穿刺時の姿勢（回内位で手の甲が上、指先は前下方 30°）
    const pitch = Number(qs.get('pitch') || 30) * Math.PI / 180;
    if (qs.get('tilt')) PROBE_TILT = Number(qs.get('tilt'));
    for (const [side, type, pos] of [['right', 'metal', [0.22, 1.1, -0.3]], ['left', 'cannula', [-0.05, 1.1, -0.3]]]) {
      const grip = new THREE.Group(); grip.position.fromArray(pos);
      const f = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));                       // 指先方向
      const Y = f.clone().negate(), back = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch));
      let X = side === 'right' ? back : back.clone().negate(), Z = new THREE.Vector3().crossVectors(X, Y);
      if (qs.get('pose') === 'hs') {   // 握手の形（指先が前、親指が上、掌が内側）: コントローラーを自然に構えた姿勢
        X = new THREE.Vector3(1, 0, 0); Y.set(0, 0, 1); Z = new THREE.Vector3(0, -1, 0);
      }
      grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
      const h = loadHand(side, gloveMat); const pose = gripPose(side);
      h.group.quaternion.copy(pose.quaternion); h.group.position.copy(pose.position);
      grip.add(h.group); scene.add(grip);
      if (qs.get('tool') === 'probe') {
        // プローブを持った姿勢（右手: 本番と同じ probePlacement で配置）。左手には手の甲にテープを 2 枚貼った状態
        if (side === 'right') { const pr = makeProbe(); grip.add(pr); h.ready.then(() => probePlacement(h, grip, grip, side, pr)); }
        else {
          h.ready.then(() => {
            h.setCurl({ thumb: 0.3, index: 0.25, middle: 0.3, ring: 0.3, pinky: 0.35 });
          });
          const fakeCs = { grip, side }; stickTapeOnHand(tools.tape0, fakeCs); stickTapeOnHand(tools.tape1, fakeCs);
        }
        continue;
      }
      const n = makeNeedle(type === 'metal' ? 0xd9303a : 0x2f6fd0, type); grip.add(n);
      if (qs.get('curl')) { const [i, m, r, p, o] = qs.get('curl').split(',').map(Number); PINCH_CURL[side] = { ...PINCH_CURL[side], index: i, middle: m, ring: r, pinky: p, thumbOpp: (side === 'right' ? 1 : -1) * o }; }
      h.ready.then(() => { setWingsFolded(n, true); pinchPlacement(h, grip, grip, side, n, n); });
    }
  } else if (qs.get('debug') === 'hand') {
    // 指の曲げ値の確認: 右手を並べ、親指先（赤）と人差し指先（緑）に印
    // 列 = 人差し指の曲げ、行 = 母指の対立量（ops）。掌をカメラ側（+z）に向け、指先は -x、母指は上
    const th = Number(qs.get('t') ?? 1), oa = qs.get('oa') || 'z', ic0 = Number(qs.get('i') ?? 0.3);
    const ops = (qs.get('ops') || '0,0.4,0.8,-0.4').split(',').map(Number);
    const side = qs.get('side') || 'right';
    ops.forEach((op, r) => [0, 1, 2, 3].forEach((i) => {
      const ic = ic0 + i * 0.15;
      const grip = new THREE.Group(); grip.position.set(-0.33 + i * 0.22, 1.42 - r * 0.22, -0.3);
      // 母指側（gripSpace の -Z）をカメラ (+z) に向け、指先は -x、手の甲は上
      const m = side === 'right'
        ? new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1))
        : new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1));
      grip.quaternion.setFromRotationMatrix(m);
      const h = loadHand(side, gloveMat); const pose = gripPose(side);
      h.group.quaternion.copy(pose.quaternion); h.group.position.copy(pose.position);
      grip.add(h.group); scene.add(grip);
      h.ready.then(() => {
        h.setCurl({ thumb: th, index: ic, middle: 0.8, ring: 0.9, pinky: 0.95, thumbOpp: op, thumbOppAxis: oa });
        const mk = (bone, col) => { const s = new THREE.Mesh(new THREE.SphereGeometry(0.005, 10, 8), new THREE.MeshBasicMaterial({ color: col })); bone.add(s); };
        mk(h.tips.thumb, 0xff0000); mk(h.tips.index, 0x00ff00);
        grip.updateMatrixWorld(true);
        const gap = h.tips.thumb.getWorldPosition(new THREE.Vector3()).distanceTo(h.tips.index.getWorldPosition(new THREE.Vector3()));
        console.log(`[hand] side=${side} thumb=${th} index=${ic.toFixed(2)} opp=${op} axis=${oa} tipGap=${(gap * 1000).toFixed(1)}mm`);
      });
    }));
  } else if (qs.get('debug')) {
    const dr = loadHand('right', gloveMat), dl = loadHand('left', gloveMat);
    dr.group.position.set(0.25, 1.08, -0.35); dr.group.rotation.set(-1.4, 0.3, 0.4);
    dl.group.position.set(0.0, 1.05, -0.4); dl.group.rotation.set(-1.0, -0.4, -0.3);
    dr.ready.then(h => h.setCurl({ thumb: 0.8, index: 0.9, middle: 0.9, ring: 0.9, pinky: 0.9 }));
    dl.ready.then(h => h.setCurl({ thumb: 0.1, index: 0.1, middle: 0.2, ring: 0.2, pinky: 0.2 }));
    scene.add(dr.group); scene.add(dl.group);
  }
  if (qs.get('demo')) setTimeout(demoState, 500);
  if (qs.get('debug') === 'echo') setTimeout(() => debugEcho(qs), 600);   // プローブを腕に当てた状態（axis=short|long, needle=1）
  if (qs.get('test') === 'grab') setTimeout(selfTestGrab, 800);          // 全器具の「掴む」自己テスト（結果はコンソールへ）
  if (qs.get('lift')) P.setLift(Number(qs.get('lift')));   // 前腕の持ち上げ確認（rad）

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  renderer.setAnimationLoop(loop);
}

// ---------------------------------------------------------------- 器具の配置
function registerTool(name, obj, o) {
  obj.position.fromArray(o.pos);
  if (o.rotY) obj.rotation.y = o.rotY;
  if (o.quat) obj.quaternion.copy(o.quat);
  const tool = {
    name, obj, kind: o.kind || name, site: o.site,
    homePos: obj.position.clone(), homeQuat: obj.quaternion.clone(),
    gripPos: new THREE.Vector3().fromArray(o.gripPos),
    gripQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.gripEuler || [0, 0, 0]))),
    locked: !!o.locked, held: null, fixed: false, stuck: false, taped: false,
    grabOffset: new THREE.Vector3().fromArray(o.grabOffset || [0, 0, 0]), grabR: o.grabR || GRAB_DIST,   // 掴む判定の中心（ローカル）と半径（大きな器具用）
    punctured: false, inVessel: false, perforated: false, angle: 0, everFlash: false, flashDepth: 0, lastDepth: 0, styletOut: false, styletAnim: -1,
  };
  scene.add(obj);
  tools[name] = tool; toolList.push(tool);
  return tool;
}
function removeTool(name) {
  const t = tools[name];
  if (!t) return;
  if (t.held) t.held.held = null;
  t.obj.removeFromParent();
  delete tools[name];
  toolList.splice(toolList.indexOf(t), 1);
}
function createNeedles() {
  removeTool('needleA'); removeTool('needleV');
  const yaw = C.TRAY.yaw, tp = C.trayPos;
  registerTool('needleA', makeNeedle(0xd9303a, config.needle), { pos: tp(0.25, 0.004, 0.07), rotY: -Math.PI / 2 + yaw, gripPos: [0, -0.012, -0.05], kind: 'needle', site: 'A' });
  registerTool('needleV', makeNeedle(0x2f6fd0, config.needle), { pos: tp(0.25, 0.004, 0.14), rotY: -Math.PI / 2 + yaw, gripPos: [0, -0.012, -0.05], kind: 'needle', site: 'V' });
}

// 物理ボタン（指先で押し込むと沈み、底まで押すと動作）
function registerButton(name, holder, onPress, extra = {}) {
  const ud = holder.userData;
  const cap = extra.cap || ud.cap;
  const b = {
    name, cap, rest: cap.position.clone(),
    axis: new THREE.Vector3().fromArray(extra.axis || ud.axis || [0, -1, 0]).normalize(),
    topOffset: new THREE.Vector3().fromArray(extra.topOffset || ud.topOffset || [0, 0, 0]),
    travel: extra.travel ?? ud.travel ?? 0.006, hitR: extra.hitR ?? ud.hitR ?? 0.03,
    palm: !!(extra.palm ?? ud.palm),   // 掌でも押せる（指差し姿勢でなくてもよい）
    onPress, depth: 0, latched: false, by: null,
  };
  pressables.push(b);
  return b;
}

function buildTools() {
  const yaw = C.TRAY.yaw, tp = C.trayPos;
  // 聴診器: チェストピースが把持対象。トレイ上では静的モデルを表示
  steth = makeStethoscopeSet();
  steth.tray.position.fromArray(tp(-0.17, 0.001, -0.1)); steth.tray.rotation.y = Math.PI + yaw; scene.add(steth.tray);
  steth.chest.visible = false; steth.binaural.visible = false;
  steth.tube = new THREE.Mesh(new THREE.BufferGeometry(), steth.tubeMat); steth.tube.visible = false; steth.tube.frustumCulled = false; scene.add(steth.tube);
  scene.add(steth.binaural);
  registerTool('stethoscope', steth.chest, { pos: tp(-0.17, 0.004, -0.1), rotY: yaw, gripPos: [0, -0.02, -0.07] });
  registerTool('tourniquet', makeTourniquet(T, P.tourniquet.r), { pos: tp(-0.25, 0, 0.17), rotY: yaw, gripPos: [0, -0.01, -0.07] });
  createNeedles();

  setBox = makeSetBox(T);
  setBox.position.fromArray(tp(0.15, 0, -0.08)); setBox.rotation.y = yaw;
  scene.add(setBox);
  interactables.push({ name: 'setbox', obj: setBox, radius: 0.13, onSelect: openSet });   // 箱の中心付近だけ（隣の針を掴む操作を奪わない）
  registerTool('sheet', makeFoldedDrape(T), { pos: tp(0.1, 0.004, -0.08), rotY: yaw, gripPos: [0, -0.02, -0.06], locked: true });
  const gauze = makeGauze(); gauze.position.fromArray(tp(0.21, 0.004, -0.04)); gauze.rotation.y = yaw; scene.add(gauze);
  // エコー: プローブ立て（カートのベッド側の端）とプローブ。持つと手の前でレンズ面が前下方を向く
  // カートのベッド側の端 = エコーのコーナー（聴診器トレイから 12cm 以上離す）: プローブ立て + ゼリー、タブレットは画面を上にして寝かせて置く
  const holder = makeProbeHolder(); holder.position.fromArray(tp(-0.49, 0, 0.12)); holder.rotation.y = yaw; scene.add(holder);
  // 持ち方（リニアプローブの標準）: 先端近く（下側）を親指・人差し指・中指で軽く挟み、プローブは皮膚に垂直。小指側を患者に添えて支える。
  // → レンズ面は手の下（指先の少し先）で真下を向き、持ち手は手の中を上へ抜ける。走査面は手の前後方向（腕に向かって立てば短軸）
  registerTool('probe', makeProbe(), { pos: tp(-0.49, 0.012, 0.12), rotY: yaw + Math.PI / 2, gripPos: [0, -0.075, -0.05], gripEuler: [0, Math.PI / 2, 0], kind: 'probe', grabOffset: [0, 0.09, 0], grabR: 0.16 });   // 持ち手の中ほどを掴む
  // iViz air のタブレットは固定せず、手で持って好きな所に置ける（ベッドの上、患者の体と腕の間に立て掛ける、カートの上など）
  registerTool('tablet', echo.tablet, { pos: tp(-0.47, 0.006, -0.12), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ')), gripPos: [0, 0.02, -0.12], gripEuler: [-0.35, 0, 0], kind: 'tablet', grabR: 0.2 });
  tools.tablet.obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // 開始セット（カート手前側の端）: 手袋の箱・手指消毒薬（room 側で配置）・個包装アルコール綿
  gloveBox = makeGloveBox(T); gloveBox.position.fromArray(tp(0.46, 0, -0.1)); gloveBox.rotation.y = yaw; scene.add(gloveBox);
  // 次の手袋は取り出し口から指先を上にして顔を出している（穿刺者側へ少し傾く）
  const slot = gloveBox.localToWorld(gloveBox.userData.slot.clone());
  registerTool('glove', makeGlove(gloveMat), { pos: [slot.x, slot.y, slot.z], quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-0.45, 0.85, 0.1).normalize()), gripPos: [0, -0.01, -0.05], gripEuler: [Math.PI / 2, 0, 0], kind: 'glove' });
  const basin = tp(-0.15, -0.42, 0.1);   // 使用済みの綿・パウチは下段の膿盆へ
  for (let i = 0; i < 2; i++) {
    registerTool('pouch' + i, makeAlcoholPouch(T), { pos: tp(0.41 + i * 0.065, 0.003, 0.2 - i * 0.004), rotY: yaw + 0.1 * (i - 0.5), gripPos: [0, -0.012, -0.05], gripEuler: [0, Math.PI / 2, 0], kind: 'pouch' });
    tools['pouch' + i].obj.userData.swab = 'swab' + i;
    registerTool('swab' + i, makeSwab(), { pos: [basin[0] + i * 0.03, basin[1], basin[2]], rotY: yaw, gripPos: [0, -0.012, -0.05], locked: true, kind: 'cotton' });
    tools['swab' + i].obj.visible = false;
  }
  for (let i = 0; i < 4; i++) registerTool('tape' + i, makeTapeStrip(), { pos: tp(-0.12, 0.0015 + i * 0.001, 0.11 + i * 0.025), rotY: yaw, gripPos: [0, -0.015, -0.06], gripEuler: [0, Math.PI / 2, 0], kind: 'tape' });
  for (const site of ['A', 'V']) {
    const h = room.lines.home[site];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.dir);
    registerTool('conn' + site, makeConnector(site === 'A' ? 0xd9303a : 0x2f6fd0), { pos: [h.pos.x, h.pos.y, h.pos.z], quat: q, gripPos: [0, -0.01, -0.06], kind: 'connector', site });
  }

  // カート上のリセットボタン（前面寄り）
  const reset = makeResetButton(T); reset.position.fromArray(tp(0.06, 0, 0.2)); reset.rotation.y = yaw; scene.add(reset);
  registerButton('reset', reset, resetAll);
  registerButton('pump', room.pumpButton, startPump);
  // 手指消毒薬は指先でも掌でも押せる（トリガー不要）
  registerButton('sanitizer', room.sanitizer, () => { if (!state.done.hygiene) { addLog('手指衛生を実施 ✔', 'ok'); completeStep('hygiene'); } else addLog('手指衛生は実施済みです', 'info'); }, { palm: true });

  // 設定用サイドテーブル（穿刺者の左後方。パネルとリセットボタンは穿刺者側を向く）
  const ST = C.SIDE_TABLE;
  const table = new THREE.Group(); table.position.set(ST.x, 0, ST.z);
  const tm = new THREE.MeshStandardMaterial({ map: T.stainless, metalness: 0.9, roughness: 0.3 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.3), tm); top.position.y = ST.y; top.castShadow = true; top.receiveShadow = true; table.add(top);
  for (const [x, z] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.12], [0.18, 0.12]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, ST.y - 0.01, 10), tm); leg.position.set(x, (ST.y - 0.01) / 2, z); table.add(leg);
  }
  table.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.28), tm).translateY(0.25));   // 下段棚
  scene.add(table);
  settings = makeSettingsPanel(T);
  settings.group.position.set(ST.x - 0.07, ST.y + 0.01, ST.z); settings.group.rotation.y = ST.yaw;
  scene.add(settings.group);
  for (const b of settings.buttons) registerButton(b.name, settings.group, () => toggleSetting(b.name), b);
  const reset2 = makeResetButton(T); reset2.position.set(ST.x + 0.12, ST.y + 0.01, ST.z - 0.09); reset2.rotation.y = ST.yaw; scene.add(reset2);
  registerButton('reset2', reset2, resetAll);
}

// 指先がボタンのキャップに触れると押し込み量に応じて沈み、底付きで動作する
const _bv = new THREE.Vector3(), _bv2 = new THREE.Vector3(), _bv3 = new THREE.Vector3();
const FINGER_R = 0.008, PALM_R = 0.022;
function updateButtons(dt) {
  for (const b of pressables) {
    const parent = b.cap.parent;
    let target = 0, by = null;
    for (const cs of controllers) {
      // 押す点: 指差し姿勢なら人差し指の先、palm ボタンは何も持っていない手の掌でも可
      for (let k = 0; k < 2; k++) {
        let R;
        if (k === 0) { if (!cs.pointing) continue; fingerTip(cs, _bv); R = FINGER_R; }
        else { if (!b.palm || cs.held || cs.wrist) continue; palmPoint(cs, _bv); R = PALM_R; }
        parent.worldToLocal(_bv);
        _bv2.copy(b.rest).add(b.topOffset);
        _bv.sub(_bv2);
        const along = _bv.dot(b.axis) + R;                 // 押し込み方向の侵入量（指/掌の厚み分を加味）
        _bv3.copy(b.axis).multiplyScalar(along - R);
        const lat = _bv.sub(_bv3).length();                // キャップ中心からの横ずれ
        if (lat < b.hitR + (k ? 0.02 : 0) && along > -0.012 && along < b.travel + 0.035) {
          const d = Math.min(b.travel, Math.max(0, along));
          if (d > target) { target = d; by = cs; }
        }
      }
    }
    // 押し込みは即時に追従、離すとバネで戻る
    b.depth = target >= b.depth ? target : b.depth + (target - b.depth) * Math.min(1, dt * 16);
    b.cap.position.copy(b.rest).addScaledVector(b.axis, b.depth);
    if (!b.latched && b.depth >= b.travel * 0.85) {
      b.latched = true;
      if (by) haptic(by, 0.6, 50);
      b.onPress(by);
    } else if (b.latched && b.depth < b.travel * 0.3) b.latched = false;
  }
}

function toggleSetting(name) {
  if (name === 'vessel') config.vessel = config.vessel === 'avf' ? 'avg' : 'avf';
  else if (name === 'needle') config.needle = config.needle === 'metal' ? 'cannula' : 'metal';
  else config.deep = !config.deep;
  P.setVesselType(config.vessel, { deep: config.deep });
  updateSettingLabels();
  resetAll();
  addLog(`設定変更: ${C.VESSEL_TYPES[config.vessel].label} / ${C.NEEDLE_TYPES[config.needle].label}` + (config.deep && config.vessel === 'avf' ? ' / 深い血管（エコー下）' : ''), 'info');
}
function updateSettingLabels() {
  T.labels.vessel.draw('血管タイプ', config.vessel === 'avf' ? '自己血管\nAVF' : '人工血管\nAVG (U字)');
  T.labels.needle.draw('針タイプ', config.needle === 'metal' ? '金属翼状針' : 'カニューラ型\n留置針');
  T.labels.depth.draw('血管の深さ', config.deep ? '深い\n（エコー下）' : '標準');
}

// ---------------------------------------------------------------- UI パネル
let uiCanvas, uiCtx, uiTex;
function buildUI() {
  uiCanvas = document.createElement('canvas'); uiCanvas.width = 1024; uiCanvas.height = 760;
  uiCtx = uiCanvas.getContext('2d');
  uiTex = new THREE.CanvasTexture(uiCanvas); uiTex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group(); g.position.set(-0.3, 1.55, -1.42); g.rotation.y = 0.25;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.7, 0.03), new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5 }));
  g.add(frame);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.653), new THREE.MeshBasicMaterial({ map: uiTex }));
  panel.position.z = 0.016; g.add(panel);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 10), new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.8, roughness: 0.3 }));
  stand.position.set(0, -0.95, 0); g.add(stand);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5 }));
  foot.position.set(0, -1.54, 0); g.add(foot);
  scene.add(g);
  drawUI();
}
function wrap(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const ch of text) { if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch; }
  if (line) lines.push(line);
  return lines;
}
function drawUI() {
  const c = uiCtx, W = uiCanvas.width, H = uiCanvas.height;
  c.fillStyle = '#10233a'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1b3b5e'; c.fillRect(0, 0, W, 86);
  c.fillStyle = '#fff'; c.font = 'bold 40px sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText('透析室 穿刺トレーニング', 28, 36);
  c.fillStyle = '#9fd3ff'; c.font = '22px sans-serif';
  c.fillText(`${C.VESSEL_TYPES[config.vessel].label}  /  ${C.NEEDLE_TYPES[config.needle].label}`, 28, 70);
  c.textAlign = 'right'; c.font = 'bold 40px sans-serif';
  c.fillStyle = state.score >= 80 ? '#7ee8a2' : state.score >= 50 ? '#ffd166' : '#ff7b7b';
  c.fillText(`スコア ${Math.max(0, state.score)}`, W - 28, 43);
  c.textAlign = 'left';
  const cur = currentStep();
  const sp = Math.min(25.5, 432 / STEPS.length);
  c.font = `${sp < 23 ? 19 : 21}px sans-serif`;
  STEPS.forEach((s, i) => {
    const y = 108 + i * sp, done = !!state.done[s.id], isCur = cur && cur.id === s.id;
    if (isCur) { c.fillStyle = 'rgba(255,209,102,0.18)'; c.fillRect(16, y - sp / 2, 570, sp); }
    c.fillStyle = done ? '#7ee8a2' : isCur ? '#ffd166' : '#9fb3c8';
    c.fillText(`${done ? '☑' : '☐'} ${i + 1}. ${s.label}`, 28, y);
  });
  c.fillStyle = '#17304d'; c.fillRect(600, 100, W - 624, 430);
  c.fillStyle = '#ffd166'; c.font = 'bold 24px sans-serif';
  wrap(c, state.finished ? '結果' : (cur ? `次: ${cur.label}` : ''), W - 650).forEach((l, i) => c.fillText(l, 616, 126 + i * 28));
  c.fillStyle = '#e8eef7'; c.font = '21px sans-serif';
  const hint = state.finished ? `スコア ${Math.max(0, state.score)} 点。カートの赤いボタン、または B/Y ボタン長押しでリセットして再挑戦できます。左のサイドテーブルで血管・針のタイプを切り替えられます。` : (cur ? cur.hint : '');
  wrap(c, hint, W - 650).forEach((l, i) => c.fillText(l, 616, 188 + i * 27));
  if (state.info) {
    c.fillStyle = '#9ad7ff'; c.font = 'bold 23px sans-serif';
    wrap(c, state.info, W - 650).forEach((l, i) => c.fillText(l, 616, 410 + i * 28));
  }
  c.fillStyle = '#0b1a2c'; c.fillRect(16, 548, W - 32, 176);
  c.font = '21px sans-serif';
  state.log.slice(-5).forEach((l, i) => {
    c.fillStyle = { ok: '#7ee8a2', warn: '#ffd166', bad: '#ff7b7b', info: '#cfe0f0' }[l.kind];
    c.fillText(l.msg, 32, 572 + i * 33);
  });
  c.fillStyle = '#6f8aa6'; c.font = '19px sans-serif';
  c.fillText('左スティック: 移動   右スティック: 向き（左右）/ 高さ（上下）   B または Y 長押し: リセット', 28, 742);
  uiTex.needsUpdate = true; uiDirty = false;
}

// ---------------------------------------------------------------- コントローラー（手として表示）
function setupControllers() {
  for (let i = 0; i < 2; i++) {
    const ctrl = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const hands = {};
    for (const side of ['right', 'left']) {
      const h = loadHand(side, skinMat);   // 開始時は素手
      const pose = gripPose(side);
      h.group.quaternion.copy(pose.quaternion); h.group.position.copy(pose.position);
      const holder = new THREE.Group(); holder.add(h.group);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.033, 0.06, 20), skinMat); cuff.position.y = 0.1; holder.add(cuff);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.037, 0.07, 20), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.95 })); sleeve.position.y = 0.16; holder.add(sleeve);
      grip.add(holder);
      hands[side] = { api: h, holder, cuff };
    }
    const cs = { ctrl, grip, hands, side: i === 0 ? 'right' : 'left', held: null, wrist: false, inputSource: null, lastPos: new THREE.Vector3(), selectPressed: false, squeezePressed: false, lastBeat: -1, byHold: 0, turned: false };
    setHandSide(cs, cs.side);
    ctrl.addEventListener('connected', e => { cs.inputSource = e.data; setHandSide(cs, e.data.handedness === 'left' ? 'left' : 'right'); });
    ctrl.addEventListener('disconnected', () => { cs.inputSource = null; });
    ctrl.addEventListener('selectstart', () => { cs.selectPressed = true; onSelectStart(cs); });
    ctrl.addEventListener('selectend', () => { cs.selectPressed = false; onSelectEnd(cs); });
    ctrl.addEventListener('squeezestart', () => { cs.squeezePressed = true; onSqueezeStart(cs); });
    ctrl.addEventListener('squeezeend', () => { cs.squeezePressed = false; onSelectEnd(cs); });
    dolly.add(ctrl); dolly.add(grip);
    controllers.push(cs);
  }
  renderer.xr.addEventListener('sessionstart', () => { initAudio(); orbit.enabled = false; });
  renderer.xr.addEventListener('sessionend', () => { orbit.enabled = true; });
}
function setHandSide(cs, side) {
  cs.side = side;
  cs.hands.right.holder.visible = side === 'right';
  cs.hands.left.holder.visible = side === 'left';
  cs.hand = cs.hands[side].api;
}
function haptic(cs, intensity = 0.5, ms = 60) {
  const act = cs.inputSource?.gamepad?.hapticActuators?.[0];
  if (act?.pulse) act.pulse(intensity, ms);
}
function fingerTip(cs, out) {
  const tip = cs.hand?.tips?.index;
  return tip ? tip.getWorldPosition(out) : cs.ctrl.getWorldPosition(out);
}
// 掌の中心（gripSpace 原点から掌側へ 2cm: 右手は -X、左手は +X）
function palmPoint(cs, out) {
  cs.grip.getWorldPosition(out);
  _v4.set(cs.side === 'right' ? -1 : 1, 0, 0).applyQuaternion(cs.grip.getWorldQuaternion(_q));
  return out.addScaledVector(_v4, 0.02);
}
// 手袋の装着状態を手のモデルへ反映（両コントローラーの同じ側の手に適用）
function setGloved(side, on) {
  state.gloved[side] = on;
  const m = on ? gloveMat : skinMat;
  for (const cs of controllers) {
    const H = cs.hands[side];
    H.api.group.traverse(o => { if (o.isMesh) o.material = m; });
    H.cuff.material = m;
  }
}
// 患者に触れる操作の前に手袋の装着を確認（未装着なら一度だけ減点）
function requireGloves() {
  if (state.gloved.right && state.gloved.left) return true;
  if (!state.gloveWarned) { state.gloveWarned = true; penalty(5, '手袋を装着せずに患者に触れました（標準予防策）'); }
  return false;
}
const otherController = cs => cs.other || controllers.find(c => c !== cs);
// 手の甲の表面の点（gripSpace 原点から甲側へ 2cm: 右手は +X、左手は -X）
function backOfHand(cs, out) {
  cs.grip.getWorldPosition(out);
  _v4.set(cs.side === 'right' ? 1 : -1, 0, 0).applyQuaternion(cs.grip.getWorldQuaternion(_q));
  return out.addScaledVector(_v4, 0.02);
}
// 固定用テープを反対の手の甲（手袋の上）に貼っておく: 穿刺したらすぐ剥がして固定できる。最大 4 枚（手首側へ並ぶ）
// [手首方向の位置 y, 甲の表面までの距離 x]（手のモデルの甲は指の付け根〜中央で原点から 10〜11mm、手首側で 14〜17mm）
const TAPE_SLOTS = [[0.012, 0.012], [0.030, 0.012], [0.048, 0.0145], [0.066, 0.017]];
function stickTapeOnHand(tool, oc) {
  const used = toolList.filter(t => t.kind === 'tape' && t.onHand === oc).map(t => t.slot);
  const slot = TAPE_SLOTS.findIndex((_, i) => !used.includes(i));
  if (slot < 0) { addLog('手の甲にはこれ以上テープを貼れません', 'info'); return false; }
  tool.onHand = oc; tool.slot = slot; tool.fixed = false;
  oc.grip.add(tool.obj);
  const sx = oc.side === 'right' ? 1 : -1;
  tool.obj.position.set(sx * TAPE_SLOTS[slot][1], TAPE_SLOTS[slot][0], 0);
  tool.obj.rotation.set(Math.PI / 2, 0, -sx * Math.PI / 2); tool.obj.scale.setScalar(1);   // 粘着面を甲に、長さ方向は手を横切る向き
  addLog(`テープを${oc.side === 'right' ? '右' : '左'}手の甲に貼りました（穿刺後にここから剥がして固定）`, 'info');
  return true;
}
const headPos = out => camera.getWorldPosition(out);

function onSqueezeStart(cs) {
  if (cs.held?.kind === 'needle' && cs.held.obj.userData.type === 'cannula' && cs.held.punctured) { withdrawStylet(cs.held, cs); return; }
  onSelectStart(cs);
}
function onSelectStart(cs) {
  initAudio();
  cs.ctrl.getWorldPosition(_v);
  // トリガーで操作する対象（セット箱の開封。開封後は無効）。ボタン類は指で押し込む物理ボタン（updateButtons）
  if (cs.held) return;
  for (const it of interactables) {
    if (it.name === 'setbox' && state.setOpen) continue;
    it.obj.getWorldPosition(_v2);
    if (_v.distanceTo(_v2) < it.radius) { it.onSelect(cs); haptic(cs, 0.4, 40); return; }
  }
  // 留置したカニューラ針の内筒ハブをつまむ → 内筒抜去（手の位置と指先の位置のどちらかがハブから 12cm 以内。針を掴み直すより優先）
  fingerTip(cs, _v3);
  for (const t of toolList) {
    if (t.kind !== 'needle' || t.obj.userData.type !== 'cannula' || t.styletOut) continue;
    if (!(t.stuck || (t.held && t.held !== cs && t.punctured))) continue;
    t.obj.localToWorld(_v2.set(0, 0, 0.03));
    if (Math.min(_v.distanceTo(_v2), _v3.distanceTo(_v2)) < 0.12) { withdrawStylet(t, cs); return; }
  }
  // 金属針のクランプ（留置中・固定後）
  for (const t of toolList) {
    if (t.kind !== 'needle' || !t.obj.userData.clamp || !(t.stuck || t.held)) continue;
    if (t.held === cs) continue;
    t.obj.localToWorld(_v2.set(0.003, -0.007, 0.11));
    if (_v.distanceTo(_v2) < 0.045) { toggleClamp(t); haptic(cs, 0.4, 40); return; }
  }
  // 装着中の駆血帯に手を近づけてトリガー → 外す（手に持った状態になる）
  {
    const tq = tools.tourniquet;
    if (tq && tq.fixed && state.tourniquetOn && _v.distanceTo(P.tourniquet.pos) < 0.13) { removeTourniquet(cs); return; }
  }
  // 反対の手が持っているアルコール綿のパウチに触れてトリガー → 開封 → 綿を取り出す
  for (const t of toolList) {
    if (t.kind !== 'pouch' || !t.held || t.held === cs) continue;
    t.obj.getWorldPosition(_v2);
    if (_v.distanceTo(_v2) > 0.1) continue;
    const ud = t.obj.userData;
    if (!ud.torn) { setPouchTorn(t.obj, true); haptic(cs, 0.5, 50); haptic(t.held, 0.3, 50); addLog('アルコール綿のパウチを開封しました → 中の綿を取り出す', 'info'); return; }
    if (!ud.taken) { takeSwab(cs, t); return; }
  }
  // 指先が物理ボタンのすぐ近くなら「押す」意図とみなし、近くの器具を誤って掴まない
  fingerTip(cs, _v3);
  for (const b of pressables) {
    b.cap.parent.localToWorld(_v2.copy(b.rest).add(b.topOffset));
    if (_v3.distanceTo(_v2) < b.hitR + 0.04) return;
  }
  // 患者の手首を持つ → 前腕を肘から持ち上げられる（針が刺さっている間は不可）
  if (_v.distanceTo(P.wristNow(_v2)) < 0.1 && !toolList.some(t => t.kind === 'needle' && (t.stuck || t.punctured))) {
    cs.wrist = true; cs.lastPose = ''; haptic(cs, 0.3, 30);
    addLog('患者の手首を持ちました（上げると前腕が持ち上がります）', 'info');
    return;
  }
  // 最も近い器具を掴む（判定中心と半径は器具ごと。半径からの余裕が最も大きいものを選ぶ）
  let best = null, bestD = 0;
  for (const t of toolList) {
    if (t.held || t.fixed || t.locked || t.taped) continue;
    if (t.onHand === cs) continue;                       // 自分の手の甲に貼ったテープは反対の手で剥がす
    t.obj.localToWorld(_v2.copy(t.grabOffset));
    const d = (t.onHand ? 0.06 : t.grabR) - _v.distanceTo(_v2);
    if (d > bestD) { best = t; bestD = d; }
  }
  if (best) grab(cs, best);
}
function grab(cs, tool) {
  // 留置した留置針の内筒がまだ入っている間は、ハブをつまむ = 内筒を抜く操作（針を掴み直すのは内筒抜去後）
  if (tool.kind === 'needle' && tool.stuck && tool.obj.userData.type === 'cannula' && !tool.styletOut) { withdrawStylet(tool, cs); return; }
  tool.held = cs; cs.held = tool;
  if (tool.onHand) { tool.onHand = null; tool.slot = -1; }
  cs.ctrl.add(tool.obj);
  tool.obj.scale.setScalar(1);
  if (tool.kind === 'needle' && cs.hand.loaded) {
    // 親指と人差し指の指先の間に、翼（金属針）/ 内筒ハブ（留置針）が挟まる位置へ
    setWingsFolded(tool.obj, true);
    pinchPlacement(cs.hand, cs.grip, cs.ctrl, cs.side, tool.obj, tool.obj);
    cs.lastPose = '';
  } else if (tool.kind === 'probe' && cs.hand.loaded) {
    // 先端近くを親指と人差し指・中指で挟む（ペングリップ）。手の中の位置は毎フレームの接触計算の基準にもなる
    probePlacement(cs.hand, cs.grip, cs.ctrl, cs.side, tool.obj);
    tool.holdPos = tool.obj.position.clone(); tool.holdQuat = tool.obj.quaternion.clone();
    cs.lastPose = '';
  } else {
    tool.obj.position.copy(tool.gripPos);
    tool.obj.quaternion.copy(tool.gripQuat);
  }
  haptic(cs, 0.3, 30);
  if (tool.kind === 'needle') {
    if (tool.stuck) { tool.stuck = false; addLog(`${tool.site}針を持ち直しました（血管内に入るよう調整するか抜針）`, 'info'); }
    else resetNeedleState(tool);
  }
  if (tool.name === 'stethoscope') onStethGrab(cs);
  if (tool.kind === 'probe') { echo.setActive(true); if (!state.echoUsed) { state.echoUsed = true; addLog('エコープローブを持ちました。皮膚に当てると画面に断面が映ります（血管を横切る向き = 短軸）', 'info'); } }
}
// ピンチ姿勢の手で針をつまんだときの針の位置・向き（ctrl ローカル）。
// 指先方向へ針先を向け、翼/ハブの「つまみ位置」を親指・人差し指の指先の中点に合わせる
const _pp = { ti: new THREE.Vector3(), tt: new THREE.Vector3(), gq: new THREE.Quaternion(), fwd: new THREE.Vector3(), back: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), cq: new THREE.Quaternion() };
function pinchPlacement(hand, grip, ctrl, side, needleObj, out) {
  hand.setCurl(PINCH_CURL[side]);
  grip.updateMatrixWorld(true);
  hand.tips.index.getWorldPosition(_pp.ti); hand.tips.thumb.getWorldPosition(_pp.tt);
  // 挟む軸 = 親指の先 → 人差し指の先。折った翼（留置針では内筒ハブ）の両面がこの軸に垂直になるように針を置く
  _pp.x.subVectors(_pp.ti, _pp.tt).normalize();                                   // 針ローカル +x（翼の面の法線方向）
  const pinch = _pp.ti.add(_pp.tt).multiplyScalar(0.5);                           // 指の腹が触れ合う点
  grip.getWorldQuaternion(_pp.gq);
  // 針の軸は手の前方（gripSpace の -Y = 指の付け根から指先へ向かう手の向き）に沿わせ、掌側へ 15° 傾ける。
  // 指の曲がりには追従させない（人差し指の末節が曲がっていても針は手の向きに沿って前へ出る）
  _pp.back.set(side === 'right' ? 1 : -1, 0, 0).applyQuaternion(_pp.gq);        // 手の甲方向
  _pp.fwd.set(0, -1, 0).applyQuaternion(_pp.gq).addScaledVector(_pp.back, -Math.tan(0.26));
  _pp.fwd.addScaledVector(_pp.x, -_pp.fwd.dot(_pp.x)).normalize();               // 挟む軸に垂直な成分だけ
  _pp.z.copy(_pp.fwd).negate();                                                   // 針ローカル -z = 針先方向
  _pp.y.crossVectors(_pp.z, _pp.x).normalize();                                   // 翼を立てた方向
  if (_pp.y.dot(_pp.back) < 0) { _pp.y.negate(); _pp.x.negate(); }               // 刃面（翼）は手の甲側を上に
  _pp.q.setFromRotationMatrix(_pp.m.makeBasis(_pp.x, _pp.y, _pp.z));
  _pp.p.fromArray(needleObj.userData.pinch).applyQuaternion(_pp.q);
  pinch.sub(_pp.p);                                                               // 針原点（ワールド）
  ctrl.updateMatrixWorld(true);
  out.position.copy(ctrl.worldToLocal(pinch));
  out.quaternion.copy(ctrl.getWorldQuaternion(_pp.cq).invert().multiply(_pp.q));
}
// エコープローブの持ち方: 手全体で本体を握る。広い面が掌に当たり、親指は手前の広い面、他の指は向こう側へ回り込む。
// 持ち手は親指の方向（自然に構えた手では真上）へ伸び、レンズ面は握った手の小指側の下（指はすべてレンズ面より上）
const _pr = { yaw: new THREE.Quaternion(), yAxis: new THREE.Vector3(0, 1, 0), gq: new THREE.Quaternion(), gp: new THREE.Vector3(), thumb: new THREE.Vector3(), up: new THREE.Vector3(), palm: new THREE.Vector3(), h: new THREE.Vector3(), x: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), cq: new THREE.Quaternion() };
function probePlacement(hand, grip, ctrl, side, out) {
  hand.setCurl(PROBE_CURL[side]);
  grip.updateMatrixWorld(true);
  grip.getWorldQuaternion(_pr.gq); grip.getWorldPosition(_pr.gp);
  _pr.thumb.set(0, 0, -1).applyQuaternion(_pr.gq);                                 // 親指の方向（自然に構えた手では真上）
  _pr.up.set(0, 1, 0).applyQuaternion(_pr.gq);                                    // 指先 → 手首の方向
  _pr.palm.set(side === 'right' ? -1 : 1, 0, 0).applyQuaternion(_pr.gq);          // 掌の法線（掌が向く方向）
  _pr.h.copy(_pr.thumb).multiplyScalar(Math.cos(PROBE_TILT)).addScaledVector(_pr.up, Math.sin(PROBE_TILT));
  _pr.h.addScaledVector(_pr.palm, -_pr.h.dot(_pr.palm)).normalize();              // 持ち手方向（プローブ +y）: 掌の面に沿う
  _pr.x.crossVectors(_pr.h, _pr.palm).normalize();                                // 広い面の法線 = 掌の法線（プローブ z）、幅方向は手の長さ方向
  _pr.q.setFromRotationMatrix(_pr.m.makeBasis(_pr.x, _pr.h, _pr.palm));
  _pr.q.multiply(_pr.yaw.setFromAxisAngle(_pr.yAxis, PROBE_YAW));                   // 持ち手軸まわりに回す（走査面の向き）
  const origin = _pr.gp.addScaledVector(_pr.palm, PROBE_FIST.palm).addScaledVector(_pr.up, PROBE_FIST.up).addScaledVector(_pr.thumb, PROBE_FIST.thumb).addScaledVector(_pr.h, -PROBE_HOLD_L);   // 握りの中心からレンズ面へ
  ctrl.updateMatrixWorld(true);
  out.position.copy(ctrl.worldToLocal(origin));
  out.quaternion.copy(ctrl.getWorldQuaternion(_pr.cq).invert().multiply(_pr.q));
}
// タブレットを立てる向き: 画面法線を dir（水平）へ向け、20° 後ろへもたれさせる
const TABLET_LEAN = 0.35, TABLET_H = 0.168;
function standingQuat(dir) {
  const yaw = Math.atan2(dir.x, dir.z);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(-TABLET_LEAN, yaw, 0, 'YXZ'));
}
// 置いた物を支える面の高さ（カート天面・サイドテーブル・ベッド（掛け布団/アームレスト/マットレス）・床）
function supportY(x, z) {
  if (Math.abs(x - C.TRAY.x) < C.TRAY_D / 2 && Math.abs(z - C.TRAY.z) < C.TRAY_W / 2) return C.TRAY.y;
  const ST = C.SIDE_TABLE;
  if (Math.abs(x - ST.x) < 0.21 && Math.abs(z - ST.z) < 0.15) return ST.y + 0.01;
  if (x > -1.05 && x < 1.05 && z > -1.45 && z < -0.45) {
    let y = C.BED_TOP;
    if (x > -0.505 && x < 0.545 && z > -0.66 && z < -0.46) y = Math.max(y, C.BED_TOP + C.CUSHION_H);
    const b = P.blanketY(x, z); if (b !== null) y = Math.max(y, b);
    return y;
  }
  return 0;
}
// タブレットを離した所に置く: ほぼ水平なら画面を上にして寝かせ、それ以外は立てて 20° 後ろへもたれさせる（患者の体側に立て掛ける使い方）
function placeTablet(tool) {
  const o = tool.obj;
  o.updateMatrixWorld(true);
  const pos = o.getWorldPosition(new THREE.Vector3());
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
  scene.attach(o); o.scale.setScalar(1);
  const s = supportY(pos.x, pos.z);
  if (Math.abs(n.y) > 0.7) {                                   // 寝かせる（画面上向き）。向きは手の向きを保つ
    const yaw = Math.atan2(n.x, n.z) + (n.y > 0 ? 0 : Math.PI);
    o.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, yaw, 0, 'YXZ'));
    o.position.set(pos.x, s + 0.006, pos.z);
    addLog('タブレットを置きました（画面上向き）', 'info');
  } else {
    n.y = 0; if (n.lengthSq() < 1e-6) n.set(0, 0, 1); n.normalize();
    o.quaternion.copy(standingQuat(n));
    o.position.set(pos.x, s + TABLET_H / 2 * Math.cos(TABLET_LEAN) + 0.003, pos.z);
    addLog('タブレットを立てました（画面が自分を向くように置くと見やすい）', 'info');
  }
}
// 駆血帯を外す: 装着位置から手に移る。両針の留置後ならステップ完了、途中なら警告
function removeTourniquet(cs) {
  const tq = tools.tourniquet;
  state.tourniquetOn = false; tq.fixed = false;
  setTourniquetCoiled(tq.obj);
  grab(cs, tq);
  const stuck = s => !!tools['needle' + s]?.stuck;
  if (stuck('A') && stuck('V')) {
    if (clock.elapsedTime - state.tourniquetAt > 90) penalty(5, '駆血時間が長すぎます（1 分以内を目安に）');
    addLog('駆血帯を外しました ✔（回路接続へ）', 'ok');
    if (STEPS.some(s => s.id === 'tourniquetOff')) completeStep('tourniquetOff');
  } else if (stuck('A') || stuck('V')) addLog('片方の穿刺が終わる前に駆血帯を外しました（必要なら巻き直し）', 'warn');
  else addLog('駆血帯を外しました', 'info');
}
// パウチから綿を取り出して、その手で持つ
function takeSwab(cs, pouch) {
  const swab = tools[pouch.obj.userData.swab];
  if (!swab || swab.held) return;
  setPouchTaken(pouch.obj, true);
  swab.locked = false; swab.obj.visible = true; swab.fixed = false;
  grab(cs, swab);
  addLog('アルコール綿を取り出しました → 穿刺部を中心から外側へ消毒', 'info');
}
function resetNeedleState(tool) {
  tool.punctured = false; tool.inVessel = false; tool.perforated = false; tool.everFlash = false; tool.styletOut = false; tool.styletAnim = -1; tool.stuck = false; tool.taped = false; tool.stenHit = false;
  if (!tool.held) setWingsFolded(tool.obj, false);
  setFlash(tool, false);
  const st = tool.obj.userData.stylet;
  if (st) { st.visible = true; st.position.z = 0; }
  if (tool.obj.userData.clamp) setClampOpen(tool.obj, false);
  tool.obj.userData.fill?.set(0);
}
function returnHome(tool) {
  if (tool.kind === 'probe') echo.setActive(false);
  tool.onHand = null; tool.slot = -1;
  scene.attach(tool.obj);
  tool.obj.position.copy(tool.homePos);
  tool.obj.quaternion.copy(tool.homeQuat);
  tool.obj.scale.setScalar(1);
  if (tool.kind === 'connector') updateLine(tool, 'home');
  if (tool.kind === 'tape') resetTape(tool.obj);
  if (tool.name === 'stethoscope') stethHome();
}
function connectorPose(tool, pos, dir) {
  tool.obj.getWorldPosition(pos);
  dir.set(0, 0, 1).applyQuaternion(tool.obj.getWorldQuaternion(_q));
  return pos;
}
function updateLine(tool, mode) {
  connectorPose(tool, _v2, _v3);
  room.lines.update(tool.site, _v2, _v3, mode);
}

// ---------- 聴診器: チェストピースを持ち、イヤーチップを頭に近づけて装着、ダイアフラムを血管へ
function onStethGrab(cs) {
  steth.tray.visible = false; steth.chest.visible = true; steth.binaural.visible = true; steth.tube.visible = true;
  if (!state.stethWorn) {
    cs.ctrl.add(steth.binaural);
    steth.binaural.position.set(0, -0.27, 0.0); steth.binaural.rotation.set(Math.PI, 0, 0);   // 手から垂れ下がる
  }
}
function wearSteth() {
  state.stethWorn = true;
  camera.add(steth.binaural);
  steth.binaural.position.set(0, -0.03, 0.06); steth.binaural.rotation.set(0, Math.PI, 0);
  addLog('聴診器を装着しました', 'info');
}
function stethHome() {
  state.stethWorn = false;
  steth.chest.visible = false; steth.binaural.visible = false; steth.tube.visible = false;
  steth.tray.visible = true;
  scene.add(steth.binaural);
}
function updateStethTube() {
  if (!steth.tube.visible) return;
  steth.chest.localToWorld(_v.copy(steth.chest.userData.stemEnd));
  _v2.set(0, 0, 1).applyQuaternion(steth.chest.getWorldQuaternion(_q));
  steth.binaural.localToWorld(_v3.copy(steth.binaural.userData.yoke));
  const a = _v.clone(), b = _v3.clone();
  const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= 0.12;
  const pts = [a, a.clone().addScaledVector(_v2, 0.06), mid, b.clone().add(new THREE.Vector3(0, -0.04, 0)), b];
  steth.tube.geometry.dispose();
  steth.tube.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 30, 0.0045, 8, false);
}

function onSelectEnd(cs) {
  if (cs.selectPressed || cs.squeezePressed) return;
  if (cs.wrist) { cs.wrist = false; cs.lastPose = ''; return; }   // 手首を離す → 前腕はゆっくり下りる（loop）
  const tool = cs.held;
  if (!tool) return;
  cs.held = null; tool.held = null; tool.holdPos = tool.holdQuat = null;
  cs.ctrl.getWorldPosition(_v);

  if (tool.kind === 'pouch' && tool.obj.userData.torn) {
    // 開封済みのパウチはゴミ → 下段の膿盆へ
    const b = tools.swab0.homePos;
    scene.attach(tool.obj); tool.obj.position.set(b.x + 0.02, b.y + 0.006, b.z + 0.04); tool.obj.rotation.set(0, C.TRAY.yaw + 0.5, 0); tool.obj.scale.setScalar(1);
    tool.fixed = true; return;
  }
  if (tool.kind === 'cotton' && state.disinfected) { returnHome(tool); tool.fixed = true; return; }   // 使用済みの綿は膿盆へ（再利用不可）
  if (tool.kind === 'tablet') { placeTablet(tool); haptic(cs, 0.3, 40); return; }                    // タブレットは離した場所に置く
  if (tool.name === 'stethoscope') {
    if (_v.distanceTo(tool.homePos) < 0.35 || !state.stethWorn) { returnHome(tool); return; }
    // 装着したまま手を離す → チェストピースは胸元に垂れる
    camera.add(tool.obj); tool.obj.position.set(0, -0.36, -0.12); tool.obj.rotation.set(-Math.PI / 2, 0, 0);
    return;
  }
  if (tool.name === 'sheet') {
    const nearArm = Math.abs(_v.z - C.ARM_Z) < 0.25 && _v.x > C.ELBOW_X - 0.15 && _v.x < C.WRIST_X + 0.25 && _v.y < C.ARM_Y + 0.35;
    if (nearArm && !state.sheetPlaced) {
      state.sheetPlaced = true; P.sheetPlane.visible = true; tool.obj.visible = false; tool.fixed = true;
      scene.attach(tool.obj);
      if (P.lift > 0.05) { state.liftedForSheet = true; addLog('前腕を持ち上げてシーツを敷きました ✔', 'ok'); }
      completeStep('sheet'); haptic(cs, 0.6, 80); return;
    }
  } else if (tool.name === 'tourniquet') {
    if (_v.distanceTo(P.tourniquet.pos) < 0.2 && !state.tourniquetOn) {
      state.tourniquetOn = true; state.tourniquetAt = clock.elapsedTime; tool.fixed = true;
      P.group.add(tool.obj);
      tool.obj.position.copy(P.tourniquet.pos);
      const q = P.tourniquet.quat.clone();
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q.clone().invert());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-localUp.z, localUp.x)));
      tool.obj.quaternion.copy(q); tool.obj.scale.setScalar(1);
      setTourniquetApplied(tool.obj);
      haptic(cs, 0.7, 100);
      if (C.VESSEL_TYPES[config.vessel].usesTourniquet) { completeStep('tourniquet'); addLog('駆血によりシャント血管が怒張しました（1 分以内に穿刺）', 'info'); }
      else penalty(3, '人工血管（グラフト）では駆血は不要です');
      return;
    }
  } else if (tool.kind === 'needle') {
    setWingsFolded(tool.obj, false);
    if (tool.punctured && !tool.perforated) {
      // 刺さったまま留置（血管内なら寝かせて固定姿勢へ）
      if (tool.inVessel) {
        if (tool.angle > 18 && !state.done['needle' + tool.site]) { state.score -= 3; addLog('逆血後は針を寝かせて進めてから固定しましょう（自動で寝かせました）−3', 'warn'); }
        layDownNeedle(tool);
        tool.stuck = true; P.forearm.attach(tool.obj);
        state.info = '';
        if (!state.done['needle' + tool.site]) addLog(`${tool.site}針 穿刺成功（刺入角 ${tool.angle.toFixed(0)}°）→ ${tool.obj.userData.type === 'cannula' && !tool.styletOut ? '内筒を抜去' : 'テープで固定'}`, 'ok');
        completeStep('needle' + tool.site); haptic(cs, 0.8, 120);
        if (tool.obj.userData.type === 'cannula' && tool.styletOut) completeStep('stylet' + tool.site);   // 持ったまま（グリップボタン）内筒を抜いていた場合
      } else {
        tool.stuck = true; P.forearm.attach(tool.obj);
        state.info = '';
        addLog(`${tool.site}針は血管に入っていません。持ち直して調整するか抜針してください`, 'warn');
      }
      return;
    }
    if (tool.perforated) penalty(5, `${tool.site}針 後壁穿破のため抜針（血腫形成）`);
    resetNeedleState(tool);
    state.info = '';
  } else if (tool.kind === 'tape') {
    if (placeTape(tool)) { haptic(cs, 0.5, 60); return; }
    // 反対の手の甲の近くで離す → 手の甲（手袋の上）に貼っておく
    const oc = otherController(cs);
    if (oc && _v.distanceTo(backOfHand(oc, _v2)) < 0.09 && stickTapeOnHand(tool, oc)) { haptic(oc, 0.4, 50); haptic(cs, 0.3, 40); return; }
  } else if (tool.kind === 'connector') {
    if (connectLine(tool)) { haptic(cs, 0.6, 80); return; }
  }
  returnHome(tool);
}
// 血管内の針を寝かせ、ハブ/翼が皮膚に密着する姿勢へ（先端は血管内を少し進める）
function layDownNeedle(tool) {
  const n = tool.obj, ud = n.userData, V = P.vessel;
  const tipZ = (ud.type === 'cannula' && tool.styletOut) ? ud.cannulaTipZ : ud.tipZ;
  const L = -tipZ;
  n.localToWorld(_v.set(0, 0, tipZ));
  _v2.set(0, 0, -1).applyQuaternion(n.getWorldQuaternion(_q)); _v2.y = 0; _v2.normalize();
  const cl = V.closest(_v);
  const tan = cl.tangent.clone(); if (tan.dot(_v2) < 0) tan.negate();
  const tip = cl.point.clone().addScaledVector(tan, 0.006);                 // 血管軸上を 6mm 進める
  const hub = tip.clone().addScaledVector(tan, -L);
  hub.y = C.skinY(hub.x, hub.z) + ud.hubLift;
  const dir = new THREE.Vector3().subVectors(tip, hub).normalize();
  const zAxis = dir.clone().negate(), xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize(), yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  scene.attach(n);
  n.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  n.position.copy(hub);
  tool.inVessel = true;
}
function placeTape(tape) {
  tape.obj.getWorldPosition(_v);
  for (const site of ['A', 'V']) {
    const n = tools['needle' + site];
    if (!n?.stuck) continue;
    n.obj.getWorldPosition(_v2);
    if (_v.distanceTo(_v2) > 0.1) continue;
    const ud = n.obj.userData, k = state.taped[site];
    if (ud.type === 'cannula' && !n.styletOut) { addLog('先に内筒（金属針）を抜去してください', 'warn'); return false; }
    if (k >= 2) { addLog('テープは 2 枚で十分です', 'info'); return false; }
    tape.fixed = true;
    applyTapeOnSkin(tape, n, k === 0 ? 'hub' : ud.hasTube ? 'tube' : 'hubRear');
    state.taped[site] = k + 1;
    if (k === 0) { n.taped = true; addLog(`${site}針を${ud.hasTube ? '翼' : 'ハブ'}の上から横一文字に固定（皮膚に密着）`, 'ok'); completeStep('tape' + site); }
    else addLog(`${site}針 ${ud.hasTube ? 'チューブを Ω 固定' : 'ハブ後端を 2 枚目のテープで固定'} ✔`, 'ok');
    return true;
  }
  return false;
}
// テープを皮膚の曲面に沿わせて貼る。ハブ/翼（またはチューブ）の上だけ盛り上がり、それ以外は皮膚に密着
// kind: 'hub' = ハブ・翼の上（横一文字）, 'tube' = チューブの上（Ω固定）, 'hubRear' = 留置針ハブ後端
function applyTapeOnSkin(tape, n, kind) {
  const ud = n.obj.userData;
  const nq = n.obj.getWorldQuaternion(new THREE.Quaternion());
  const axis = new THREE.Vector3(0, 0, -1).applyQuaternion(nq); axis.y = 0; axis.normalize();   // 針先方向（水平成分）
  const across = new THREE.Vector3(-axis.z, 0, axis.x);                                          // 幅方向（腕を横切る）
  const zc = kind === 'tube' ? 0.065 : kind === 'hubRear' ? ud.tapeZ + 0.014 : ud.tapeZ;
  const c = n.obj.localToWorld(new THREE.Vector3(0, 0, zc));
  let topY, halfW, wingHalf = 0, wingY = 0;
  if (kind === 'tube') { topY = c.y - 0.0015; halfW = 0.0045; }
  else {
    topY = c.y + ud.hubR + 0.0006; halfW = ud.hubR * 2.0;
    if (ud.wings && kind === 'hub') { wingHalf = 0.0175; wingY = c.y - 0.0025 + 0.0012; }
  }
  const W = 0.07, L = 0.016;
  const geo = new THREE.PlaneGeometry(W, L, 64, 4);
  const p = geo.attributes.position, pt = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getY(i);
    pt.copy(c).addScaledVector(across, u).addScaledVector(axis, v);
    let y = C.skinY(pt.x, pt.z) + 0.0005;                                        // 皮膚面にぴったり
    y += Math.max(0, topY - y) * Math.exp(-((u / halfW) ** 2) * 1.1);            // ハブ/チューブの上の盛り上がり
    if (wingHalf) {                                                              // 翼の上は平らな段
      const t = Math.min(1, Math.max(0, (wingHalf + 0.004 - Math.abs(u)) / 0.006));
      y = Math.max(y, y + (wingY + 0.0004 - y) * t);
    }
    p.setXYZ(i, pt.x, y, pt.z);
  }
  geo.computeVertexNormals();
  // 貼ったテープは針に追従させる（ワールド座標で作った形状を、針の子として保持）
  tape.obj.position.set(0, 0, 0); tape.obj.quaternion.identity(); tape.obj.scale.setScalar(1);
  scene.add(tape.obj); n.obj.attach(tape.obj);
  setTapeApplied(tape.obj, geo);
}
function connectLine(conn) {
  conn.obj.getWorldPosition(_v);
  const n = tools['needle' + conn.site];
  if (!n?.stuck) return false;
  const ud = n.obj.userData;
  n.obj.localToWorld(_v2.set(0, 0, ud.lineEndZ));
  if (_v.distanceTo(_v2) > 0.07) return false;
  if (ud.type === 'cannula' && !n.styletOut) { addLog('内筒を抜去してから回路を接続します', 'warn'); return false; }
  n.obj.add(conn.obj); conn.fixed = true;
  conn.obj.position.set(0, 0, ud.lineEndZ + 0.002); conn.obj.quaternion.identity(); conn.obj.scale.setScalar(1);
  state.connected[conn.site] = true;
  updateLine(conn, 'attached');
  if (!n.taped) penalty(5, `${conn.site}針をテープで固定する前に回路を接続（針の脱落リスク）`);
  if (state.tourniquetOn && !state.tourniquetWarned) { state.tourniquetWarned = true; penalty(5, '駆血帯を外さずに回路を接続（必ず駆血を解除してから接続）'); }
  if (ud.clamp && ud.clampOpen) penalty(5, `${conn.site}針 クランプを閉じずに回路を接続（血液流出）`);
  if (ud.clamp && state.bleed[conn.site] < 0.7) addLog('逆血確認が不十分なまま接続しました', 'warn');
  addLog(`${conn.site}針に血液回路を接続（回路は手の母指・示指間を通して固定）` + (ud.type === 'cannula' ? '（逆止弁付き留置針）' : ''), 'ok');
  completeStep('connect' + conn.site);
  return true;
}
function toggleClamp(n) {
  const ud = n.obj.userData, open = !ud.clampOpen;
  setClampOpen(n.obj, open);
  if (open) {
    if (state.connected[n.site]) { addLog(`${n.site}針のクランプを開放（回路へ）`, 'info'); completeStep('clamp' + n.site); }
    else if (n.stuck) addLog(`${n.site}針のクランプを開放 → 逆血がチューブを上がってきます`, 'info');
    else addLog(`${n.site}針のクランプを開放`, 'info');
  } else {
    addLog(`${n.site}針のクランプを閉鎖`, 'info');
    if (n.stuck && !state.connected[n.site] && state.bleed[n.site] >= 0.7) completeStep('bleed' + n.site);
    if (state.connected[n.site] && state.pumpOn) penalty(5, '運転中にクランプを閉じました（閉塞アラーム）');
  }
}
function startPump() {
  if (state.pumpOn) { addLog('血液ポンプは運転中です', 'info'); return; }
  if (!state.connected.A || !state.connected.V) { penalty(5, 'A/V 回路が未接続のままポンプを開始（アラーム）'); return; }
  for (const site of ['A', 'V']) {
    const ud = tools['needle' + site].obj.userData;
    if (ud.clamp && !ud.clampOpen) { penalty(5, `${site}針のクランプが閉じています（閉塞アラーム）`); return; }
  }
  state.pumpOn = true; state.flowT = 0;
  room.setPumpRunning(true);
  addLog('血液ポンプ開始 → A針から血液が回路へ流れ始めました', 'ok');
  completeStep('pump');
}
function withdrawStylet(tool, cs) {
  if (tool.styletOut) return;
  if (!tool.inVessel && !tool.everFlash) penalty(15, '逆血を確認する前に内筒を抜去');
  else if (tool.held && tool.lastDepth - tool.flashDepth < 0.002) penalty(10, '逆血後にカニューラを進めずに内筒を抜去（外筒先端が血管外のおそれ）');
  else addLog('逆血確認後にカニューラを進めて内筒抜去 ✔', 'ok');
  tool.styletOut = true; tool.styletAnim = 0;
  addLog('内筒（金属針）を抜去 → 針廃棄容器へ。外筒（逆止弁付き）を留置', 'info');
  haptic(cs, 0.5, 60);
  if (tool.stuck) completeStep('stylet' + tool.site);
}
function openSet() {
  if (state.setOpen) return;
  state.setOpen = true;
  for (const t of toolList) if (t.name === 'sheet') t.locked = false;   // アルコール綿はパウチから取り出すまでロックのまま
  completeStep('open');
}
function setFlash(tool, on) {
  const f = tool.obj.userData.flash;
  f.material.color.set(on ? 0xb00014 : 0xffffff); f.material.opacity = on ? 0.95 : 0.5;
}
function resetAll() {
  resetState();
  for (const t of toolList) {
    if (t.held) { t.held.held = null; t.held = null; }
    t.fixed = false; t.locked = (t.name === 'sheet' || t.kind === 'cotton');
    t.obj.visible = t.kind !== 'cotton';
    if (t.kind === 'needle') resetNeedleState(t);
    if (t.name === 'tourniquet') setTourniquetCoiled(t.obj);
    if (t.kind === 'pouch') { setPouchTaken(t.obj, false); setPouchTorn(t.obj, false); }
    returnHome(t);
  }
  createNeedles();
  P.sheetPlane.visible = false; P.hematoma.visible = false; P.clearDisinfect();
  P.vessel.pickSites();   // 穿刺部位は毎回変える
  buildSteps();
  P.setLift(0);
  echo.setActive(false); echo.clearNeedles();
  if (config.vessel === 'avf') P.vessel.setRadius(C.VESSEL_R_NORMAL);
  room.lines.reset(); room.setPumpRunning(false); room.resetMachineFill();
  for (const cs of controllers) { cs.selectPressed = false; cs.squeezePressed = false; cs.wrist = false; }
  setGloved('right', false); setGloved('left', false);
  addLog('リセットしました。最初から開始してください。', 'info');
}
// デスクトップ確認用: 穿刺・固定・接続・ポンプ開始までを済ませた状態（駆血帯は外した状態）
function demoState() {
  setGloved('right', true); setGloved('left', true);
  state.done.sheet = true; P.sheetPlane.visible = true;
  // 消毒済みの範囲（穿刺点を中心に外へ広がる円）
  for (const site of ['A', 'V']) {
    const s = P.vessel.sites[site];
    for (let i = 0; i < 40; i++) { const a = i * 0.9, r = 0.004 + i * 0.0008; const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r; P.markSwab(new THREE.Vector3(x, C.skinY(x, z), z), 0.012); }
  }
  state.disinfected = true;
  for (const site of ['V', 'A']) {
    const n = tools['needle' + site], s = P.vessel.sites[site], ud = n.obj.userData;
    P.group.add(n.obj);
    // 針先は血管の走行に沿わせる（A は末梢向き、V は中枢向き）
    const dir = s.tangent.clone(); dir.y = 0; dir.normalize(); if ((site === 'A') === (dir.x < 0)) dir.negate();
    n.obj.position.set(s.x - dir.x * 0.012, C.skinY(s.x, s.z) + 0.004, s.z - dir.z * 0.012);
    n.obj.quaternion.setFromEuler(new THREE.Euler(-0.35, Math.atan2(-dir.x, -dir.z), 0, 'YXZ'));
    n.punctured = true; n.inVessel = true; n.angle = 20;
    layDownNeedle(n); n.stuck = true; P.forearm.attach(n.obj);
    if (ud.stylet) { n.styletOut = true; ud.stylet.visible = false; }
    state.done['needle' + site] = true; state.done['stylet' + site] = true;
    for (const ti of site === 'A' ? [0, 2] : [1, 3]) { const tp = tools['tape' + ti]; n.obj.getWorldPosition(tp.obj.position); placeTape(tp); }
    if (ud.clamp) { state.bleed[site] = 1; ud.fill.set(1); state.done['bleed' + site] = true; }
    const conn = tools['conn' + site]; conn.obj.position.copy(n.obj.localToWorld(new THREE.Vector3(0, 0, ud.lineEndZ))); connectLine(conn);
    if (ud.clamp) toggleClamp(n);
  }
  startPump();
  const f = Number(new URLSearchParams(location.search).get('flow')); if (f > 0) state.flowT = f;
}

// 自己テスト: 各器具の「掴む判定の中心」に仮想コントローラー（手のモデル付き）を置いてトリガー → その器具が手に移るか、離すと戻るかを検証。
// さらに: プローブは持ち手の上端・中ほど・下端の 3 点と、持ったままエコー画像を 5 フレーム生成、皮膚で止まるか。
// 留置針の内筒抜去（ハブ近くでトリガー / ハブをつまむ）、テープを反対の手の甲に貼って剥がす、も確認する
function selfTestGrab() {
  const results = [];
  const mkFake = (side, pos) => {
    const f = { ctrl: new THREE.Group(), grip: new THREE.Group(), side, held: null, wrist: false, inputSource: null, lastPos: new THREE.Vector3(), selectPressed: false, squeezePressed: false, lastBeat: -1, byHold: 0, turned: false, hands: controllers[0].hands };
    const h = loadHand(side, gloveMat); const pose = gripPose(side);
    h.group.quaternion.copy(pose.quaternion); h.group.position.copy(pose.position); f.grip.add(h.group); f.hand = h;
    f.ctrl.position.copy(pos); f.grip.position.copy(pos);
    scene.add(f.ctrl); scene.add(f.grip);
    return f;
  };
  const fake = mkFake('right', new THREE.Vector3(0.6, 1.3, 0.3)), fake2 = mkFake('left', new THREE.Vector3(0.3, 1.3, 0.3));
  fake.other = fake2; fake2.other = fake;
  const moveTo = (f, p) => { f.ctrl.position.copy(p); f.grip.position.copy(p); f.ctrl.updateMatrixWorld(true); f.grip.updateMatrixWorld(true); };
  const log = (label, ok, extra = '') => { results.push({ label, ok }); console.log(`[grabtest] ${ok ? 'OK ' : 'NG '} ${label}${extra}`); };
  const tryGrab = (label, tool, worldPos) => {
    moveTo(fake, worldPos);
    fake.selectPressed = true; onSelectStart(fake);
    const got = fake.held;
    const attached = !!got && got.obj.parent === fake.ctrl;
    let echoOk = null;
    if (got?.kind === 'probe') { echoOk = true; for (let i = 0; i < 5; i++) { updateEcho(0.016, i * 0.016, 60 / C.HEART_BPM); if (echoError) echoOk = false; } }
    fake.selectPressed = false; onSelectEnd(fake);
    const released = tool.held === null && tool.obj.parent !== fake.ctrl;
    const ok = got === tool && attached && released && echoOk !== false;
    log(label, ok, `: got=${got?.name ?? '(none)'} attached=${attached} released=${released}` + (echoOk === null ? '' : ` echo=${echoOk}`));
  };
  const run = () => {
    for (const t of toolList) {
      if (t.locked || t.fixed) continue;
      tryGrab(t.name, t, t.obj.localToWorld(t.grabOffset.clone()));
    }
    const probe = tools.probe;
    for (const [label, off] of [['probe 持ち手 上端', [0, 0.15, 0]], ['probe 持ち手 下端', [0, 0.04, 0]], ['probe 先端 横 3cm', [0.03, 0.02, 0]]]) tryGrab(label, probe, probe.obj.localToWorld(new THREE.Vector3(...off)));
    // プローブと腕の接触: 手を皮膚の 2cm 下まで押し込んでも、レンズ面は皮膚から 3mm 以内に留まるか
    {
      const s = P.vessel.sites.V, a = C.armAt(s.x);
      moveTo(fake, new THREE.Vector3(s.x, s.y + 0.1, s.z));
      grab(fake, probe);
      const hold = (probe.holdPos || probe.gripPos).clone().applyQuaternion(fake.ctrl.quaternion);
      moveTo(fake, new THREE.Vector3(s.x, s.y - 0.02, s.z).sub(hold));            // レンズ面の基準位置がちょうど皮膚の 2cm 下
      updateHeld(fake, probe, 0.016);
      probe.obj.updateMatrixWorld(true);
      const F = probe.obj.getWorldPosition(new THREE.Vector3());
      const dist = Math.hypot(F.y - a.y, F.z - a.z), sink = a.r - dist;
      log('probe 皮膚で止まる', sink <= PROBE_PRESS_MAX + 0.0005 && sink >= -0.001, `: 沈み込み=${(sink * 1000).toFixed(1)}mm（上限 ${PROBE_PRESS_MAX * 1000}mm） contact=${probe.contact} hold=${!!probe.holdPos}`);
      fake.held = null; probe.held = null; probe.holdPos = probe.holdQuat = null; returnHome(probe);
    }
    // 留置針の内筒抜去: 留置した（stuck）カニューラ針の (1) ハブから 8cm 離れた所でトリガー、(2) 針の掴み判定の中心でトリガー → 内筒が抜け、針は手に移らない
    {
      const s = P.vessel.sites.V;
      for (const [label, off] of [['内筒抜去 ハブ近くでトリガー', new THREE.Vector3(0, 0.08, 0)], ['内筒抜去 ハブをつまむ', new THREE.Vector3(0, 0, 0)]]) {
        const t = registerTool('testCannula', makeNeedle(0x2f6fd0, 'cannula'), { pos: [s.x, s.y + 0.004, s.z], rotY: 0, gripPos: [0, 0, 0], kind: 'needle', site: 'V' });
        t.stuck = true; t.punctured = true; t.inVessel = true; t.everFlash = true;
        const hub = t.obj.localToWorld(new THREE.Vector3(0, 0, 0.03));
        moveTo(fake, hub.add(off));
        fake.selectPressed = true; onSelectStart(fake); fake.selectPressed = false; onSelectEnd(fake);
        log(label, t.styletOut && fake.held === null && t.stuck, `: styletOut=${t.styletOut} held=${fake.held?.name ?? '(none)'}`);
        removeTool('testCannula');
      }
    }
    // テープ: カートから持って反対の手の甲の近くで離す → 手の甲に貼られる → 反対の手で剥がせる → 自分の手の甲のテープは自分では掴まない
    {
      const tp = tools.tape0;
      moveTo(fake2, new THREE.Vector3(0.3, 1.3, 0.3));
      tryGrabNoRelease(tp);
      const back = backOfHand(fake2, new THREE.Vector3());
      moveTo(fake, back.clone().add(new THREE.Vector3(0.02, 0.02, 0)));
      fake.selectPressed = false; onSelectEnd(fake);
      log('テープを手の甲に貼る', tp.onHand === fake2 && tp.obj.parent === fake2.grip, `: onHand=${tp.onHand === fake2} parent=${tp.obj.parent === fake2.grip}`);
      // 自分（左手）では掴めない
      const tpos = tp.obj.getWorldPosition(new THREE.Vector3());
      moveTo(fake2, tpos); fake2.selectPressed = true; onSelectStart(fake2); const selfGot = fake2.held; fake2.selectPressed = false; onSelectEnd(fake2);
      log('自分の手の甲のテープは掴まない', selfGot !== tp, `: got=${selfGot?.name ?? '(none)'}`);
      moveTo(fake2, new THREE.Vector3(0.3, 1.3, 0.3));
      // 反対の手で剥がす
      moveTo(fake, tp.obj.getWorldPosition(new THREE.Vector3()));
      fake.selectPressed = true; onSelectStart(fake);
      log('テープを手の甲から剥がす', fake.held === tp && tp.obj.parent === fake.ctrl && !tp.onHand, `: got=${fake.held?.name ?? '(none)'}`);
      moveTo(fake, new THREE.Vector3(0.9, 1.3, 0.6)); fake.selectPressed = false; onSelectEnd(fake);
      log('テープを離すとカートへ戻る', tp.obj.parent === scene && tp.obj.position.distanceTo(tp.homePos) < 1e-6);
    }
    const ng = results.filter(r => !r.ok);
    console.log(`[grabtest] ${results.length - ng.length}/${results.length} OK` + (ng.length ? '  NG: ' + ng.map(r => r.label).join(', ') : ''));
    state.info = `掴みテスト ${results.length - ng.length}/${results.length} OK` + (ng.length ? ' NG: ' + ng.map(r => r.label).join(', ') : ''); uiDirty = true;
    fake.ctrl.removeFromParent(); fake.grip.removeFromParent(); fake2.ctrl.removeFromParent(); fake2.grip.removeFromParent();
  };
  const tryGrabNoRelease = tool => { moveTo(fake, tool.obj.localToWorld(tool.grabOffset.clone())); fake.selectPressed = true; onSelectStart(fake); };
  Promise.all([fake.hand.ready, fake2.hand.ready]).then(run);
}

// デスクトップ確認用: プローブを V 側の穿刺部位に当て（短軸 or 長軸）、必要なら針を刺した状態でエコー画像を生成
function debugEcho(qs) {
  const probe = tools.probe;
  let s = P.vessel.sites.V;
  // at=ana: 吻合部（手首）、at=sten: V 側の枝の狭窄部、dx=: 部位から腕に沿ってずらす [m]
  const at = qs.get('at'), dx = Number(qs.get('dx') || 0);
  const siteFrom = (b, t) => { const p = b.curve.getPointAt(t); return { x: p.x, y: C.skinY(p.x, p.z), z: p.z, tangent: b.curve.getTangentAt(t) }; };
  if (at === 'ana') s = siteFrom(P.vessel.branches.find(b => b.id === 'cephF'), 0.0);
  else if (at === 'bif') s = siteFrom(P.vessel.branches.find(b => b.id === 'radialA'), 0.0);   // 上腕動脈の分岐部
  else if (at === 'sten' && s.branch.sten) s = siteFrom(s.branch, s.branch.sten.t);
  else if (dx) s = siteFrom(s.branch, THREE.MathUtils.clamp(s.t + dx / s.branch.len, 0, 1));
  const fake = { ctrl: new THREE.Group(), grip: new THREE.Group(), side: 'right', hand: { loaded: false }, held: null, hands: controllers[0].hands };
  scene.add(fake.ctrl);
  grab(fake, probe);
  const tan = s.tangent.clone().normalize();
  const long = qs.get('axis') === 'long';
  // プローブは皮膚面の法線に沿わせる（腕の軸から穿刺点へ向かう方向）
  const aa = C.armAt(s.x), up = new THREE.Vector3(0, s.y - aa.y, s.z - aa.z).normalize();
  const lat = long ? tan.clone().addScaledVector(up, -tan.dot(up)).normalize() : new THREE.Vector3().crossVectors(up, tan).normalize();   // 画像の横方向: 短軸 = 血管を横切る
  const tilt = Number(qs.get('tilt') || 0), off = Number(qs.get('off') || 0);
  const press = Number(qs.get('press') || 0.0015);
  const pos = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(up, -press).addScaledVector(lat, off);
  const zAxis = new THREE.Vector3().crossVectors(lat, up).normalize();
  const m = new THREE.Matrix4().makeBasis(lat, up, zAxis);
  probe.obj.removeFromParent(); scene.add(probe.obj);
  probe.obj.position.copy(pos); probe.obj.quaternion.setFromRotationMatrix(m);
  probe.obj.rotateZ(tilt);
  probe.held = fake; fake.held = probe;
  if (qs.get('needle') === '1' || qs.get('ndl') === '1') {   // ndl=1: needle=cannula と併用するとき
    const n = tools.needleV, ud = n.obj.userData;
    scene.add(n.obj);
    const dir = tan.clone().addScaledVector(up, -tan.dot(up)).normalize().negate();
    const ang = Number(qs.get('nang') || 25) * Math.PI / 180, adv = Number(qs.get('nadv') || 0.012);
    const entry = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, -0.03);
    const d3 = dir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(up, -Math.sin(ang));
    const tip = entry.clone().addScaledVector(d3, adv);
    const hub = tip.clone().addScaledVector(d3, ud.tipZ);
    const zA = d3.clone().negate(), xA = new THREE.Vector3().crossVectors(up, zA).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
    n.obj.position.copy(hub); n.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
    n.stuck = true; n.punctured = true;
    if (qs.get('stylet') === 'out' && ud.stylet) { n.styletOut = true; ud.stylet.visible = false; }   // 留置針の外筒だけが残った状態
  }
}

// ---------------------------------------------------------------- 音（シャント音の合成）
let audio = null, listening = 0;
function initAudio() {
  if (audio) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const ctx = new AC();
  const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 0.8;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 160; bp.Q.value = 2;
  const pulse = ctx.createGain(); pulse.gain.value = 0;
  const master = ctx.createGain(); master.gain.value = 0;
  src.connect(lp); lp.connect(pulse); src.connect(bp); bp.connect(pulse); pulse.connect(master); master.connect(ctx.destination);
  src.start();
  audio = { ctx, pulse, master };
}
function updateAudio(t) {
  if (!audio) return;
  const Tb = 60 / C.HEART_BPM, ph = (t % Tb) / Tb;
  const env = 0.3 + 0.9 * Math.exp(-((ph - 0.12) ** 2) / 0.01);
  audio.pulse.gain.setTargetAtTime(env, audio.ctx.currentTime, 0.02);
  audio.master.gain.setTargetAtTime(listening, audio.ctx.currentTime, 0.05);
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
}

// ---------------------------------------------------------------- 移動（スティック）
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _head = new THREE.Vector3();
function updateLocomotion(cs, gp, dt) {
  const ax = gp.axes.length >= 4 ? gp.axes[2] : gp.axes[0], ay = gp.axes.length >= 4 ? gp.axes[3] : gp.axes[1];
  if (ax === undefined || ay === undefined) return;
  if (cs.side === 'left') {
    if (Math.abs(ax) < 0.15 && Math.abs(ay) < 0.15) return;
    camera.getWorldDirection(_fwd); _fwd.y = 0; _fwd.normalize();
    _right.crossVectors(_fwd, new THREE.Vector3(0, 1, 0));
    dolly.position.addScaledVector(_fwd, -ay * dt * 1.2).addScaledVector(_right, ax * dt * 1.2);
  } else {
    if (Math.abs(ax) > 0.7) {
      if (!cs.turned) {
        cs.turned = true;
        camera.getWorldPosition(_head);
        dolly.rotateY(ax > 0 ? -Math.PI / 6 : Math.PI / 6);
        dolly.updateMatrixWorld(true);
        camera.getWorldPosition(_v); dolly.position.add(_head.sub(_v));
      }
    } else if (Math.abs(ax) < 0.3) cs.turned = false;
    if (Math.abs(ay) > 0.2) dolly.position.y = THREE.MathUtils.clamp(dolly.position.y - ay * dt * 0.5, -0.6, 1.2);
  }
}

// ---------------------------------------------------------------- 毎フレーム
let uiTimer = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  const Tb = 60 / C.HEART_BPM, beat = Math.floor(t / Tb);

  const lidTarget = state.setOpen ? -1.95 : 0;
  setBox.userData.lid.rotation.x += (lidTarget - setBox.userData.lid.rotation.x) * Math.min(1, dt * 6);

  const V = P.vessel;
  if (config.vessel === 'avf') {
    const targetR = state.tourniquetOn ? C.VESSEL_R_DILATED : C.VESSEL_R_NORMAL;
    state.vesselR += (targetR - state.vesselR) * Math.min(1, dt * 2.5);
    V.setRadius(state.vesselR);
  }
  updateEcho(dt, t, Tb);
  for (const tool of toolList) {
    if (tool.kind !== 'needle') continue;
    if (tool.styletAnim >= 0) {
      const st = tool.obj.userData.stylet;
      tool.styletAnim += dt;
      st.position.z = Math.min(0.06, tool.styletAnim * 0.12);
      if (tool.styletAnim > 0.6) { st.visible = false; tool.styletAnim = -1; }
    }
    // 金属針: 留置中にクランプを開くと逆血がチューブを上がる。開けっ放しは流出
    const ud = tool.obj.userData;
    if (ud.clamp && tool.stuck && ud.clampOpen && !state.connected[tool.site]) {
      const s = tool.site;
      if (state.bleed[s] < 1) { state.bleed[s] = Math.min(1, state.bleed[s] + dt / 2.0); ud.fill.set(state.bleed[s]); state.info = `${s}針 逆血 ${(state.bleed[s] * 100).toFixed(0)}% … チューブ先端まで来たらクランプを閉じる`; uiDirty = true; }
      else { state.bleedLeak[s] += dt; if (state.bleedLeak[s] > 1.5 && state.bleedLeak[s] < 100) { state.bleedLeak[s] = 100; penalty(5, `${s}針 逆血がチューブ先端から流出（クランプを閉じていない）`); } }
    }
  }
  updateFlow(dt);
  room.update(dt);
  updateStethTube();

  listening = 0;
  let palpating = false;
  for (const cs of controllers) {
    const gp = cs.inputSource?.gamepad;
    if (gp) {
      const tp = gp.buttons[0]?.pressed, sp = gp.buttons[1]?.pressed;
      if (cs.selectPressed && tp === false) { cs.selectPressed = false; onSelectEnd(cs); }
      if (cs.squeezePressed && sp === false) { cs.squeezePressed = false; onSelectEnd(cs); }
      if (gp.buttons[5]?.pressed) { cs.byHold += dt; if (cs.byHold > 1.0) { cs.byHold = -5; resetAll(); haptic(cs, 0.8, 150); } } else cs.byHold = 0;
      updateLocomotion(cs, gp, dt);
    }
    const trig = gp?.buttons?.[0]?.value ?? (cs.selectPressed ? 1 : 0);
    const grip = gp?.buttons?.[1]?.value ?? (cs.squeezePressed ? 1 : 0);
    // 何も持たずにトリガーを引く = 人差し指を立てた「ポインティング」姿勢（物理ボタンを押す指）
    cs.pointing = !cs.held && !cs.wrist && trig > 0.5;
    let pose;
    if (cs.held?.kind === 'needle') pose = 'pinch';
    else if (cs.held?.kind === 'probe') pose = 'probe';
    else if (cs.wrist) pose = 'wrist';
    else if (cs.pointing) pose = 'point';
    else {
      const ci = cs.held ? Math.max(trig, 0.75) : trig, cg = cs.held ? Math.max(grip, 0.8) : grip;
      pose = `g${ci.toFixed(2)},${cg.toFixed(2)}`;
      cs.curl = { index: 0.15 + 0.85 * ci, middle: 0.15 + 0.85 * cg, ring: 0.15 + 0.85 * cg, pinky: 0.15 + 0.85 * cg, thumb: 0.3 + 0.5 * Math.max(ci, cg) };
    }
    if (cs.hand.loaded && pose !== cs.lastPose) {
      cs.lastPose = pose;
      cs.hand.setCurl(pose === 'pinch' ? PINCH_CURL[cs.side] : pose === 'probe' ? PROBE_CURL[cs.side] : pose === 'point' ? { ...POINT_CURL, ...NO_OPP } : pose === 'wrist' ? { ...WRIST_CURL, ...NO_OPP } : { ...cs.curl, ...NO_OPP });
    }
    cs.ctrl.getWorldPosition(_v);
    if (cs.held) updateHeld(cs, cs.held, dt);
    else if (updatePalpation(cs, dt, beat)) palpating = true;
    cs.lastPos.copy(_v);
  }
  updateLift(dt);
  updateButtons(dt);
  if (!palpating && state.info.startsWith('触知')) { state.info = ''; uiDirty = true; }
  updateAudio(t);

  uiTimer += dt;
  if (uiDirty || uiTimer > 0.12) { uiTimer = 0; drawUI(); }
  renderer.render(scene, camera);
}

// エコー: プローブを持っている間、血管・針のデータを渡して B モード画像を生成。深い血管モードでは「血管を描出」ステップを判定
const _ea = new THREE.Vector3(), _eb = new THREE.Vector3();
// プローブと腕の接触: レンズ面は皮膚の中へ 3mm（圧迫分）までしか入らない。それ以上手を押し込んでも、プローブは皮膚の上に留まって
// 腕の表面を滑る（手だけが腕の中へ進む）。皮膚に触れた瞬間に振動、押し込みすぎは小刻みな振動で知らせる
const PROBE_PRESS_MAX = PRESS_MAX;
const _pc = { f: new THREE.Vector3(), r: new THREE.Vector3(), q: new THREE.Quaternion(), d: new THREE.Vector3(), d2: new THREE.Vector3() };
function updateProbeContact(cs, tool, dt) {
  const o = tool.obj;
  o.position.copy(tool.holdPos || tool.gripPos); o.quaternion.copy(tool.holdQuat || tool.gripQuat);   // 手の中の基準位置からやり直す（前フレームの押し戻しを持ち越さない）
  o.updateMatrixWorld(true);
  const F = o.getWorldPosition(_pc.f);
  let contact = false, press = 0;
  if (C.onArm(F.x)) {
    const a = C.armAt(F.x);
    _pc.r.set(0, F.y - a.y, F.z - a.z);
    const dist = _pc.r.length();
    if (dist > 1e-4 && _pc.r.y > -0.2 * a.r) {                        // 腕の上半分〜側面（下から突き上げる場合は無視）
      if (dist < a.r + 0.0015) contact = true;
      const minDist = a.r - PROBE_PRESS_MAX;
      if (dist < minDist) {
        press = minDist - dist;                                        // 皮膚より深く押し込んだ量 → 押し戻す
        _pc.d.copy(_pc.r).normalize().multiplyScalar(press);
        _pc.d2.copy(_pc.d).applyQuaternion(cs.ctrl.getWorldQuaternion(_pc.q).invert());
        o.position.add(_pc.d2);
        // レンズ面の端が腕の中へ入るのも防ぐ: 走査面の横方向（プローブ x）の両端で同じ判定をして大きい方へ押し戻す
      }
    }
  }
  if (contact && !tool.contact) haptic(cs, 0.5, 70);                  // 皮膚に触れた
  if (press > 0.006) { tool.buzz = (tool.buzz || 0) + dt; if (tool.buzz > 0.1) { tool.buzz = 0; haptic(cs, 0.12, 30); } }   // 押し込みすぎ（手が腕の中）
  tool.contact = contact; tool.press = press;
}
let echoError = false;
function updateEcho(dt, t, Tb) {
  const probe = tools.probe;
  if (!probe?.held || echoError) return;
  try { updateEchoInner(probe, dt, t, Tb); }
  catch (e) { echoError = true; console.error('echo update failed', e); addLog('エコー画像の生成でエラー（画像は停止。器具の操作は継続できます）', 'warn'); }
}
function updateEchoInner(probe, dt, t, Tb) {
  echo.setVessel(P.vessel, `${config.vessel}:${config.deep}:${P.vessel.version}`);
  echo.clearNeedles();
  let k = 0;
  for (const site of ['A', 'V']) {
    const n = tools['needle' + site]; if (!n || k > 2) continue;
    const ud = n.obj.userData;
    if (!(n.held || n.stuck)) continue;
    n.obj.updateMatrixWorld(true);
    if (ud.type === 'metal') {
      n.obj.localToWorld(_ea.set(0, 0, 0.0)); n.obj.localToWorld(_eb.set(0, 0, ud.tipZ));
      echo.setNeedle(k++, _ea, _eb, 0.00085, 1.0);
    } else {
      n.obj.localToWorld(_ea.set(0, 0, 0.0)); n.obj.localToWorld(_eb.set(0, 0, ud.cannulaTipZ));
      echo.setNeedle(k++, _ea, _eb, -0.001, 0.7);                                        // プラスチック外筒: 中空（負の半径）= 前壁・後壁の 2 本の線として金属より暗く映る
      if (!n.styletOut) { n.obj.localToWorld(_ea.set(0, 0, 0.0)); n.obj.localToWorld(_eb.set(0, 0, ud.tipZ)); echo.setNeedle(k++, _ea, _eb, 0.0008, 1.0); }
    }
  }
  const pulse = Math.max(0, Math.sin(t * Math.PI * 2 / Tb)) ** 2;
  const es = echo.update(probe.obj, dt, pulse, t);
  // 深い血管モード: 穿刺対象の静脈がセンターラインの近く（4mm 以内）に 2 秒間描出されたら完了
  if (es.contact && es.centerVein && es.centerVein.kind !== 'artery' && es.centerVein.latAbs < 0.004 && !state.done.echo && STEPS.some(s => s.id === 'echo')) {
    state.echoTime += dt;
    state.info = `エコー: 血管を描出中 … 深さ ${es.depthMm.toFixed(1)}mm / 径 ${es.diaMm.toFixed(1)}mm  ${Math.min(2, state.echoTime).toFixed(1)} / 2.0 秒`; uiDirty = true;
    if (state.echoTime >= 2) { addLog(`エコーで血管を描出 ✔（深さ ${es.depthMm.toFixed(1)}mm, 径 ${es.diaMm.toFixed(1)}mm）`, 'ok'); completeStep('echo'); state.info = ''; }
  } else if (state.info.startsWith('エコー:')) { state.info = ''; uiDirty = true; }
}
// 患者の前腕: 手首を持った手の高さに追従して肘から持ち上がる（上限 MAX_LIFT）。離すとゆっくり下りる
const FOREARM_L = C.WRIST_X - C.ELBOW_X;
function updateLift(dt) {
  const holder = controllers.find(c => c.wrist);
  let target = 0;
  if (holder) {
    holder.ctrl.getWorldPosition(_v);
    target = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp((_v.y - 0.02 - P.wrist.y) / FOREARM_L, -1, 1)), 0, MAX_LIFT);
    if (_v.distanceTo(P.wristNow(_v2)) > 0.3) { holder.wrist = false; holder.lastPose = ''; target = 0; }   // 手が離れすぎたら手を離したことにする
  }
  const rate = holder ? 10 : 3;
  const next = P.lift + (target - P.lift) * Math.min(1, dt * rate);
  if (Math.abs(next - P.lift) > 1e-5) P.setLift(next);
}
function updateFlow(dt) {
  if (state.flowT < 0 || state.flowDone) return;
  state.flowT += dt;
  // A針 → 患者側 A 回路 → ピロー・ポンプ・ダイアライザー入口 → ダイアライザー（下から上）→ 静脈側チャンバー → 気泡検出器 → 患者側 V 回路 → V針
  const seq = [
    { dur: 2.5, fn: p => room.lines.setFill('A', p, true) },
    { dur: 2.0, fn: p => room.setMachineFill('mA', p) },
    { dur: 1.6, fn: p => room.setMachineFill('dialyzer', p) },
    { dur: 0.8, fn: p => room.setMachineFill('mV1', p) },
    { dur: 0.8, fn: p => room.setMachineFill('chamber', p) },
    { dur: 1.0, fn: p => room.setMachineFill('mV2', p) },
    { dur: 2.5, fn: p => room.lines.setFill('V', p, false) },
    { dur: config.needle === 'metal' ? 1.0 : 0.01, fn: p => { const f = tools.needleV?.obj.userData.fill; if (f) f.set(Math.max(state.bleed.V, p), state.bleed.V < 0.5); } },
  ];
  let t = state.flowT;
  for (const s of seq) {
    if (t <= s.dur) { s.fn(t / s.dur); return; }
    s.fn(1); t -= s.dur;
  }
  state.flowDone = true;
  addLog('血液回路が血液で満たされました（プライミング完了）→ 透析開始', 'ok');
  checkFinished();
}

function updatePalpation(cs, dt, beat) {
  if (P.lift > 0.02 || cs.wrist) return false;
  fingerTip(cs, _v3);
  const cl0 = C.onArm(_v3.x) ? P.vessel.closest(_v3) : null;
  const on = !!cl0 && cl0.d < 0.03 && cl0.kind !== 'artery' && !cl0.branch.comitant;
  if (!on) return false;
  if (beat !== cs.lastBeat) { cs.lastBeat = beat; haptic(cs, state.tourniquetOn ? 0.9 : 0.6, 45); }
  if (!state.done.palpate) {
    if (state.palpateTime === 0) requireGloves();
    state.palpateTime += dt;
    state.info = `触知中… スリルを感じます ${Math.min(2.5, state.palpateTime).toFixed(1)} / 2.5 秒`;
    uiDirty = true;
    if (state.palpateTime >= 2.5) { addLog('スリル良好：連続性の振動を触知', 'info'); completeStep('palpate'); state.info = ''; }
  }
  return true;
}

function updateHeld(cs, tool, dt) {
  const V = P.vessel;
  if (tool.name === 'stethoscope') {
    // 装着判定: 垂れ下がったイヤーチップ（バイノーラル原点）が頭に近づいたら耳に装着
    if (!state.stethWorn) {
      steth.binaural.getWorldPosition(_v2); headPos(_v3);
      if (_v2.distanceTo(_v3) < 0.22) wearSteth();
    }
    tool.obj.getWorldPosition(_v2);
    const on = P.lift < 0.02 && C.onArm(_v2.x) && V.closest(_v2).d < 0.045;
    if (on && state.listenTime === 0) requireGloves();
    if (on && !state.stethWorn) {
      if (!state.stethHint) { state.stethHint = true; addLog('イヤーチップを耳に装着してください（垂れたイヤーチップを頭に近づける）', 'warn'); }
      state.info = 'イヤーチップ未装着：音は聞こえません'; uiDirty = true;
    } else if (on) {
      listening = config.vessel === 'avf' ? 0.25 + 0.6 * C.forearmT(_v2.x) : 0.6;
      if (!state.done.auscult) {
        state.listenTime += dt;
        state.info = `聴診中… ${Math.min(3, state.listenTime).toFixed(1)} / 3.0 秒`; uiDirty = true;
        if (state.listenTime > 3) { addLog(config.vessel === 'avf' ? 'シャント音 良好：連続性の低音（狭窄音なし）' : 'グラフト音 良好：連続性の血流音（狭窄音なし）', 'info'); completeStep('auscult'); state.info = ''; }
      }
    } else if (state.info.startsWith('聴診') || state.info.startsWith('イヤー')) { state.info = ''; uiDirty = true; }
  }
  else if (tool.kind === 'probe') updateProbeContact(cs, tool, dt);
  else if (tool.kind === 'glove') {
    // 持った手袋を反対の手に近づける → その手に装着
    const oc = otherController(cs);
    if (oc) {
      tool.obj.getWorldPosition(_v2); oc.grip.getWorldPosition(_v3);
      if (_v2.distanceTo(_v3) < 0.09) {
        if (state.gloved[oc.side]) { state.info = `${oc.side === 'right' ? '右' : '左'}手は装着済みです。反対の手に近づけてください`; uiDirty = true; }
        else {
          setGloved(oc.side, true); haptic(oc, 0.6, 80); haptic(cs, 0.3, 40);
          addLog(`${oc.side === 'right' ? '右' : '左'}手に手袋を装着 ✔`, 'ok');
          cs.held = null; tool.held = null; returnHome(tool);   // 箱に次の手袋が出る
          state.info = '';
          if (state.gloved.right && state.gloved.left) completeStep('gloves');
          else { state.info = 'もう一方の手にも手袋を装着してください（箱から次の手袋を取る）'; uiDirty = true; }
        }
      } else if (state.info.endsWith('近づけてください')) { state.info = ''; uiDirty = true; }
    }
  }
  else if (tool.kind === 'cotton') {
    tool.obj.getWorldPosition(_v2);
    const aa = C.armAt(_v2.x);
    const touching = P.lift < 0.02 && C.onArm(_v2.x) && Math.abs(_v2.z - aa.z) < aa.r * 0.9 && Math.abs(_v2.y - C.skinY(_v2.x, _v2.z)) < 0.03;
    if (touching && !state.disinfected) {
      if (state.swabDistance === 0) requireGloves();
      cs.ctrl.getWorldPosition(_v);
      const step = _v.distanceTo(cs.lastPos);
      state.swabDistance += step;
      if (state.swabPts.length === 0 || _v2.distanceTo(state.swabPts[state.swabPts.length - 1]) > 0.015) state.swabPts.push(_v2.clone());
      // 拭いた所を皮膚に描く（消毒された範囲が見える）
      if (!tool.lastMark || _v2.distanceTo(tool.lastMark) > 0.003) { tool.lastMark = (tool.lastMark || new THREE.Vector3()).copy(_v2); P.markSwab(_v2, 0.013); }
      const p = Math.min(1, state.swabDistance / 0.35);
      state.info = `消毒中… ${(p * 100).toFixed(0)}%（穿刺点を中心に外側へ円を描くように。拭いた範囲が皮膚に表示されます）`; uiDirty = true;
      if (p >= 1) {
        state.disinfected = true; state.info = '';
        // 中心から外側へ広がっているか（前半と後半の中心からの距離を比較）
        const pts = state.swabPts, c0 = pts[0];
        const rad = pts.map(q => Math.hypot(q.x - c0.x, q.z - c0.z));
        const n = rad.length, first = rad.slice(0, Math.max(1, n >> 1)), last = rad.slice(n >> 1);
        const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
        if (avg(last) > avg(first) + 0.012) addLog('消毒完了：中心から外側へ ✔（乾燥を待ってから穿刺）', 'ok');
        else penalty(3, '消毒は穿刺点を中心に外側へ円を描くように');
        completeStep('disinfect');
      }
    }
  }
  else if (tool.kind === 'connector') {
    updateLine(tool, 'held');
  }
  else if (tool.kind === 'needle') {
    const n = tool.obj, ud = n.userData, cannula = ud.type === 'cannula';
    const tipZ = (cannula && tool.styletOut) ? ud.cannulaTipZ : ud.tipZ;
    _v.set(0, 0, tipZ); n.localToWorld(_v);
    _v2.set(0, 0, -1).applyQuaternion(n.getWorldQuaternion(_q));
    if (P.lift > 0.02 && !tool.punctured) { state.info = '患者の腕を下ろしてから穿刺してください'; uiDirty = true; return; }
    const aa = C.armAt(_v.x);
    const inArea = C.onArm(_v.x) && Math.abs(_v.z - aa.z) < aa.r;
    const sy = C.skinY(_v.x, _v.z);
    const depth = inArea ? sy - _v.y : -1;
    tool.lastDepth = depth;
    const angle = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(-_v2.y, -1, 1)));
    const [a0, a1] = V.cfg.idealAngle;

    if (inArea && _v.y < sy + 0.08 && !tool.punctured) {
      state.info = `刺入角 ${angle.toFixed(0)}°（推奨 ${a0}〜${a1}°）  目標: ${V.sites[tool.site].label}`;
      uiDirty = true;
    }
    if (depth > 0 && !tool.punctured) {
      tool.punctured = true; tool.angle = angle; tool.perforated = false; tool.everFlash = false; tool.arteryHit = false;
      haptic(cs, 0.6, 50);
      addLog(`${tool.site}針 刺入（角度 ${angle.toFixed(0)}°）`, 'info');
      requireGloves();
      if (!state.disinfected) penalty(20, '消毒していない部位に穿刺');
      else if (!P.isDisinfected(_v3.set(_v.x, sy, _v.z))) penalty(10, '消毒した範囲の外に穿刺（拭いた範囲の中に刺す）');
      else addLog('消毒範囲内に穿刺 ✔', 'ok');
      // エコーガイド下か（プローブが皮膚に接し、刺入点から 5cm 以内）
      const es = echo.state, probe = tools.probe;
      const guided = probe?.held && es.contact && probe.obj.getWorldPosition(_v3).distanceTo(_v) < 0.05;
      if (guided) addLog('エコーガイド下に穿刺 ✔', 'ok');
      else if (V.deep) penalty(10, '深い血管をエコーなしで穿刺（ブラインド穿刺）');
      if (V.cfg.usesTourniquet && !state.tourniquetOn) penalty(10, '駆血せずに穿刺（血管が怒張していない）');
      if (state.tourniquetOn && clock.elapsedTime - state.tourniquetAt > 60 && !state.tourniquetWarned) { state.tourniquetWarned = true; penalty(5, '駆血時間が 1 分を超えています'); }
      if (angle < a0 || angle > a1) penalty(10, `刺入角度が推奨範囲外（${angle.toFixed(0)}°）`);
      const site = V.sites[tool.site];
      if (Math.hypot(_v.x - site.x, _v.z - site.z) > 0.035) penalty(5, `${tool.site}針の穿刺位置が目標からずれています`);
      const other = tools[tool.site === 'A' ? 'needleV' : 'needleA'];
      if (other?.stuck) { other.obj.getWorldPosition(_v3); if (_v3.distanceTo(_v) < 0.05) penalty(5, 'A針とV針の間隔が近すぎます（再循環のおそれ）'); }
      const oc = otherController(cs);
      let fixed = false;
      if (oc && !oc.held) { fingerTip(oc, _v3); fixed = _v3.distanceTo(_v) < 0.09 && _v3.y < sy + 0.05; }
      if (fixed) addLog('皮膚を伸展・固定して穿刺 ✔', 'ok'); else penalty(5, '皮膚の固定なし（反対の手で穿刺部の皮膚を伸展）');
    }
    if (tool.punctured) {
      if (depth <= 0) {
        tool.punctured = false; tool.inVessel = false; setFlash(tool, false); state.info = ''; uiDirty = true;
        if (cannula && tool.styletOut) { penalty(5, `${tool.site}針 外筒が抜けました`); }
        return;
      }
      const cl = V.closest(_v);
      const r = cl.r;
      if (cl.kind === 'artery' && cl.d < r && !tool.arteryHit) {
        tool.arteryHit = true; haptic(cs, 1, 250);
        penalty(15, `${cl.branch.name}を誤穿刺（拍動性の鮮紅色の逆血）。抜針して圧迫止血`);
      }
      const inVessel = cl.d < r && cl.kind !== 'artery' && !cl.branch.comitant;   // 伴走静脈（深部静脈）は穿刺対象ではない
      if (inVessel && !tool.inVessel) {
        haptic(cs, 0.9, 80);
        if (!tool.everFlash) {
          tool.everFlash = true; tool.flashDepth = depth; addLog(cannula ? '逆血確認 → 針を寝かせて 2〜3mm 進め、トリガーを離して留置 → 内筒を抜去' : '逆血（フラッシュバック）確認 → 針を寝かせて 2〜3mm 進め、トリガーを離して留置', 'ok');
          // 狭窄部（径が細い所）への穿刺: エコーで太い所を選ぶべき
          if (cl.sten > 0.35 && !tool.stenHit) { tool.stenHit = true; penalty(10, `狭窄部に穿刺（血管径 ${(r * 2000).toFixed(1)}mm と細い。エコーで太い所を選ぶ）`); }
        }
      }
      tool.inVessel = inVessel;
      if (!tool.styletOut) setFlash(tool, inVessel || tool.perforated);
      if (!tool.perforated && _v.y < cl.point.y - r && cl.horiz < r + 0.004) {
        tool.perforated = true; tool.inVessel = false;
        P.hematoma.visible = true; P.hematoma.position.copy(P.forearm.worldToLocal(_v3.set(_v.x, sy, _v.z)));
        penalty(25, (config.vessel === 'avg' ? '人工血管' : '血管') + '後壁を穿破しました（血腫）。抜針して再穿刺');
        haptic(cs, 1, 200);
      }
      const dmm = (depth * 1000).toFixed(0);
      state.info = tool.perforated ? '後壁穿破！ 抜針してください'
        : tool.arteryHit && cl.kind === 'artery' ? '動脈内！ 抜針して圧迫止血'
        : inVessel ? `血管内 ✔  深さ ${dmm}mm  角度 ${angle.toFixed(0)}°  → 寝かせて少し進め、トリガーを離して留置`
        : `皮下 … 深さ ${dmm}mm  角度 ${angle.toFixed(0)}°  血管に向けて進めてください`;
      uiDirty = true;
    }
  }
}

// ---------------------------------------------------------------- VR 開始ボタン
function setupVRButton() {
  const btn = document.getElementById('vrbtn'), info = document.getElementById('info');
  if (!navigator.xr) {
    btn.textContent = 'WebXR 非対応ブラウザ';
    info.innerHTML += '<br><span style="color:#ffd166">このブラウザは WebXR に対応していません。Quest のブラウザで開いてください（マウスで見学は可能）。</span>';
    return;
  }
  navigator.xr.isSessionSupported('immersive-vr').then(ok => {
    if (!ok) { btn.textContent = 'VR ヘッドセット未検出'; return; }
    btn.disabled = false; btn.textContent = 'VR を開始';
    btn.onclick = async () => {
      if (renderer.xr.isPresenting) { renderer.xr.getSession().end(); return; }
      try {
        const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] });
        session.addEventListener('end', () => { btn.textContent = 'VR を開始'; });
        await renderer.xr.setSession(session);
        btn.textContent = 'VR を終了';
      } catch (e) { btn.textContent = 'VR 開始に失敗: ' + e.message; }
    };
  });
}

init();
