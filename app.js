// 透析室 穿刺トレーニングVR  (Quest 3 / WebXR / Three.js) — メインロジック
import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';
import { RoomEnvironment } from './lib/RoomEnvironment.js';
import { mergeGeometries } from './lib/BufferGeometryUtils.js';
import * as C from './src/constants.js';
import { createTextures, makeLabel } from './src/textures.js';
import { buildRoom } from './src/room.js';
import { buildPatient } from './src/patient.js';
import { loadHand, loadTrackedHand, gripPose, XR_JOINTS } from './src/handmodel.js';
import {
  makeStethoscopeSet, makeTourniquet, setTourniquetApplied, setTourniquetCoiled, makeNeedle, setClampOpen, setWingsFolded,
  makeTapeStrip, setTapeApplied, resetTape, makeConnector, makeSetBox, makeFoldedDrape, makeGauze,
  makeAlcoholPouch, setPouchTorn, setPouchTaken, makeSwab, makeGloveBox, makeGlove,
  makeResetButton, makeSettingsPanel,
} from './src/tools.js';
import { createEcho, makeProbe, makeProbeHolder, PRESS_MAX, veinFlatten } from './src/echo.js';

const GRAB_DIST = 0.13;
// 針を持つときの指の曲げ（親指と人差し指でつまむ「ピンチ」姿勢）
// （親指は中手骨を Y 軸回りに対立させて人差し指の指先に合わせる。左手は鏡像なので符号が逆）
// 針の持ち方（臨床の標準）: 金属翼状針は翼を折り畳んで親指と人差し指の腹で両側から挟む。留置針は内筒ハブ（後端の硬い部分）を同様に挟む。
// 針の軸は人差し指の向きに沿って指先の先へ出し、刃面（翼の面）は手の甲側が上。中指以降は軽く曲げて患者の腕に「支え」を作れる程度に緩める
// （値は ?debug=hand で親指先と人差し指先の距離を計測して決定: index 0.65 / thumbOpp 右 0.3・左 -0.15 で指先同士が約 9mm = 指の腹が触れ合う）
// 中指〜小指は軽くこぶしを握る程度に曲げて掌の中へ収める（下へ開いていると患者の腕に当たって針が血管の深さまで届かない）
const PINCH_CURL = {
  right: { thumb: 1.0, index: 0.65, middle: 0.9, ring: 0.93, pinky: 0.95, thumbOpp: 0.3, thumbOppAxis: 'y' },
  left: { thumb: 1.0, index: 0.65, middle: 0.9, ring: 0.93, pinky: 0.95, thumbOpp: -0.15, thumbOppAxis: 'y' },
};
// 浅い血管用の持ち方（グリップで持ったとき）: 親指と人差し指のつまみ方と針の向きは標準と同じで、中指〜小指だけを「パー」のように伸ばす。
// 手の甲が少し自分に見える向きにすると、親指と人差し指の輪が一番下に来て、伸ばした指は腕に当たらず浅い角度で刺せる
const OK_CURL = {
  right: { ...PINCH_CURL.right, middle: 0.04, ring: 0.02, pinky: 0.02 },
  left: { ...PINCH_CURL.left, middle: 0.04, ring: 0.02, pinky: 0.02 },
};
const NO_OPP = { thumbOpp: 0 };
// エコープローブを持つ姿勢: 手全体で本体を握る（親指は手前の広い面、他の指は向こう側へ回り込み、掌に広い面が当たる）。
// 小指側がレンズ面に近く、指はすべてレンズ面より上にある（参考: us-ism.com のプローブの持ち方の写真）
const PROBE_CURL = {
  right: { thumb: 0.7, index: 0.96, middle: 0.98, ring: 0.98, pinky: 0.98, thumbOpp: 0 },
  left: { thumb: 0.7, index: 0.96, middle: 0.98, ring: 0.98, pinky: 0.98, thumbOpp: 0 },
};
const PROBE_HOLD_L = 0.07;    // 握りの中心からレンズ面までの距離: 握った手の小指側の下にヘッド（レンズ面）が出る（ヘッド 6cm・握りはその上の細い部分）
// 握りの中心（gripSpace 座標）: 手のモデルの掌面は原点から掌側へ 23mm、曲げた指の先は 65mm にあるので、その間にプローブ本体（厚み 28mm）を置く
const PROBE_FIST = { palm: 0.031, up: 0.005, thumb: 0.005 };   // 本体が薄く（14mm）なったので掌に近づける
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
// 患者の腕の可動域（rad）: abduct = 肩を支点に腕全体を外（ユーザー側）へ広げる、yaw = 肘を支点に前腕を外へ振る、roll = 前腕の回内（母指側が上を向く）
const ARM_LIMITS = { abduct: [-0.08, 0.75], yaw: [-0.3, 0.32], lift: [0, MAX_LIFT], roll: [-0.25, 1.6] };

// ---------------------------------------------------------------- 設定（血管タイプ・針タイプ）と手順
const config = { vessel: 'avf', needle: 'metal', deep: false, voice: !location.search.includes('voice=0') };   // deep: 深い血管（透けて見えない。エコー下穿刺の練習）, voice: 手順の音声ガイド
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
  const target = avg ? '人工血管（ループグラフト）' : '怒張した血管';
  const angle = `${vcfg.idealAngle[0]}〜${vcfg.idealAngle[1]}°`;
  const nd = C.NEEDLE_TYPES[config.needle].short;
  const tq = vcfg.usesTourniquet, deep = config.deep;   // deep: 血管（グラフト）が外から見えず、エコーで探して穿刺する
  const needlePre = ['auscult', 'palpate', 'disinfect', ...(tq ? ['tourniquet'] : []), ...(deep ? ['echo'] : [])];
  const siteLabel = site => P?.vessel?.sites?.[site]?.label || (avg ? (site === 'A' ? 'グラフト 動脈側の脚（母指側）' : 'グラフト 静脈側の脚（小指側）') : (site === 'A' ? '手首寄り' : '肘寄り'));
  const needleHint = site => `${site === 'A' ? '赤い針（A）' : '青い針（V）'}を持ち、反対の手で皮膚を伸展・固定しながら「${siteLabel(site)}」の${deep ? (avg ? '人工血管（外からは見えないのでエコーで探して位置と深さを確認）' : '血管（透けて見えないのでエコーで位置と深さを確認）') : target}へ ${deep ? '30〜45°' : angle} で刺入。逆血（フラッシュバック）を確認したら針を寝かせて 2〜3mm 進め、トリガーを離すと針は刺さったまま留置されます。` + (deep ? '' : 'エコー（カートのプローブ）を当てると画面で血管の深さを確認できます。');
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
    { id: 'auscult',    label: avg ? '聴診器でグラフト音を聴取' : '聴診器でシャント音を聴取', hint: 'カートの聴診器（チェストピース）をトリガーで持ち（持ったまま。離すときはもう一度トリガー）、垂れ下がったイヤーチップを自分の頭に近づけて装着し、ダイアフラムを前腕の血管に当てて 3 秒間聴診します。' + (avg ? '' : '手首側（吻合部）ほど音が大きくなります。'), requires: ['gloves'] },
    { id: 'palpate',    label: avg ? 'グラフトを触知（スリル・走行確認）' : 'シャント血管を触知（スリル）', say: '何も持っていない手で人差し指を立て、指先を前腕の血管の真上の皮膚に当て、1 秒確認します。', hint: '何も持っていない手でトリガーかグリップを引いて人差し指を立て、指先を前腕の血管の真上の皮膚に当てます。この手順の間は、トリガーもグリップも握らない開いた手で前腕に触れるだけで拍動（スリル）が伝わります（血管から 1.5cm 以内）。1 秒確認します。この手順を終えると、トリガーかグリップで人差し指を立てた指先の真下に血管の内腔があるときだけ伝わるようになります（感じた所の真下へ垂直に刺せば血管に入る）。', requires: ['gloves'] },
    { id: 'open',       label: '穿刺セットを開封',           hint: '穿刺セットの箱に手を近づけてトリガーを引くと蓋が開きます。' },
    { id: 'sheet',      label: '滅菌シーツを腕の下に敷く',   hint: 'セット内の滅菌シーツ（緑）を持ち、患者の前腕の上で手を離すと腕の下に敷かれます。反対の手で患者の手首を持つ（トリガー）と前腕を持ち上げられるので、持ち上げて敷くとスムーズです。', requires: ['open'] },
    { id: 'disinfect',  label: '穿刺部をアルコール綿で消毒', hint: '開始セットのアルコール綿のパウチを持ち、反対の手で開封口に触れてトリガーを引くと破れます。もう一度トリガーで中の綿を取り出し、穿刺予定部位を中心に外側へ円を描くように（直径 5〜7cm）消毒します。乾燥を待ってから穿刺。', requires: ['sheet'] },
    ...(tq ? [{ id: 'tourniquet', label: '駆血帯を上腕に巻く', hint: '駆血帯を持ち、患者の上腕の上で手を離すと巻かれ、シャント血管が怒張します。駆血は 3 分以内に。', requires: ['disinfect'] }] : []),
    ...(deep ? [{ id: 'echo', label: 'エコーで穿刺血管を描出（短軸で画面中央に）', hint: 'タブレットは手で持って見やすい所（ベッドの上や患者の体側に立て掛ける）に置けます。カートのプローブをトリガーで持ち（持ったまま。離すときはもう一度トリガー）、ゼリーを付けたつもりで穿刺予定部位の皮膚に当てます。血管を横切る向き（短軸）で、血管の黒い円がセンターライン（画面上の▼）の下に来るようにプローブを動かし、深さ・径の表示を確認します（2 秒保持）。', requires: ['disinfect'] }] : []),
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
// 読み上げ文の書き出し（?dump=voice）: 血管 × 針 × 深さ の全設定で手順を作り、重複を除いた「次は、…」の文を console に出す
function dumpVoiceTexts() {
  const saved = { ...config }, seen = new Set();
  for (const vessel of ['avf', 'avg']) for (const needle of ['metal', 'cannula']) for (const deep of [false, true]) {
    Object.assign(config, { vessel, needle, deep }); P.setVesselType(vessel, { deep }); buildSteps();
    for (const s of STEPS) { const t = speechText(stepSpeech(s)); if (!seen.has(t)) { seen.add(t); console.log('[voicedump] ' + JSON.stringify({ id: s.id, text: t })); } }
  }
  Object.assign(config, saved); P.setVesselType(config.vessel, { deep: config.deep }); buildSteps();
  console.log(`[voicedump] done ${seen.size}`);
}

// ---------------------------------------------------------------- タイトル画面（白い部屋にロゴ・設定パネル・スタート）
// 起動時と VR 開始時はタイトル画面。スタートを押すと透析室が現れ、設定どおりに最初から開始する。確認用パラメータ（test/debug/demo/cam など）があるときは最初から透析室
let titleMode = false, title = null;

// ---------------------------------------------------------------- 状態
const state = {};
function resetState() {
  Object.assign(state, {
    done: {}, score: 100, log: [], finished: false,
    listenTime: 0, palpateTime: 0, setOpen: false, sheetPlaced: false, tourniquetOn: false, tourniquetAt: 0, tourniquetWarned: false,
    swabDistance: 0, swabPts: [], disinfected: false, vesselR: C.VESSEL_R_NORMAL, info: '',
    taped: { A: 0, V: 0 }, connected: { A: false, V: false }, bleed: { A: 0, V: 0 }, bleedLeak: { A: 0, V: 0 },
    pumpOn: false, flowT: -1, flowDone: false, vLeak: false, stethWorn: false, stethHint: false,
    gloved: { right: false, left: false }, gloveWarned: false, liftedForSheet: false, trackedNoticed: false,
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
  if (missing.length) deduct(2, `手順の順番が違います（先に「${STEPS.find(s => s.id === missing[0]).label}」）`, 'warn');
  addLog(`✔ ${STEPS[idx].label}`, 'ok');
  cue('ok');
  checkFinished();
  uiDirty = true;
}
function checkFinished() {
  if (!state.finished && state.flowDone && !state.vLeak && STEPS.every(s => state.done[s.id])) {
    state.finished = true; state.score = Math.max(0, state.score);
    const rank = scoreRank(state.score);
    addLog(`トレーニング終了  スコア ${state.score} 点（${rank}）`, 'ok');
    speak(`トレーニング終了。スコアは ${state.score} 点、${rank} です。`, true);
  }
}
const scoreRank = s => s >= 90 ? '優' : s >= 70 ? '良' : s >= 50 ? '可' : '要再挑戦';
// 採点: 減点は元の基準の半分（初めてでも 50 点前後は残り、慣れれば 90 点以上を狙える）。同じ内容の減点を繰り返したときはさらに半分（最低 1 点）
const SCORE_SCALE = 0.5;
function deduct(pts, msg, kind = 'bad') {
  const key = msg.replace(/[0-9.]+/g, '#');
  state.penalized ??= {};
  const n = state.penalized[key] = (state.penalized[key] || 0) + 1;
  const d = Math.max(1, Math.round(n > 1 ? pts / 2 : pts));
  state.score -= d; addLog(`${msg} −${d}`, kind); if (kind === 'bad') cue('bad');
  speak(`減点。${msg}`, true);
}
const penalty = (pts, msg) => deduct(Math.max(1, Math.round(pts * SCORE_SCALE)), msg, 'bad');

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
  renderer.shadowMap.type = THREE.PCFShadowMap;      // Quest の GPU 負荷を抑える（ソフト PCF はサンプル数が多い）。normalBias でアクネを防ぐ
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  renderer.xr.setFoveation(1.0);                        // 視野周辺の解像度を落として GPU 負荷を下げる（Quest の固定中心窩レンダリング）
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
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2.4;   // 影の範囲は作業域（ベッド・装置・カート）に絞る → 同じ解像度で影が細かい
  sun.shadow.camera.right = sun.shadow.camera.top = 2.4;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.015;
  scene.add(sun);
  const fill = new THREE.PointLight(0xfff2e0, 0.5, 6, 1.5); fill.position.set(-0.5, 2.3, 0.8); scene.add(fill);

  T = createTextures();
  gloveMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T.glove, normalMap: T.skinNormal, normalScale: new THREE.Vector2(0.15, 0.15), roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.35 });
  // 術者の素手（開始時。手袋を装着すると gloveMat に切り替わる）
  skinMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T.skin, normalMap: T.skinNormal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.58, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffd9c8), clearcoat: 0.04, clearcoatRoughness: 0.5 });
  room = buildRoom(scene, T);
  P = buildPatient(scene, T, config.vessel, { deep: config.deep });
  room.lines.hookAt = (c, out) => P.toWorld(c, out);   // 患者側回路が手に掛かる位置は腕の姿勢に追従
  echo = createEcho(renderer, T);
  buildTools();
  { const seed = new URLSearchParams(location.search).get('seed'); if (seed !== null) P.vessel.pickSites(Number(seed)); }   // 穿刺部位の組み合わせを固定（確認用）
  buildSteps();
  buildUI();
  setupControllers();
  setupVRButton();
  updateSettingLabels();
  buildIntro();
  buildTitle();
  { const q = new URLSearchParams(location.search); const debugging = ['test', 'debug', 'demo', 'cam', 'pose', 'place', 'lift', 'stats', 'dump'].some(k => q.has(k)); if (q.get('title') === '1' || !debugging) returnToTitle(true); }   // 起動時も赤いボタンと同じ経路でタイトルへ（位置・見た目を同じにする）

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
      if (qs.get('tool') === 'steth') {   // 聴診器のチェストピースの持ち方（右手）
        if (side === 'right') { const st = makeStethoscopeSet(); grip.add(st.chest); h.ready.then(() => stethPlacement(h, grip, grip, side, st.chest)); }
        continue;
      }
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
      h.ready.then(() => { setWingsFolded(n, true); pinchPlacement(h, grip, grip, side, n, n, qs.get('hold') === 'ok' ? OK_CURL[side] : PINCH_CURL[side]); });
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
        if (r === 0 && i === 0) {   // 人差し指の先の関節（tip ボーン）からメッシュの先端までの距離を計測（触知点の補正用）
          const tipB = h.tips.index, dipB = h.bones.index[h.bones.index.length - 2];
          const tip = tipB.getWorldPosition(new THREE.Vector3()), dip = dipB.getWorldPosition(new THREE.Vector3()), dir = tip.clone().sub(dip).normalize();
          let maxAlong = -1, maxDown = 0; const v = new THREE.Vector3(), d = new THREE.Vector3();
          h.group.traverse(o => {
            if (!o.isSkinnedMesh) return; o.skeleton.update(); const pos = o.geometry.attributes.position;
            for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k); o.applyBoneTransform(k, v); o.localToWorld(v); d.subVectors(v, tip); const along = d.dot(dir); const lat = d.clone().addScaledVector(dir, -along).length(); if (lat < 0.012 && along > maxAlong) maxAlong = along; }
          });
          console.log(`[tipext] side=${side} mesh beyond tip joint=${(maxAlong * 1000).toFixed(1)}mm dipToTip=${(tip.distanceTo(dip) * 1000).toFixed(1)}mm`);
        }
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
  if (qs.get('stats') === '1') setTimeout(() => { const r = renderer.info.render; console.log(`[stats] calls=${r.calls} triangles=${r.triangles} geometries=${renderer.info.memory.geometries} textures=${renderer.info.memory.textures}`); }, 2500);
  if (qs.get('demo')) setTimeout(demoState, 500);
  if (qs.get('debug') === 'echo') setTimeout(() => debugEcho(qs), 600);   // プローブを腕に当てた状態（axis=short|long, needle=1）
  if (qs.get('test') === 'grab') setTimeout(selfTestGrab, 800);
  if (qs.get('dump') === 'voice') setTimeout(dumpVoiceTexts, 800);
  if (qs.get('debug') === 'swab') setTimeout(() => {   // 消毒痕の位置確認: 綿 2 枚を皮膚に置き、その原点に印を描く（印が綿の真下に出るか）
    const sv = P.vessel.sites.V;
    [[0.02, 0], [-0.03, 0.015]].forEach(([dx, dz], i) => {
      const c = new THREE.Vector3(sv.x + dx, 0, sv.z + dz); c.y = C.skinY(c.x, c.z);
      const sw = tools['swab' + i]; sw.obj.visible = !qs.get('hide'); scene.attach(sw.obj);   // &hide=1: 綿を隠して印だけ見る sw.obj.position.copy(P.toWorld(c.clone())); sw.obj.quaternion.identity(); sw.obj.updateMatrixWorld(true);
      P.markSwab(c, 0.013);
      const { o, u, v } = P.overlayUV(c), L = P.W.distanceTo(P.E), tExp = Math.abs(c.x - P.E.x) / Math.abs(P.W.x - P.E.x);
      console.log(`[swab] ${i}: u=${u.toFixed(3)} v=${v.toFixed(3)} expected v≈${tExp.toFixed(3)} overlayL=${o.L.toFixed(3)} E.x=${P.E.x.toFixed(3)} W.x=${P.W.x.toFixed(3)} c=${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)} disinfected=${P.isDisinfected(c)}`);
    });
  }, 600);
  if (qs.get('place') === 'probe') setTimeout(() => { const pr = tools.probe; pr.obj.position.set(0.5, 1.0, -0.95); pr.obj.rotation.set(0.4, 0.7, 0.3); placeProbe(pr); const o2 = tools.tablet; }, 600);   // プローブをベッドの上に置いた状態（確認用）          // 全器具の「掴む」自己テスト（結果はコンソールへ）
  if (qs.get('lift')) P.setLift(Number(qs.get('lift')));   // 前腕の持ち上げ確認（rad）
  if (qs.get('pose')) { const [abduct, yaw, lift, roll] = qs.get('pose').split(',').map(Number); P.setPose({ abduct: abduct || 0, yaw: yaw || 0, lift: lift || 0, roll: roll || 0 }); }   // 腕の姿勢（rad）の確認用

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
    toggle: !!o.toggle,   // true: トリガーで持ち、もう一度トリガーで離す（長く使う器具）。false: トリガーを離した瞬間に離す
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
  registerTool('needleA', makeNeedle(0xd9303a, config.needle), { pos: tp(-0.14, 0.004, 0.07), rotY: -Math.PI / 2 + yaw, gripPos: [0, -0.012, -0.05], kind: 'needle', site: 'A' });   // 針はゼリーの隣（患者に近い側）。金属針はチューブ込みで 18cm あるので、プローブ立てと重ならない位置
  registerTool('needleV', makeNeedle(0x2f6fd0, config.needle), { pos: tp(-0.14, 0.004, 0.14), rotY: -Math.PI / 2 + yaw, gripPos: [0, -0.012, -0.05], kind: 'needle', site: 'V' });
}

// 物理ボタン（指先で押し込むと沈み、底まで押すと動作）
function registerButton(name, holder, onPress, extra = {}) {
  const ud = holder.userData;
  const cap = extra.cap || ud.cap;
  const b = {
    name, cap, rest: cap.position.clone(),
    axis: new THREE.Vector3().fromArray(extra.axis || ud.axis || [0, -1, 0]).normalize(),
    topOffset: new THREE.Vector3().fromArray(extra.topOffset || ud.topOffset || [0, 0, 0]),
    travel: extra.travel ?? ud.travel ?? 0.006, hitR: extra.hitR ?? ud.hitR ?? 0.03, hitBox: extra.hitBox || ud.hitBox || null,   // hitBox: [半幅 x, 半幅 z]（キャップのローカル座標で矩形判定。隣のキーを巻き込まない）
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
  registerTool('stethoscope', steth.chest, { pos: tp(-0.17, 0.004, -0.1), rotY: yaw, gripPos: [0, -0.02, -0.07], toggle: true });
  registerTool('tourniquet', makeTourniquet(T, P.tourniquet.r), { pos: tp(0.14, 0, 0.17), rotY: yaw, gripPos: [0, -0.01, -0.07] });   // 前列: ゼリー → 針 → テープ → 駆血帯 の順（患者側から）
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
  registerTool('probe', makeProbe(), { pos: tp(-0.49, 0.012, 0.12), rotY: yaw + Math.PI / 2, gripPos: [0, -0.075, -0.05], gripEuler: [0, Math.PI / 2, 0], kind: 'probe', grabOffset: [0, 0.09, 0], grabR: 0.16, toggle: true });   // 持ち手の中ほどを掴む
  // iViz air のタブレットは固定せず、手で持って好きな所に置ける（ベッドの上、患者の体と腕の間に立て掛ける、カートの上など）
  registerTool('tablet', echo.tablet, { pos: tp(-0.47, 0.006, -0.12), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, -Math.PI / 2, 0, 'YXZ')), gripPos: [0, 0.02, -0.12], gripEuler: [-0.35, 0, 0], kind: 'tablet', grabR: 0.2 });
  tools.tablet.obj.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // 開始セット（カート手前側の端）: 手袋の箱・手指消毒薬（room 側で配置）・個包装アルコール綿
  gloveBox = makeGloveBox(T); gloveBox.position.fromArray(tp(0.46, 0, -0.1)); gloveBox.rotation.y = yaw; scene.add(gloveBox);
  // 次の手袋は取り出し口から指先を上にして顔を出している（穿刺者側へ少し傾く）
  const slot = gloveBox.localToWorld(gloveBox.userData.slot.clone());
  registerTool('glove', makeGlove(gloveMat), { pos: [slot.x, slot.y + 0.02, slot.z], rotY: 0.4, gripPos: [0, -0.01, -0.05], kind: 'glove', grabR: 0.1 });   // 取り出し口から顔を出したくしゃくしゃの手袋の塊
  const basin = tp(-0.15, -0.42, 0.1);   // 使用済みの綿・パウチは下段の膿盆へ
  for (let i = 0; i < 4; i++) {   // アルコール綿のパウチ 4 枚（2 枚重ねを 2 山。失敗しても足りるように。横に広げると手指消毒薬と重なる）
    registerTool('pouch' + i, makeAlcoholPouch(T), { pos: tp(0.41 + (i % 2) * 0.065 + (i >> 1) * 0.004, 0.003 + (i >> 1) * 0.006, 0.2 - (i % 2) * 0.004 + (i >> 1) * 0.008), rotY: yaw + 0.1 * ((i % 2) - 0.5) + (i >> 1) * 0.12, gripPos: [0, -0.012, -0.05], gripEuler: [0, Math.PI / 2, 0], kind: 'pouch' });
    tools['pouch' + i].obj.userData.swab = 'swab' + i;
    registerTool('swab' + i, makeSwab(), { pos: [basin[0] + i * 0.03, basin[1], basin[2]], rotY: yaw, gripPos: [0, -0.012, -0.05], locked: true, kind: 'cotton' });
    tools['swab' + i].obj.visible = false;
  }
  for (let i = 0; i < 4; i++) registerTool('tape' + i, makeTapeStrip(), { pos: tp(0.0, 0.0015 + i * 0.001, 0.11 + i * 0.025), rotY: yaw, gripPos: [0, -0.015, -0.06], gripEuler: [0, Math.PI / 2, 0], kind: 'tape' });
  for (const site of ['A', 'V']) {
    const h = room.lines.home[site];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), h.dir);
    registerTool('conn' + site, makeConnector(site === 'A' ? 0xd9303a : 0x2f6fd0), { pos: [h.pos.x, h.pos.y, h.pos.z], quat: q, gripPos: [0, -0.01, -0.06], kind: 'connector', site });
  }

  // リセットボタンはサイドテーブルのものだけ（カート上のものは撤去）
  registerButton('pump', room.pumpButton, startPump);
  // プローブの ⏯ ボタン（指で押す）でもフリーズ／解除（ハンドトラッキングではグリップがないのでこちらを使う）
  registerButton('probeFreeze', tools.probe.obj, by => toggleEchoFreeze(by), { cap: tools.probe.obj.userData.freezeBtn, topOffset: [0, 0, 0.001], travel: 0.002, hitR: 0.012, axis: [0, 0, -1] });
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
  const reset2 = makeResetButton(T, T.titleBtnLabel); reset2.position.set(ST.x + 0.12, ST.y + 0.01, ST.z - 0.09); reset2.rotation.y = ST.yaw; scene.add(reset2);
  registerButton('title', reset2, returnToTitle);   // 設定キーを押すと物はリセットされるので、赤いボタンは「タイトル画面へ戻る」
}

