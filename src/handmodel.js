// リアルな手のモデル（WebXR Input Profiles の generic-hand メッシュ, Apache-2.0）を読み込み、
// 指の曲がりをフォワードキネマティクスで制御する。
// モデル座標: 手首 = 原点、指先方向 = -z、手の甲 = +y、親指 = 右手で -x / 左手で +x
import * as THREE from 'three';
import { GLTFLoader } from '../lib/GLTFLoader.js';

const CHAINS = {
  thumb:  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index:  ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring:   ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky:  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};
// 各関節の最大屈曲角（rad）: [中手骨, 基節, 中節, 末節]
const MAX_ANGLE = { thumb: [0.25, 0.55, 0.7], finger: [0.0, 1.35, 1.5, 0.9] };
const loader = new GLTFLoader();

export function loadHand(side, material) {
  const group = new THREE.Group();
  const api = { group, side, tips: {}, bones: {}, loaded: false, curl: { thumb: 0.2, index: 0.2, middle: 0.2, ring: 0.2, pinky: 0.2 }, setCurl: () => {} };
  api.ready = new Promise(resolve => {
    loader.load(`./assets/hands/${side}.glb`, gltf => {
      const root = gltf.scene;
      root.traverse(o => { if (o.isMesh) { o.material = material; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      // left.glb は右手の規約に対して X 軸回りに +90° 回った姿勢で格納されているので補正し、両手とも「-z = 指先, +y = 手の甲」に揃える
      if (side === 'left') { const fix = new THREE.Group(); fix.rotation.x = -Math.PI / 2; fix.add(root); group.add(fix); }
      else group.add(root);
      const chains = {};
      for (const [finger, names] of Object.entries(CHAINS)) {
        const bones = names.map(n => root.getObjectByName(n));
        if (bones.some(b => !b)) continue;
        bones.forEach(b => b.updateMatrix());
        const rest = bones.map(b => b.matrix.clone());
        const rel = rest.map((m, i) => i === 0 ? m.clone() : new THREE.Matrix4().copy(rest[i - 1]).invert().multiply(m));
        chains[finger] = { bones, rel };
        api.bones[finger] = bones;
        api.tips[finger] = bones[bones.length - 1];
      }
      const rot = new THREE.Matrix4(), rot2 = new THREE.Matrix4(), M = new THREE.Matrix4();
      api.setCurl = (c) => {
        Object.assign(api.curl, c);
        for (const [finger, ch] of Object.entries(chains)) {
          const amount = api.curl[finger] ?? 0;
          const maxA = finger === 'thumb' ? MAX_ANGLE.thumb : MAX_ANGLE.finger;
          let prev = null;
          ch.bones.forEach((bone, i) => {
            const a = -(maxA[i] ?? 0) * amount;          // -X 回りで掌側へ屈曲
            rot.makeRotationX(a);
            if (finger === 'thumb' && i === 0 && api.curl.thumbOpp) {
              // 母指の対立（人差し指側へ向ける）: 中手骨をローカル軸回りに追加回転
              const o = api.curl.thumbOpp, ax = api.curl.thumbOppAxis || 'z';
              if (ax === 'y') rot2.makeRotationY(o); else if (ax === 'x') rot2.makeRotationX(o); else rot2.makeRotationZ(o);
              rot.multiply(rot2);
            }
            if (i === 0) M.copy(ch.rel[0]).multiply(rot);
            else M.copy(prev).multiply(ch.rel[i]).multiply(rot);
            M.decompose(bone.position, bone.quaternion, bone.scale);
            prev = prev ? prev.copy(M) : M.clone();
          });
        }
      };
      api.setCurl({});
      api.loaded = true;
      resolve(api);
    }, undefined, () => resolve(api));
  });
  return api;
}

// ハンドトラッキング用: 同じ GLB を WebXR Hand Input の関節（25 個、手首を含む）の姿勢で直接動かす。
// GLB の骨は平坦な階層（すべて Armature 直下）で、関節名は WebXR の jointName と同じなので、関節の位置・回転をそのまま骨に写す
// （three.js の XRHandMeshModel と同じ方式）。api.update(xrHand) を毎フレーム呼ぶ。setCurl は無効（実際の手の形がそのまま映る）
export const XR_JOINTS = ['wrist', ...Object.values(CHAINS).flat()];
export function loadTrackedHand(side, material) {
  const group = new THREE.Group();
  const api = { group, side, tips: {}, bones: {}, joints: {}, loaded: false, tracked: true, curl: {}, setCurl: () => {} };
  api.ready = new Promise(resolve => {
    loader.load(`./assets/hands/${side}.glb`, gltf => {
      const root = gltf.scene;
      root.traverse(o => { if (o.isMesh) { o.material = material; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      group.add(root);
      for (const name of XR_JOINTS) { const b = root.getObjectByName(name); if (b) api.joints[name] = b; }
      for (const [finger, names] of Object.entries(CHAINS)) {
        api.bones[finger] = names.map(n => api.joints[n]).filter(Boolean);
        api.tips[finger] = api.joints[names[names.length - 1]];
      }
      api.loaded = true;
      resolve(api);
    }, undefined, () => resolve(api));
  });
  // xrHand: renderer.xr.getHand(i)。joints[name] の position/quaternion（リファレンス空間）を骨へ写す
  api.update = xrHand => {
    if (!api.loaded || !xrHand?.joints) return;
    for (const name of XR_JOINTS) {
      const j = xrHand.joints[name], b = api.joints[name];
      if (!j || !b || !j.visible) continue;
      b.position.copy(j.position); b.quaternion.copy(j.quaternion);
    }
  };
  return api;
}

// WebXR gripSpace（原点 = 握った指の中心, -Z = 親指方向, +X = 右手の甲, +Y = 前腕方向）に手首を合わせる姿勢
export function gripPose(side) {
  const m = new THREE.Matrix4();
  if (side === 'right') m.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  else m.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
  return { quaternion: new THREE.Quaternion().setFromRotationMatrix(m), position: new THREE.Vector3(0, 0.085, 0.0) };
}
