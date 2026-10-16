// プロシージャルテクスチャ（Canvas で生成。外部画像不要・オフライン可）
import * as THREE from 'three';

function make(w, h, draw, repeat = [1, 1], srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
// 高さ（明るい = 高い）を描いたキャンバスから法線マップを作る（タイル可能）。k = 高さの強さ
function normalFrom(w, h, drawHeight, k = 2.2, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
  drawHeight(ctx, w, h);
  const src = ctx.getImageData(0, 0, w, h).data, out = ctx.createImageData(w, h), d = out.data;
  const hAt = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * k, dy = (hAt(x, y + 1) - hAt(x, y - 1)) * k;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (-dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.anisotropy = 8;
  return t;
}
// 粗さマップなど、色空間変換なしのグレースケール
const gray = (w, h, draw, repeat = [1, 1]) => make(w, h, draw, repeat, false);

function speckle(ctx, w, h, n, colors, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = rnd(alpha * 0.4, alpha);
    ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
    const r = rnd(rMin, rMax);
    ctx.beginPath(); ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function weave(ctx, w, h, step, alpha, color = '#000') {
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.globalAlpha = alpha;
  for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); ctx.stroke(); }
  for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

export function createTextures() {
  const T = {};

  T.skin = make(512, 512, (c, w, h) => {
    c.fillStyle = '#e5c1ad'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 2500, ['#d49a85', '#f2d5c2', '#c98f80', '#efc8b0'], 3, 14, 0.10);
    speckle(c, w, h, 6000, ['#8a4b40', '#b57a68'], 0.6, 1.3, 0.14);
    // うっすらとした体毛
    c.strokeStyle = 'rgba(90,60,45,0.28)'; c.lineWidth = 1;
    for (let i = 0; i < 420; i++) { const x = Math.random() * w, y = Math.random() * h, a = rnd(-0.6, 0.6); c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); c.stroke(); }
  }, [3, 1]);

  T.glove = make(256, 256, (c, w, h) => {
    c.fillStyle = '#5a86c8'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 3000, ['#4b74b4', '#6c97d6'], 0.8, 2.2, 0.12);
  });

  // 床: 医療施設の長尺塩ビシート（テラゾー調のチップ、60cm ごとの継ぎ目）。法線マップ（継ぎ目の溝・ゆず肌）と粗さマップ（擦れた所は艶が落ちる）付き
  T.linoleum = make(1024, 1024, (c, w, h) => {
    c.fillStyle = '#cbd0d4'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 26000, ['#aeb6bc', '#e6e9ec', '#9aa3aa', '#d6dbdf', '#b9c2c8'], 0.8, 3.2, 0.55);
    speckle(c, w, h, 1800, ['#8e979e', '#f2f4f6'], 2.5, 6, 0.3);                       // 大きめのチップ
    for (let i = 0; i < 60; i++) { c.globalAlpha = rnd(0.03, 0.08); c.fillStyle = '#6f777d'; const x = rnd(0, w), y = rnd(0, h); c.beginPath(); c.ellipse(x, y, rnd(20, 90), rnd(6, 18), rnd(0, 3.14), 0, Math.PI * 2); c.fill(); }   // 擦れ・汚れ
    c.globalAlpha = 1; c.strokeStyle = '#a4acb2'; c.lineWidth = 4; c.globalAlpha = 0.8; c.strokeRect(2, 2, w - 4, h - 4); c.globalAlpha = 1;
  }, [13, 13]);
  T.floorNormal = normalFrom(512, 512, (c, w, h) => {
    speckle(c, w, h, 12000, ['#7a7a7a', '#868686'], 1, 3, 0.6);                        // ゆず肌
    c.fillStyle = '#5a5a5a'; c.fillRect(0, 0, w, 3); c.fillRect(0, 0, 3, h); c.fillRect(0, h - 3, w, 3); c.fillRect(w - 3, 0, 3, h);   // 継ぎ目の溝
  }, 1.6, [13, 13]);
  T.floorRough = gray(512, 512, (c, w, h) => {
    c.fillStyle = '#6a6a6a'; c.fillRect(0, 0, w, h);                                      // 基本の粗さ（やや艶あり）
    speckle(c, w, h, 6000, ['#5c5c5c', '#787878'], 1, 4, 0.5);
    for (let i = 0; i < 50; i++) { c.globalAlpha = rnd(0.15, 0.35); c.fillStyle = '#9a9a9a'; const x = rnd(0, w), y = rnd(0, h); c.beginPath(); c.ellipse(x, y, rnd(20, 90), rnd(6, 18), rnd(0, 3.14), 0, Math.PI * 2); c.fill(); }   // 擦れた所は艶が落ちる
    c.globalAlpha = 1;
  }, [13, 13]);

  T.wall = make(512, 512, (c, w, h) => {
    c.fillStyle = '#eef0eb'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 6000, ['#e2e5df', '#f7f8f4'], 1, 4, 0.25);
  }, [4, 2]);
  T.wallNormal = normalFrom(512, 512, (c, w, h) => { speckle(c, w, h, 16000, ['#747474', '#8c8c8c'], 0.8, 2.6, 0.5); }, 1.2, [4, 2]);   // 塗装壁の細かな凹凸

  T.ceiling = make(512, 512, (c, w, h) => {
    c.fillStyle = '#f3f4f2'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 9000, ['#e3e5e2', '#ffffff', '#d8dbd7'], 0.6, 2, 0.5);
    speckle(c, w, h, 700, ['#cfd3cf'], 1, 6, 0.5);                                        // 岩綿吸音板の虫食い模様
    c.strokeStyle = '#c3c7c3'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
  }, [13, 13]);
  T.ceilingNormal = normalFrom(512, 512, (c, w, h) => {
    speckle(c, w, h, 700, ['#5e5e5e'], 1, 6, 0.6);
    c.fillStyle = '#505050'; c.fillRect(0, 0, w, 5); c.fillRect(0, 0, 5, h); c.fillRect(0, h - 5, w, 5); c.fillRect(w - 5, 0, 5, h);   // 目地の溝
  }, 1.8, [13, 13]);

  T.blanket = make(512, 512, (c, w, h) => {
    c.fillStyle = '#cfe2d3'; c.fillRect(0, 0, w, h);
    weave(c, w, h, 4, 0.10, '#6e8f77');
    speckle(c, w, h, 4000, ['#b9d2be', '#e0eee2'], 1, 3, 0.25);
    // ワッフル状の凹凸風パターン
    c.globalAlpha = 0.07; c.fillStyle = '#5c7f66';
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) c.fillRect(x + 4, y + 4, 24, 24);
    c.globalAlpha = 1;
  }, [6, 4]);
  T.blanketNormal = normalFrom(512, 512, (c, w, h) => {   // ワッフル織りの凹凸 + 糸目
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const g = c.createRadialGradient(x + 16, y + 16, 2, x + 16, y + 16, 15); g.addColorStop(0, '#6a6a6a'); g.addColorStop(1, '#8e8e8e'); c.fillStyle = g; c.fillRect(x + 3, y + 3, 26, 26); }
    weave(c, w, h, 4, 0.25, '#6e6e6e');
  }, 2.0, [6, 4]);

  T.sheet = make(512, 512, (c, w, h) => {
    c.fillStyle = '#f5f6f6'; c.fillRect(0, 0, w, h);
    weave(c, w, h, 3, 0.05, '#8a9299');
    speckle(c, w, h, 2500, ['#e9ecee', '#ffffff'], 1, 4, 0.3);
  }, [5, 3]);
  T.sheetNormal = normalFrom(512, 512, (c, w, h) => {   // 敷かれたシーツのゆるい皺（低周波の起伏）+ 織り目
    const img = c.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w * Math.PI * 2, v = y / h * Math.PI * 2;
      const hgt = 0.5 + 0.18 * Math.sin(u * 2 + Math.sin(v * 3) * 1.2) + 0.12 * Math.sin(v * 3 + Math.cos(u * 2) * 1.5) + 0.07 * Math.sin(u * 7 + v * 5);
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = hgt * 255; d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    weave(c, w, h, 3, 0.1, '#606060');
  }, 1.6, [5, 3]);
  T.fabricNormal = normalFrom(256, 256, (c, w, h) => { weave(c, w, h, 3, 0.35, '#5a5a5a'); speckle(c, w, h, 2000, ['#8a8a8a'], 0.6, 1.4, 0.4); }, 1.4, [8, 8]);   // 布の織り目（パジャマ等）

  T.gown = make(512, 512, (c, w, h) => {
    c.fillStyle = '#cfe0f1'; c.fillRect(0, 0, w, h);
    weave(c, w, h, 3, 0.04, '#5f7fa6');
    c.fillStyle = '#afc9e6';
    for (let y = 0; y < h; y += 28) for (let x = 0; x < w; x += 28) {
      const ox = (y / 28) % 2 ? 14 : 0;
      c.beginPath(); c.arc(x + ox, y, 3, 0, Math.PI * 2); c.fill();
    }
  }, [6, 6]);

  T.pajama = make(512, 512, (c, w, h) => {              // パジャマ（薄青地に紺のストライプ + 細い白線）
    c.fillStyle = '#a9c6e0'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 32) { c.fillStyle = '#5f86b3'; c.fillRect(x, 0, 6, h); c.fillStyle = '#eef4fa'; c.fillRect(x + 16, 0, 2, h); }
    weave(c, w, h, 3, 0.07, '#2f4a68');
    speckle(c, w, h, 2500, ['#9bb9d6', '#c4d9ea'], 1, 3, 0.2);
  }, [8, 8]);

  T.stainless = make(512, 512, (c, w, h) => {
    c.fillStyle = '#cdd2d7'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      c.globalAlpha = rnd(0.03, 0.14);
      c.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#8a9199';
      c.fillRect(0, Math.random() * h, w, rnd(0.5, 1.5));
    }
    c.globalAlpha = 1;
  }, [2, 1]);
  T.stainlessNormal = normalFrom(512, 512, (c, w, h) => {   // ヘアライン（横方向の細かな筋）
    for (let i = 0; i < 4000; i++) { c.globalAlpha = rnd(0.1, 0.4); c.fillStyle = Math.random() < 0.5 ? '#9a9a9a' : '#666666'; c.fillRect(0, Math.random() * h, w, rnd(0.5, 1.2)); }
    c.globalAlpha = 1;
  }, 0.9, [2, 1]);
  T.vinyl = make(512, 256, (c, w, h) => {                 // アームレストの合皮（薄青、縫い目）
    c.fillStyle = '#9dbfe0'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 5000, ['#8fb3d6', '#abc9e6'], 0.8, 2.2, 0.3);
    c.strokeStyle = '#6f93b8'; c.lineWidth = 2; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(0, 24); c.lineTo(w, 24); c.moveTo(0, h - 24); c.lineTo(w, h - 24); c.stroke(); c.setLineDash([]);
  }, [3, 1]);

  T.band = make(256, 256, (c, w, h) => {              // 駆血帯（伸縮バンド）
    c.fillStyle = '#2f4f8e'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { c.fillStyle = (x / 8) % 2 ? '#3b5fa6' : '#294780'; c.fillRect(x, 0, 4, h); }
    weave(c, w, h, 3, 0.12, '#101b33');
  }, [8, 1]);

  T.drape = make(512, 512, (c, w, h) => {             // 滅菌ドレープ（不織布）
    c.fillStyle = '#3e9088'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 12000, ['#2f7a73', '#5aa59d', '#4a9890'], 0.6, 2.2, 0.35);
  }, [3, 2]);

  T.paper = make(512, 512, (c, w, h) => {             // 滅菌パック（紙）
    c.fillStyle = '#eef3f8'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 7000, ['#dfe7ef', '#ffffff'], 0.8, 2.5, 0.4);
  });

  T.setLabel = make(512, 256, (c, w, h) => {
    c.fillStyle = '#eef3f8'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 3000, ['#dfe7ef', '#ffffff'], 0.8, 2.5, 0.4);
    c.fillStyle = '#2a6fb8'; c.fillRect(40, 40, w - 80, h - 80);
    c.fillStyle = '#fff'; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('穿刺セット', w / 2, h / 2 - 20);
    c.font = '26px sans-serif'; c.fillText('滅菌済 STERILE  Lot 2609A', w / 2, h / 2 + 40);
  });

  T.curtain = make(512, 512, (c, w, h) => {
    c.fillStyle = '#dbe9dc'; c.fillRect(0, 0, w, h);
    weave(c, w, h, 4, 0.05, '#6a8a6f');
    c.fillStyle = '#c3d9c6';
    for (let x = 0; x < w; x += 64) c.fillRect(x, 0, 20, h);
  }, [4, 2]);
  T.curtainNormal = normalFrom(256, 256, (c, w, h) => { weave(c, w, h, 4, 0.3, '#5c5c5c'); }, 1.2, [4, 2]);

  T.pillow = make(512, 512, (c, w, h) => {
    c.fillStyle = '#f8f8f6'; c.fillRect(0, 0, w, h);
    weave(c, w, h, 3, 0.04, '#8a9299');
  }, [2, 2]);

  T.wood = make(512, 512, (c, w, h) => {
    c.fillStyle = '#c9a77c'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      c.globalAlpha = rnd(0.05, 0.2); c.fillStyle = Math.random() < 0.5 ? '#a9825a' : '#e0c39b';
      c.fillRect(0, Math.random() * h, w, rnd(1, 5));
    }
    c.globalAlpha = 1;
  }, [2, 1]);

  T.window = make(1024, 640, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7fb6e8'); g.addColorStop(0.6, '#cfe6f7'); g.addColorStop(1, '#e8eef2');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; c.globalAlpha = 0.8;
    for (let i = 0; i < 8; i++) { const x = rnd(0, w), y = rnd(40, 200), r = rnd(30, 70); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.arc(x + r, y + 10, r * 0.8, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
    for (let i = 0; i < 14; i++) {
      const bw = rnd(50, 110), bh = rnd(120, 300), x = i * 75;
      c.fillStyle = `hsl(${rnd(200, 220)}, 15%, ${rnd(55, 75)}%)`; c.fillRect(x, h - 150 - bh, bw, bh + 150);
      c.fillStyle = 'rgba(255,255,230,0.5)';
      for (let yy = h - 140 - bh; yy < h - 160; yy += 22) for (let xx = x + 8; xx < x + bw - 10; xx += 18) if (Math.random() < 0.5) c.fillRect(xx, yy, 8, 10);
    }
    c.fillStyle = '#6a8f5a'; c.fillRect(0, h - 150, w, 150);
    // ブラインド
    c.fillStyle = 'rgba(245,247,248,0.9)';
    for (let y = 0; y < h; y += 26) c.fillRect(0, y, w, 14);
    c.fillStyle = '#ffffff'; c.fillRect(w / 2 - 6, 0, 12, h); c.fillRect(0, 0, 10, h); c.fillRect(w - 10, 0, 10, h);
  });

  // DCS-200Si の 15 インチ タッチパネル画面（実機の運転画面を模したレイアウト。運転/準備で描き直す）
  T.dcsScreen = makeDcsScreen();
  // 本体中段前縁の紺色デカール帯（横線 → ドットのグラデーション、DCS-200Si ロゴ）
  T.dcsBand = make(1024, 128, (c, w, h) => {
    const grad = c.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#2c4480'); grad.addColorStop(1, '#1d2d5c');
    c.fillStyle = grad; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(190,205,240,0.55)'; c.lineWidth = 2;
    for (let y = 8; y < h; y += 9) { c.beginPath(); c.moveTo(0, y); c.lineTo(w * 0.55, y); c.stroke(); }
    c.fillStyle = 'rgba(190,205,240,0.6)';
    for (let x = w * 0.5; x < w; x += 14) for (let y = 7; y < h; y += 14) {
      const r = 1.5 + 4.5 * Math.min(1, (x - w * 0.5) / (w * 0.4));
      c.beginPath(); c.arc(x + ((y / 14) % 2) * 7, y, r, 0, Math.PI * 2); c.fill();
    }
    // ロゴのロゼンジ
    c.fillStyle = '#121a30'; c.beginPath(); c.moveTo(120, 22); c.lineTo(470, 14); c.quadraticCurveTo(520, 64, 470, 114); c.lineTo(120, 106); c.quadraticCurveTo(80, 64, 120, 22); c.fill();
    c.fillStyle = '#e4e7ee'; c.font = 'italic bold 58px sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText('DCS-200Si', 300, 66);
  });
  // 下部キャビネット側面の青い装飾帯（縦向き: 上は横線、下へ行くほどドットに変わる）
  T.dcsSide = make(128, 1024, (c, w, h) => {
    const grad = c.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#2b4a8f'); grad.addColorStop(1, '#1d3570');
    c.fillStyle = grad; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(200,214,245,0.6)'; c.lineWidth = 2;
    for (let y = 6; y < h * 0.5; y += 8) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.fillStyle = 'rgba(200,214,245,0.65)';
    for (let y = h * 0.5; y < h; y += 13) for (let x = 7; x < w; x += 13) {
      const r = 1.5 + 4 * Math.min(1, (y - h * 0.5) / (h * 0.4));
      c.beginPath(); c.arc(x + ((Math.round(y / 13)) % 2) * 6, y, r, 0, Math.PI * 2); c.fill();
    }
  });
  // DCS-200Si の銘板（黒いロゼンジに銀文字、背景は透明）
  T.dcsLogo = make(512, 96, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#15192a'; c.beginPath(); c.moveTo(40, 14); c.lineTo(470, 8); c.quadraticCurveTo(505, 48, 470, 88); c.lineTo(40, 82); c.quadraticCurveTo(10, 48, 40, 14); c.fill();
    c.fillStyle = '#d9dde6'; c.font = 'italic bold 56px sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText('DCS-200Si', 256, 50);
  });
  // モニター下縁の操作ボタン列（左: 消音・画面切替、中央: ロゴ、右: 警報ランプ・ボタン・赤い緊急停止）
  T.dcsBezel = make(1024, 112, (c, w, h) => {
    c.fillStyle = '#1c2a4e'; c.fillRect(0, 0, w, h);
    const btn = (x, col, r = 26) => { c.fillStyle = '#0d1530'; c.beginPath(); c.arc(x, 56, r + 4, 0, Math.PI * 2); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(x, 56, r, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(x - r * 0.3, 56 - r * 0.3, r * 0.4, 0, Math.PI * 2); c.fill(); };
    btn(70, '#d9dde4'); btn(150, '#d9dde4');
    c.fillStyle = '#2d3b63'; c.fillRect(215, 38, 70, 36);
    c.fillStyle = '#c8d0e0'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('NIKKISO', w / 2, 58);
    // 警報ランプ（黄色の三角）
    c.fillStyle = '#f5c518'; c.beginPath(); c.moveTo(760, 30); c.lineTo(790, 82); c.lineTo(730, 82); c.closePath(); c.fill();
    c.fillStyle = '#222'; c.font = 'bold 34px sans-serif'; c.fillText('!', 760, 62);
    btn(850, '#d9dde4'); btn(950, '#d8262e', 30);
  });

  T.clock = make(256, 256, (c, w, h) => {
    c.fillStyle = '#fff'; c.beginPath(); c.arc(128, 128, 120, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#333'; c.lineWidth = 6; c.stroke();
    c.fillStyle = '#222';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; c.fillRect(128 + Math.cos(a) * 100 - 3, 128 + Math.sin(a) * 100 - 3, 6, 6); }
    c.lineWidth = 7; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 + 55, 128 - 40); c.stroke();
    c.lineWidth = 4; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 - 20, 128 - 85); c.stroke();
  });

  T.settingsTitle = make(512, 56, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#e8eef7'; c.font = 'bold 27px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('設定（押して切り替え → リセット）', w / 2, h / 2);
  });
  T.labels = { vessel: makeLabel(), needle: makeLabel(), depth: makeLabel() };
  T.titleLabels = { vessel: makeLabel(), needle: makeLabel(), depth: makeLabel() };   // タイトル画面の大きなキー
  T.titleHead = make(1024, 52, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#cfe0f5'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('キーを指で押して設定を選び、下のスタートを押してください', w / 2, h / 2); });
  T.titleStart = make(1024, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.font = 'bold 120px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('スタート', w / 2, h / 2 - 20); c.font = 'bold 36px sans-serif'; c.fillStyle = '#d8f5e2'; c.fillText('START — タッチして開始', w / 2, h / 2 + 82); });

  T.pouch = make(512, 384, (c, w, h) => {              // 個包装アルコール綿のパウチ（アルミ蒸着フィルム + 青の印刷）
    const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#cfd4da'); g.addColorStop(0.45, '#f6f7f9'); g.addColorStop(1, '#c3c9d0');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(110,120,130,0.45)'; c.lineWidth = 2;
    for (let y = 6; y < 44; y += 7) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }          // シール（上端）
    for (let y = h - 40; y < h; y += 7) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }     // シール（下端）
    c.fillStyle = '#2f6fd0'; c.fillRect(0, 90, w, 140);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#fff'; c.font = 'bold 66px sans-serif'; c.fillText('アルコール綿', w / 2, 160);
    c.fillStyle = '#1f2c52'; c.font = 'bold 28px sans-serif'; c.fillText('消毒用エタノール含浸  1枚入', w / 2, 262);
    c.font = '24px sans-serif'; c.fillText('単回使用 ・ 滅菌済', w / 2, 300);
    c.fillStyle = '#d9303a'; c.font = 'bold 26px sans-serif'; c.textAlign = 'right'; c.fillText('◀ 開封口', w - 14, 66);
  });
  T.gloveLabel = make(512, 256, (c, w, h) => {         // 手袋の箱（ニトリル手袋 M）
    c.fillStyle = '#f4f6f8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a7bd5'; c.fillRect(0, 0, w, 70); c.fillRect(0, h - 40, w, 40);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#fff'; c.font = 'bold 40px sans-serif'; c.fillText('NITRILE  GLOVES', w / 2, 36);
    c.fillStyle = '#1f2c52'; c.font = 'bold 62px sans-serif'; c.fillText('ニトリル手袋', w / 2, 120);
    c.font = 'bold 44px sans-serif'; c.fillText('M サイズ ・ 100枚入', w / 2, 180);
    c.fillStyle = '#fff'; c.font = '24px sans-serif'; c.fillText('パウダーフリー ・ 未滅菌 ・ 単回使用', w / 2, h - 20);
  });

  T.okLabel = make(256, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#ffffff'; c.font = 'bold 86px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('OK', 128, 100); c.font = 'bold 44px sans-serif'; c.fillText('確認', 128, 178);
  });
  T.titleBtnLabel = make(256, 256, (c, w, h) => {   // サイドテーブルの赤いボタン: タイトル画面へ戻る
    c.fillStyle = '#2b3038'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = 'bold 56px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TITLE', 128, 110); c.font = '34px sans-serif'; c.fillText('タイトルへ', 128, 175);
  });
  T.resetLabel = make(256, 256, (c, w, h) => {
    c.fillStyle = '#2b3038'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff'; c.font = 'bold 60px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('RESET', 128, 110); c.font = '34px sans-serif'; c.fillText('リセット', 128, 175);
  });

  // 皮膚の法線マップ（毛穴・細かい皺）: 高さノイズから生成
  T.skinNormal = (() => {
    const w = 512, h = 512, c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 9000, ['#5a5a5a', '#a0a0a0'], 0.8, 2.6, 0.5);
    speckle(ctx, w, h, 1200, ['#6a6a6a', '#969696'], 3, 12, 0.25);
    ctx.strokeStyle = 'rgba(70,70,70,0.35)'; ctx.lineWidth = 1;
    for (let i = 0; i < 400; i++) { const x = rnd(0, w), y = rnd(0, h), a = rnd(0, Math.PI); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30); ctx.stroke(); }
    const src = ctx.getImageData(0, 0, w, h).data, out = ctx.createImageData(w, h), d = out.data;
    const hAt = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    const k = 2.2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * k, dy = (hAt(x, y + 1) - hAt(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (-dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1); t.anisotropy = 8;
    return t;
  })();

  // 髪（短髪）: 色テクスチャ + 生え際のアルファマスク（球 UV: u=0.25 が顔側, v=1 が頭頂）
  T.hair = make(512, 512, (c, w, h) => {
    c.fillStyle = '#2b1e17'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      c.strokeStyle = Math.random() < 0.5 ? 'rgba(80,58,42,0.5)' : 'rgba(20,12,8,0.5)'; c.lineWidth = rnd(0.6, 1.4);
      const x = rnd(0, w), y = rnd(0, h), a = rnd(-0.5, 0.5) + Math.PI / 2;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * rnd(6, 18), y + Math.sin(a) * rnd(6, 18)); c.stroke();
    }
    speckle(c, w, h, 800, ['#6b5240', '#8a7060'], 0.5, 1.2, 0.5);   // 白髪混じり
  }, [4, 2]);
  T.hairAlpha = (() => {
    const w = 512, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = 1 - y / h;                       // v=1 頭頂
      const phi = u * Math.PI * 2, front = (1 + Math.cos(phi - Math.PI / 2)) / 2;   // 1 = 顔側
      const temple = Math.exp(-((Math.abs(u - 0.25) - 0.1) ** 2) / 0.002) * 0.08;     // こめかみの後退
      const edge = 0.33 + 0.36 * front + temple + 0.015 * Math.sin(u * 90) + 0.01 * Math.sin(u * 230);
      const a = Math.min(1, Math.max(0, (v - edge) / 0.025));
      const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = a * 255; d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
  })();

  return T;
}