// 指先がボタンのキャップに触れると押し込み量に応じて沈み、底付きで動作する
const _bv = new THREE.Vector3(), _bv2 = new THREE.Vector3(), _bv3 = new THREE.Vector3();
const FINGER_R = 0.008, PALM_R = 0.022;
function updateButtons(dt) {
  for (const b of pressables) {
    if (b.enabled === false || !!b.title !== titleMode) continue;   // タイトル画面のキーはタイトル中だけ、他のボタンは透析室でだけ
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
        _bv.sub(_bv3);                                     // キャップ中心からの横ずれ（ベクトル）
        const m = k ? 0.02 : 0;
        const inside = b.hitBox ? (Math.abs(_bv.x) < b.hitBox[0] + m && Math.abs(_bv.z) < b.hitBox[1] + m) : _bv.length() < b.hitR + m;
        if (inside && along > -0.012 && along < b.travel + 0.035) {
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
      cue('button');
      b.onPress(by);
    } else if (b.latched && b.depth < b.travel * 0.3) b.latched = false;
  }
}

function toggleSetting(name) {
  if (name === 'voice') {   // 音声ガイドの ON/OFF（物はリセットしない）
    config.voice = !config.voice; updateSettingLabels();
    if (config.voice) { voice.stepId = null; speak('音声ガイドをオンにしました。', true); } else { if (voice.ok) speechSynthesis.cancel(); voice.queue.length = 0; if (voice.el) { voice.el.pause(); voice.el = null; } }
    addLog(`音声ガイド: ${config.voice ? 'ON' : 'OFF'}` + (config.voice ? (useClips() ? '（同梱の音声）' : voice.v ? `（端末の音声: ${voice.v.name}）` : '（この端末に日本語の音声がなく、同梱の音声も読み込めていません）') : ''), 'info');
    return;
  }
  if (name === 'vessel') config.vessel = config.vessel === 'avf' ? 'avg' : 'avf';
  else if (name === 'needle') config.needle = config.needle === 'metal' ? 'cannula' : 'metal';
  else config.deep = !config.deep;
  P.setVesselType(config.vessel, { deep: config.deep });
  updateSettingLabels();
  resetAll();
  addLog(`設定変更: ${C.VESSEL_TYPES[config.vessel].label} / ${C.NEEDLE_TYPES[config.needle].label}` + (config.deep ? ' / 深い血管（エコー下）' : ''), 'info');
}
function updateSettingLabels() {
  T.labels.vessel.draw('血管タイプ', config.vessel === 'avf' ? '自己血管\nAVF' : '人工血管\nAVG (U字)');
  T.labels.needle.draw('針タイプ', config.needle === 'metal' ? '金属翼状針' : 'カニューラ型\n留置針');
  T.labels.depth.draw('血管の深さ', config.deep ? '深い\n（エコー下）' : '標準');
  T.labels.voice.draw('音声ガイド', config.voice ? 'ON' : 'OFF');
}

// ---------------------------------------------------------------- UI パネル
let uiCanvas, uiCtx, uiTex;
function buildUI() {
  uiCanvas = document.createElement('canvas'); uiCanvas.width = 1280; uiCanvas.height = 1100;   // 1.28 × 1.1m の板（1px = 1mm）
  uiCtx = uiCanvas.getContext('2d');
  uiTex = new THREE.CanvasTexture(uiCanvas); uiTex.colorSpace = THREE.SRGBColorSpace;
  // ベッドの頭側の向こう（約 1.45m 先）に立つ大きな板（1.28 × 1.1m、中心の高さ 1.62m）。1.4m 先から読める文字の大きさ（手順 約 3cm、見出し 4cm）
  const g = new THREE.Group(); g.position.set(-0.3, 1.62, -1.4); g.rotation.y = 0.25;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.32, 1.14, 0.03), new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5 }));
  g.add(frame);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 1.1), new THREE.MeshBasicMaterial({ map: uiTex }));
  panel.position.z = 0.016; g.add(panel);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.05, 10), new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.8, roughness: 0.3 }));
  stand.position.set(0, -1.095, 0); g.add(stand);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.5 }));
  foot.position.set(0, -1.61, 0); g.add(foot);
  scene.add(g);
  drawUI();
}
function wrap(ctx, text, maxW) {
  const lines = []; let line = '';
  for (const ch of text) { if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; } else line += ch; }
  if (line) lines.push(line);
  return lines;
}
// 文字列を幅 maxW に収める: 収まらなければ文字を小さく（最小 70%）、それでも収まらなければ末尾を … に
function fitText(c, text, x, y, maxW) {
  const m = /(\d+)px/.exec(c.font), size = m ? +m[1] : 20, font0 = c.font;
  if (c.measureText(text).width > maxW) {
    c.font = font0.replace(/\d+px/, Math.max(Math.round(size * 0.7), Math.floor(size * maxW / c.measureText(text).width)) + 'px');
    if (c.measureText(text).width > maxW) { while (text.length > 1 && c.measureText(text + '…').width > maxW) text = text.slice(0, -1); text += '…'; }
  }
  c.fillText(text, x, y); c.font = font0;
}
function drawUI() {
  const c = uiCtx, W = uiCanvas.width, H = uiCanvas.height;
  c.fillStyle = '#10233a'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#1b3b5e'; c.fillRect(0, 0, W, 100);
  c.fillStyle = '#fff'; c.font = 'bold 44px sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText('透析室 穿刺トレーニング', 28, 40);
  c.fillStyle = '#9fd3ff'; c.font = '26px sans-serif';
  c.fillText(`${C.VESSEL_TYPES[config.vessel].label}  /  ${C.NEEDLE_TYPES[config.needle].label}` + (config.deep ? '  /  深い血管（エコー下）' : '') + (config.voice ? '  /  音声ガイド ON' : ''), 28, 80);
  c.textAlign = 'right'; c.font = 'bold 52px sans-serif';
  c.fillStyle = state.score >= 80 ? '#7ee8a2' : state.score >= 50 ? '#ffd166' : '#ff7b7b';
  c.fillText(`スコア ${Math.max(0, state.score)}`, W - 28, 50);
  c.textAlign = 'left';
  const cur = currentStep();
  // 左: 手順の一覧（1 行 約 3cm。現在の手順は太字・黄色の帯）
  const LX = 16, LW = 744, sp = Math.min(40, 796 / STEPS.length), fs = Math.round(Math.min(30, sp * 0.76));
  STEPS.forEach((s, i) => {
    const y = 118 + i * sp + sp / 2, done = !!state.done[s.id], isCur = cur && cur.id === s.id;
    if (isCur) { c.fillStyle = 'rgba(255,209,102,0.22)'; c.fillRect(LX, y - sp / 2, LW, sp); }
    c.fillStyle = done ? '#7ee8a2' : isCur ? '#ffd166' : '#9fb3c8';
    c.font = `${isCur ? 'bold ' : ''}${fs}px sans-serif`;
    fitText(c, `${done ? '☑' : '☐'} ${i + 1}. ${s.label}`, 28, y, LW - 24);
  });
  // 右: 次の手順（大きな見出し）とやり方
  const RX = 784, RW = W - RX - 16;
  c.fillStyle = '#17304d'; c.fillRect(RX - 12, 112, RW + 12, 802);
  c.fillStyle = '#ffd166'; c.font = 'bold 40px sans-serif';
  let y = 150;
  wrap(c, state.finished ? `結果: ${scoreRank(state.score)}` : (cur ? `次: ${cur.label}` : ''), RW - 16).forEach(l => { c.fillText(l, RX, y); y += 46; });
  y += 10; c.fillStyle = '#e8eef7'; c.font = '29px sans-serif';
  const hint = state.finished ? `スコア ${Math.max(0, state.score)} 点。B/Y ボタン長押しでリセットして再挑戦、サイドテーブルの赤いボタンでタイトル画面へ戻れます。` : (cur ? cur.hint : '');
  wrap(c, hint, RW - 16).forEach(l => { c.fillText(l, RX, y); y += 36; });
  if (state.info) {
    y += 14; c.fillStyle = '#9ad7ff'; c.font = 'bold 30px sans-serif';
    wrap(c, state.info, RW - 16).forEach(l => { c.fillText(l, RX, y); y += 37; });
  }
  // 下: 直近の記録（4 行）
  c.fillStyle = '#0b1a2c'; c.fillRect(16, 928, W - 32, 156);
  c.font = '27px sans-serif';
  state.log.slice(-4).forEach((l, i) => {
    c.fillStyle = { ok: '#7ee8a2', warn: '#ffd166', bad: '#ff7b7b', info: '#cfe0f0' }[l.kind];
    fitText(c, l.msg, 32, 950 + i * 37, W - 64);
  });
  uiTex.needsUpdate = true; uiDirty = false;
}

// ---------------------------------------------------------------- タイトル画面
// 白い部屋。目の前の上にロゴ（厚みのある板）が浮かび、その下に「血管・針・深さ」を選ぶ大きなキー、さらに下に大きなスタートのキー。
// キーは指先（または掌）で押す。スタートで透析室が現れ、立った姿勢の高さ・向きに合わせて開始位置に立つ
const TITLE_START_EYE = 1.62;   // 立位想定の目の高さ [m]（座ったまま始めても、この高さまで持ち上げる）
function buildTitle() {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  // 3D ロゴ: ロゴ画像から白背景を除いた輪郭（logo_shape.json: 外周と穴）を 7cm 押し出し、前面に元の絵柄（透明 PNG）を貼る。
  // 側面は紺。幅 2.4m で目の前 2.6m・高さ 2.0m に浮かび、ゆっくり浮き沈みする
  const slab = new THREE.Group(); slab.position.set(0, 2.5, -3.0); slab.rotation.x = -0.22; g.add(slab);
  {
    const LW = 5.4;   // 幅 5.4m（3.0m 先・高さ 2.5m に大きく浮かぶ）
    const tex = new THREE.TextureLoader().load('./assets/ctrl/logo.png'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const capM = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });   // 前面は元画像の色をそのまま（照明・トーンマッピングで白飛びしない）
    const sideM = new THREE.MeshStandardMaterial({ color: 0x1b4f9a, roughness: 0.35, metalness: 0.25 });
    fetch('./assets/ctrl/logo_shape.json').then(r => r.json()).then(d => {
      const LH = LW / d.aspect, depth = 0.07;
      tex.repeat.set(1 / LW, 1 / LH);   // 押し出し面の UV = 形の座標（m）→ 画像全体に対応
      const geos = [];
      for (const s of d.shapes) {
        const shape = new THREE.Shape(s.outer.map(([x, y]) => new THREE.Vector2(x * LW, y * LH)));
        for (const h of s.holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x * LW, y * LH))));
        geos.push(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 }));
      }
      // 押し出しの「前後の面」と「側面」を別々に結合（mergeGeometries は形ごとの材質グループを作ってしまうので、面の種類ごとに分けてから結合）
      const slice = (ge, grp) => { const out = new THREE.BufferGeometry(); for (const name of ['position', 'normal', 'uv']) { const a = ge.attributes[name]; out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize)); } return out; };
      const caps = geos.map(ge => slice(ge, ge.groups[0])), sides = geos.map(ge => slice(ge, ge.groups[1]));
      for (const [list, mat] of [[caps, capM], [sides, sideM]]) {
        const geo = mergeGeometries(list, false); geo.translate(-LW / 2, -LH / 2, -depth / 2);
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; slab.add(mesh);
      }
    }).catch(e => console.warn('logo shape load failed', e));
  }
  // 1 枚のパネル（手元: 前 0.5m・高さ 1.0m、面は 57° 上向きで術者を向く）: 上段に血管・針・深さの 3 キー、下段に大きなスタート
  // 手を伸ばして触る距離（前 0.62m・高さ 1.05m）の小さめのパネル（幅 0.9m）。面は 57° 起こして術者を向く
  const panel = new THREE.Group(); panel.position.set(0, 1.32, -0.6); panel.rotation.x = 1.1; g.add(panel);   // 胸の高さ（1.32m）。立位の目線（1.62m）から少し見下ろす位置
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2a44, roughness: 0.6 });
  panel.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.4), dark).translateY(0.01));
  const head = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.033), new THREE.MeshBasicMaterial({ map: T.titleHead, transparent: true })); head.rotation.x = -Math.PI / 2; head.position.set(0, 0.021, -0.172); panel.add(head);
  const keys = [['vessel', 0x1f5fb0, 0x163f78], ['needle', 0x1f8a68, 0x155f48], ['depth', 0x8a4aa8, 0x5e3274], ['voice', 0xb5651d, 0x7d4512]];   // 白い部屋でも文字が読める濃い色。4 つ目: 音声ガイド ON/OFF
  const KW = 0.155, KD = 0.15, GAP = 0.015, KZ = -0.06;
  title = { group: g, slab, panel, buttons: [], t: 0 };
  keys.forEach(([name, col, rim], i) => {
    const x = (i - (keys.length - 1) / 2) * (KW + GAP);
    const b = new THREE.Group(); b.position.set(x, 0.02, KZ);
    b.add(new THREE.Mesh(new THREE.BoxGeometry(KW, 0.02, KD), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 })).translateY(0.01));
    b.add(new THREE.Mesh(new THREE.BoxGeometry(KW + 0.004, 0.004, KD + 0.004), new THREE.MeshStandardMaterial({ color: rim, roughness: 0.5 })).translateY(0.002));
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(KW - 0.012, (KW - 0.012) * 300 / 512), new THREE.MeshBasicMaterial({ map: T.titleLabels[name].texture, transparent: true })); lab.rotation.x = -Math.PI / 2; lab.position.y = 0.021; b.add(lab);   // ラベルはテクスチャの縦横比のまま
    panel.add(b);
    panel.add(new THREE.Mesh(new THREE.BoxGeometry(KW + 0.008, 0.003, KD + 0.008), new THREE.MeshStandardMaterial({ color: 0x0e1626 })).translateY(0.021).translateX(x).translateZ(KZ));
    const btn = registerButton('title_' + name, panel, () => toggleTitleSetting(name), { cap: b, topOffset: [0, 0.021, 0], travel: 0.012, hitBox: [KW / 2, KD / 2] });   // 人差し指を立てた手（トリガー/グリップを握る）でだけ押せる。判定はキーの矩形の中だけ
    btn.title = true; title.buttons.push(btn);
  });
  // スタート（同じパネルの下段、大きな緑のキー）
  const SZ = 0.11;
  const sb = new THREE.Group(); sb.position.set(0, 0.02, SZ);
  sb.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.025, 0.12), new THREE.MeshStandardMaterial({ color: 0x2ea85a, roughness: 0.35, emissive: 0x0b3a1c })).translateY(0.0125));
  const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.105), new THREE.MeshBasicMaterial({ map: T.titleStart, transparent: true })); sl.rotation.x = -Math.PI / 2; sl.position.y = 0.026; sb.add(sl);
  panel.add(sb);
  panel.add(new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.003, 0.13), new THREE.MeshStandardMaterial({ color: 0x0e1626 })).translateY(0.021).translateZ(SZ));
  const startBtn = registerButton('title_start', panel, () => startGame(), { cap: sb, topOffset: [0, 0.026, 0], travel: 0.015, hitBox: [0.28, 0.06] });   // スタートもキーの矩形の中だけ（上段のキーを押してもスタートしない）
  startBtn.title = true; title.buttons.push(startBtn);
  drawTitleLabels();
}
function drawTitleLabels() {
  T.titleLabels.vessel.draw('血管', config.vessel === 'avf' ? '自己血管\nAVF' : '人工血管\nAVG');
  T.titleLabels.needle.draw('穿刺針', config.needle === 'metal' ? '金属翼状針' : 'カニューラ型\n留置針');
  T.titleLabels.depth.draw('深さ', config.deep ? '深い\n（エコー下）' : '標準');
  T.titleLabels.voice.draw('音声ガイド', config.voice ? 'ON' : 'OFF');
}
function toggleTitleSetting(name) {
  if (name === 'voice') { config.voice = !config.voice; updateSettingLabels(); drawTitleLabels(); return; }   // 音声ガイド ON/OFF（血管は作り直さない）
  if (name === 'vessel') config.vessel = config.vessel === 'avf' ? 'avg' : 'avf';
  else if (name === 'needle') config.needle = config.needle === 'metal' ? 'cannula' : 'metal';
  else config.deep = !config.deep;
  P.setVesselType(config.vessel, { deep: config.deep });
  updateSettingLabels(); drawTitleLabels();
}
// タイトル画面へ: 透析室の物をすべて隠し（照明と手は残す）、白い部屋にロゴとパネルだけ
// サイドテーブルの赤いボタン: 物をリセットしてタイトル画面へ（VR 開始直後と同じく、ロゴとパネルが目の前に出る）
function returnToTitle(initial = false) {
  if (titleMode && !initial) return;
  resetAll();
  dolly.position.set(0, 0, 0); dolly.rotation.set(0, 0, 0); dolly.updateMatrixWorld(true);   // 立ち位置・高さ・向きを起動時と同じ原点に戻す
  enterTitle();
  title.pending = true;   // VR 中なら頭の追跡が有効になってから 2.5 秒間、頭の正面に追従して固定（起動時と同じ）
  if (initial) { state.log.length = 0; uiDirty = true; }
}
function enterTitle() {
  titleMode = true;
  if (voice.ok) speechSynthesis.cancel();
  voice.queue.length = 0; if (voice.el) { voice.el.pause(); voice.el = null; }
  title.hidden = scene.children.filter(o => o !== title.group && o !== dolly && !o.isLight && o.visible);   // 隠した物だけをスタート時に戻す（元から非表示の物はそのまま）
  for (const o of title.hidden) o.visible = false;
  title.group.visible = true;
  scene.background = new THREE.Color(0xffffff);
  placeTitleInFront();
}
// ロゴとパネルを頭の向き・位置に合わせて目の前へ（VR 開始時の向きがどちらでも正面に出る）
function placeTitleInFront() {
  if (!renderer.xr.isPresenting) { title.group.position.set(0, 0, 0); title.group.rotation.y = 0; return; }   // デスクトップ: 原点で -z 向き
  headPos(_v); camera.getWorldDirection(_v2); _v2.y = 0; if (_v2.lengthSq() < 1e-4) _v2.set(0, 0, -1); _v2.normalize();
  title.group.position.set(_v.x, 0, _v.z); title.group.rotation.y = Math.atan2(-_v2.x, -_v2.z);
  // 座ったまま始めたときはパネルの高さを目線に合わせる（立位 1.62m を基準）
  const eye = renderer.xr.isPresenting ? _v.y - dolly.position.y : TITLE_START_EYE;
  title.group.position.y = Math.min(0, eye - TITLE_START_EYE);
}
function startGame() {
  if (!titleMode) return;
  titleMode = false;
  for (const o of title.hidden || []) o.visible = true;
  title.group.visible = false;
  scene.background = new THREE.Color(0xdfe6ec);
  resetAll();
  recenterPlayer();
  addLog(`トレーニング開始: ${C.VESSEL_TYPES[config.vessel].label} / ${C.NEEDLE_TYPES[config.needle].label}` + (config.deep ? ' / 深い血管（エコー下）' : ''), 'ok');
  speak('トレーニングを開始します。', true);
}
// 開始位置: 術者はベッド脇の原点に立ち、ベッド（-z）を向く。頭の向きに合わせてドリーを回し、頭の水平位置を原点へ。
// 目の高さが立位より低ければ（座ったまま等）、立位の目の高さ（1.62m）になるまで持ち上げる
function recenterPlayer() {
  if (!renderer.xr.isPresenting) return;
  headPos(_v); camera.getWorldDirection(_v2); _v2.y = 0; _v2.normalize();
  const yaw = Math.atan2(-_v2.x, -_v2.z);           // 頭の向き（-z を向いていれば 0）
  dolly.rotateY(-yaw); dolly.updateMatrixWorld(true);
  headPos(_v);
  dolly.position.x -= _v.x; dolly.position.z -= _v.z;
  const eyeLocal = _v.y - dolly.position.y;
  dolly.position.y = eyeLocal < 1.5 ? TITLE_START_EYE - eyeLocal : 0;
  dolly.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- 操作説明（術者の真後ろの壁に大きく掲示。消えないので、振り向けばいつでも読める）
// 左列: Meta Quest Touch Plus コントローラーのイラスト（左右）に各ボタンの役割、右列: ハンドトラッキングの手の形のイラストと説明
let intro = null;
// Meta Quest Touch Plus の製品写真（Meta の製品ページより。左右 1 枚ずつ）を板に貼り、ボタンの引き出し線を重ねる
const CTRL_IMG = { right: './assets/ctrl/right.webp', left: './assets/ctrl/left.webp' };
function drawControllerPhoto(c, img, x, y, size, side) {
  c.fillStyle = '#eef1f4'; c.fillRect(x, y, size, size);
  if (img) c.drawImage(img, x, y, size, size);
  if (side !== 'right') return;
  const k = size / 686;   // 写真の座標（686×686）→ 板の座標
  const P = (px, py) => [x + px * k, y + py * k];
  const label = (from, to, text, align) => {
    c.strokeStyle = '#ffd166'; c.lineWidth = 3; c.beginPath(); c.moveTo(...from); c.lineTo(...to); c.stroke();
    c.fillStyle = '#ffd166'; c.beginPath(); c.arc(from[0], from[1], 5, 0, Math.PI * 2); c.fill();
    c.font = 'bold 26px sans-serif'; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(text, to[0] + (align === 'left' ? 8 : -8), to[1]);
  };
  // 右コントローラー: ボタン・グリップは左へ、スティック・トリガーは右へ引き出す
  label(P(310, 160), [x - 40, y + 30], 'B（長押しでリセット）', 'right');
  label(P(345, 218), [x - 40, y + 95], 'A', 'right');
  label(P(300, 360), [x - 40, y + 165], 'グリップ（中指）', 'right');
  label(P(405, 155), [x + size + 20, y + 30], 'スティック', 'left');
  label(P(380, 330), [x + size + 20, y + 185], 'トリガー（前面）', 'left');
}
function buildIntro() {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1280;
  const c = cv.getContext('2d');
  c.fillStyle = '#0d1f36'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = '#1b3b5e'; c.fillRect(0, 0, cv.width, 120);
  c.fillStyle = '#ffffff'; c.font = 'bold 64px sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText('操作方法', 48, 60);
  c.fillStyle = '#9fd3ff'; c.font = '34px sans-serif'; c.textAlign = 'right';
  c.fillText('コントローラーを置いて手を出すと自動でハンドトラッキングに切り替わります（Quest 3）', cv.width - 48, 60);
  const title = (x, text, color) => { c.textAlign = 'left'; c.fillStyle = color; c.font = 'bold 48px sans-serif'; c.fillText(text, x, 180); c.fillRect(x, 212, 940, 4); };
  const lines = (x, y0, items, headW = 300) => {
    let y = y0;
    for (const [head, body] of items) {
      c.textAlign = 'left'; c.fillStyle = '#ffd166'; c.font = 'bold 32px sans-serif'; c.fillText(head, x, y);
      c.fillStyle = '#e8eef7'; c.font = '30px sans-serif';
      const ls = wrap(c, body, 940 - headW);
      ls.forEach((l, i) => c.fillText(l, x + headW, y + i * 36));
      y += Math.max(1, ls.length) * 36 + 16;
    }
  };
  // 左列: コントローラー（製品写真は読み込み後に描き足す）
  title(64, 'コントローラー（Meta Quest Touch Plus）', '#7fe3ff');
  const drawPhotos = imgs => {
    c.fillStyle = '#0d1f36'; c.fillRect(64, 230, 940, 440);
    drawControllerPhoto(c, imgs.right, 440, 240, 340, 'right');
    drawControllerPhoto(c, imgs.left, 64, 470, 170, 'left');
    c.fillStyle = '#9fb3c8'; c.font = '26px sans-serif'; c.textAlign = 'center'; c.fillText('右コントローラー', 610, 610);
    c.textAlign = 'left'; c.font = '22px sans-serif'; c.fillText('左コントローラー', 248, 505); c.fillText('X / Y ボタン', 248, 537); c.fillText('左スティック = 移動', 248, 569); c.fillText('（配置は右と対称）', 248, 601);
    tex.needsUpdate = true;
  };
  lines(64, 690, [
    ['トリガー', '器具を持つ／離す。エコープローブと聴診器は持ったままになり、もう一度トリガーで離す。何も持たずに引くと人差し指が立ち、その指でボタン類を押せる（グリップでも可）'],
    ['グリップ', '針をグリップで持つと浅い血管用の持ち方（つまみ方は同じで中指〜小指を伸ばし、親指と人差し指の輪を一番下にする）。留置針の内筒は、トリガー持ちならグリップ、グリップ持ちならトリガーで抜く。プローブ・聴診器を持っているときはトリガーと同じく離す'],
    ['A / B・X / Y', 'エコープローブを持っている手の A か B（左手は X か Y）を押すと、エコーのフリーズ／解除'],
    ['スティック', '左: 移動   右: 向き（左右）・高さ（上下）'],
    ['B / Y 長押し', '最初からやり直す。サイドテーブルの赤いボタンはタイトル画面へ戻る（設定キーを押しても物はリセットされる）'],
    ['患者の腕', '手首を持つ: 前腕を上げる・内外へ振る・手をひねると回内外。肘を持つ: 腕を肩から外へ広げる'],
  ], 240);
  // 右列: ハンドトラッキング
  title(1064, 'ハンドトラッキング', '#9ff0b2');
  lines(1064, 280, [
    ['つまむ', '親指と人差し指の先を合わせる = 持つ／離す（プローブ・聴診器はもう一度つまんで離す）。針はつまんだ指先の先に出る'],
    ['針の持ち方', '親指と人差し指でつかむ'],
    ['水色の輪', '今つまめる物に輪が出る。輪が出た状態でつまむ'],
    ['人差し指で押す', 'ボタン類はいつでも人差し指で押し込める。プローブの ⏯ ボタンを反対の手で押すとエコーのフリーズ／解除'],
    ['手が隠れた時', '持っている物は落ちない。手が戻って次につまんだときに離す'],
    ['移動', 'スティックがないので歩いて近づく。振動の代わりに音で知らせる'],
    ['患者の腕', '手首や肘をつまんで動かす（コントローラーと同じ）'],
  ], 240);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const imgs = {}; let loaded = 0;
  drawPhotos(imgs);
  for (const side of ['left', 'right']) { const im = new Image(); im.onload = () => { imgs[side] = im; if (++loaded === 2) drawPhotos(imgs); }; im.onerror = () => { if (++loaded === 2) drawPhotos(imgs); }; im.src = CTRL_IMG[side]; }
  const g = new THREE.Group();
  const W = 2.6, H = W * cv.height / cv.width;
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.06, H + 0.06), new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6 })); g.add(frame);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex })); panel.position.z = 0.004; g.add(panel);
  // 術者の真後ろの壁（+z 側, z = 3）。ユーザーは原点に立って -z を向くので、振り向くと正面に見える。下端は床から 0.8m
  g.position.set(0.1, 0.8 + H / 2, 2.955); g.rotation.y = Math.PI;
  scene.add(g);
  intro = { group: g };
}

