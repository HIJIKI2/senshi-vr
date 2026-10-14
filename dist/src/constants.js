// 共有定数（単位: m）。ユーザーは原点に立ち -z 方向（ベッド側）を向く
export const BED_TOP = 0.85;                      // マットレス天面
export const CUSHION_H = 0.03;                    // アームレスト（クッション）の厚み
export const ARM_R = 0.045;                       // 前腕（肘側）半径
export const ARM_Z = -0.56;                       // 前腕軸の z 位置
export const ARM_Y = BED_TOP + CUSHION_H + ARM_R; // 前腕軸（肘側）の高さ
export const SHOULDER = { x: -0.49, y: ARM_Y + 0.035, z: -0.68 };
export const ELBOW_X = -0.08, WRIST_X = 0.30;
export const WRIST_LIFT = 0.009;                  // 手首側がわずかに高い（前腕上面をほぼ水平に保つ）
export const VESSEL_R_NORMAL = 0.0032, VESSEL_R_DILATED = 0.0045;   // 自己血管（AVF）の橈側皮静脈の半径: 非駆血 / 駆血（怒張）。vessel.js の各枝の基本径は駆血時の値
export const GRAFT_R = 0.003;                                      // 人工血管（AVG）: 6mm PTFE グラフト
export const HEART_BPM = 72;
// 器具カート天面中心と向き（yaw = -90°: カートの長辺（前面）が穿刺者側 -x を向く）
export const TRAY = { x: 0.97, y: 0.9, z: 0.18, yaw: -Math.PI / 2 };
export const TRAY_W = 1.2, TRAY_D = 0.5;         // カート天面の幅（長辺・穿刺者向き。ベッド側の端はベッドの角に触れない）と奥行き
// カート天面ローカル座標（dx: 幅方向, dz: 奥行き方向（+z が前面側））→ ワールド座標
export function trayPos(dx, dy, dz) {
  const c = Math.cos(TRAY.yaw), s = Math.sin(TRAY.yaw);
  return [TRAY.x + dx * c + dz * s, TRAY.y + dy, TRAY.z - dx * s + dz * c];
}
// 設定パネル用サイドテーブル（穿刺者の左後方、パネルは穿刺者側を向く）
export const SIDE_TABLE = { x: -0.5, y: 0.84, z: 0.25, yaw: Math.PI / 2 + 0.3 };

// 血管タイプごとの設定
export const VESSEL_TYPES = {
  avf: { label: '自己血管（AVF）', idealAngle: [15, 30], depth: 0.0035, usesTourniquet: true },
  avg: { label: '人工血管（AVG・前腕ループグラフト）', idealAngle: [30, 45], depth: 0.0055, usesTourniquet: false },   // depth: グラフト中心の皮膚からの深さ（標準）
};
export const NEEDLE_TYPES = {
  metal:   { label: '金属翼状針', short: '金属針' },
  cannula: { label: 'プラスチックカニューラ型留置針', short: 'カニューラ針' },
};

const clamp01 = v => Math.min(1, Math.max(0, v));
export function forearmT(x) { return clamp01((x - ELBOW_X) / (WRIST_X - ELBOW_X)); }
export function forearmRadius(x) {
  const t = forearmT(x);
  return ARM_R * (1 + 0.05 * Math.sin(t * Math.PI)) - 0.010 * t * t;   // 肘 0.045 → 手首 0.035
}
export function forearmAxisY(x) { return ARM_Y + WRIST_LIFT * forearmT(x); }
// 腕（上腕の露出部〜前腕）の軸と半径。x < ELBOW_X は上腕（肩へ向かって z が奥へずれる）
export const ARM_X_MIN = ELBOW_X - 0.15;        // 上腕の露出部（袖口より遠位）の肩側の限界
export function armAt(x) {
  if (x >= ELBOW_X) return { y: forearmAxisY(x), z: ARM_Z, r: forearmRadius(x) };
  const t = clamp01((ELBOW_X - x) / (ELBOW_X - SHOULDER.x));
  return { y: ARM_Y + (SHOULDER.y - ARM_Y) * t, z: ARM_Z + (SHOULDER.z - ARM_Z) * t, r: 0.043 + 0.007 * t + 0.004 * Math.sin(Math.PI * t) };
}
export const onArm = x => x > ARM_X_MIN && x < WRIST_X;
// 皮膚表面の高さ（z は腕軸からのずれを考慮した円筒面）。前腕・上腕とも可
export function skinY(x, z = ARM_Z) {
  const a = armAt(x), dz = z - a.z;
  return a.y + Math.sqrt(Math.max(0, a.r * a.r - dz * dz));
}
// 腕の表面から depth だけ内側の点（theta: 真上 = 0、+z（母指・ユーザー側）へ正、rad）
export function armPoint(x, theta, depth = 0) {
  const a = armAt(x), rr = a.r - depth;
  return { x, y: a.y + rr * Math.cos(theta), z: a.z + rr * Math.sin(theta) };
}
// 深部構造（エコー描画用）: 前腕の橈骨・尺骨、上腕骨の中心と半径
export function bonesAt(x) {
  const a = armAt(x);
  if (x >= ELBOW_X) return [{ y: a.y + a.r * 0.3, z: a.z + 0.014, r: 0.0075 }, { y: a.y + a.r * 0.22, z: a.z - 0.013, r: 0.0065 }];
  return [{ y: a.y - 0.004, z: a.z - 0.003, r: 0.011 }];
}