// 文字列を書き換えられるラベル（設定ボタン用）
// 血液の充填状態を表すグラデーション（u 方向 = チューブ長さ方向）
export function makeFillTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 2;
  const ctx = c.getContext('2d');
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  let cur = -1;
  function set(progress, fromEnd = false) {
    const p = Math.min(1, Math.max(0, progress));
    if (Math.abs(p - cur) < 0.002 && p !== 0 && p !== 1) return;
    cur = p;
    ctx.fillStyle = 'rgba(232,238,244,0.62)'; ctx.clearRect(0, 0, 512, 2); ctx.fillRect(0, 0, 512, 2);   // 血液が来る前は生食で満たされている（白っぽい半透明）
    ctx.fillStyle = 'rgba(165,8,22,0.97)';
    const n = Math.round(p * 512);
    if (fromEnd) ctx.fillRect(512 - n, 0, n, 2); else ctx.fillRect(0, 0, n, 2);
    texture.needsUpdate = true;
  }
  set(0);
  return { texture, set };
}

// DCS-200Si 風の運転画面（1024×768）。draw(running) で「準備」⇄「運転」を描き直す
function makeDcsScreen() {
  const w = 1024, h = 768, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const rr = (x, y, ww, hh, r, fill, stroke) => {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + ww, y, x + ww, y + hh, r); c.arcTo(x + ww, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + ww, y, r); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
  };
  const txt = (s, x, y, font, col, align = 'left') => { c.font = font; c.fillStyle = col; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y); };
  // 数値パネル（黒地に白数字、下に緑のレンジバー）
  const numPanel = (x, y, ww, hh, label, val, unit, big = 92, bar = true) => {
    rr(x, y, ww, hh, 6, '#0d1a14', '#2f5a45');
    txt(label, x + 12, y + 22, 'bold 24px sans-serif', '#dfe8e2');
    txt(unit, x + ww - 10, y + 22, '18px sans-serif', '#9fb5a8', 'right');
    txt(val, x + ww / 2, y + hh / 2 + 14, `bold ${big}px sans-serif`, '#ffffff', 'center');
    if (bar) { c.fillStyle = '#1f3a2c'; c.fillRect(x + 12, y + hh - 18, ww - 24, 8); c.fillStyle = '#39c46a'; c.fillRect(x + 12 + (ww - 24) * 0.3, y + hh - 18, (ww - 24) * 0.4, 8); }
  };
  const draw = (running) => {
    c.fillStyle = '#e4e8ec'; c.fillRect(0, 0, w, h);
    // 上段バー: 状態（運転 HD / 準備 HD）・通信・ホーム
    rr(14, 10, 300, 52, 8, running ? '#1f8a3f' : '#4a5f78');
    txt(running ? '運転  HD' : '準備  HD', 164, 36, 'bold 34px sans-serif', '#ffffff', 'center');
    rr(560, 10, 180, 52, 8, '#c9d64a'); txt('通信', 650, 36, 'bold 30px sans-serif', '#1a1a1a', 'center');
    rr(950, 8, 60, 56, 8, '#2f9e5e'); txt('⌂', 980, 38, 'bold 40px sans-serif', '#ffffff', 'center');
    // 圧力・除水
    numPanel(14, 74, 190, 150, '静脈圧', '112', 'mmHg');
    numPanel(214, 74, 190, 150, '透析液圧', '-42', 'mmHg');
    numPanel(414, 74, 138, 150, '除水量積算', running ? '0.03' : '0.00', 'L', 60, false);
    numPanel(562, 74, 138, 150, '除水量設定', '6.99', 'L', 60, false);
    rr(710, 74, 138, 150, 6, '#f3f0b0', '#b9b45a'); txt('除水速度', 722, 96, 'bold 22px sans-serif', '#333'); txt('L/h', 836, 96, '18px sans-serif', '#555', 'right');
    txt(running ? '1.77' : '0.00', 779, 160, 'bold 60px sans-serif', '#111', 'center');
    // 左列: 血圧・脈拍
    const bp = [['最高血圧', '127', 'mmHg'], ['最低血圧', '79', 'mmHg'], ['脈拍', '103', 'bpm']];
    bp.forEach((b, i) => { const y = 240 + i * 112; rr(14, y, 150, 100, 6, '#0d1a14', '#2f5a45'); txt(b[0], 24, y + 20, 'bold 20px sans-serif', '#dfe8e2'); txt(b[1], 90, y + 62, 'bold 56px sans-serif', '#fff', 'center'); txt(b[2], 156, y + 90, '16px sans-serif', '#9fb5a8', 'right'); });
    txt('測定  9:36', 90, 596, 'bold 22px sans-serif', '#1f3d2e', 'center');
    // 中央: 残り時間のゲージ（半円）
    const cx = 455, cy = 470, R = 165;
    c.beginPath(); c.arc(cx, cy, R + 14, Math.PI * 0.8, Math.PI * 2.2); c.lineWidth = 30; c.strokeStyle = '#c9d2d8'; c.stroke();
    c.beginPath(); c.arc(cx, cy, R + 14, Math.PI * 0.8, Math.PI * 0.8 + Math.PI * 1.4 * (running ? 0.03 : 0)); c.lineWidth = 30; c.strokeStyle = '#39c46a'; c.stroke();
    for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.8 + Math.PI * 1.4 * i / 8; c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); c.lineTo(cx + Math.cos(a) * (R + 30), cy + Math.sin(a) * (R + 30)); c.lineWidth = i % 2 ? 2 : 4; c.strokeStyle = '#4a5a66'; c.stroke(); }
    ['1h', '2h', '3h', '4h'].forEach((s, i) => { const a = Math.PI * 0.8 + Math.PI * 1.4 * (i + 1) / 4.6; txt(s, cx + Math.cos(a) * (R + 55), cy + Math.sin(a) * (R + 55), 'bold 22px sans-serif', '#334', 'center'); });
    c.beginPath(); c.arc(cx, cy, 92, 0, Math.PI * 2); c.fillStyle = '#0f3d2a'; c.fill();
    txt('残り時間', cx, cy - 34, 'bold 24px sans-serif', '#cfe9d8', 'center');
    txt(running ? '3:59' : '4:00', cx, cy + 14, 'bold 62px sans-serif', '#ffffff', 'center');
    txt('開始', 300, 640, 'bold 20px sans-serif', '#334', 'center'); txt(running ? '9:12' : '--:--', 300, 668, 'bold 30px sans-serif', '#111', 'center');
    txt('完了', 610, 640, 'bold 20px sans-serif', '#334', 'center'); txt(running ? '13:41' : '--:--', 610, 668, 'bold 30px sans-serif', '#111', 'center');
    // 右列: IP 速度・透析液温度・濃度・流量
    const rc = [['IP速度', '10.0', 'mL/h', '#f3f0b0'], ['透析液温度', '36.0', '℃', '#f2f4f6'], ['透析液濃度', '13.1', 'mS/cm', '#f2f4f6'], ['透析液流量', '300', 'mL/min', '#f2f4f6']];
    rc.forEach((r, i) => { const y = 240 + i * 94; rr(700, y, 150, 82, 6, r[3], '#8a949c'); txt(r[0], 712, y + 18, 'bold 19px sans-serif', '#222'); txt(r[1], 775, y + 54, 'bold 40px sans-serif', '#111', 'center'); txt(r[2], 844, y + 72, '14px sans-serif', '#555', 'right'); });
    // 右端: 運転 / 停止 / 返血（D-FAS）
    rr(862, 234, 150, 130, 10, running ? '#1f8a3f' : '#dfe4e8', '#2c7a45'); txt('運転', 937, 299, 'bold 40px sans-serif', running ? '#fff' : '#1f8a3f', 'center');
    rr(862, 380, 150, 110, 10, running ? '#dfe4e8' : '#1f8a3f', '#2c7a45'); txt('停止', 937, 435, 'bold 40px sans-serif', running ? '#1f8a3f' : '#fff', 'center');
    rr(862, 560, 150, 110, 10, '#dfe4e8', '#2c7a45'); txt('返血', 937, 600, 'bold 36px sans-serif', '#1f8a3f', 'center'); txt('D-FAS', 937, 640, 'bold 18px sans-serif', '#1f8a3f', 'center');
    // 下段バー
    c.fillStyle = '#cfd6dc'; c.fillRect(0, 692, w, 76);
    [['血圧', 150], ['タイマー', 290], ['工程', 560]].forEach(([s, x]) => { rr(x - 55, 702, 110, 56, 8, '#f6f8fa', '#9aa5ae'); txt(s, x, 730, 'bold 24px sans-serif', '#223', 'center'); });
    rr(20, 702, 80, 56, 8, '#f6f8fa', '#9aa5ae'); rr(400, 702, 70, 56, 8, '#f6f8fa', '#9aa5ae'); rr(660, 702, 70, 56, 8, '#f6f8fa', '#9aa5ae');
    txt('血流量', 760, 715, 'bold 20px sans-serif', '#223'); txt('mL/min', 760, 745, '16px sans-serif', '#556');
    txt(running ? '150' : '0', 980, 730, 'bold 56px sans-serif', '#111', 'right');
    tex.needsUpdate = true;
  };
  draw(false);
  return { texture: tex, draw };
}

export function makeLabel() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 300;
  const ctx = c.getContext('2d');
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  function draw(title, value) {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = 'bold 36px sans-serif'; ctx.fillText(title, 256, 56);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 46px sans-serif';
    const lines = value.split('\n');
    lines.forEach((l, i) => ctx.fillText(l, 256, 160 + (i - (lines.length - 1) / 2) * 56));
    texture.needsUpdate = true;
  }
  return { texture, draw };
}