// ---------------------------------------------------------------- コントローラー（手として表示）
function setupControllers() {
  for (let i = 0; i < 2; i++) {
    const ctrl = renderer.xr.getController(i);
    const grip = renderer.xr.getControllerGrip(i);
    const xrHand = renderer.xr.getHand(i);   // ハンドトラッキング時の関節（Quest 3 など対応機種のみ。コントローラーでは使われない）
    const hands = {};
    for (const side of ['right', 'left']) {
      const h = loadHand(side, skinMat);   // 開始時は素手
      const pose = gripPose(side);
      h.group.quaternion.copy(pose.quaternion); h.group.position.copy(pose.position);
      const holder = new THREE.Group(); holder.add(h.group);   // 手だけ（袖・手首の筒は付けない。ハンドトラッキングの見た目と同じ）
      grip.add(holder);
      const tracked = loadTrackedHand(side, skinMat);   // 実際の手の形で動くモデル（ハンドトラッキング時）
      tracked.group.visible = false; xrHand.add(tracked.group);
      hands[side] = { api: h, holder, tracked };
    }
    // ハンドトラッキング時は、関節から作った「仮想の gripSpace / targetRay」を cs.grip / cs.ctrl として使う。
    // コントローラー時と同じ座標系で器具を持たせるため（持つ位置・向きの計算は共通）
    const vgrip = new THREE.Group(), vctrl = new THREE.Group(); vgrip.add(vctrl); dolly.add(vgrip);
    // toolRoot: 持っている器具の親（targetRay の子）。手が患者の腕に当たって押し戻されるとき、器具も一緒に動かす
    const cs = { xrCtrl: ctrl, xrGrip: grip, ctrl, grip, vgrip, vctrl, xrHand, hands, toolRoot: new THREE.Group(), push: new THREE.Vector3(), vgripBase: new THREE.Vector3(), lost: false, heldLost: false, touching: false, side: i === 0 ? 'right' : 'left', tracked: false, held: null, wrist: false, inputSource: null, lastPos: new THREE.Vector3(), selectPressed: false, squeezePressed: false, lastBeat: -1, byHold: 0, turned: false };
    setHandSide(cs, cs.side);
    // 入力源がつながるたびに、コントローラーかハンドトラッキングかを自動で判定（Quest 3 でコントローラーを置いて手を出すと切り替わる。PICO などはコントローラーのみ）
    ctrl.addEventListener('connected', e => {
      cs.inputSource = e.data; cs.tracked = !!e.data.hand; cs.lost = false;
      setHandSide(cs, e.data.handedness === 'left' ? 'left' : 'right');
      if (cs.tracked && !state.trackedNoticed) { state.trackedNoticed = true; addLog('ハンドトラッキング: 親指と人差し指をつまむ = トリガー（持つ／離す）。ボタンは人差し指で押す。移動はスティックがないので歩いて近づく', 'info'); }
      uiDirty = true;
    });
    // 切断: ハンドトラッキングが途切れた（手がカメラの外へ出た）ときは持っている物を離さず、手が戻るのを待つ（戻ると同じ手として再接続され、持ったまま続けられる）。
    // コントローラーへ持ち替えたときは controller の connected で切り替わる
    ctrl.addEventListener('disconnected', () => { cs.inputSource = null; if (cs.tracked) { cs.lost = true; return; } setHandSide(cs, cs.side); });
    dolly.add(xrHand);
    ctrl.addEventListener('selectstart', () => { cs.selectPressed = true; onSelectStart(cs); });
    ctrl.addEventListener('selectend', () => onSelectEndXR(cs));
    ctrl.addEventListener('squeezestart', () => { cs.squeezePressed = true; onSqueezeStart(cs); });
    ctrl.addEventListener('squeezeend', () => { cs.squeezePressed = false; onSelectEnd(cs); });
    dolly.add(ctrl); dolly.add(grip);
    controllers.push(cs);
  }
  renderer.xr.addEventListener('sessionstart', () => { initAudio(); orbit.enabled = false; setupFrameRate(); addLog('操作説明は真後ろの壁に掲示してあります（振り向くと見えます）', 'info'); if (titleMode) title.pending = true; });
  renderer.xr.addEventListener('sessionend', () => { orbit.enabled = true; });
}
function setHandSide(cs, side) {
  const mode = `${cs.tracked ? 'hand' : 'ctrl'}:${side}`;
  if (cs.mode === mode) return;   // 同じ入力・同じ手の再接続（ハンドトラッキングが一瞬途切れて戻った等）: 持っている物も姿勢もそのまま
  cs.mode = mode; cs.side = side;
  for (const s of ['right', 'left']) {
    cs.hands[s].holder.visible = s === side && !cs.tracked;      // コントローラー: 握り姿勢の手（指の曲げは状況で変える）
    cs.hands[s].tracked.group.visible = s === side && cs.tracked;   // ハンドトラッキング: 実際の手の形
  }
  cs.hand = cs.tracked ? cs.hands[side].tracked : cs.hands[side].api;
  cs.holder = cs.hands[side].holder;
  // 入力の切り替え中に持っていた物は置く（親の座標系が変わるため）
  if (cs.held) { const t = cs.held; cs.held = null; t.held = null; t.holdPos = t.holdQuat = null; returnHome(t); }
  cs.wrist = false; cs.heldLost = false;
  if (cs.tracked) {
    cs.ctrl = cs.vctrl; cs.grip = cs.vgrip;
    cs.vgrip.add(cs.hands[side].holder);   // コントローラー用の手（非表示）を仮想 gripSpace の下に置く: 針の持ち位置をこの手のつまみ位置で決める
    // targetRay 相当のフレーム（gripSpace 基準）: -Z = 指先方向, +Y = 手の甲側。右手と左手で甲の向きが逆
    const X = new THREE.Vector3(0, 0, side === 'right' ? 1 : -1), Y = new THREE.Vector3(side === 'right' ? 1 : -1, 0, 0), Z = new THREE.Vector3(0, 1, 0);
    cs.vctrl.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  } else { cs.ctrl = cs.xrCtrl; cs.grip = cs.xrGrip; cs.xrGrip.add(cs.hands[side].holder); }
  cs.ctrl.add(cs.toolRoot); cs.toolRoot.position.set(0, 0, 0);
  cs.lastPose = '';
  cs.vgFilter?.p.reset(); cs.vgFilter?.q.reset();
}
// ハンドトラッキング: 関節の位置から仮想の gripSpace を作る（原点 = 握りの中心（指の付け根の中点から手首側へ 1cm）,
// -Y = 手首 → 中指の付け根の方向（指先方向）, -Z = 親指側（人差し指 → 小指の逆）, X = 残り（右手は甲、左手は掌）。コントローラーの gripSpace と同じ規約）
// 仮想 gripSpace の向きの較正: 関節から作った基底を、コントローラー用の手（FK）の gripSpace に一致させる回転（右手は約 7°、左手は鏡像）
const VGRIP_FIX = {
  right: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-0.14, 0.96, 0.24).normalize(), 6.9 * Math.PI / 180),
  left: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-0.14, -0.96, -0.24).normalize(), 7.0 * Math.PI / 180),
};
const _vg = { w: new THREE.Vector3(), i: new THREE.Vector3(), k: new THREE.Vector3(), m: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), o: new THREE.Vector3(), mat: new THREE.Matrix4(), q: new THREE.Quaternion(), dq: new THREE.Quaternion() };
// One Euro フィルタ（Casiez 2012）: ゆっくり動かすときは強く平滑化してジッターを消し、速く動かすときは遅れが出ないようカットオフを上げる。
// 位置（m）と向き（quaternion）に別々に掛ける。dt が無い/大きい（追跡が途切れた後）ときはそのまま通す（遅れを残さない）
const euroAlpha = (cut, dt) => 1 / (1 + 1 / (2 * Math.PI * cut * dt));
class EuroVec {
  constructor(minCut, beta, dCut = 1) { this.mc = minCut; this.b = beta; this.dc = dCut; this.x = new THREE.Vector3(); this.dx = new THREE.Vector3(); this.t = new THREE.Vector3(); this.init = false; }
  reset() { this.init = false; }
  filter(v, dt) {
    if (!this.init || !(dt > 0) || dt > 0.3) { this.x.copy(v); this.dx.set(0, 0, 0); this.init = true; return this.x; }
    this.t.subVectors(v, this.x).divideScalar(dt); this.dx.lerp(this.t, euroAlpha(this.dc, dt));
    this.x.lerp(v, euroAlpha(this.mc + this.b * this.dx.length(), dt)); return this.x;
  }
}
class EuroQuat {
  constructor(minCut, beta, dCut = 1) { this.mc = minCut; this.b = beta; this.dc = dCut; this.x = new THREE.Quaternion(); this.rate = 0; this.init = false; }
  reset() { this.init = false; }
  filter(q, dt) {
    if (!this.init || !(dt > 0) || dt > 0.3) { this.x.copy(q); this.rate = 0; this.init = true; return this.x; }
    const ang = 2 * Math.acos(Math.min(1, Math.abs(q.dot(this.x)))) / dt;   // 角速度 [rad/s]
    this.rate += (ang - this.rate) * euroAlpha(this.dc, dt);
    this.x.slerp(q, euroAlpha(this.mc + this.b * this.rate, dt)); return this.x;
  }
}
function updateVirtualGrip(cs, dt = 0) {
  const j = cs.hand.joints; if (!j?.wrist || !cs.hand.loaded) return;
  j.wrist.getWorldPosition(_vg.w); j['index-finger-phalanx-proximal'].getWorldPosition(_vg.i); j['pinky-finger-phalanx-proximal'].getWorldPosition(_vg.k); j['middle-finger-phalanx-proximal'].getWorldPosition(_vg.m);
  _vg.y.subVectors(_vg.w, _vg.m).normalize();                                   // +Y = 指先 → 手首
  _vg.z.subVectors(_vg.k, _vg.i); _vg.z.addScaledVector(_vg.y, -_vg.z.dot(_vg.y)).normalize();   // +Z = 人差し指 → 小指（親指の反対）
  _vg.x.crossVectors(_vg.y, _vg.z).normalize();
  _vg.q.setFromRotationMatrix(_vg.mat.makeBasis(_vg.x, _vg.y, _vg.z));
  _vg.q.multiply(VGRIP_FIX[cs.side]);   // 向きの較正（コントローラー用の手のモデルで gripSpace と一致するよう、自己テストで求めた回転）
  // 原点: 人差し指と小指の付け根の中点から、指先側へ 4mm・親指側へ 6mm・手の甲側へ 10mm（コントローラー用の手のモデルで gripSpace 原点と一致するよう較正。自己テストで確認）
  _vg.o.addVectors(_vg.i, _vg.k).multiplyScalar(0.5).addScaledVector(_vg.y, -0.004).addScaledVector(_vg.z, -0.006).addScaledVector(_vg.x, cs.side === 'right' ? 0.010 : -0.010);
  // 平滑化（ワールド座標で）: 位置 1.2Hz + 40Hz/(m/s)、向き 1.2Hz + 4Hz/(rad/s)
  if (!cs.vgFilter) cs.vgFilter = { p: new EuroVec(1.2, 40), q: new EuroQuat(1.2, 4) };
  _vg.o.copy(cs.vgFilter.p.filter(_vg.o, dt)); _vg.q.copy(cs.vgFilter.q.filter(_vg.q, dt));
  cs.vgrip.position.copy(dolly.worldToLocal(_vg.o));
  cs.vgrip.quaternion.copy(dolly.getWorldQuaternion(_vg.dq).invert().multiply(_vg.q));
  cs.vgripBase.copy(cs.vgrip.position);
  cs.vgrip.updateMatrixWorld(true);
}
// ハンドトラッキング: 「つまみ解除」が手の追跡の途切れ（手がカメラの外へ出た等）によるものなら、持っている物を離さない。
// 追跡が切れた直後は最後の姿勢のまま（関節が見えない / 入力源が外れた / 指先がまだ閉じている）なので、それで判定する
function pinchLost(cs) {
  if (!cs.tracked || !cs.held) return false;
  if (cs.lost) return true;
  const w = cs.xrHand?.joints?.wrist; if (w && !w.visible) return true;
  const tips = cs.hand?.tips; if (tips?.thumb && tips?.index && tips.thumb.getWorldPosition(_v4).distanceTo(tips.index.getWorldPosition(_v3)) < 0.02) return true;
  return false;
}
function onSelectEndXR(cs) {
  cs.selectPressed = false;
  if (pinchLost(cs)) { cs.heldLost = true; return; }   // 手が戻ったら、次につまんだときに離せる
  onSelectEnd(cs);
}
function haptic(cs, intensity = 0.5, ms = 60) {
  // Quest: gamepad.hapticActuators[0].pulse()。他機種向けに vibrationActuator / playEffect も試す。
  // ハンドトラッキング中は振動できないので、代わりに短い音（強さで高さ・長さが変わる）で「触れた・持った」を知らせる
  if (cs.tracked || (!cs.inputSource?.gamepad && renderer.xr.isPresenting)) { cue('tick', intensity, ms); return; }
  const gp = cs.inputSource?.gamepad; if (!gp) return;
  const act = gp.hapticActuators?.[0] || gp.vibrationActuator;
  if (!act) return;
  try {
    if (act.pulse) act.pulse(intensity, ms);
    else if (act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
  } catch (e) { /* 非対応 */ }
}
// 人差し指の先（メッシュの先端）。コントローラー用の手のモデルは tip ボーンが指先の 11mm 内側にあるので、末節の向きに沿って先端まで延ばす
// （?debug=hand で計測: tip ボーンからメッシュ先端まで 11.1mm）。ハンドトラッキングの tip 関節は指先そのものなので補正しない
const FK_TIP_EXT = 0.011, _ft = new THREE.Vector3();
function fingerTipOf(cs, name, out) {
  const tip = cs.hand?.tips?.[name];
  if (!tip) return null;
  tip.getWorldPosition(out);
  const bones = cs.hand.bones?.[name];
  if (!cs.tracked && bones?.length >= 2) { const dip = bones[bones.length - 2].getWorldPosition(_ft); out.addScaledVector(_ft.subVectors(out, dip).normalize(), FK_TIP_EXT); }
  return out;
}
function fingerTip(cs, out) { return fingerTipOf(cs, 'index', out) || cs.ctrl.getWorldPosition(out); }
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
    H.tracked.group.traverse(o => { if (o.isMesh) o.material = m; });
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
  if (titleMode) return;
  if (cs.held?.kind === 'needle' && cs.held.obj.userData.type === 'cannula' && cs.held.punctured && cs.held.holdMode !== 'ok') { withdrawStylet(cs.held, cs); return; }
  if (cs.held?.toggle) { releaseHeld(cs); return; }   // プローブ・聴診器を持っている手のグリップ = トリガーと同じ（離す）
  if (cs.held || cs.wrist) return;   // 持っている物を離すのはトリガーだけ
  cs.grabByGrip = true; onSelectStart(cs); cs.grabByGrip = false;   // グリップで針を持つと浅い血管用の持ち方
}
// ハンドトラッキング: 中指〜小指が伸びているか（中指の先が手首から 13cm 以上離れている。握ると 8〜10cm）
function fingersExtended(cs) {
  const j = cs.hand?.joints; if (!j?.wrist || !j['middle-finger-tip']) return false;
  return j['middle-finger-tip'].getWorldPosition(_v3).distanceTo(j.wrist.getWorldPosition(_v4)) > 0.13;
}
function onSelectStart(cs) {
  initAudio();
  if (titleMode) return;   // タイトル画面ではキーを指で押すだけ
  grabPoint(cs, _v);
  // ハンドトラッキングの追跡が途切れている間も持ち続けた物: 手が戻って次につまんだときに離す
  if (cs.held && cs.heldLost) { cs.heldLost = false; releaseHeld(cs); return; }
  // プローブ・聴診器（長く使う器具）はトリガーで持ち、もう一度トリガーで離す
  if (cs.held?.toggle) { releaseHeld(cs); return; }
  // グリップで持っている留置針（浅い血管用の持ち方）: トリガーで内筒を抜く
  if (cs.held?.kind === 'needle' && cs.held.holdMode === 'ok' && cs.held.obj.userData.type === 'cannula' && cs.held.punctured && cs.squeezePressed) { withdrawStylet(cs.held, cs); return; }
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
  // 金属針のクランプ（留置中・固定後）: 人差し指の先をクランプに近づけてトリガー
  { const t = clampNear(cs); if (t) { toggleClamp(t); haptic(cs, 0.4, 40); return; } }
  // 装着中の駆血帯に手を近づけてトリガー → 外す（手に持った状態になる）
  {
    const tq = tools.tourniquet;
    if (tq && tq.fixed && state.tourniquetOn && _v.distanceTo(P.tourniquetWorld(_v4)) < 0.13) { removeTourniquet(cs); return; }
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
  fingerTip(cs, _v3);
  // 接続済みの回路コネクタ: 手か指先がコネクタから 8cm 以内なら外して手に持つ（脱血不良などで刺し直すため。運転中なら停止して減点）
  {
    let best = null, bestD = 0.08;
    for (const t of toolList) {
      if (t.kind !== 'connector' || !t.fixed || !state.connected[t.site] || t.held) continue;
      t.obj.getWorldPosition(_v2);
      const d = Math.min(_v.distanceTo(_v2), _v3.distanceTo(_v2));
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) { disconnectLine(best, cs); return; }
  }
  // 針に貼ったテープ: 8cm 以内なら剥がして手に持つ（離すとカートへ戻る。針の上で離せば貼り直し）。全部剥がすと針を抜ける
  {
    let best = null, bestD = 0.08;
    for (const t of toolList) {
      if (t.kind !== 'tape' || !t.fixed || t.held || !needleOfTape(t)) continue;
      t.obj.getWorldPosition(_v2);
      const d = Math.min(_v.distanceTo(_v2), _v3.distanceTo(_v2));
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) { peelTape(best, cs); return; }
  }
  // 反対の手の甲に貼ったテープ: 手か指先がテープから 8cm 以内なら最優先で剥がす（近くに留置した針があっても針を掴み直さない）
  {
    let bestT = null, bestD = 0.08;
    for (const t of toolList) {
      if (t.kind !== 'tape' || !t.onHand || t.onHand === cs || t.held) continue;
      t.obj.getWorldPosition(_v2);
      const d = Math.min(_v.distanceTo(_v2), _v3.distanceTo(_v2));
      if (d < bestD) { bestD = d; bestT = t; }
    }
    if (bestT) { grab(cs, bestT); addLog('手の甲からテープを剥がしました → 針の上で離して固定', 'info'); return; }
  }
  // 指先が物理ボタンのすぐ近くなら「押す」意図とみなし、近くの器具を誤って掴まない
  for (const b of pressables) {
    if (b.enabled === false || !!b.title !== titleMode) continue;   // 隠れているタイトル画面のキーなどは対象外
    b.cap.parent.localToWorld(_v2.copy(b.rest).add(b.topOffset));
    if (_v3.distanceTo(_v2) < b.hitR + 0.04) return;
  }
  // 患者の手首を持つ → 前腕を動かせる（上げ下げ・内外に振る・手をひねると回内外）。肘のあたりを持つ → 腕全体を肩から外へ広げる（針が刺さっている間は不可）
  const armPart = armHoldCandidate(cs, _v);
  if (armPart) { startArmHold(cs, armPart); return; }
  // 最も近い器具を掴む（判定中心と半径は器具ごと。半径からの余裕が最も大きいものを選ぶ）
  const best = nearestTool(cs, _v);
  if (best) grab(cs, best);
}
// 人差し指の先から 4cm 以内にある金属針のクランプ（留置中、または反対の手が持っている針）。開け閉めの判定と水色の輪の表示に使う
const CLAMP_LOCAL = new THREE.Vector3(0.003, -0.007, 0.11);
function clampNear(cs, out = _v2) {
  fingerTip(cs, _v3);
  for (const t of toolList) {
    if (t.kind !== 'needle' || !t.obj.userData.clamp || !(t.stuck || t.held) || t.held === cs) continue;
    t.obj.localToWorld(out.copy(CLAMP_LOCAL));
    if (_v3.distanceTo(out) < 0.04) return t;
  }
  return null;
}
// 掴む操作の基準点: ハンドトラッキングでは親指と人差し指の指先の中点（つまむ所）、コントローラーでは targetRay の原点（手の中）
function grabPoint(cs, out) {
  const tips = cs.tracked ? cs.hand?.tips : null;
  if (tips?.thumb && tips?.index) { tips.thumb.getWorldPosition(out); return out.add(tips.index.getWorldPosition(_v4)).multiplyScalar(0.5); }
  return cs.ctrl.getWorldPosition(out);
}
function nearestTool(cs, p) {
  let best = null, bestD = 0;
  for (const t of toolList) {
    if (t.held || t.fixed || t.locked || t.taped) continue;
    if (t.kind === 'needle' && state.connected[t.site]) continue;   // 回路がつながった針は、先に回路を外さないと持てない
    if (t.onHand === cs) continue;                       // 自分の手の甲に貼ったテープは反対の手で剥がす
    t.obj.localToWorld(_v2.copy(t.grabOffset));
    const d = (t.onHand ? 0.06 : t.stuck ? 0.06 : t.grabR) - p.distanceTo(_v2);   // 留置した針はハブのすぐ近くでだけ掴み直せる
    if (d > bestD) { best = t; bestD = d; }
  }
  return best;
}
// 患者の腕を持てる所: 'wrist'（手首から 10cm）/ 'elbow'（肘から 9cm）。針が刺さっている・持って刺している間は動かせない
function armHoldCandidate(cs, p) {
  if (toolList.some(t => t.kind === 'needle' && (t.stuck || t.punctured))) return null;
  if (p.distanceTo(P.wristNow(_v2)) < 0.1) return 'wrist';
  if (p.distanceTo(P.elbowNow(_v2)) < 0.09) return 'elbow';
  return null;
}
function startArmHold(cs, part) {
  cs.wrist = part; cs.lastPose = ''; haptic(cs, 0.3, 30);
  // 持った点と手の位置のずれを覚えておき、以後は「手の位置 − ずれ」を手首/肘の目標位置にする（持った瞬間に腕が跳ねない）
  const anchor = part === 'wrist' ? P.wristNow(_v2) : P.elbowNow(_v2);
  cs.armHold = { part, off: cs.ctrl.getWorldPosition(new THREE.Vector3()).sub(anchor), q0inv: cs.grip.getWorldQuaternion(new THREE.Quaternion()).invert(), roll0: P.pose.roll };
  addLog(part === 'wrist' ? '患者の手首を持ちました（上げ下げ・内外に動かす・手をひねると前腕が回ります）' : '患者の肘を持ちました（外へ動かすと腕が肩から広がります）', 'info');
}
function grab(cs, tool) {
  // 留置した留置針の内筒がまだ入っている間は、ハブをつまむ = 内筒を抜く操作（針を掴み直すのは内筒抜去後）
  if (tool.kind === 'needle' && tool.stuck && tool.obj.userData.type === 'cannula' && !tool.styletOut) { withdrawStylet(tool, cs); return; }
  tool.held = cs; cs.held = tool;
  if (tool.onHand) { tool.onHand = null; tool.slot = -1; }
  resetHandPush(cs); cs.grip.updateMatrixWorld(true); cs.toolRoot.updateMatrixWorld(true);   // 腕からの押し戻しを戻した手を基準に持たせる（押し戻しは次のフレームで手と器具に一緒にかかる）
  cs.toolRoot.add(tool.obj);
  tool.obj.scale.setScalar(1);
  if (tool.kind === 'needle' && cs.hands[cs.side].api.loaded) {
    // 親指と人差し指の指先の間に、翼（金属針）/ 内筒ハブ（留置針）が挟まる位置へ。
    // ハンドトラッキングでも「コントローラー用の手（ピンチ姿勢）」のつまみ位置を使う: 仮想 gripSpace はコントローラーの gripSpace に較正してあるので、
    // 実際の指先のぶれや開き具合に関係なく、針は手に対してコントローラー時と同じ位置・向きに保たれる
    setWingsFolded(tool.obj, true);
    // 持ち方: トリガーで持つ = 標準（中指〜小指は軽く握る）、グリップで持つ = 浅い血管用（OK サイン、中指〜小指は伸ばす）。
    // ハンドトラッキングではつまんだ時に中指〜小指が伸びていれば浅い血管用
    tool.holdMode = (cs.grabByGrip || (cs.tracked && fingersExtended(cs))) ? 'ok' : 'pinch';
    pinchPlacement(cs.hands[cs.side].api, cs.grip, cs.ctrl, cs.side, tool.obj, tool.obj, tool.holdMode === 'ok' ? OK_CURL[cs.side] : PINCH_CURL[cs.side]);
    cs.lastPose = '';
  } else if (tool.kind === 'probe' && cs.hand.loaded) {
    // 先端近くを親指と人差し指・中指で挟む（ペングリップ）。手の中の位置は毎フレームの接触計算の基準にもなる
    probePlacement(cs.hand, cs.grip, cs.ctrl, cs.side, tool.obj);
    tool.holdPos = tool.obj.position.clone(); tool.holdQuat = tool.obj.quaternion.clone();
    cs.lastPose = '';
  } else if (tool.name === 'stethoscope' && cs.hands[cs.side].api.loaded) {
    // チェストピースの縁を親指と人差し指でつまむ（コントローラー用の手のつまみ位置で決める。ハンドトラッキングでも同じ）
    stethPlacement(cs.hands[cs.side].api, cs.grip, cs.ctrl, cs.side, tool.obj);
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
function pinchPlacement(hand, grip, ctrl, side, needleObj, out, curl = PINCH_CURL[side]) {
  hand.setCurl(curl);
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
// 聴診器のチェストピースの持ち方: 親指と人差し指で縁をつまみ、他の指は軽く添える。膜面は掌の向き（回内位で下）、ステムは手首側へ
const STETH_CURL = {
  right: { thumb: 1.0, index: 0.6, middle: 0.7, ring: 0.75, pinky: 0.8, thumbOpp: 0.3, thumbOppAxis: 'y' },
  left: { thumb: 1.0, index: 0.6, middle: 0.7, ring: 0.75, pinky: 0.8, thumbOpp: -0.15, thumbOppAxis: 'y' },
};
const _sp = { ti: new THREE.Vector3(), tt: new THREE.Vector3(), gq: new THREE.Quaternion(), palm: new THREE.Vector3(), fwd: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), cq: new THREE.Quaternion() };
function stethPlacement(hand, grip, ctrl, side, out) {
  hand.setCurl(STETH_CURL[side]);
  grip.updateMatrixWorld(true);
  hand.tips.index.getWorldPosition(_sp.ti); hand.tips.thumb.getWorldPosition(_sp.tt);
  const pinch = _sp.ti.add(_sp.tt).multiplyScalar(0.5);                            // 指の腹が触れ合う点（チェストピースの縁）
  grip.getWorldQuaternion(_sp.gq);
  _sp.palm.set(side === 'right' ? -1 : 1, 0, 0).applyQuaternion(_sp.gq);           // 掌の法線
  _sp.fwd.set(0, -1, 0).applyQuaternion(_sp.gq);                                   // 指先方向
  _sp.y.copy(_sp.palm).negate();                                                   // チェストピース +Y（膜面は -Y = 掌の向き）
  _sp.z.copy(_sp.fwd).negate(); _sp.z.addScaledVector(_sp.y, -_sp.z.dot(_sp.y)).normalize();   // ステム（+Z）は手首側へ
  _sp.x.crossVectors(_sp.y, _sp.z).normalize();
  _sp.q.setFromRotationMatrix(_sp.m.makeBasis(_sp.x, _sp.y, _sp.z));
  // 中心: つまみ点から掌側へ 1cm・指先側へ 1.2cm（縁を指先でつまみ、本体は指の下に収まる）
  const center = pinch.addScaledVector(_sp.palm, 0.01).addScaledVector(_sp.fwd, 0.012);
  ctrl.updateMatrixWorld(true);
  out.position.copy(ctrl.worldToLocal(center));
  out.quaternion.copy(ctrl.getWorldQuaternion(_sp.cq).invert().multiply(_sp.q));
}
// エコーのフリーズ／解除（プローブを持っている間だけ）
function toggleEchoFreeze(cs) {
  if (!tools.probe?.held) return;
  const frozen = echo.toggleFreeze();
  if (cs) haptic(cs, frozen ? 0.6 : 0.3, 50);
  addLog(frozen ? 'エコーをフリーズしました（画像が静止。持っている手の A/B（X/Y）でもう一度押すと解除）' : 'エコーのフリーズを解除しました', 'info');
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
    const c = P.toArm(_v4.set(x, C.BED_TOP + 0.1, z), _v4);
    if (c.x > -0.505 && c.x < 0.545 && Math.abs(c.z - C.ARM_Z) < 0.17) y = Math.max(y, C.BED_TOP + C.CUSHION_H);
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
// プローブを離した所に置く: 広い面を下にして横たえる（持ち手の向きは手の向きを保つ）。置く面はカート・サイドテーブル・ベッド・患者の腕の皮膚・床。
// プローブ立てから 15cm 以内で離したときは立てに戻す
function placeProbe(tool) {
  const o = tool.obj;
  o.updateMatrixWorld(true);
  const pos = o.getWorldPosition(new THREE.Vector3());
  echo.setActive(false);
  if (pos.distanceTo(tool.homePos) < 0.15) { returnHome(tool); addLog('プローブをプローブ立てに戻しました', 'info'); return; }
  scene.attach(o); o.scale.setScalar(1);
  let s = supportY(pos.x, pos.z), onSkin = false;
  const c = P.toArm(pos, _v4), a = C.armAt(c.x);
  if (C.onArm(c.x) && Math.abs(c.z - a.z) < a.r && P.lift < 0.02) { const sw = P.toWorld(_v3.set(c.x, C.skinY(c.x, c.z), c.z), _v3); if (sw.y > s) { s = sw.y; onSkin = true; } }
  const h = new THREE.Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())); h.y = 0;
  if (h.lengthSq() < 1e-6) h.set(1, 0, 0); h.normalize();
  const up = new THREE.Vector3(0, 1, 0), x = new THREE.Vector3().crossVectors(h, up).normalize();
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, h, up));   // z（厚み方向）= 上 → 広い面を下にして横たわる
  o.position.set(pos.x, s + 0.0145, pos.z);
  if (onSkin) P.parentFor(c.x).attach(o);   // 腕の上に置いたプローブは腕と一緒に動く
  addLog('プローブを置きました（持ち上げるとエコーが再開します）', 'info');
}
// 駆血帯を外す: 装着位置から手に移る。両針の留置後ならステップ完了、途中なら警告
function removeTourniquet(cs) {
  const tq = tools.tourniquet;
  state.tourniquetOn = false; tq.fixed = false;
  setTourniquetCoiled(tq.obj);
  grab(cs, tq);
  const stuck = s => !!tools['needle' + s]?.stuck;
  if (stuck('A') && stuck('V')) {
    if (clock.elapsedTime - state.tourniquetAt > 240) penalty(5, '駆血時間が長すぎます（3 分以内を目安に）');
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
  if (tool.site) for (const k of ['needle', 'stylet', 'tape', 'bleed', 'connect', 'clamp']) if (state.done[k + tool.site]) { state.done[k + tool.site] = false; uiDirty = true; }   // 抜針 → その針の手順をやり直し
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
  if (cs.held?.toggle) return;   // プローブ・聴診器はボタンを離しても持ったまま（離すのはもう一度トリガー）
  releaseHeld(cs);
}
// 持っている物（または患者の手首）を離す。離した場所に応じて置く・貼る・接続する・留置する
function releaseHeld(cs) {
  if (cs.wrist) { cs.wrist = false; cs.lastPose = ''; return; }   // 手首を離す → 前腕はゆっくり下りる（loop）
  const tool = cs.held;
  if (!tool) return;
  cs.held = null; tool.held = null; tool.holdPos = tool.holdQuat = null;
  grabPoint(cs, _v);

  if (tool.kind === 'pouch' && tool.obj.userData.torn) {
    // 開封済みのパウチはゴミ → 下段の膿盆へ
    const b = tools.swab0.homePos;
    scene.attach(tool.obj); tool.obj.position.set(b.x + 0.02, b.y + 0.006, b.z + 0.04); tool.obj.rotation.set(0, C.TRAY.yaw + 0.5, 0); tool.obj.scale.setScalar(1);
    tool.fixed = true; return;
  }
  if (tool.kind === 'cotton' && tool.used) { returnHome(tool); tool.fixed = true; return; }   // 使用済みの綿は膿盆へ（再利用不可）
  if (tool.kind === 'tablet') { placeTablet(tool); haptic(cs, 0.3, 40); return; }                    // タブレットは離した場所に置く
  if (tool.kind === 'probe') { placeProbe(tool); haptic(cs, 0.3, 40); return; }                      // プローブも離した場所に置く（プローブ立ての近くなら立てに戻す）
  if (tool.name === 'stethoscope') { returnHome(tool); return; }   // どこで離してもカートのトレイへ戻る（イヤーチップも外れる）
  if (tool.name === 'sheet') {
    const c = P.toArm(_v, _v4);
    const nearArm = Math.abs(c.z - C.ARM_Z) < 0.25 && c.x > C.ELBOW_X - 0.15 && c.x < C.WRIST_X + 0.25 && c.y < C.ARM_Y + 0.35;
    if (nearArm && !state.sheetPlaced) {
      state.sheetPlaced = true; P.sheetPlane.visible = true; tool.obj.visible = false; tool.fixed = true;
      scene.attach(tool.obj);
      if (P.lift > 0.05) { state.liftedForSheet = true; addLog('前腕を持ち上げてシーツを敷きました ✔', 'ok'); }
      completeStep('sheet'); haptic(cs, 0.6, 80); return;
    }
  } else if (tool.name === 'tourniquet') {
    if (_v.distanceTo(P.tourniquetWorld(_v4)) < 0.2 && !state.tourniquetOn) {
      state.tourniquetOn = true; state.tourniquetAt = clock.elapsedTime; tool.fixed = true;
      P.attachToUpperArm(tool.obj, P.tourniquet.pos);   // 上腕と一緒に動く
      const q = P.tourniquet.quat.clone();
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q.clone().invert());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-localUp.z, localUp.x)));
      tool.obj.quaternion.copy(q); tool.obj.scale.setScalar(1);
      setTourniquetApplied(tool.obj);
      haptic(cs, 0.7, 100);
      if (C.VESSEL_TYPES[config.vessel].usesTourniquet) { completeStep('tourniquet'); addLog('駆血によりシャント血管が怒張しました（3 分以内に穿刺）', 'info'); }
      else penalty(3, '人工血管（グラフト）では駆血は不要です');
      return;
    }
  } else if (tool.kind === 'needle') {
    setWingsFolded(tool.obj, false);
    if (tool.punctured && !tool.perforated) {
      // 刺さったまま留置（血管内なら寝かせて固定姿勢へ）
      if (tool.inVessel) {
        if (tool.angle > 18 && !state.done['needle' + tool.site]) addLog('針を寝かせて固定姿勢にしました', 'info');   // 減点しない（手を離せば自動で寝かせる）
        layDownNeedle(tool);
        tool.stuck = true; P.parentFor(P.toArm(tool.obj.getWorldPosition(_v3), _v3).x).attach(tool.obj);
        state.info = '';
        if (!state.done['needle' + tool.site]) addLog(`${tool.site}針 穿刺成功（刺入角 ${tool.angle.toFixed(0)}°）→ ${tool.obj.userData.type === 'cannula' && !tool.styletOut ? '内筒を抜去' : 'テープで固定'}`, 'ok');
        completeStep('needle' + tool.site); haptic(cs, 0.8, 120);
        if (tool.obj.userData.type === 'cannula' && tool.styletOut) completeStep('stylet' + tool.site);   // 持ったまま（グリップボタン）内筒を抜いていた場合
      } else {
        tool.stuck = true; P.parentFor(P.toArm(tool.obj.getWorldPosition(_v3), _v3).x).attach(tool.obj);
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
  P.toArm(n.localToWorld(_v.set(0, 0, tipZ)), _v);
  P.toArmDir(_v2.set(0, 0, -1).applyQuaternion(n.getWorldQuaternion(_q)), _v2); _v2.y = 0; _v2.normalize();
  const cl = V.closest(_v);
  const tan = cl.tangent.clone(); if (tan.dot(_v2) < 0) tan.negate();
  const tip = cl.point.clone().addScaledVector(tan, 0.006);                 // 血管軸上を 6mm 進める
  const hub = tip.clone().addScaledVector(tan, -L);
  hub.y = C.skinY(hub.x, hub.z) + ud.hubLift;
  const dir = new THREE.Vector3().subVectors(tip, hub).normalize();
  const zAxis = dir.clone().negate(), xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize(), yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
  // 基準姿勢で決めた姿勢を腕（前腕 / 上腕）の子として置く（ローカル = 基準姿勢 − 原点。腕がどの向きでも正しい）
  P.placeCanon(n, hub, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)));
  tool.inVessel = true;
}
function placeTape(tape) {
  tape.obj.getWorldPosition(_v);
  // 貼る相手 = テープに最も近い留置針（翼/ハブの位置で判定、12cm 以内）。すでに 2 枚貼った針は候補から外す（隣の針の固定を邪魔しない）
  const cand = [];
  for (const s of ['A', 'V']) {
    const n = tools['needle' + s];
    if (!n?.stuck) continue;
    n.obj.localToWorld(_v2.set(0, 0, n.obj.userData.tapeZ));
    cand.push({ s, d: _v.distanceTo(_v2), full: state.taped[s] >= 2 });
  }
  cand.sort((p, q) => p.d - q.d);
  let site = null;
  if (cand.length && cand[0].d < 0.12) {
    if (!cand[0].full) site = cand[0].s;
    else if (cand[1] && !cand[1].full && cand[1].d < 0.07) site = cand[1].s;   // 一番近い針が 2 枚貼り済みでも、7cm 以内にもう一方の針があればそちらへ
    else { addLog(`${cand[0].s}針のテープは 2 枚で十分です`, 'info'); return false; }
  }
  if (!site) return false;
  {
    const n = tools['needle' + site];
    const ud = n.obj.userData, k = state.taped[site];
    if (ud.type === 'cannula' && !n.styletOut) { addLog('先に内筒（金属針）を抜去してください', 'warn'); return false; }
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
  const axis = P.toArmDir(new THREE.Vector3(0, 0, -1).applyQuaternion(nq), new THREE.Vector3()); axis.y = 0; axis.normalize();   // 針先方向（基準姿勢・水平成分）
  const across = new THREE.Vector3(-axis.z, 0, axis.x);                                          // 幅方向（腕を横切る）
  const zc = kind === 'tube' ? 0.065 : kind === 'hubRear' ? ud.tapeZ + 0.014 : ud.tapeZ;
  const c = P.toArm(n.obj.localToWorld(new THREE.Vector3(0, 0, zc)));
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
  // 貼ったテープは針に追従させる（基準姿勢で作った形状を前腕の座標系（= 基準姿勢 − 肘）に置いてから、針の子として保持）
  tape.obj.quaternion.identity();
  P.placeCanon(tape.obj, new THREE.Vector3(0, 0, 0), null, c.x); n.obj.attach(tape.obj);
  setTapeApplied(tape.obj, geo);
}
// 針に貼ってあるテープなら、その針
const needleOfTape = tape => ['A', 'V'].map(s => tools['needle' + s]).find(n => n && n.obj === tape.obj.parent) || null;
// テープを剥がして手に持つ。その針のテープが 0 枚になれば固定の手順をやり直し（針を抜けるようになる）
function peelTape(tape, cs) {
  const n = needleOfTape(tape);
  tape.fixed = false; resetTape(tape.obj);
  if (n) {
    const site = n.site; state.taped[site] = Math.max(0, state.taped[site] - 1);
    if (state.taped[site] === 0) { n.taped = false; state.done['tape' + site] = false; }
  }
  grab(cs, tape);
  addLog(`${n ? n.site + '針の' : ''}テープを剥がしました（離すとカートへ戻ります。針の上で離すと貼り直し）`, 'info'); uiDirty = true;
}
// 接続済みの回路を針から外して手に持つ。接続・クランプ開放・ポンプの手順はやり直し。運転中なら停止して減点
function disconnectLine(conn, cs) {
  const site = conn.site;
  state.connected[site] = false; conn.fixed = false;
  if (state.pumpOn) { state.pumpOn = false; state.flowT = -1; state.flowDone = false; room.setPumpRunning(false); penalty(5, '運転中に回路を外しました（ポンプ停止）'); }
  for (const id of ['connect' + site, 'clamp' + site, 'pump']) state.done[id] = false;
  grab(cs, conn); updateLine(conn, 'held');
  addLog(`${site}針から血液回路を外しました（離すと装置側へ戻ります。テープを剥がせば針を抜けます）`, 'info'); uiDirty = true;
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
  if (!tools.needleA?.inVessel) { penalty(10, 'A針の先端が血管内にないため脱血できません（脱血不良アラーム）。回路を外し、テープを剥がして抜針し、刺し直してから運転'); haptic(controllers[0], 1, 300); return; }
  state.pumpOn = true; state.flowT = 0; state.vLeak = false;
  room.setPumpRunning(true);
  addLog('血液ポンプ開始 → A針から血液が回路へ流れ始めました', 'ok');
  completeStep('pump');
}
function withdrawStylet(tool, cs) {
  if (tool.styletOut) return;
  if (!tool.inVessel && !tool.everFlash) penalty(15, '逆血を確認する前に内筒を抜去');
  else addLog('逆血確認後に内筒抜去 ✔', 'ok');   // 逆血後に進めたかどうかは減点しない（刺し方は術者の流儀に任せる）
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
    t.obj.visible = t.kind !== 'cotton'; t.used = false;
    if (t.kind === 'needle') resetNeedleState(t);
    if (t.name === 'tourniquet') setTourniquetCoiled(t.obj);
    if (t.kind === 'pouch') { setPouchTaken(t.obj, false); setPouchTorn(t.obj, false); }
    returnHome(t);
  }
  createNeedles();
  P.sheetPlane.visible = false; P.hematoma.visible = false; P.swelling.visible = false; P.clearDisinfect();
  P.vessel.pickSites();   // 穿刺部位は毎回変える
  buildSteps();
  P.setPose({ abduct: 0, yaw: 0, lift: 0, roll: 0 });   // 腕の姿勢も基準に戻す
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
    // 針先は血管の走行に沿わせる（A は末梢向き、V は中枢向き）
    const dir = s.tangent.clone(); dir.y = 0; dir.normalize(); if ((site === 'A') === (dir.x < 0)) dir.negate();
    P.placeCanon(n.obj, new THREE.Vector3(s.x - dir.x * 0.012, C.skinY(s.x, s.z) + 0.004, s.z - dir.z * 0.012), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, Math.atan2(-dir.x, -dir.z), 0, 'YXZ')));
    n.punctured = true; n.inVessel = true; n.angle = 20;
    layDownNeedle(n); n.stuck = true;
    if (ud.stylet) { n.styletOut = true; ud.stylet.visible = false; }
    state.done['needle' + site] = true; state.done['stylet' + site] = true;
    for (const ti of site === 'A' ? [0, 2] : [1, 3]) { const tp = tools['tape' + ti]; n.obj.getWorldPosition(tp.obj.position); placeTape(tp); }
    if (ud.clamp) { state.bleed[site] = 1; ud.fill.set(1); state.done['bleed' + site] = true; }
    const conn = tools['conn' + site]; conn.obj.position.copy(n.obj.localToWorld(new THREE.Vector3(0, 0, ud.lineEndZ))); connectLine(conn);
    if (ud.clamp) toggleClamp(n);
  }
  if (new URLSearchParams(location.search).get('leak') === '1') tools.needleV.inVessel = false;   // V 針が血管外のまま運転 → 漏れの確認
  startPump();
  const f = Number(new URLSearchParams(location.search).get('flow')); if (f > 0) state.flowT = f;
}

// 自己テスト: 各器具の「掴む判定の中心」に仮想コントローラー（手のモデル付き）を置いてトリガー → その器具が手に移るか、離すと戻るかを検証。
// さらに: プローブは持ち手の上端・中ほど・下端の 3 点と、持ったままエコー画像を 5 フレーム生成、皮膚で止まるか。
// 留置針の内筒抜去（ハブ近くでトリガー / ハブをつまむ）、テープを反対の手の甲に貼って剥がす、も確認する
function selfTestGrab() {
  const results = [];
  const mkFake = (side, pos) => {
    const f = { ctrl: new THREE.Group(), grip: new THREE.Group(), toolRoot: new THREE.Group(), push: new THREE.Vector3(), vgripBase: new THREE.Vector3(), tracked: false, lost: false, heldLost: false, touching: false, side, held: null, wrist: false, inputSource: null, lastPos: new THREE.Vector3(), selectPressed: false, squeezePressed: false, lastBeat: -1, byHold: 0, turned: false, hands: controllers[0].hands };
    f.ctrl.add(f.toolRoot);
    const h = loadHand(side, gloveMat); const pose = gripPose(side);
    h.group.quaternion.copy(pose.quaternion); h.group.position.copy(pose.position);
    const holder = new THREE.Group(); holder.add(h.group); f.grip.add(holder); f.holder = holder; f.hand = h;
    f.hands = { ...controllers[0].hands, [side]: { ...controllers[0].hands[side], api: h, holder } };   // 針の持ち位置はこの手で決める
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
    const attached = !!got && got.obj.parent === fake.toolRoot;
    let echoOk = null;
    if (got?.kind === 'probe') { echoOk = true; for (let i = 0; i < 5; i++) { updateEcho(0.016, i * 0.016, 60 / C.HEART_BPM); if (echoError) echoOk = false; } }
    fake.selectPressed = false; onSelectEnd(fake);
    let stillHeldOk = true;
    if (tool.toggle) { stillHeldOk = fake.held === tool; fake.selectPressed = true; onSelectStart(fake); fake.selectPressed = false; onSelectEnd(fake); }   // 長く使う器具: ボタンを離しても保持 → 再トリガーで離す
    const released = tool.held === null && tool.obj.parent !== fake.toolRoot;
    const ok = got === tool && attached && released && stillHeldOk && echoOk !== false;
    log(label, ok, `: got=${got?.name ?? '(none)'} attached=${attached} released=${released}` + (echoOk === null ? '' : ` echo=${echoOk}`));
  };
  const run = () => {
    for (const t of toolList) {
      if (t.locked || t.fixed) continue;
      tryGrab(t.name, t, t.obj.localToWorld(t.grabOffset.clone()));
    }
    const probe = tools.probe;
    for (const [label, off] of [['probe 持ち手 上端', [0, 0.15, 0]], ['probe 持ち手 下端', [0, 0.04, 0]], ['probe 先端 横 3cm', [0.03, 0.02, 0]]]) tryGrab(label, probe, probe.obj.localToWorld(new THREE.Vector3(...off)));
    // プローブを立てから離れた所で離す → その場に置かれる（立てには戻らない）。立ての近くで離す → 立てに戻る
    {
      const pr = tools.probe;
      grab(fake, pr);
      moveTo(fake, new THREE.Vector3(0.5, 1.05, -0.95));
      fake.selectPressed = true; onSelectStart(fake); fake.selectPressed = false; onSelectEnd(fake);   // 持っている → 再トリガーで離す
      const w = pr.obj.getWorldPosition(new THREE.Vector3());
      log('プローブは離した所に置かれる', pr.held === null && w.distanceTo(pr.homePos) > 0.3 && Math.abs(w.x - 0.5) < 0.1 && Math.abs(w.z + 0.95) < 0.1 && Math.abs(w.y - 1.03) < 0.1, `: pos=(${w.x.toFixed(2)}, ${w.y.toFixed(2)}, ${w.z.toFixed(2)})`);
      grab(fake, pr); moveTo(fake, pr.homePos.clone().add(new THREE.Vector3(0, 0.05, 0)));
      fake.selectPressed = true; onSelectStart(fake); fake.selectPressed = false; onSelectEnd(fake);
      log('立ての近くで離すと立てに戻る', pr.held === null && pr.obj.position.distanceTo(pr.homePos) < 1e-6);
    }
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
    // 聴診器のダイアフラムも皮膚で止まるか（手を皮膚の 2cm 下まで押し込む）
    {
      const st = tools.stethoscope, s = P.vessel.sites.V, a = C.armAt(s.x);
      moveTo(fake, new THREE.Vector3(s.x, s.y + 0.1, s.z));
      grab(fake, st);
      const hold = (st.holdPos || st.gripPos).clone().applyQuaternion(fake.ctrl.quaternion);
      moveTo(fake, new THREE.Vector3(s.x, s.y - 0.02, s.z).sub(hold));
      updateHeld(fake, st, 0.016);
      st.obj.updateMatrixWorld(true);
      const F = st.obj.localToWorld(STETH_FACE.clone());
      const sink = a.r - Math.hypot(F.y - a.y, F.z - a.z);
      log('聴診器 皮膚で止まる', sink <= 0.0035 && sink >= -0.001, `: 沈み込み=${(sink * 1000).toFixed(1)}mm`);   // 腕の側面の部位では面の向きの分で 3mm 程度まで許容（seed 5 で 2.9mm）
      fake.held = null; st.held = null; returnHome(st);
    }
    // テープ: 2 枚貼り済みの針が 6cm 隣にあっても、翼の上で離したテープはその針に貼れるか
    {
      const s = P.vessel.sites.V;
      const nf = registerTool('testFull', makeNeedle(0xd9303a, 'metal'), { pos: [s.x + 0.06, s.y + 0.004, s.z], rotY: 0, gripPos: [0, 0, 0], kind: 'needle', site: 'A' });
      const nt = registerTool('testTarget', makeNeedle(0x2f6fd0, 'metal'), { pos: [s.x, s.y + 0.004, s.z], rotY: 0, gripPos: [0, 0, 0], kind: 'needle', site: 'V' });
      nf.stuck = nt.stuck = true; nf.inVessel = nt.inVessel = true;
      const sv = { ...state.taped }; state.taped.A = 2; state.taped.V = 0;
      const prevA = tools.needleA, prevV = tools.needleV; tools.needleA = nf; tools.needleV = nt;
      const tp = tools.tape2; tp.obj.position.set(s.x, s.y + 0.01, s.z); tp.obj.updateMatrixWorld(true);
      const ok = placeTape(tp) && state.taped.V === 1 && tp.obj.parent === nt.obj;
      log('隣の針が貼り済みでも翼の上のテープは貼れる', ok, `: tapedV=${state.taped.V} parent=${tp.obj.parent === nt.obj}`);
      tools.needleA = prevA; tools.needleV = prevV; Object.assign(state.taped, sv); nt.taped = false;
      tp.fixed = false; resetTape(tp.obj); returnHome(tp); removeTool('testFull'); removeTool('testTarget');
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
      // 反対の手で剥がす（5cm 隣に留置した針があっても、針ではなくテープを取る）
      const tpw = tp.obj.getWorldPosition(new THREE.Vector3());
      const tn = registerTool('testStuck', makeNeedle(0xd9303a, 'metal'), { pos: [tpw.x + 0.05, tpw.y, tpw.z], rotY: 0, gripPos: [0, 0, 0], kind: 'needle', site: 'A' });
      tn.stuck = true; tn.punctured = true; tn.inVessel = true;
      moveTo(fake, tpw);
      fake.selectPressed = true; onSelectStart(fake);
      log('テープを手の甲から剥がす（隣の留置針より優先）', fake.held === tp && tp.obj.parent === fake.toolRoot && !tp.onHand, `: got=${fake.held?.name ?? '(none)'}`);
      removeTool('testStuck');
      moveTo(fake, new THREE.Vector3(0.9, 1.3, 0.6)); fake.selectPressed = false; onSelectEnd(fake);
      log('テープを離すとカートへ戻る', tp.obj.parent === scene && tp.obj.position.distanceTo(tp.homePos) < 1e-6);
    }
    // 駆血して血管内に留置した針は、駆血帯を外して静脈が細くなっても先端が血管内に残るか（A/V 両方）
    if (config.vessel === 'avf') {
      P.vessel.setRadius(C.VESSEL_R_DILATED);
      for (const site of ['V', 'A']) {
        const n = tools['needle' + site], s = P.vessel.sites[site];
        const dir = s.tangent.clone(); dir.y = 0; dir.normalize(); if ((site === 'A') === (dir.x < 0)) dir.negate();
        // 針先は部位から 2〜3cm 先へ進むので、狭窄（部位から 2.5〜3.5cm）のない側へ向ける
        { const ahead = P.vessel.closest(new THREE.Vector3(s.x + dir.x * 0.025, s.y - 0.004, s.z + dir.z * 0.025)); if (ahead.sten > 0.2) dir.negate(); }
        P.placeCanon(n.obj, new THREE.Vector3(s.x - dir.x * 0.012, C.skinY(s.x, s.z) + 0.004, s.z - dir.z * 0.012), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, Math.atan2(-dir.x, -dir.z), 0, 'YXZ')));
        n.punctured = true; n.inVessel = true; layDownNeedle(n); n.stuck = true;
      }
      P.vessel.setRadius(C.VESSEL_R_NORMAL);
      for (const site of ['V', 'A']) {
        const n = tools['needle' + site], ud = n.obj.userData;
        n.obj.updateMatrixWorld(true); P.toArm(n.obj.localToWorld(_v3.set(0, 0, ud.tipZ)), _v3);
        const cl = P.vessel.closest(_v3);
        log(`駆血解除後も ${site}針の先端は血管内`, cl.d < cl.r && cl.kind === 'vein', `: 軸からの距離=${(cl.d * 1000).toFixed(1)}mm 半径=${(cl.r * 1000).toFixed(1)}mm`);
        n.stuck = false; resetNeedleState(n); returnHome(n);
      }
      P.vessel.setRadius(C.VESSEL_R_NORMAL);
    }
    // 術者の手は患者の腕を貫通しない: 回内位の手（甲が上）を掌の中心が皮膚の 2cm 下に来るまで下げても、手は皮膚の上へ押し戻される
    {
      const s = P.vessel.sites.V;
      fake.hand.setCurl({ thumb: 0.3, index: 0.2, middle: 0.2, ring: 0.2, pinky: 0.2, thumbOpp: 0 });
      fake.grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));   // 甲 = 上、指先 = -z
      fake.ctrl.quaternion.copy(fake.grip.quaternion);
      moveTo(fake, new THREE.Vector3(s.x, C.skinY(s.x, s.z), s.z));   // 掌の中心（原点から掌側へ 2cm）= 皮膚の 2cm 下
      resetHandPush(fake); fake.grip.updateMatrixWorld(true);
      const before = handPenetration(fake, new THREE.Vector3());
      updateHandContact(fake, 0.016);
      const after = handPenetration(fake, new THREE.Vector3());
      log('手は患者の腕を貫通しない（皮膚で止まる）', before > 0.01 && after < 0.001 && fake.push.y > 0.01, `: 侵入 ${(before * 1000).toFixed(0)}mm → ${(after * 1000).toFixed(1)}mm, 押し戻し ${(fake.push.length() * 1000).toFixed(0)}mm (${fake.penName})`);
      log('手に触れた判定', fake.touching);
    }
    // 針を持った手: 針先を血管の中心（皮膚の 5mm 下）に置いたとき、手が皮膚に当たって押し戻される量は小さい（針先は血管に届く）
    {
      // 針は血管（腕）に沿って肘側（-x）へ 20° で刺す向き。手は回内位（甲が上）、親指は術者側（+z）
      const s = P.vessel.sites.V, n = tools.needleV, pitch = 20 * Math.PI / 180;
      const f = new THREE.Vector3(-Math.cos(pitch), -Math.sin(pitch), 0), Y = f.clone().negate(), X = new THREE.Vector3(-Math.sin(pitch), Math.cos(pitch), 0), Z = new THREE.Vector3().crossVectors(X, Y);
      fake.grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); fake.ctrl.quaternion.copy(fake.grip.quaternion);
      moveTo(fake, new THREE.Vector3(s.x, s.y + 0.2, s.z));
      grab(fake, n); fake.toolRoot.updateMatrixWorld(true);
      // 針の向きは手の中の持ち方（つまむ軸）で決まるので、針が血管に沿って 20° 下向きになるよう手ごと回す
      { const d = new THREE.Vector3(0, 0, -1).applyQuaternion(n.obj.getWorldQuaternion(new THREE.Quaternion())); const q = new THREE.Quaternion().setFromUnitVectors(d, f); fake.grip.quaternion.premultiply(q); fake.ctrl.quaternion.premultiply(q); fake.grip.updateMatrixWorld(true); fake.ctrl.updateMatrixWorld(true); }
      const tip = n.obj.localToWorld(new THREE.Vector3(0, 0, n.obj.userData.tipZ));
      const target = new THREE.Vector3(s.x, C.skinY(s.x, s.z) - 0.005, s.z);
      moveTo(fake, fake.ctrl.position.clone().add(target.clone().sub(tip)));
      resetHandPush(fake); fake.grip.updateMatrixWorld(true); fake.toolRoot.updateMatrixWorld(true);
      updateHandContact(fake, 0.016);
      const tip2 = n.obj.localToWorld(new THREE.Vector3(0, 0, n.obj.userData.tipZ));
      const dz = target.y - tip2.y;
      log('針を持った手が皮膚で止まっても針先は血管に届く', fake.push.length() < 0.004 && Math.abs(dz) < 0.004, `: 押し戻し ${(fake.push.length() * 1000).toFixed(1)}mm (${fake.penName}), 針先の上昇 ${(-dz * 1000).toFixed(1)}mm`);
      fake.held = null; n.held = null; resetNeedleState(n); returnHome(n);
    }
    // アルコール綿を持った手: 綿の底面を皮膚に置いても、手の押し戻しは小さい（消毒できる）
    {
      const s = P.vessel.sites.V, sw = tools.swab0;
      fake.grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
      // targetRay（ctrl）の向き: gripSpace に対して -Z = 指先方向, +Y = 手の甲（仮想 targetRay と同じ関係）
      fake.ctrl.quaternion.copy(fake.grip.quaternion).multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0))));
      moveTo(fake, new THREE.Vector3(s.x, s.y + 0.2, s.z));
      grab(fake, sw); fake.toolRoot.updateMatrixWorld(true);
      const o = sw.obj.getWorldPosition(new THREE.Vector3());
      const target = new THREE.Vector3(s.x, C.skinY(s.x, s.z), s.z);
      moveTo(fake, fake.ctrl.position.clone().add(target.clone().sub(o)));
      resetHandPush(fake); fake.grip.updateMatrixWorld(true); fake.toolRoot.updateMatrixWorld(true);
      updateHandContact(fake, 0.016);
      const o2 = sw.obj.getWorldPosition(new THREE.Vector3());
      log('アルコール綿を持った手は押し戻さない（綿を皮膚に当てられる）', Math.abs(o2.y - target.y) < 0.002 && fake.push.length() < 1e-6, `: 手の押し戻し ${(fake.push.length() * 1000).toFixed(1)}mm`);
      fake.held = null; sw.held = null; returnHome(sw);
      fake.grip.quaternion.identity(); fake.ctrl.quaternion.identity(); resetHandPush(fake);
    }
    // ハンドトラッキングの追跡が途切れても（手がカメラの外へ出ても）持っている物を離さず、手が戻って次につまんだときに離す
    {
      const tp = tools.tape1;
      moveTo(fake, new THREE.Vector3(0.6, 1.3, 0.3));
      grab(fake, tp);
      fake.tracked = true; fake.lost = true; fake.selectPressed = true;
      onSelectEndXR(fake);
      const kept = fake.held === tp && fake.heldLost;
      fake.lost = false; fake.tracked = false;
      fake.selectPressed = true; onSelectStart(fake); fake.selectPressed = false; onSelectEnd(fake);
      log('ハンドトラッキングが途切れても持った物を離さない → 手が戻って次につまむと離す', kept && fake.held === null && tp.obj.parent === scene, `: kept=${kept} held=${fake.held?.name ?? '(none)'}`);
      fake.heldLost = false;
    }
    // ハンドトラッキングの持ち位置の整合: コントローラー用の手（FK）の関節の姿勢をそのまま XR の関節として与えると、
    // 関節から作る仮想 gripSpace がコントローラーの gripSpace に一致する（原点 1.5cm 以内・軸 12° 以内）→ 器具の持ち方が両モードで同じになる
    for (const [fk, side] of [[fake, 'right'], [fake2, 'left']]) {
      const cs0 = controllers[0], tr = cs0.hands[side].tracked, h = fk.hand;
      h.setCurl({ thumb: 0.3, index: 0.3, middle: 0.3, ring: 0.3, pinky: 0.3, thumbOpp: 0 });
      fk.grip.quaternion.identity(); moveTo(fk, new THREE.Vector3(0.6, 1.3, 0.3)); resetHandPush(fk); fk.grip.updateMatrixWorld(true);
      const fakeHand = new THREE.Group(); fakeHand.joints = {};
      for (const name of XR_JOINTS) { const b = h.joint[name]; if (!b) continue; const j = new THREE.Group(); b.getWorldPosition(j.position); b.getWorldQuaternion(j.quaternion); j.visible = true; fakeHand.joints[name] = j; }
      const prevHand = cs0.hand, prevTracked = cs0.tracked, prevSide = cs0.side; cs0.hand = tr; cs0.tracked = true; cs0.side = side;
      tr.group.position.set(0, 0, 0); tr.update(fakeHand); tr.group.updateMatrixWorld(true); cs0.vgFilter?.p.reset(); cs0.vgFilter?.q.reset(); updateVirtualGrip(cs0);
      const o = cs0.vgrip.getWorldPosition(new THREE.Vector3()), og = fk.grip.getWorldPosition(new THREE.Vector3());
      const q = cs0.vgrip.getWorldQuaternion(new THREE.Quaternion()), qg = fk.grip.getWorldQuaternion(new THREE.Quaternion());
      const ang = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(q.dot(qg)))));
      const axd = ['x', 'y', 'z'].map(a => { const v = new THREE.Vector3(); v[a] = 1; const w = v.clone().applyQuaternion(qg); return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, v.applyQuaternion(q).dot(w)))).toFixed(1); });
      const dl = o.clone().sub(og).applyQuaternion(qg.clone().invert());
      log(`ハンドトラッキングの仮想 gripSpace はコントローラーの gripSpace と一致（${side}）`, dl.length() < 0.015 && ang < 12, `: 原点ずれ ${(dl.length() * 1000).toFixed(1)}mm (grip 座標 ${dl.toArray().map(v => (v * 1000).toFixed(0)).join(',')}) 軸ずれ ${ang.toFixed(1)}° (X ${axd[0]} Y ${axd[1]} Z ${axd[2]})`);
      cs0.hand = prevHand; cs0.tracked = prevTracked; cs0.side = prevSide;
      tr.group.position.set(0, 0, 0);
    }
    // ハンドトラッキングの仮想 gripSpace: 回内位で指先が前（-z）、人差し指が -x 側の右手 → X（甲）= 上, Y = +z（手首方向）, Z = +x（小指側）
    {
      const cs0 = controllers[0], tr = cs0.hands.right.tracked;
      const fakeHand = new THREE.Group(); fakeHand.joints = {};
      const put = (name, x, y, z) => { const j = new THREE.Group(); j.position.set(x, y, z); j.visible = true; fakeHand.joints[name] = j; };
      for (const name of Object.keys(tr.joints)) put(name, 0, 1, 0);
      put('wrist', 0, 1, 0); put('middle-finger-phalanx-proximal', 0, 1, -0.1); put('index-finger-phalanx-proximal', -0.03, 1, -0.09); put('pinky-finger-phalanx-proximal', 0.03, 1, -0.09);
      const prevHand = cs0.hand, prevTracked = cs0.tracked; cs0.hand = tr; cs0.tracked = true;
      tr.update(fakeHand); tr.group.updateMatrixWorld(true); cs0.vgFilter?.p.reset(); cs0.vgFilter?.q.reset(); updateVirtualGrip(cs0);
      const q = cs0.vgrip.getWorldQuaternion(new THREE.Quaternion());
      const ax = v => v.applyQuaternion(q);
      const X = ax(new THREE.Vector3(1, 0, 0)), Y = ax(new THREE.Vector3(0, 1, 0)), Z = ax(new THREE.Vector3(0, 0, 1)), o = cs0.vgrip.getWorldPosition(new THREE.Vector3());
      const ok = X.y > 0.99 && Y.z > 0.99 && Z.x > 0.99 && Math.abs(o.z + 0.094) < 0.005;   // 原点 = 付け根の中点 (z -0.09) から指先側へ 4mm
      log('ハンドトラッキングの仮想 gripSpace', ok, `: X=(${X.toArray().map(v => v.toFixed(2))}) Y=(${Y.toArray().map(v => v.toFixed(2))}) Z=(${Z.toArray().map(v => v.toFixed(2))}) origin z=${o.z.toFixed(3)}`);
      cs0.hand = prevHand; cs0.tracked = prevTracked;
    }
    // ハンドトラッキング用モデル: 関節の姿勢を与えると指先がそこへ動くか（実機なしで確認できる範囲）
    {
      const tr = controllers[0].hands.right.tracked;
      const fakeHand = new THREE.Group(); fakeHand.joints = {};
      let k = 0;
      for (const name of Object.keys(tr.joints)) { const j = new THREE.Group(); j.position.set(0.3 + 0.01 * k, 1.2, -0.4 + 0.005 * k); j.visible = true; fakeHand.joints[name] = j; k++; }
      const want = fakeHand.joints['index-finger-tip']?.position.clone();
      tr.update(fakeHand); tr.group.updateMatrixWorld(true);
      const got = tr.tips.index?.getWorldPosition(new THREE.Vector3());
      const ok = tr.loaded && !!want && !!got && got.distanceTo(tr.group.localToWorld(want.clone())) < 1e-6;
      log('ハンドトラッキング用モデル: 関節に追従', ok, `: loaded=${tr.loaded} joints=${Object.keys(tr.joints).length}`);
    }
    // 針の 2 つの持ち方: トリガー = 標準（中指〜小指を握る）、グリップ = 浅い血管用（OK サイン: 中指〜小指を伸ばし、つまみ位置は掌側＝下）
    {
      const n = tools.needleV, h = fake.hand;
      fake.grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));   // 回内位（甲が上）
      fake.ctrl.quaternion.copy(fake.grip.quaternion); moveTo(fake, new THREE.Vector3(0.6, 1.3, 0.3));
      const pinchY = (cs) => { fake.toolRoot.updateMatrixWorld(true); const p = n.obj.localToWorld(new THREE.Vector3(...n.obj.userData.pinch)); return p.y - fake.grip.position.y; };
      grab(fake, n); const modeA = n.holdMode, yA = pinchY(), tipsA = h.tips.middle.getWorldPosition(new THREE.Vector3()).distanceTo(h.joint.wrist.getWorldPosition(new THREE.Vector3()));
      fake.held = null; n.held = null; returnHome(n);
      fake.grabByGrip = true; grab(fake, n); fake.grabByGrip = false; const modeB = n.holdMode, yB = pinchY(), tipsB = h.tips.middle.getWorldPosition(new THREE.Vector3()).distanceTo(h.joint.wrist.getWorldPosition(new THREE.Vector3()));
      const midB = h.tips.middle.getWorldPosition(new THREE.Vector3()).y - fake.grip.position.y;   // 伸ばした中指の先の高さ（回内位なので上が +y）
      const gap = h.tips.thumb.getWorldPosition(new THREE.Vector3()).distanceTo(h.tips.index.getWorldPosition(new THREE.Vector3()));
      fake.held = null; n.held = null; returnHome(n); fake.grip.quaternion.identity(); fake.ctrl.quaternion.identity();
      log('グリップで持つと浅い血管用の持ち方（つまみ位置が伸ばした指より下、中指〜小指が伸びる）', modeA === 'pinch' && modeB === 'ok' && yB < midB - 0.02 && tipsB > tipsA + 0.05 && gap < 0.012 && Math.abs(yA - yB) < 0.002, `: 標準 ${modeA} つまみ高さ ${(yA * 1000).toFixed(0)}mm 中指先まで ${(tipsA * 1000).toFixed(0)}mm / グリップ ${modeB} つまみ ${(yB * 1000).toFixed(0)}mm 中指先の高さ ${(midB * 1000).toFixed(0)}mm 中指先まで ${(tipsB * 1000).toFixed(0)}mm 指先の隙間 ${(gap * 1000).toFixed(1)}mm`);
    }
    // 触知: 人差し指を立てた手の指先を血管の真上の皮膚に置くと拍動、1.5cm 横では伝わらない、指を立てていなければ伝わらない
    {
      const sv = P.vessel.sites.V, dir = sv.tangent.clone(); dir.y = 0; dir.normalize(); const side = new THREE.Vector3(-dir.z, 0, dir.x);
      fake.hand.setCurl({ ...POINT_CURL, thumbOpp: 0 }); fake.grip.quaternion.identity(); fake.ctrl.quaternion.identity(); fake.grip.updateMatrixWorld(true);
      const tip = palpPoint(fake, new THREE.Vector3()), ctrlP = fake.ctrl.getWorldPosition(new THREE.Vector3());   // 基準点 = 人差し指の先
      const put = c => moveTo(fake, P.toWorld(c).add(ctrlP).sub(tip));
      const savedDone = state.done.palpate; state.done.palpate = true;   // 手順の完了判定は動かさず、拍動の判定だけ見る
      fake.pointing = true; put(new THREE.Vector3(sv.x, sv.y + 0.012, sv.z)); const onTop = updatePalpation(fake, 0.016, 1);   // 第 1 関節が皮膚の 1.2cm 上（指の腹が皮膚に触れる高さ）
      // 血管の縁の少し外（半径 + 2mm 横）: 拍動は伝わらない（ここに刺すと血管に入らない）
      const svb = P.vessel.closestBelow(new THREE.Vector3(sv.x, sv.y + 0.012, sv.z)), edgeOff = svb.r + 0.002;
      let edge = false;
      for (const sg of [1, -1]) {   // 縁の外側で、真下に別の血管が来ない側を使う（別の血管があればそれは正しく拍動する）
        const c = new THREE.Vector3(sv.x + side.x * edgeOff * sg, 0, sv.z + side.z * edgeOff * sg); c.y = C.skinY(c.x, c.z) + 0.012;
        const cb = P.vessel.closestBelow(c); if (cb && cb.branch !== svb.branch) continue;
        put(c); edge = updatePalpation(fake, 0.016, 4); break;
      }
      // 横にずらした所: 真下に別の静脈がない位置（1.5〜3cm、両側から探す）
      let bp = null;
      for (const off of [0.015, 0.02, 0.025, 0.03]) for (const sg of [1, -1]) { const c = new THREE.Vector3(sv.x + side.x * off * sg, 0, sv.z + side.z * off * sg); c.y = C.skinY(c.x, c.z) + 0.012; const cb = P.vessel.closestBelow(c); if (!bp && (!cb || cb.horiz > cb.r + 0.01)) bp = c; }
      put(bp || new THREE.Vector3(sv.x + side.x * 0.03, C.skinY(sv.x + side.x * 0.03, sv.z + side.z * 0.03) + 0.012, sv.z + side.z * 0.03)); const beside = updatePalpation(fake, 0.016, 2);
      fake.pointing = false; put(new THREE.Vector3(sv.x, sv.y + 0.012, sv.z)); const notPointing = updatePalpation(fake, 0.016, 3);
      // 学習モード（手順「スリルを触知」の最中）: 開いた手でも、1cm 横でも伝わる
      state.done.palpate = false; put(new THREE.Vector3(sv.x + side.x * 0.01, C.skinY(sv.x + side.x * 0.01, sv.z + side.z * 0.01) + 0.012, sv.z + side.z * 0.01)); const learn = updatePalpation(fake, 0.016, 5);
      state.palpateTime = 0; state.done.palpate = savedDone; state.info = '';
      log('触知: 穿刺時は立てた人差し指の先が内腔の真上にあるときだけ拍動（縁の外・横 1.5cm・指を立てない手では伝わらない）、学習中は開いた手で触れるだけで伝わる', onTop && !edge && !beside && !notPointing && learn, `: 真上=${onTop} 縁の外(${(edgeOff * 1000).toFixed(1)}mm)=${edge} 横=${beside} 指を立てない=${notPointing} 学習中(開いた手・1cm横)=${learn}`);
    }
    // 刺し直し: 接続済みの回路を外す → テープを剥がす → 針を持てる → 抜針でその針の手順がやり直し
    {
      const n = tools.needleA, tp = tools.tape0, conn = tools.connA, gp = new THREE.Vector3();
      const sv = P.vessel.sites.A;
      scene.attach(n.obj); n.obj.position.copy(P.toWorld(new THREE.Vector3(sv.x, sv.y + 0.01, sv.z))); n.obj.quaternion.identity(); n.obj.updateMatrixWorld(true);
      n.stuck = true; n.taped = true; n.punctured = true; n.inVessel = false; n.styletOut = true; state.taped.A = 1;   // 留置針なら内筒は抜去済み
      tp.fixed = true; n.obj.attach(tp.obj); conn.fixed = true; n.obj.add(conn.obj); conn.obj.position.set(0, 0, n.obj.userData.lineEndZ); state.connected.A = true;
      for (const id of ['needleA', 'tapeA', 'connectA']) state.done[id] = true;
      n.obj.localToWorld(gp.copy(n.grabOffset)); const blocked = nearestTool(fake, gp) !== n;          // 回路がつながった針は持てない
      disconnectLine(conn, fake); const disc = !state.connected.A && fake.held === conn && !state.done.connectA;
      fake.held = null; conn.held = null; returnHome(conn);
      n.obj.localToWorld(gp.copy(n.grabOffset)); const stillBlocked = nearestTool(fake, gp) !== n;     // テープが残っていれば持てない
      peelTape(tp, fake); const peeled = !n.taped && !state.done.tapeA && fake.held === tp && state.taped.A === 0;
      fake.held = null; tp.held = null; returnHome(tp);
      n.obj.localToWorld(gp.copy(n.grabOffset)); const grabbable = nearestTool(fake, gp) === n;
      if (grabbable) grab(fake, n);
      const regrabbed = fake.held === n && !n.stuck;
      n.punctured = false; resetNeedleState(n); const undone = !state.done.needleA;
      fake.held = null; n.held = null; returnHome(n); state.connected.A = false; state.taped.A = 0; state.info = '';
      log('刺し直し: 回路を外す → テープを剥がす → 針を持ち直して抜針 → 手順がやり直し', blocked && disc && stillBlocked && peeled && grabbable && regrabbed && undone, `: 接続中は持てない=${blocked} 回路外し=${disc} テープ残りで持てない=${stillBlocked} 剥離=${peeled} 持てる=${grabbable} 持ち直し=${regrabbed} やり直し=${undone}`);
    }
    // タイトルへ戻るボタン: 透析室の物が隠れてタイトルが出る → スタートで透析室に戻る
    {
      returnToTitle();
      const inTitle = titleMode && title.group.visible && P.group.visible === false;
      startGame();
      log('赤いボタンでタイトル画面へ戻り、スタートで透析室に戻る', inTitle && !titleMode && P.group.visible && !title.group.visible, `: title=${inTitle} back=${!titleMode && P.group.visible}`);
    }
    // タイトル画面のキー: 上段の「針」キーを指で押し込んでも、下段のスタートは押されない（矩形判定）。押すと針の種類が切り替わる
    {
      const prevTitle = titleMode; titleMode = true; title.group.visible = true;
      const needleBtn = title.buttons.find(b => b.name === 'title_needle'), startBtn = title.buttons.find(b => b.name === 'title_start');
      const cap = needleBtn.cap; cap.parent.updateMatrixWorld(true);
      const top = cap.parent.localToWorld(needleBtn.rest.clone().add(needleBtn.topOffset));
      const axisW = new THREE.Vector3(0, 1, 0).applyQuaternion(cap.parent.getWorldQuaternion(new THREE.Quaternion()));
      fake.hand.setCurl({ ...POINT_CURL, thumbOpp: 0 }); fake.grip.updateMatrixWorld(true);
      const tip = fake.hand.tips.index.getWorldPosition(new THREE.Vector3()), ctrlP = fake.ctrl.getWorldPosition(new THREE.Vector3());
      const before = config.needle;
      fake.pointing = true; controllers.push(fake);
      for (let i = 0; i < 12; i++) { moveTo(fake, top.clone().addScaledVector(axisW, 0.02 - 0.004 * i).add(ctrlP).sub(tip)); updateButtons(0.016); }   // 指先を 2cm 上から 2.8cm 押し込む
      controllers.splice(controllers.indexOf(fake), 1); fake.pointing = false;
      const toggled = config.needle !== before, startDepth = startBtn.depth, stillTitle = titleMode;
      titleMode = prevTitle; title.group.visible = prevTitle;
      log('タイトルのキー: 針キーを押してもスタートは押されない', toggled && startDepth < 0.001 && stillTitle, `: 針 ${before}→${config.needle} スタートの沈み ${(startDepth * 1000).toFixed(1)}mm title=${stillTitle}`);
      if (toggled) toggleTitleSetting('needle');   // 設定を元に戻す
      for (const b of title.buttons) { b.depth = 0; b.latched = false; b.cap.position.copy(b.rest); }
    }
    // エコーのフリーズ: プローブを持つ手のグリップで静止 ⇄ 解除。フリーズ中は画像を更新しない。離すと解除される
    {
      const pr = tools.probe; moveTo(fake, pr.obj.localToWorld(pr.grabOffset.clone())); grab(fake, pr);
      updateEcho(0.016, 0, 60 / C.HEART_BPM);
      toggleEchoFreeze(fake); const f1 = echo.state.frozen;            // A/X（X/Y）ボタン相当
      const stillHeld = fake.held === pr;
      toggleEchoFreeze(fake); const f2 = echo.state.frozen;
      toggleEchoFreeze(fake);
      fake.squeezePressed = true; onSqueezeStart(fake); fake.squeezePressed = false; onSelectEnd(fake);   // グリップでも離せる（トリガーと同じ）
      log('プローブを持つ手の A/B（X/Y）でエコーをフリーズ／解除、グリップで離すと解除', f1 === true && stillHeld && f2 === false && echo.state.frozen === false && pr.held === null, `: 1回目=${f1} 持ったまま=${stillHeld} 2回目=${f2} グリップで離した後=${echo.state.frozen} held=${pr.held?.name ?? '(none)'}`);
      returnHome(pr);
    }
    // 金属針のクランプ: 人差し指の先をクランプに近づけてトリガー → 開く（手の中心が離れていても指先が近ければよい）。輪も出る
    {
      const s = P.vessel.sites.V;
      const t = registerTool('testClamp', makeNeedle(0xd9303a, 'metal'), { pos: [s.x, s.y + 0.004, s.z], rotY: 0, gripPos: [0, 0, 0], kind: 'needle', site: 'A' });
      t.stuck = true; t.inVessel = true;
      const cl = t.obj.localToWorld(CLAMP_LOCAL.clone());
      fake.hand.setCurl({ ...POINT_CURL, thumbOpp: 0 }); fake.grip.updateMatrixWorld(true);
      const tip = fake.hand.tips.index.getWorldPosition(new THREE.Vector3()), ctrlP = fake.ctrl.getWorldPosition(new THREE.Vector3());
      moveTo(fake, cl.clone().add(ctrlP).sub(tip).add(new THREE.Vector3(0, 0.02, 0)));   // 指先がクランプの 2cm 上
      updateHover(fake); const ringOk = fake.hoverRing.visible && fake.hoverRing.position.distanceTo(cl) < 1e-6;
      fake.selectPressed = true; onSelectStart(fake); fake.selectPressed = false; onSelectEnd(fake);
      log('金属針のクランプは人差し指の先で開け閉め（水色の輪が出る）', ringOk && t.obj.userData.clampOpen && fake.held === null, `: ring=${ringOk} open=${t.obj.userData.clampOpen} held=${fake.held?.name ?? '(none)'}`);
      removeTool('testClamp');
    }
    // 掴める物の目印（水色の輪）: 何も持っていない手がテープの近くにあると、テープの掴み位置に輪が出る。離れると消える
    {
      const tp = tools.tape3, gp = tp.obj.localToWorld(tp.grabOffset.clone());
      moveTo(fake, gp.clone().add(new THREE.Vector3(-0.02, 0.03, 0))); updateHover(fake);   // 列の端のテープの外側（隣のテープより近い所）
      const near = fake.hoverRing.visible && fake.hoverRing.position.distanceTo(gp) < 1e-6;
      moveTo(fake, new THREE.Vector3(0.6, 1.6, 0.6)); updateHover(fake);
      log('掴める物に水色の輪が出る（離れると消える）', near && !fake.hoverRing.visible, `: near=${near} far=${fake.hoverRing.visible}`);
    }
    // ハンドトラッキングの平滑化（One Euro）: 静止した手のジッター（±2mm）は 1/4 以下に、1 秒で 30cm 動かしたときの遅れは 2cm 以内
    {
      const f = new EuroVec(1.2, 40); let r = 0;
      const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296 - 0.5; };
      const base = new THREE.Vector3(0.3, 1.2, -0.4), v = new THREE.Vector3(); let rawVar = 0, filVar = 0;
      for (let i = 0; i < 144; i++) { v.copy(base).add(new THREE.Vector3(rnd() * 0.004, rnd() * 0.004, rnd() * 0.004)); const o = f.filter(v, 1 / 72); if (i > 20) { rawVar += v.distanceToSquared(base); filVar += o.distanceToSquared(base); } }
      const f2 = new EuroVec(1.2, 40); let lag = 0;
      for (let i = 0; i <= 72; i++) { v.set(0.3 + 0.3 * i / 72, 1.2, -0.4); const o = f2.filter(v, 1 / 72); if (i === 72) lag = v.distanceTo(o); }
      log('ハンドトラッキングの手ぶれ平滑化（静止時のジッターを抑え、動かすと遅れない）', filVar < rawVar / 9 && lag < 0.02, `: ジッター ${(Math.sqrt(rawVar / 123) * 1000).toFixed(2)}mm → ${(Math.sqrt(filVar / 123) * 1000).toFixed(2)}mm, 30cm/s での遅れ ${(lag * 1000).toFixed(1)}mm`);
    }
    // 患者の腕の姿勢: 手首を持って上げる・外へ振る → 離すと持ち上げだけ戻り、振った向きは保たれる。肘を持って外へ → 腕全体が肩から広がる
    {
      controllers.push(fake);   // updateArmPose は controllers の中から持っている手を探す
      const w0 = P.wristNow(new THREE.Vector3());
      moveTo(fake, w0.clone().add(new THREE.Vector3(0, 0.03, 0.02)));
      fake.selectPressed = true; onSelectStart(fake);
      const held = fake.wrist === 'wrist';
      moveTo(fake, w0.clone().add(new THREE.Vector3(0, 0.15, 0.1)));
      for (let i = 0; i < 40; i++) updateArmPose(0.05);
      const lifted = P.pose.lift > 0.15, swung = P.pose.yaw > 0.1;
      fake.selectPressed = false; onSelectEnd(fake);
      for (let i = 0; i < 80; i++) updateArmPose(0.05);
      const settled = P.pose.lift < 0.01 && P.pose.yaw > 0.1;
      log('手首を持つと前腕が上がり外へ振れる → 離すと下りるが向きは保たれる', held && lifted && swung && settled, `: held=${held} lift=${P.pose.lift.toFixed(2)} yaw=${P.pose.yaw.toFixed(2)}`);
      const e0 = P.elbowNow(new THREE.Vector3());
      moveTo(fake, e0.clone().add(new THREE.Vector3(0, 0.03, 0.03)));
      fake.selectPressed = true; onSelectStart(fake);
      const heldE = fake.wrist === 'elbow';
      moveTo(fake, e0.clone().add(new THREE.Vector3(-0.05, 0.03, 0.25)));
      for (let i = 0; i < 40; i++) updateArmPose(0.05);
      fake.selectPressed = false; onSelectEnd(fake);
      log('肘を持って外へ動かすと腕全体が肩から広がる', heldE && P.pose.abduct > 0.25, `: held=${heldE} abduct=${P.pose.abduct.toFixed(2)}`);
      controllers.splice(controllers.indexOf(fake), 1);
      P.setPose({ abduct: 0, yaw: 0, lift: 0, roll: 0 });
    }
    // 腕の姿勢を変えた状態（肩から 29° 外・肘で 10° 外・34° 回内）でも、判定・エコー・接触・駆血帯は腕に追従する
    {
      P.setPose({ abduct: 0.5, yaw: 0.17, lift: 0, roll: 0.6 });
      const s = P.vessel.sites.V;
      const c0 = new THREE.Vector3(s.x, s.y, s.z), w0 = P.toWorld(c0), back = P.toArm(w0);
      const cu = new THREE.Vector3(C.ELBOW_X - 0.1, C.ARM_Y, C.ARM_Z), wu = P.toWorld(cu), bu = P.toArm(wu);
      log('腕の姿勢変更: 座標変換の往復（前腕・上腕）', back.distanceTo(c0) < 2e-5 && bu.distanceTo(cu) < 2e-5 && w0.distanceTo(c0) > 0.1, `: 前腕 ${(back.distanceTo(c0) * 1000).toFixed(3)}mm 上腕 ${(bu.distanceTo(cu) * 1000).toFixed(3)}mm 穿刺部位の移動量 ${(w0.distanceTo(c0) * 100).toFixed(0)}cm`);
      // 針: 部位の血管中心へ血管に沿って 20° で入れた針先 → 血管内と判定（腕の向きに関係なく）
      const n = tools.needleV, ud = n.obj.userData, aa = C.armAt(s.x), up = new THREE.Vector3(0, s.y - aa.y, s.z - aa.z).normalize();
      const dir = s.tangent.clone(); dir.y = 0; dir.normalize();
      { const ahead = P.vessel.closest(new THREE.Vector3(s.x + dir.x * 0.012, s.y - s.depth, s.z + dir.z * 0.012)); if (ahead.sten > 0.2 || ahead.d > 0.002) dir.negate(); }
      const tipC = new THREE.Vector3(s.x, s.y - s.depth, s.z), d3 = dir.clone().multiplyScalar(Math.cos(0.35)).addScaledVector(up, -Math.sin(0.35)).normalize();
      const zA = d3.clone().negate(), xA = new THREE.Vector3().crossVectors(up, zA).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
      { // 針先をワールドで血管中心に合わせる（針は剛体なので、肘周りの変形がある所では先端基準で置く）
        const qW = P.frameQuat(tipC.x, new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA)));
        const dW = new THREE.Vector3(0, 0, -1).applyQuaternion(qW), tipW = P.toWorld(tipC);
        scene.add(n.obj); n.obj.quaternion.copy(qW); n.obj.position.copy(tipW).addScaledVector(dW, ud.tipZ); n.obj.updateMatrixWorld(true);
      }
      resetNeedleState(n); n.held = fake; fake.held = n; const dis = state.disinfected; state.disinfected = true;
      updateHeld(fake, n, 0.016);
      log('腕を回した状態でも針先の血管内判定が合う', n.punctured && n.inVessel && !n.perforated, `: punctured=${n.punctured} inVessel=${n.inVessel} info="${state.info}"`);
      n.held = null; fake.held = null; resetNeedleState(n); returnHome(n); state.disinfected = dis; state.info = '';
      // エコー: 部位に短軸で当てたプローブ（腕の向きに合わせて置く）→ 画面中央に血管、深さは血管中心まで
      const pr = tools.probe; grab(fake, pr);
      // プローブは血管の中心を通る皮膚の法線上に立てる（部位が腕の側面にあるときは、真上の皮膚点から放射方向に当てても血管は中央に来ない）
      const vc = new THREE.Vector3(s.x, s.y - s.depth, s.z), upR = new THREE.Vector3(0, vc.y - aa.y, vc.z - aa.z), rad = upR.length(); upR.normalize();
      const skinR = new THREE.Vector3(s.x, aa.y, aa.z).addScaledVector(upR, aa.r), depthR = aa.r - rad;
      const tan = s.tangent.clone().normalize(), lat = new THREE.Vector3().crossVectors(upR, tan).normalize();
      P.placeCanon(pr.obj, skinR.clone().addScaledVector(upR, -0.0015), new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lat, upR, new THREE.Vector3().crossVectors(lat, upR).normalize())));
      for (let i = 0; i < 3; i++) updateEchoInner(pr, 0.016, i * 0.016, 60 / C.HEART_BPM);
      const es = echo.state;
      log('腕を回しても エコーは穿刺部位の血管を画面中央に映す', !!(es.contact && es.centerVein && es.centerVein.latAbs < 0.004 && Math.abs(es.depthMm - depthR * 1000) < 2.5), `: contact=${es.contact} lat=${es.centerVein ? (es.centerVein.latAbs * 1000).toFixed(1) : '-'}mm depth=${es.depthMm.toFixed(1)}mm（血管中心 ${(depthR * 1000).toFixed(1)}mm）`);
      fake.held = null; pr.held = null; pr.holdPos = pr.holdQuat = null; returnHome(pr);
      // 手の接触: 回内した腕の穿刺部位の皮膚の 2cm 下に掌の中心を置いても、手は皮膚の外へ押し戻される
      fake.hand.setCurl({ thumb: 0.3, index: 0.2, middle: 0.2, ring: 0.2, pinky: 0.2, thumbOpp: 0 });
      fake.grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
      fake.ctrl.quaternion.copy(fake.grip.quaternion);
      const skinW = P.toWorld(new THREE.Vector3(s.x, C.skinY(s.x, s.z), s.z));
      moveTo(fake, skinW); resetHandPush(fake); fake.grip.updateMatrixWorld(true);
      const before = handPenetration(fake, new THREE.Vector3()); updateHandContact(fake, 0.016); const after = handPenetration(fake, new THREE.Vector3());
      log('腕を回した状態でも手は皮膚で止まる', before > 0.008 && after < 0.001, `: 侵入 ${(before * 1000).toFixed(0)}mm → ${(after * 1000).toFixed(1)}mm`);
      fake.grip.quaternion.identity(); fake.ctrl.quaternion.identity(); resetHandPush(fake);
      // 駆血帯: 外へ広げた上腕の上で離す → 巻かれて腕と一緒に動く → 近づけてトリガーで外せる
      const tq = tools.tourniquet; grab(fake, tq);
      moveTo(fake, P.tourniquetWorld(new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0)));
      fake.selectPressed = false; onSelectEnd(fake);
      const on = state.tourniquetOn && tq.obj.parent === P.armRoot;
      moveTo(fake, P.tourniquetWorld(new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0.05)));
      fake.selectPressed = true; onSelectStart(fake);
      const off = !state.tourniquetOn && fake.held === tq;
      moveTo(fake, new THREE.Vector3(0.9, 1.3, 0.6)); fake.selectPressed = false; onSelectEnd(fake);
      log('外へ広げた腕にも駆血帯を巻ける・外せる', on && off, `: on=${on} off=${off}`);
      P.setPose({ abduct: 0, yaw: 0, lift: 0, roll: 0 });
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
  if (qs.get('tq') === '1') { state.tourniquetOn = true; state.vesselR = C.VESSEL_R_DILATED; P.vessel.setRadius(state.vesselR); }   // 駆血状態
  if (at === 'ana') s = siteFrom(P.vessel.branches.find(b => b.id === 'cephF'), 0.0);
  else if (at === 'bif') s = siteFrom(P.vessel.branches.find(b => b.id === 'radialA'), 0.0);   // 上腕動脈の分岐部
  else if (at === 'gaa') s = siteFrom(P.vessel.branches.find(b => b.id === 'graft'), 0.0);   // AVG 動脈側吻合部
  else if (at === 'gva') s = siteFrom(P.vessel.branches.find(b => b.id === 'graft'), 1.0);   // AVG 静脈側吻合部
  else if (at === 'sten' && s.branch.sten) s = siteFrom(s.branch, s.branch.sten.t);
  else if (dx) s = siteFrom(s.branch, THREE.MathUtils.clamp(s.t + dx / s.branch.len, 0, 1));
  const fake = { ctrl: new THREE.Group(), grip: new THREE.Group(), toolRoot: new THREE.Group(), push: new THREE.Vector3(), side: 'right', hand: { loaded: false }, held: null, hands: controllers[0].hands };
  fake.ctrl.add(fake.toolRoot); scene.add(fake.ctrl);
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
  P.placeCanon(probe.obj, pos, new THREE.Quaternion().setFromRotationMatrix(m));   // 腕の子（ローカル = 基準姿勢 − 原点）: 腕の姿勢を変えても同じ所に当たる
  probe.obj.rotateZ(tilt);
  probe.held = fake; fake.held = probe;
  if (qs.get('freeze') === '1') setTimeout(() => echo.toggleFreeze(), 1500);   // フリーズ画面の確認用
  if (qs.get('needle') === '1' || qs.get('ndl') === '1') {   // ndl=1: needle=cannula と併用するとき
    const n = tools.needleV, ud = n.obj.userData;
    const dir = tan.clone().addScaledVector(up, -tan.dot(up)).normalize().negate();
    const ang = Number(qs.get('nang') || 25) * Math.PI / 180, adv = Number(qs.get('nadv') || 0.012);
    const entry = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, -0.03);
    const d3 = dir.clone().multiplyScalar(Math.cos(ang)).addScaledVector(up, -Math.sin(ang));
    const tip = entry.clone().addScaledVector(d3, adv);
    const hub = tip.clone().addScaledVector(d3, ud.tipZ);
    const zA = d3.clone().negate(), xA = new THREE.Vector3().crossVectors(up, zA).normalize(), yA = new THREE.Vector3().crossVectors(zA, xA);
    P.placeCanon(n.obj, hub, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA)));
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
// 音声ガイド: ブラウザ内蔵の合成音声（Web Speech API）で手順を読み上げる。端末内の日本語音声を使うので無料・通信不要。
// 日本語音声が無い端末では無音（サイドテーブルの「音声ガイド」キーを押すと記録に注意が出る）。?debug=voice で使える音声を console に出す
// 再生の優先順: 1) 端末の日本語合成音声（Web Speech API）、2) 同梱の音声ファイル（assets/voice/manifest.json: 文 → ファイル。Irodori-TTS で事前生成。?voice=clips で強制）
const voice = { ok: typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined', v: null, stepId: null, pendingId: null, timer: 0,
  clips: null, queue: [], el: null, forceClips: location.search.includes('voice=clips') };
fetch('./assets/voice/manifest.json').then(r => r.ok ? r.json() : null).then(m => { voice.clips = m; if (m) console.log('[voice] clips:', Object.keys(m).length); }).catch(() => {});
const useClips = () => !!voice.clips && (voice.forceClips || !voice.v);
// 読み上げ用の文: 括弧の中（操作の補足）は読まない。コロンは文の切れ目に
function speechText(t) {
  let s = String(t);
  for (let i = 0; i < 3; i++) s = s.replace(/（[^（）]*）|\([^()]*\)/g, '');
  return s.replace(/\s*[:：]\s*/g, '。').replace(/[ 　]+/g, ' ').replace(/、(?=\s*[、。])/g, '').replace(/。\s*。+/g, '。').replace(/^[、。\s]+/, '').trim();
}
// 照合用: 句読点・空白・記号を除き、数値を # に（tools_voice.py の生成文と細部が違っても当たるように）
const normKey = t => speechText(t).replace(/[0-9]+(\.[0-9]+)?/g, '#').replace(/[^\p{L}\p{N}#]/gu, '');
const stepSpeech = s => `${STEPS.indexOf(s) === 0 ? 'まず、' : '次は、'}${s.label}。${s.say || s.hint}`;   // 最初の手順は「まず、」（「まずは」は合成音声の先頭に「い」のような音が出る）
// 文 → 音声ファイルの列。手順・減点は正規化した文で探す、終了のスコアは「終了」「数」「評価」の 3 つをつなぐ
function clipsFor(text) {
  const m = voice.clips; if (!m) return null;
  if (!voice.index) { voice.index = {}; for (const k of Object.keys(m)) voice.index[/^fin:/.test(k) ? k : normKey(k)] = m[k]; }
  const hit = k => voice.index[k] ? ['./assets/voice/' + voice.index[k]] : null;
  const fin = /^トレーニング終了。スコアは (\d+) 点、(.+) です。$/.exec(text);
  if (fin) return hit('fin:' + fin[1]);   // 点数ごとに 1 クリップ（評価つき）
  if (text.startsWith('減点。手順の順番が違います')) return hit(normKey('減点。手順の順番が違います。'));   // 手順名が入るので一般形で 1 つ
  return hit(normKey(text));
}
function playClips(files, interrupt) {
  if (interrupt) { voice.queue.length = 0; if (voice.el) { voice.el.pause(); voice.el = null; } }
  voice.queue.push(...files);
  if (!voice.el) nextClip();
}
function nextClip() {
  const f = voice.queue.shift(); if (!f) { voice.el = null; return; }
  const el = new Audio(f); voice.el = el; el.volume = 1.0;
  el.onended = el.onerror = () => { if (voice.el === el) { voice.el = null; nextClip(); } };
  el.play().catch(() => { if (voice.el === el) { voice.el = null; nextClip(); } });
}
function pickVoice() {
  if (!voice.ok) return;
  const vs = speechSynthesis.getVoices().filter(v => /^ja/i.test(v.lang));
  voice.v = vs.find(v => /Nanami|Google|Kyoko|O-ren|Natural/i.test(v.name)) || vs[0] || null;
  if (vs.length && !voice.logged) { voice.logged = true; console.log('[voice] ja:', vs.map(v => v.name).join(', '), '→', voice.v?.name); }
}
if (voice.ok) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text, interrupt = false) {
  if (!config.voice || !text || titleMode) return;
  if (useClips()) { const files = clipsFor(text); if (files) playClips(files, interrupt); return; }
  if (!voice.ok) return;
  try {
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speechText(text).replace(/[☐☑✔]/g, '').replace(/A針/g, 'エー針').replace(/V針/g, 'ブイ針').replace(/A\/V/g, 'エー・ブイ'));
    u.lang = 'ja-JP'; if (voice.v) u.voice = voice.v; u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
    speechSynthesis.speak(u);
  } catch (e) { /* 非対応 */ }
}
// 手順が進んだら次の手順（名前とやり方）を読み上げる。完了音の後 0.8 秒置いてから。タイトル画面では読まない
function stopSpeech() {
  if (voice.ok) speechSynthesis.cancel();
  voice.queue.length = 0; if (voice.el) { voice.el.pause(); voice.el = null; }
}
function updateVoice(dt) {
  if (!config.voice || !(voice.ok || voice.clips)) return;
  if (titleMode) { voice.stepId = voice.pendingId = null; return; }
  const cur = currentStep(), id = state.finished ? 'done' : cur ? cur.id : null;
  if (id !== voice.pendingId) { if (voice.pendingId !== null && !state.finished) stopSpeech(); voice.pendingId = id; voice.timer = 0; return; }   // 手順が進んだ: 読み上げ中の案内は止める（終了時はスコアの読み上げを残す）
  if (id === voice.stepId) return;
  voice.timer += dt; if (voice.timer < 0.8) return;
  voice.stepId = id;
  if (cur && !state.finished) speak(stepSpeech(cur));
}
// 効果音（合成）: tick = 触れた/持った（強さで音の高さと長さ）, ok = 手順完了, bad = 減点, button = ボタン押下。音量は控えめ
function cue(kind, intensity = 0.5, ms = 60) {
  if (!audio || audio.ctx.state !== 'running') return;   // 音声はユーザー操作（VR 開始・トリガー）で初期化済みのときだけ
  const ctx = audio.ctx, t0 = ctx.currentTime;
  const tone = (freq, dur, vol, type = 'sine', at = 0) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(vol, t0 + at + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t0 + at + dur);
    o.connect(g); g.connect(ctx.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
  };
  if (kind === 'tick') tone(500 + 900 * intensity, Math.min(0.12, 0.02 + ms / 1000 * 0.4), 0.05 + 0.12 * intensity, 'triangle');
  else if (kind === 'ok') { tone(880, 0.09, 0.08); tone(1320, 0.14, 0.08, 'sine', 0.09); }
  else if (kind === 'bad') { tone(220, 0.18, 0.1, 'sawtooth'); tone(180, 0.22, 0.08, 'sawtooth', 0.18); }
  else if (kind === 'button') tone(1500, 0.03, 0.08, 'square');
}
function updateAudio(t) {
  if (!audio) return;
  const Tb = 60 / C.HEART_BPM, ph = (t % Tb) / Tb;
  const env = 0.3 + 0.9 * Math.exp(-((ph - 0.12) ** 2) / 0.01);
  audio.pulse.gain.setTargetAtTime(env, audio.ctx.currentTime, 0.02);
  audio.master.gain.setTargetAtTime(listening, audio.ctx.currentTime, 0.05);
  if (audio.ctx.state === 'suspended' && t - (audio.resumeAt || -9) > 2) { audio.resumeAt = t; audio.ctx.resume().catch(() => {}); }   // 再開の試行は 2 秒に 1 回（警告の連発を避ける）
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

// ---------------------------------------------------------------- フレームレート
// Quest 3 は 72/90/120Hz を選べる。90Hz を要求し、実測が目標の 88% を下回る状態が続いたら 72Hz に下げる（コマ落ちする 90 より安定した 72 の方が滑らか）
const fps = { target: 0, frames: 0, time: 0, dropped: false, measured: 0 };
function setupFrameRate() {
  const session = renderer.xr.getSession(); if (!session?.supportedFrameRates || !session.updateTargetFrameRate) return;
  const rates = Array.from(session.supportedFrameRates);
  const want = rates.includes(90) ? 90 : rates.includes(72) ? 72 : null;
  if (!want) return;
  session.updateTargetFrameRate(want).then(() => { fps.target = want; fps.frames = 0; fps.time = 0; }).catch(() => {});
}
function updateFrameRate(dt) {
  if (!fps.target || !renderer.xr.isPresenting) return;
  fps.frames++; fps.time += dt;
  if (fps.time < 4) return;
  fps.measured = fps.frames / fps.time; fps.frames = 0; fps.time = 0;
  if (fps.target === 90 && fps.measured < 90 * 0.88 && !fps.dropped) {
    const session = renderer.xr.getSession();
    if (session?.updateTargetFrameRate) session.updateTargetFrameRate(72).then(() => { fps.target = 72; fps.dropped = true; }).catch(() => {});
  }
}

// ---------------------------------------------------------------- 毎フレーム
let uiTimer = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  updateFrameRate(dt);
  if (titleMode) { titleLoop(dt, t); return; }
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
  updateVoice(dt);
  room.update(dt);
  updateStethTube();

  listening = 0;
  let palpating = false;
  for (const cs of controllers) {
    const gp = cs.inputSource?.gamepad;
    if (gp) {
      const tp = gp.buttons[0]?.pressed, sp = gp.buttons[1]?.pressed;
      if (cs.selectPressed && tp === false) onSelectEndXR(cs);
      if (cs.squeezePressed && sp === false) { cs.squeezePressed = false; onSelectEnd(cs); }
      if (gp.buttons[5]?.pressed) { cs.byHold += dt; if (cs.byHold > 1.0) { cs.byHold = -5; resetAll(); haptic(cs, 0.8, 150); } } else cs.byHold = 0;
      // A/X（buttons[4]）を押す、または B/Y（buttons[5]）を短く押して離す = プローブを持っている手ならエコーのフリーズ／解除（B/Y の長押しはリセットのまま）
      const ax = !!gp.buttons[4]?.pressed, by = !!gp.buttons[5]?.pressed;
      if (cs.held?.kind === 'probe') {
        if (ax && !cs.axPrev) toggleEchoFreeze(cs);
        if (!by && cs.byPrev && cs.byHold >= 0 && cs.byHold < 0.6) toggleEchoFreeze(cs);
      }
      if (!by && cs.byPrev && cs.byHold < 0) cs.byHold = 0;
      cs.axPrev = ax; cs.byPrev = by;
      updateLocomotion(cs, gp, dt);
    }
    const trig = gp?.buttons?.[0]?.value ?? (cs.selectPressed ? 1 : 0);
    const grip = gp?.buttons?.[1]?.value ?? (cs.squeezePressed ? 1 : 0);
    resetHandPush(cs);   // 前フレームの「腕からの押し戻し」を戻してから姿勢を更新
    if (cs.tracked) { cs.hand.update(cs.xrHand); cs.xrHand.updateMatrixWorld(true); updateVirtualGrip(cs, dt); }   // ハンドトラッキング: 関節の姿勢を手のモデルへ、関節から仮想の握りフレームを更新
    // 何も持たずにトリガーを引く = 人差し指を立てた「ポインティング」姿勢（物理ボタンを押す指）。ハンドトラッキングでは常に人差し指でボタンを押せる
    cs.pointing = !cs.held && !cs.wrist && (cs.tracked || trig > 0.5 || grip > 0.5);   // トリガーでもグリップでも人差し指が立ち、ボタンを押せる
    let pose;
    if (cs.held?.kind === 'needle') pose = cs.held.holdMode === 'ok' ? 'ok' : 'pinch';
    else if (cs.held?.kind === 'probe') pose = 'probe';
    else if (cs.held?.name === 'stethoscope') pose = 'steth';
    else if (cs.wrist) pose = 'wrist';
    else if (cs.pointing) pose = 'point';
    else {
      const ci = cs.held ? Math.max(trig, 0.75) : trig, cg = cs.held ? Math.max(grip, 0.8) : grip;
      pose = `g${ci.toFixed(2)},${cg.toFixed(2)}`;
      cs.curl = { index: 0.15 + 0.85 * ci, middle: 0.15 + 0.85 * cg, ring: 0.15 + 0.85 * cg, pinky: 0.15 + 0.85 * cg, thumb: 0.3 + 0.5 * Math.max(ci, cg) };
    }
    if (cs.hand.loaded && pose !== cs.lastPose) {
      cs.lastPose = pose;
      cs.hand.setCurl(pose === 'pinch' ? PINCH_CURL[cs.side] : pose === 'ok' ? OK_CURL[cs.side] : pose === 'probe' ? PROBE_CURL[cs.side] : pose === 'steth' ? STETH_CURL[cs.side] : pose === 'point' ? { ...POINT_CURL, ...NO_OPP } : pose === 'wrist' ? { ...WRIST_CURL, ...NO_OPP } : { ...cs.curl, ...NO_OPP });
    }
    cs.ctrl.getWorldPosition(_v);
    if (cs.held?.toggle) { updateHeld(cs, cs.held, dt); updateHandContact(cs, dt); }   // プローブ・聴診器: 器具が皮膚で止まり、手はそれに追従
    else {
      updateHandContact(cs, dt);                                                      // 手（と持っている器具）は腕の中へ入らない
      if (cs.held) updateHeld(cs, cs.held, dt);
      else if (updatePalpation(cs, dt, beat)) palpating = true;
    }
    cs.lastPos.copy(_v);
    updateHover(cs);
  }
  updateArmPose(dt);
  updateButtons(dt);
  if (!palpating && state.info.startsWith('触知')) { state.info = ''; uiDirty = true; }
  updateAudio(t);

  uiTimer += dt;
  if (uiDirty && uiTimer > 0.12) { uiTimer = 0; drawUI(); }
  renderer.render(scene, camera);
}

// タイトル画面のフレーム: 手の表示（人差し指を立てた形）とキーの押し込みだけ。ロゴはゆっくり浮き沈みして少し揺れる
function titleLoop(dt, t) {
  // 頭の追跡が有効になってから（高さ 0.5m 以上）2.5 秒間はロゴとパネルを頭の正面に追従させ、その後は固定（開始直後の向きの乱れを吸収する）
  if (renderer.xr.isPresenting && title.pending !== false) {
    const hy = headPos(_v).y - dolly.position.y;
    if (hy > 0.5) { if (title.pending === true) { title.pending = t + 2.5; } placeTitleInFront(); if (t > title.pending) title.pending = false; }
  }
  for (const cs of controllers) {
    const gp = cs.inputSource?.gamepad;
    if (gp) { const tp = gp.buttons[0]?.pressed, sp = gp.buttons[1]?.pressed; if (cs.selectPressed && tp === false) cs.selectPressed = false; if (cs.squeezePressed && sp === false) cs.squeezePressed = false; updateLocomotion(cs, gp, dt); }   // スティックで移動・向き・高さ
    resetHandPush(cs);
    if (cs.tracked) { cs.hand.update(cs.xrHand); cs.xrHand.updateMatrixWorld(true); updateVirtualGrip(cs, dt); }
    const trig = gp?.buttons?.[0]?.value ?? (cs.selectPressed ? 1 : 0), grip = gp?.buttons?.[1]?.value ?? (cs.squeezePressed ? 1 : 0);
    cs.pointing = cs.tracked || trig > 0.5 || grip > 0.5;   // トリガーかグリップを握ると人差し指を立てた手になり、その状態でだけキーを押せる
    const pose = cs.pointing ? 'point' : 'rest';
    if (cs.hand.loaded && cs.lastPose !== pose) { cs.lastPose = pose; cs.hand.setCurl(pose === 'point' ? { ...POINT_CURL, ...NO_OPP } : { thumb: 0.3, index: 0.2, middle: 0.25, ring: 0.3, pinky: 0.35, thumbOpp: 0 }); }
  }
  updateButtons(dt);
  title.t += dt;
  title.slab.position.y = 2.5 + 0.04 * Math.sin(title.t * 0.8); title.slab.rotation.y = 0.05 * Math.sin(title.t * 0.5); title.slab.rotation.x = -0.22 + 0.03 * Math.sin(title.t * 0.7 + 1);
  renderer.render(scene, camera);
}

// 掴める物の目印: 何も持っていない手の「掴む基準点」から掴める範囲にある器具（または患者の手首・肘）に水色の輪を出す。
// つまむ前に何が取れるかが分かる（ハンドトラッキングでは手応えがないので特に重要）。輪は常にカメラの方を向く
const _hv = { p: new THREE.Vector3(), c: new THREE.Vector3() };
function updateHover(cs) {
  if (!cs.hoverRing) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.011, 0.015, 28), new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    ring.renderOrder = 20; ring.visible = false; scene.add(ring); cs.hoverRing = ring;
  }
  const ring = cs.hoverRing;
  if (cs.wrist || (cs.held && !clampNear(cs, _hv.c))) { ring.visible = false; return; }   // 何か持っていても、反対の手の針のクランプには輪を出す
  grabPoint(cs, _hv.p);
  let target = null;
  const part = armHoldCandidate(cs, _hv.p);
  if (clampNear(cs, _hv.c)) target = _hv.c;   // 金属針のクランプ（人差し指の先で開け閉め）
  else if (part) target = part === 'wrist' ? P.wristNow(_hv.c) : P.elbowNow(_hv.c);
  else { const t = nearestTool(cs, _hv.p); if (t) target = t.obj.localToWorld(_hv.c.copy(t.grabOffset)); }
  if (!target) { ring.visible = false; return; }
  ring.visible = true; ring.position.copy(target); ring.lookAt(headPos(_v4));
}

// エコー: プローブを持っている間、血管・針のデータを渡して B モード画像を生成。深い血管モードでは「血管を描出」ステップを判定
const _ea = new THREE.Vector3(), _eb = new THREE.Vector3(), _ed = new THREE.Vector3(), _ee = new THREE.Vector3();
// プローブと腕の接触: レンズ面は皮膚の中へ 3mm（圧迫分）までしか入らない。それ以上手を押し込んでも、プローブは皮膚の上に留まって
// 腕の表面を滑る（手だけが腕の中へ進む）。皮膚に触れた瞬間に振動、押し込みすぎは小刻みな振動で知らせる
const PROBE_PRESS_MAX = PRESS_MAX;
const _pc = { f: new THREE.Vector3(), r: new THREE.Vector3(), q: new THREE.Quaternion(), d: new THREE.Vector3(), d2: new THREE.Vector3() };
// 腕に当てる器具の接触（プローブ・聴診器）: face = 器具ローカルでの接触面の中心、pressMax = 皮膚に沈み込める量
const STETH_FACE = new THREE.Vector3(0, -0.0037, 0);   // 聴診器のダイアフラム面（チェストピース原点の下）
function updateProbeContact(cs, tool, dt, face = null, pressMax = PROBE_PRESS_MAX) {
  const o = tool.obj;
  o.position.copy(tool.holdPos || tool.gripPos); o.quaternion.copy(tool.holdQuat || tool.gripQuat);   // 手の中の基準位置からやり直す（前フレームの押し戻しを持ち越さない）
  o.updateMatrixWorld(true);
  const F = face ? o.localToWorld(_pc.f.copy(face)) : o.getWorldPosition(_pc.f);
  P.toArm(F, F);   // 腕の基準姿勢の座標で判定
  let contact = false, press = 0;
  tool.pushWorld = tool.pushWorld || new THREE.Vector3(); tool.pushWorld.set(0, 0, 0);
  if (C.onArm(F.x)) {
    const a = C.armAt(F.x);
    _pc.r.set(0, F.y - a.y, F.z - a.z);
    const dist = _pc.r.length();
    if (dist > 1e-4 && _pc.r.y > -0.2 * a.r) {                        // 腕の上半分〜側面（下から突き上げる場合は無視）
      if (dist < a.r + 0.0015) contact = true;
      const minDist = a.r - pressMax;
      if (dist < minDist) {
        press = minDist - dist;                                        // 皮膚より深く押し込んだ量 → 押し戻す
        _pc.d.copy(_pc.r).normalize().multiplyScalar(press);
        P.toWorldDir(_pc.d, _pc.d, F.x);                                 // 押し戻し（皮膚の法線方向）をワールドへ
        tool.pushWorld.copy(_pc.d);                                      // 手もこの分だけ追従させる（updateHandContact）
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
let echoError = false, echoFrame = 0;
// プローブの姿勢を腕の基準姿勢の座標へ変換したもの（エコーは血管・皮膚と同じ座標系で計算する。腕の向きを変えても画像が追従する）
const _pcn = new THREE.Object3D();
function probeCanon(obj) {
  obj.updateMatrixWorld(true);
  obj.getWorldPosition(_pcn.position); obj.getWorldQuaternion(_pcn.quaternion);
  P.toArm(_pcn.position, _pcn.position);
  _pcn.quaternion.premultiply(P.frameQuat(_pcn.position.x, _q).invert());
  return _pcn;
}
function updateEcho(dt, t, Tb) {
  const probe = tools.probe;
  if (!probe?.held || echoError) return;
  try { updateEchoInner(probe, dt, t, Tb); }
  catch (e) { echoError = true; console.error('echo update failed', e); addLog('エコー画像の生成でエラー（画像は停止。器具の操作は継続できます）', 'warn'); }
}
function updateEchoInner(probe, dt, t, Tb) {
  echo.setVessel(P.vessel, `${config.vessel}:${config.deep}:${P.vessel.version}`);
  echo.setTurgor(config.vessel === 'avf' ? THREE.MathUtils.clamp((P.vessel.dilation - 0.72) / 0.28, 0, 1) : 0);   // 駆血で怒張した静脈は圧迫してもつぶれにくい
  echo.clearNeedles();
  let k = 0;
  for (const site of ['A', 'V']) {
    const n = tools['needle' + site]; if (!n || k > 2) continue;
    const ud = n.obj.userData;
    if (!(n.held || n.stuck)) continue;
    n.obj.updateMatrixWorld(true);
    // 基準姿勢の座標で渡す（血管と同じ座標系）。プローブが静脈をつぶしているときは、血管内の針先が血管の中心へ寄る分だけ針全体をビーム方向に動かす
    // （実際も針は内腔に留まったまま血管がつぶれる。エコー上で針だけ血管の外に見えないように）
    const seg = (z0, z1) => {
      P.toArm(n.obj.localToWorld(_ea.set(0, 0, z0)), _ea); P.toArm(n.obj.localToWorld(_eb.set(0, 0, z1)), _eb);
      const es = echo.state;
      if (es.contact && es.press > 0) {
        const cl = P.vessel.closest(_eb);
        if (cl.kind === 'vein' && cl.d < cl.r * 1.3) {
          const D = _ed.set(0, -1, 0).applyQuaternion(_pcn.quaternion);                 // ビーム方向（基準姿勢の座標）
          const vd = _ee.subVectors(_eb, cl.point).dot(D), f = veinFlatten(es.press, es.turgor);
          _ea.addScaledVector(D, -vd * f); _eb.addScaledVector(D, -vd * f);
        }
      }
    };
    if (ud.type === 'metal') {
      seg(0, ud.tipZ);
      echo.setNeedle(k++, _ea, _eb, 0.00085, 1.0);
    } else {
      seg(0, ud.cannulaTipZ);
      echo.setNeedle(k++, _ea, _eb, -0.001, 0.7);                                        // プラスチック外筒: 中空（負の半径）= 前壁・後壁の 2 本の線として金属より暗く映る
      if (!n.styletOut) { seg(0, ud.tipZ); echo.setNeedle(k++, _ea, _eb, 0.0008, 1.0); }
    }
  }
  const pulse = Math.max(0, Math.sin(t * Math.PI * 2 / Tb)) ** 2;
  // 画像は 1 フレームおきに生成（実機の 30 フレーム/秒相当。計測・接触判定は毎フレーム）
  echoFrame++;
  const es = echo.update(probeCanon(probe.obj), dt, pulse, t, (echoFrame & 1) === 0 || !renderer.xr.isPresenting);
  // 深い血管モード: 穿刺対象の静脈がセンターラインの近く（4mm 以内）に 2 秒間描出されたら完了
  if (es.contact && es.centerVein && es.centerVein.kind !== 'artery' && es.centerVein.latAbs < 0.004 && !state.done.echo && STEPS.some(s => s.id === 'echo')) {
    state.echoTime += dt;
    state.info = `エコー: 血管を描出中 … 深さ ${es.depthMm.toFixed(1)}mm / 径 ${es.diaMm.toFixed(1)}mm  ${Math.min(2, state.echoTime).toFixed(1)} / 2.0 秒`; uiDirty = true;
    if (state.echoTime >= 2) { addLog(`エコーで血管を描出 ✔（深さ ${es.depthMm.toFixed(1)}mm, 径 ${es.diaMm.toFixed(1)}mm）`, 'ok'); completeStep('echo'); state.info = ''; }
  } else if (state.info.startsWith('エコー:')) { state.info = ''; uiDirty = true; }
}
// 患者の腕の姿勢: 手首を持つ手の位置で前腕の持ち上げ（肘から）と内外の振り、手のひねりで回内外、肘を持つ手の位置で腕全体の外転を決める。
// 持ち上げは離すとゆっくり下りて腕置きに戻るが、内外・回内外・外転はそのまま保たれる（寝ている患者の腕をその位置に置いたまま穿刺できる）
const LIFT0 = Math.atan2(C.WRIST_LIFT, C.WRIST_X - C.ELBOW_X);   // 基準姿勢の前腕のわずかな傾き
const _ap = { d: new THREE.Vector3(), q: new THREE.Quaternion(), ax: new THREE.Vector3(), dE: new THREE.Vector3() };
function updateArmPose(dt) {
  const holder = controllers.find(c => c.wrist);
  const pose = P.pose, cl = (k, v) => THREE.MathUtils.clamp(v, ARM_LIMITS[k][0], ARM_LIMITS[k][1]);
  const target = { abduct: pose.abduct, yaw: pose.yaw, lift: 0, roll: pose.roll };
  if (holder) {
    const h = holder.armHold;
    holder.ctrl.getWorldPosition(_v).sub(h.off);                       // 手首/肘の目標位置（ワールド）
    if (h.part === 'wrist') {
      if (_v.distanceTo(P.wristNow(_v2)) > 0.35) { holder.wrist = false; holder.lastPose = ''; }   // 手が離れすぎたら離したことにする
      else {
        _ap.d.subVectors(_v, P.elbowNow(_v2)).applyQuaternion(P.armRootQuat(_ap.q).invert());   // 肘から見た手首の方向（上腕の座標系）
        const horiz = Math.hypot(_ap.d.x, _ap.d.z);
        target.lift = cl('lift', Math.atan2(_ap.d.y, horiz) - LIFT0);
        target.yaw = cl('yaw', Math.atan2(_ap.d.z, Math.max(0.05, _ap.d.x)));
        // 手のひねり: 持った時からの回転のうち前腕の軸まわりの成分（swing-twist 分解）だけを回内外に使う
        holder.grip.getWorldQuaternion(_ap.q).multiply(h.q0inv);
        P.toWorldDir(_ap.ax.set(1, 0, 0), _ap.ax);
        const twist = 2 * Math.atan2(_ap.ax.x * _ap.q.x + _ap.ax.y * _ap.q.y + _ap.ax.z * _ap.q.z, _ap.q.w);
        target.roll = cl('roll', h.roll0 - twist);
      }
    } else {
      if (_v.distanceTo(P.elbowNow(_v2)) > 0.35) { holder.wrist = false; holder.lastPose = ''; }
      else {
        _ap.d.subVectors(_v, P.S); _ap.dE.subVectors(P.E, P.S);
        target.abduct = cl('abduct', Math.atan2(_ap.d.z, _ap.d.x) - Math.atan2(_ap.dE.z, _ap.dE.x));
      }
      target.lift = pose.lift;
    }
  }
  const rate = holder ? 10 : 3, k = Math.min(1, dt * rate);
  const next = {}; let changed = false;
  for (const key of ['abduct', 'yaw', 'lift', 'roll']) { next[key] = pose[key] + (target[key] - pose[key]) * k; if (Math.abs(next[key] - pose[key]) > 1e-5) changed = true; }
  if (changed) P.setPose(next);
}
function updateFlow(dt) {
  if (state.flowT < 0 || state.flowDone) return;
  state.flowT += dt;
  // A針 → 患者側 A 回路 → 気泡検出器（A）・ポンプ・動脈側チャンバー → ダイアライザー（上から下）→ 静脈側チャンバー → 気泡検出器（V）→ 患者側 V 回路 → V針（回路は生食で満たされていて、血液に置き換わる）
  const seq = [
    { dur: 2.5, fn: p => room.lines.setFill('A', p, true) },
    { dur: 2.0, fn: p => room.setMachineFill('mA', p) },
    { dur: 1.6, fn: p => room.setMachineFill('dialyzer', p) },
    { dur: 0.8, fn: p => room.setMachineFill('mV1', p) },
    { dur: 0.8, fn: p => room.setMachineFill('chamber', p) },
    { dur: 1.0, fn: p => room.setMachineFill('mV2', p) },
    { dur: 2.5, fn: p => room.lines.setFill('V', p, false) },
    { dur: config.needle === 'metal' ? 1.0 : 0.01, fn: p => { const f = tools.needleV?.obj.userData.fill; if (f) f.set(Math.max(state.bleed.V, p), state.bleed.V < 0.5); } },
    // V 針の先端が血管外: 返血が皮下に漏れて穿刺部が腫れる → 静脈圧上昇アラームでポンプ停止
    { dur: 1.2, fn: p => {
      const n = tools.needleV; if (!n || n.inVessel) return;
      if (!state.vLeak) { state.vLeak = true; penalty(20, 'V針の先端が血管外: 返血が皮下に漏れて腫脹（静脈圧上昇アラーム → ポンプ停止）。抜針して圧迫し、再穿刺'); haptic(controllers[0], 1, 300); }
      const ud = n.obj.userData; P.toArm(n.obj.localToWorld(_v3.set(0, 0, (ud.type === 'cannula' && n.styletOut) ? ud.cannulaTipZ : ud.tipZ)), _v3);
      const sw = P.swelling; sw.visible = true; P.placeCanon(sw, _v3.set(_v3.x, C.skinY(_v3.x, _v3.z) - 0.004, _v3.z));
      sw.scale.set(1.6 * p, 0.45 * p, 1.2 * p);
      if (p >= 1) { state.pumpOn = false; room.setPumpRunning(false); state.flowDone = true; }
    } },
  ];
  let t = state.flowT;
  for (const s of seq) {
    if (t <= s.dur) { s.fn(t / s.dur); return; }
    s.fn(1); t -= s.dur;
  }
  state.flowDone = true;
  if (state.vLeak) return;
  addLog('血液回路が血液で満たされました（プライミング完了）→ 透析開始', 'ok');
  checkFinished();
}

// ---------------------------------------------------------------- 術者の手と患者の腕の接触
// 手のモデル（指先・指の関節・掌）は患者の腕の中へ入らず、皮膚の外へ押し戻される。押し戻しは手に持っている器具にも同じだけ加える
// （手と器具は一体）。→ 針は「つまんだ指が皮膚に当たる所」まで刺さり、手が腕をすり抜けて深さが分からなくなることがない。
// プローブ・聴診器は器具側の接触判定で皮膚に止まり（updateProbeContact）、手はその押し戻しに追従した上で、さらに指が腕に入る分だけ戻る
const _hc = { p: new THREE.Vector3(), c: new THREE.Vector3(), u: new THREE.Vector3(), push: new THREE.Vector3(), extra: new THREE.Vector3(), q: new THREE.Quaternion(), l: new THREE.Vector3() };
const HAND_R = { tip: 0.008, joint: 0.011, palm: 0.016 };   // 判定に使う各点の半径（指先・指の関節・掌）
function resetHandPush(cs) {
  cs.push?.set(0, 0, 0);
  if (cs.tracked) cs.hand.group.position.set(0, 0, 0);
  else if (cs.holder) cs.holder.position.set(0, 0, 0);
  cs.toolRoot?.position.set(0, 0, 0);
}
// 手の各点の腕への侵入量（最大）と、その点を皮膚の外へ出す押し戻しベクトル（ワールド、腕の軸から放射方向）
function handPenetration(cs, out) {
  out.set(0, 0, 0);
  if (P.lift > 0.02 || !cs.hand?.loaded) return 0;
  let best = 0;
  // 押し戻しは真上（ワールド +y）へ: 手は腕の上面〜側面に上から当たるので、各点を「その真上の皮膚面 + 点の半径」まで持ち上げる量の最大を取る。
  // 判定は腕の基準姿勢の座標で行い（腕を回しても皮膚の位置が合う）、真上方向 u は腕の座標系へ変換して使う。
  // 側面（軸から横へ 0.85 半径より外）は皮膚面が急なので、そこでは 0.85 半径の位置の高さで止める（押し戻しが暴れない）
  P.toArmDir(_hc.u.set(0, 1, 0), _hc.u); { const n = Math.hypot(_hc.u.y, _hc.u.z) || 1; _hc.u.y /= n; _hc.u.z /= n; }
  const uy = _hc.u.y, uz = _hc.u.z;
  const test = (pw, rs) => {
    const p = P.toArm(pw, _hc.c);
    if (!C.onArm(p.x)) return;
    const a = C.armAt(p.x), R = a.r + rs;
    const qy = p.y - a.y, qz = p.z - a.z;
    const along = qy * uy + qz * uz;                                   // 点の高さ（腕軸から真上方向）
    const ly = qy - along * uy, lz = qz - along * uz, lat = Math.hypot(ly, lz);   // 横ずれ
    if (lat > R || along < -0.3 * a.r) return;                         // 腕の横・下側は押さない
    const latC = Math.min(lat, 0.85 * a.r);
    const pen = Math.sqrt(Math.max(0, R * R - latC * latC)) - along;
    if (pen > best) { best = pen; out.set(0, pen, 0); }
  };
  let name = '';
  // 針をつまんでいる手: 皮膚に当たるのは親指・人差し指（つまんだ指の腹は平らにつぶれる）と掌。曲げた中指〜小指は腕の上に軽く添える（判定しない）
  // 針を持っているときは指は判定しない（指は腕に触れても食い込んでよい = 皮膚を押さえている表現）。掌（中手骨）だけが腕を貫通しない
  const ndl = cs.held?.kind === 'needle';
  for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
    const bones = cs.hand.bones[f]; if (!bones) continue;
    for (let i = 0; i < bones.length; i++) {
      if (ndl && i > 0) continue;
      bones[i].getWorldPosition(_hc.p);
      const b0 = best;
      test(_hc.p, i === 0 ? HAND_R.palm : i === bones.length - 1 ? HAND_R.tip : HAND_R.joint);   // 中手骨（掌）・関節・指先
      if (best > b0) name = `${f}${i}`;
    }
  }
  if (best > 0) cs.penName = name;
  return best;
}
// 押し戻しを手のモデル（コントローラー: 手のホルダー / ハンドトラッキング: 手のモデルと仮想 gripSpace）と、必要なら持っている器具（toolRoot）へ適用
function applyHandPush(cs, pushWorld, withTool) {
  cs.push.copy(pushWorld);
  if (cs.tracked) {
    _hc.l.copy(pushWorld).applyQuaternion(dolly.getWorldQuaternion(_hc.q).invert());
    cs.hand.group.position.copy(_hc.l); cs.vgrip.position.copy(cs.vgripBase).add(_hc.l);
    cs.hand.group.updateMatrixWorld(true); cs.vgrip.updateMatrixWorld(true);
  } else if (cs.holder) {
    _hc.l.copy(pushWorld).applyQuaternion(cs.grip.getWorldQuaternion(_hc.q).invert());
    cs.holder.position.copy(_hc.l); cs.holder.updateMatrixWorld(true);
  }
  if (withTool) { _hc.l.copy(pushWorld).applyQuaternion(cs.ctrl.getWorldQuaternion(_hc.q).invert()); cs.toolRoot.position.copy(_hc.l); }
  else cs.toolRoot.position.set(0, 0, 0);
  cs.toolRoot.updateMatrixWorld(true);
}
// 針は手と一体で押し戻す（つまんだ指が皮膚に当たる所まで刺さる）。それ以外の手持ちの器具（綿・テープ・駆血帯など）は器具自体を皮膚に当てる物なので
// 押し戻さず、手だけが皮膚で止まる（指は皮膚の上、器具は皮膚に接する）
// 綿・テープ・駆血帯などを持っているときは判定しない（器具そのものを皮膚に当てる操作で、手の位置は器具の持ち方で決まる）
function updateHandContact(cs, dt) {
  const tool = cs.held, withTool = tool?.kind === 'needle';
  _hc.push.set(0, 0, 0);
  if (tool && !tool.toggle && tool.kind !== 'needle') { applyHandPush(cs, _hc.push, false); cs.touching = false; return; }
  if (tool?.toggle && tool.pushWorld) _hc.push.copy(tool.pushWorld);   // プローブ・聴診器の押し戻しに手も追従
  applyHandPush(cs, _hc.push, withTool);
  let pen = 0;
  for (let k = 0; k < 3; k++) {                                        // 真上へ持ち上げるので単調に収束する（深く入った手でも 2〜3 回で外へ出る）
    const p = handPenetration(cs, _hc.extra);
    if (k === 0) pen = p;
    if (p <= 0) break;
    _hc.push.add(_hc.extra); applyHandPush(cs, _hc.push, withTool);
  }
  if (pen > 0.001 && !cs.touching) haptic(cs, 0.25, 30);   // 皮膚に触れた
  cs.touching = pen > 0.001;
}

// 人差し指を立てた手か: コントローラーはトリガー/グリップを引いた状態（cs.pointing）、ハンドトラッキングは人差し指が伸び中指が曲がっている形
const _pg = { w: new THREE.Vector3(), i: new THREE.Vector3(), m: new THREE.Vector3() };
function isPointingHand(cs) {
  if (!cs.tracked) return !!cs.pointing;
  const j = cs.hand?.joints; if (!j?.wrist || !j['index-finger-tip'] || !j['middle-finger-tip']) return false;
  j.wrist.getWorldPosition(_pg.w); j['index-finger-tip'].getWorldPosition(_pg.i); j['middle-finger-tip'].getWorldPosition(_pg.m);
  return _pg.i.distanceTo(_pg.w) > 0.14 && _pg.m.distanceTo(_pg.w) < 0.12;
}
// 触知: 何も持たず人差し指を立てた手で、指先が皮膚に触れていて、その真下（横ずれが血管の半径の 90% 以内 = 内腔の真上）に血管があるときだけ拍動が伝わる
// （実際の穿刺でも指先に伝わる拍動の真下の血管を刺す。針やプローブを持っている手には伝わらない）
// 触知の基準点: 人差し指の先（メッシュの先端）。そこから真下に下ろした所の血管を感じる
function palpPoint(cs, out) { return fingerTip(cs, out); }
// 触知:
//  - 手順「スリルを触知」の最中（学習モード）: トリガーもグリップも握らない開いた手で腕に触れるだけで、人差し指か中指の先の近く（血管の半径 + 1.5cm）に血管があれば拍動が伝わる
//  - それ以外（穿刺時）: 人差し指を立てた手で、指先の真下（横ずれが半径の 90% 以内 = 内腔の真上）に血管があるときだけ。そこへ垂直に刺せば必ず血管に入る
const _pp2 = new THREE.Vector3();
function updatePalpation(cs, dt, beat) {
  if (P.lift > 0.02 || cs.wrist || cs.held) return false;
  const learning = !state.done.palpate, pointing = isPointingHand(cs);
  if (!learning && !pointing) return false;
  let cl0 = null, tol = 0;
  for (const name of pointing ? ['index'] : ['index', 'middle']) {
    if (!fingerTipOf(cs, name, _pp2)) continue;   // 指先 = メッシュの先端（tip ボーンの 11mm 先）
    P.toArm(_pp2, _pp2);
    if (!C.onArm(_pp2.x)) continue;
    const sy = C.skinY(_pp2.x, _pp2.z);
    if (!(_pp2.y < sy + 0.018 && _pp2.y > sy - 0.03)) continue;   // 指先が皮膚に触れている（皮膚の上 1.8cm 以内）
    const c = P.vessel.closestBelow(_pp2);                          // 指先の真下にある穿刺対象の血管（最も横ずれの小さいもの）
    if (!c) continue;
    const t = pointing ? c.r * 0.9 : c.r + 0.015;
    if (c.horiz <= t && (!cl0 || c.horiz < cl0.horiz)) { cl0 = c; tol = t; }
  }
  if (!cl0) return false;
  if (beat !== cs.lastBeat) { cs.lastBeat = beat; haptic(cs, state.tourniquetOn ? 0.9 : 0.6, 45); }
  if (!state.done.palpate) {
    if (state.palpateTime === 0) requireGloves();
    state.palpateTime += dt;
    state.info = `触知中… スリルを感じます ${Math.min(1, state.palpateTime).toFixed(1)} / 1.0 秒`;
    uiDirty = true;
    if (state.palpateTime >= 1.0) { addLog('スリル良好：連続性の振動を触知', 'info'); completeStep('palpate'); state.info = ''; }   // 触知は 1 秒（聴診は 3 秒のまま）
  }
  return true;
}

function updateHeld(cs, tool, dt) {
  const V = P.vessel;
  if (tool.name === 'stethoscope') {
    updateProbeContact(cs, tool, dt, STETH_FACE, 0.001);   // ダイアフラムは皮膚で止まる（腕を貫通しない。1mm まで沈む）
    // 装着判定: 垂れ下がったイヤーチップ（バイノーラル原点）が頭に近づいたら耳に装着
    if (!state.stethWorn) {
      steth.binaural.getWorldPosition(_v2); headPos(_v3);
      if (_v2.distanceTo(_v3) < 0.22) wearSteth();
    }
    P.toArm(tool.obj.getWorldPosition(_v2), _v2);
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
    P.toArm(tool.obj.getWorldPosition(_v2), _v2);
    const aa = C.armAt(_v2.x);
    // 綿の底面の中心（器具の原点）が皮膚に触れている（皮膚から 8mm 以内。浮かせているときは消毒にならず、色も付かない）
    const touching = P.lift < 0.02 && C.onArm(_v2.x) && Math.abs(_v2.z - aa.z) < aa.r * 0.8 && _v2.y > aa.y && Math.abs(_v2.y - C.skinY(_v2.x, _v2.z)) < 0.008;
    if (touching) {
      if (!tool.used) { tool.used = true; requireGloves(); }
      cs.ctrl.getWorldPosition(_v);
      const step = _v.distanceTo(cs.lastPos);
      state.swabDistance += step;
      if (state.swabPts.length === 0 || _v2.distanceTo(state.swabPts[state.swabPts.length - 1]) > 0.015) state.swabPts.push(_v2.clone());
      // 拭いた所を皮膚に描く（消毒された範囲が見える）
      if (!tool.lastMark || _v2.distanceTo(tool.lastMark) > 0.003) { tool.lastMark = (tool.lastMark || new THREE.Vector3()).copy(_v2); P.markSwab(_v2, 0.013); }
      const p = Math.min(1, state.swabDistance / 0.12);   // 拭いた距離 12cm で 100%（直径 5〜7cm を 2 周ほど）
      if (!state.disinfected) { state.info = `消毒中… ${(p * 100).toFixed(0)}%（穿刺点を中心に外側へ円を描くように。拭いた範囲が皮膚に表示されます）`; uiDirty = true; }
      if (p >= 1 && !state.disinfected) {
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
    _v.set(0, 0, tipZ); n.localToWorld(_v); P.toArm(_v, _v);                                      // 針先と向き（腕の基準姿勢の座標）
    _v2.set(0, 0, -1).applyQuaternion(n.getWorldQuaternion(_q)); P.toArmDir(_v2, _v2);
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
      const guided = probe?.held && es.contact && P.toArm(probe.obj.getWorldPosition(_v3), _v3).distanceTo(_v) < 0.05;
      if (guided) addLog('エコーガイド下に穿刺 ✔', 'ok');
      else if (V.deep) penalty(10, '深い血管をエコーなしで穿刺（ブラインド穿刺）');
      if (V.cfg.usesTourniquet && !state.tourniquetOn) penalty(10, '駆血せずに穿刺（血管が怒張していない）');
      if (state.tourniquetOn && clock.elapsedTime - state.tourniquetAt > 180 && !state.tourniquetWarned) { state.tourniquetWarned = true; penalty(5, '駆血時間が 3 分を超えています'); }
      const site = V.sites[tool.site];
      if (Math.hypot(_v.x - site.x, _v.z - site.z) > 0.035) addLog(`${tool.site}針は目安の部位（${site.label}）から離れた所に刺しました`, 'info');   // 減点しない（刺す場所は術者が選ぶ。細い所なら狭窄の減点が別にある）
      const other = tools[tool.site === 'A' ? 'needleV' : 'needleA'];
      if (other?.stuck) { P.toArm(other.obj.getWorldPosition(_v3), _v3); if (_v3.distanceTo(_v) < 0.05) penalty(5, 'A針とV針の間隔が近すぎます（再循環のおそれ）'); }
      const oc = otherController(cs);
      let fixed = false;
      if (oc && !oc.held) { P.toArm(fingerTip(oc, _v3), _v3); fixed = _v3.distanceTo(_v) < 0.09 && _v3.y < sy + 0.05; }
      if (fixed) addLog('皮膚を伸展・固定して穿刺 ✔', 'ok');   // 皮膚の固定は減点しない（エコー下穿刺では反対の手がプローブを持つ。刺し方は術者の流儀に任せる）
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
          if (cl.sten > 0.35 && !tool.stenHit) { tool.stenHit = true; addLog(`細い所（狭窄部、血管径 ${(r * 2000).toFixed(1)}mm）に穿刺しました`, 'info'); }   // 減点しない（刺す場所は術者が選ぶ。記録だけ残す）
        }
      }
      tool.inVessel = inVessel;
      if (!tool.styletOut) setFlash(tool, inVessel || tool.perforated);
      if (!tool.perforated && _v.y < cl.point.y - r && cl.horiz < r + 0.004) {
        tool.perforated = true; tool.inVessel = false;
        P.hematoma.visible = true; P.placeCanon(P.hematoma, _v3.set(_v.x, sy, _v.z));
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
  if (location.search.includes('noui=1')) document.getElementById('overlay').style.display = 'none';   // デバッグ描画用: 画面下の案内を隠す
  if (location.search.includes('debug=voice') && voice.ok) setTimeout(() => console.log('[voice] all:', speechSynthesis.getVoices().map(v => `${v.name} (${v.lang})`).join(', ')), 1500);
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
        const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers', 'high-refresh-rate'] });
        session.addEventListener('end', () => { btn.textContent = 'VR を開始'; });
        await renderer.xr.setSession(session);
        btn.textContent = 'VR を終了';
      } catch (e) { btn.textContent = 'VR 開始に失敗: ' + e.message; }
    };
  });
}

init();
