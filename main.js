import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MAX_MOE = 4;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);

const ui = {
  stage: $('stage'), canvas: $('scene'),
  loader: $('loader'), loaderFill: $('loaderFill'), loaderPct: $('loaderPct'), loaderMsg: $('loaderMsg'),
  hint: $('hint'), progress: [...$('progress').children], toast: $('toast'), rotateTip: $('rotateTip'),
  tray: $('tray'), moeBtn: $('moeBtn'), milkBtn: $('milkBtn'), moeSub: $('moeSub'), milkSub: $('milkSub'),
  done: $('done'), doneTitle: $('doneTitle'), againBtn: $('againBtn'), spinBtn: $('spinBtn'),
  soundBtn: $('soundBtn'), made: $('made'), bgm: $('bgm'), meow: $('meow'),
  finishModal: $('finishModal'), finishClose: $('finishClose'), saveBtn: $('saveBtn'), saveTip: $('saveTip'),
};
const FINISH_PHOTO_URL = './assets/ui/ui-modal-finish-photo-candied-skewer.png';

const state = { count: 0, milk: false, finished: false, busy: false, ready: false, sound: true, made: 0 };
try { state.made = Number(localStorage.getItem('lxx-skewer-made') || 0); } catch { /* private mode */ }

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.75;

const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.position.set(-3, 5, 6);
scene.add(key);
const rimLight = new THREE.DirectionalLight(0xfff0c8, 0.7);
rimLight.position.set(4, 2, -5);
scene.add(rimLight);
scene.add(new THREE.HemisphereLight(0xe2f3ff, 0xffe9a8, 0.55));

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const controls = new OrbitControls(camera, ui.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.rotateSpeed = 0.9;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI - 0.35;
controls.autoRotateSpeed = 2.4;

// ------------------------------------------------------------------ model handles
const model = {
  root: null, heads: [], slotPos: [], slotQuat: [], tipY: 3.4,
  milk: null, milkPivot: null, milkFullH: 3.75, milkMinY: -0.7,
  box: new THREE.Box3(), center: new THREE.Vector3(), fitDist: 12,
};

// ------------------------------------------------------------------ tiny tween system
const tweens = [];
function tween(dur, update, done) {
  const t = { t0: performance.now(), dur: REDUCED ? Math.min(dur, 200) : dur, update, done };
  tweens.push(t);
  return t;
}
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const easeInQuad = (p) => p * p;
const easeOutBack = (p) => { const c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };

// ------------------------------------------------------------------ sparkles (VFX only)
function makeSparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i < 8; i++) {           // 4-point star glint
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 === 0 ? 31 : 9;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const sparkTex = makeSparkTexture();
const SPARK_COLORS = [0xffd84f, 0xffffff, 0x8fd3ff, 0xffb3c7, 0xffe9a6];
function burst(origin, n = 18, spread = 1.0, life = 900) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const vel = [];
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    pos.set([origin.x, origin.y, origin.z], i * 3);
    const a = Math.random() * Math.PI * 2;
    const up = 0.4 + Math.random() * 1.2;
    vel.push(new THREE.Vector3(Math.cos(a) * spread * (0.6 + Math.random()), up * spread, Math.sin(a) * spread * (0.6 + Math.random())));
    c.set(SPARK_COLORS[i % SPARK_COLORS.length]);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.22, map: sparkTex, vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  let last = performance.now();
  tween(life, (p) => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const arr = geo.attributes.position.array;
    for (let i = 0; i < n; i++) {
      vel[i].y -= 3.2 * dt;
      arr[i * 3] += vel[i].x * dt;
      arr[i * 3 + 1] += vel[i].y * dt;
      arr[i * 3 + 2] += vel[i].z * dt;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 1 - p * p;
  }, () => { scene.remove(pts); geo.dispose(); mat.dispose(); });
}

// ------------------------------------------------------------------ audio
let actx = null;
function blip(f0, f1, dur = 0.12, vol = 0.18) {
  if (!state.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch { /* audio unavailable */ }
}
function startBgm() {
  if (!state.sound) return;
  ui.bgm.volume = 0.35;
  ui.bgm.play().catch(() => {});
}
ui.soundBtn.addEventListener('click', () => {
  state.sound = !state.sound;
  ui.soundBtn.dataset.on = state.sound ? '1' : '0';
  if (state.sound) startBgm(); else ui.bgm.pause();
});
window.addEventListener('pointerdown', startBgm, { once: true });

// ------------------------------------------------------------------ load the Blender-built GLB
const loader = {
  shown: 0, real: 0, phase: 0, done: false,   // phase: 0 model, 1 fonts/media warm-up, 2 ready
  set(p, msg) {
    this.real = Math.max(this.real, p);
    ui.loaderFill.style.width = `${Math.round(this.shown * 100)}%`;
    ui.loaderPct.textContent = `${Math.round(this.shown * 100)}%`;
    if (msg) ui.loaderMsg.textContent = msg;
  },
  tickTo(target, msg) {
    this.shown += (target - this.shown) * 0.35;   // smooth toward the target each frame
    this.set(target, msg);
  },
};
new GLTFLoader().load(
  './assets/model/model-candied-cat-skewer-runtime.glb',
  (gltf) => { loader.phase = 1; loader.tickTo(0.9, '穿上糖衣…'); setupModel(gltf.scene); },
  (ev) => {
    const p = ev.total ? 0.05 + 0.8 * (ev.loaded / ev.total) : 0.4;
    loader.tickTo(p, '正在熬糖…');
  },
  (err) => {
    loader.set(1, '糖熬糊了…刷新再试一次');
    console.error(err);
  },
);
setTimeout(() => { if (!loader.done) loader.tickTo(0.5, '正在熬糖…'); }, 1200);

function setupModel(root) {
  model.root = root;
  scene.add(root);
  root.updateMatrixWorld(true);

  for (let k = 0; k < MAX_MOE; k++) {
    const h = root.getObjectByName(`head_${k}`);
    model.heads.push(h);
    model.slotPos.push(h.position.clone());
    model.slotQuat.push(h.quaternion.clone());
  }
  const tip = root.getObjectByName('stick_tip');
  if (tip) model.tipY = tip.position.y;

  model.box.setFromObject(root);
  model.box.getCenter(model.center);

  // milk-skin: alpha-clipped double-sided film; re-pivot at its bottom edge so it can unfurl upward
  const milk = root.getObjectByName('milk_skin');
  milk.traverse((o) => {
    if (o.isMesh) {
      o.material.alphaTest = 0.5;
      o.material.transparent = false;
      o.material.side = THREE.DoubleSide;
    }
  });
  const mb = new THREE.Box3().setFromObject(milk);
  model.milkMinY = mb.min.y;
  model.milkFullH = mb.max.y - mb.min.y;
  const pivot = new THREE.Group();
  pivot.position.set(0, mb.min.y, 0);
  milk.parent.add(pivot);
  pivot.updateMatrixWorld(true);
  pivot.attach(milk);
  model.milk = milk;
  model.milkPivot = pivot;

  resetBuild(false);
  onResize();
  frontView(false);
  loader.phase = 2;
  loader.shown = 1;
  loader.set(1, '可以开串啦！');
  setTimeout(() => {
    loader.done = true;
    ui.loader.classList.add('hide');
    document.getElementById('app').setAttribute('aria-hidden', 'false');
  }, 350);
  state.ready = true;
  window.__sceneReady = true;
}

// ------------------------------------------------------------------ camera framing
function onResize() {
  const w = ui.stage.clientWidth;
  const h = ui.stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!model.root) return;
  const size = model.box.getSize(new THREE.Vector3());
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const distH = (size.y * 0.5) / Math.tan(vfov / 2);
  const distW = (Math.max(size.x, size.z) * 0.62) / Math.tan(hfov / 2);
  model.fitDist = Math.max(distH, distW) * 0.96 + 0.3;
  controls.minDistance = model.fitDist * 0.45;
  controls.maxDistance = model.fitDist * 1.5;
  controls.target.copy(model.center);
}
new ResizeObserver(onResize).observe(ui.stage);

function frontView(animated = true) {
  const to = new THREE.Vector3(model.center.x, model.center.y + model.fitDist * 0.08, model.center.z + model.fitDist);
  if (!animated) { camera.position.copy(to); controls.update(); return; }
  const from = camera.position.clone();
  // swing back along a sphere so the camera never passes through the skewer
  const sFrom = new THREE.Spherical().setFromVector3(from.clone().sub(model.center));
  const sTo = new THREE.Spherical().setFromVector3(to.clone().sub(model.center));
  let dTheta = sTo.theta - sFrom.theta;
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  tween(700, (p) => {
    const e = easeOutCubic(p);
    const s = new THREE.Spherical(
      sFrom.radius + (sTo.radius - sFrom.radius) * e,
      sFrom.phi + (sTo.phi - sFrom.phi) * e,
      sFrom.theta + dTheta * e,
    );
    camera.position.setFromSpherical(s).add(model.center);
  });
}

// ------------------------------------------------------------------ game flow
function resetBuild(withFx = true) {
  state.count = 0;
  state.milk = false;
  state.finished = false;
  state.busy = false;
  model.heads.forEach((h) => { h.visible = false; h.scale.setScalar(1); });
  model.milk.visible = false;
  model.milkPivot.scale.set(1, 1, 1);
  controls.autoRotate = false;
  ui.done.classList.remove('show');
  ui.done.setAttribute('aria-hidden', 'true');
  ui.tray.style.visibility = '';
  ui.rotateTip.classList.remove('show');
  if (withFx) frontView(true);
  refreshUi();
}

function refreshUi() {
  const { count, milk } = state;
  ui.progress.forEach((el, i) => el.classList.toggle('on', i < count));
  ui.moeSub.textContent = `${count} / ${MAX_MOE}`;
  ui.moeBtn.classList.toggle('is-full', count >= MAX_MOE);
  if (count >= MAX_MOE) ui.moeSub.textContent = '串满啦';
  ui.milkBtn.classList.toggle('is-locked', count === 0);
  ui.milkBtn.classList.toggle('is-ready', count > 0 && !milk);
  ui.milkSub.textContent = count === 0 ? '最后再加' : '收尾！';
  let hint = '点「萌物」，把浪浪仙一颗颗串上签子';
  if (count > 0 && count < MAX_MOE) hint = '再串一颗，或铺「奶皮」收尾';
  if (count >= MAX_MOE) hint = '串满啦！最后铺上「奶皮」';
  if (state.finished) hint = '拖动 360° 转着看浪浪仙';
  if (ui.hint.textContent !== hint) {
    ui.hint.textContent = hint;
    ui.hint.classList.remove('bump');
    void ui.hint.offsetWidth;
    ui.hint.classList.add('bump');
  }
  ui.made.innerHTML = state.made > 0 ? `已做<br>${state.made} 串` : '';
}

let toastTimer = 0;
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1700);
}
function shake(btn) {
  btn.classList.remove('shake');
  void btn.offsetWidth;
  btn.classList.add('shake');
}

function addMoe() {
  if (!state.ready || state.finished || state.busy) return;
  if (state.milk) return;
  if (state.count >= MAX_MOE) {
    shake(ui.moeBtn);
    toast('签子串满啦～最后铺上奶皮吧');
    blip(300, 200, 0.12, 0.12);
    return;
  }
  const k = state.count;
  const head = model.heads[k];
  const slot = model.slotPos[k];
  const quat = model.slotQuat[k];
  const startY = model.tipY + 0.75;
  const spin = new THREE.Quaternion();
  const axisY = new THREE.Vector3(0, 1, 0);
  state.busy = true;
  state.count += 1;
  head.visible = true;
  head.position.set(slot.x, startY, slot.z);
  head.quaternion.copy(quat);
  head.scale.setScalar(0.001);
  blip(520, 880, 0.1, 0.16);

  tween(780, (p) => {
    if (p < 0.22) {                                     // pop in above the tip
      const e = easeOutBack(p / 0.22);
      head.scale.setScalar(Math.max(0.001, e));
      head.position.y = startY;
    } else {                                            // slide down the bamboo to its slot
      head.scale.setScalar(1);
      const q = (p - 0.22) / 0.78;
      const e = easeInQuad(q);
      head.position.y = startY + (slot.y - startY) * e;
      spin.setFromAxisAngle(axisY, (1 - easeOutCubic(q)) * Math.PI * 2);
      head.quaternion.copy(spin).multiply(quat);
    }
  }, () => {
    head.position.copy(slot);
    head.quaternion.copy(quat);
    blip(240, 130, 0.09, 0.22);
    burst(new THREE.Vector3(slot.x, slot.y, slot.z + 0.25), 14, 0.9, 700);
    tween(240, (p) => {                                 // squash on landing
      const s = Math.sin(p * Math.PI) * (1 - p);
      head.scale.set(1 + 0.10 * s, 1 - 0.12 * s, 1 + 0.10 * s);
    }, () => { head.scale.setScalar(1); state.busy = false; });
    refreshUi();
  });
  refreshUi();
}

function addMilk() {
  if (!state.ready || state.finished || state.busy) return;
  if (state.count === 0) {
    shake(ui.milkBtn);
    toast('先串上萌物哦，奶皮要最后加～');
    blip(300, 200, 0.12, 0.12);
    return;
  }
  state.busy = true;
  state.milk = true;
  const lastSlot = model.slotPos[state.count - 1];
  const needTop = lastSlot.y + 0.5 + 0.22;
  const targetY = Math.min(1, (needTop - model.milkMinY) / model.milkFullH);
  const pv = model.milkPivot;
  model.milk.visible = true;
  pv.scale.set(0.35, 0.01, 1);
  blip(330, 660, 0.25, 0.14);
  tween(820, (p) => {
    const e = easeOutBack(p);
    pv.scale.set(0.35 + 0.65 * Math.min(1, e), Math.max(0.01, targetY * e), 1);
  }, () => {
    pv.scale.set(1, targetY, 1);
    finish();
  });
  refreshUi();
}

async function saveFinishPhoto() {
  try {
    ui.saveTip.textContent = '正在准备图片…';
    const res = await fetch(FINISH_PHOTO_URL);
    const blob = await res.blob();
    const file = new File([blob], '浪浪仙冰糖葫芦.png', { type: blob.type || 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '浪浪仙冰糖葫芦' });
      ui.saveTip.textContent = '已打开保存/分享面板';
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '浪浪仙冰糖葫芦.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    ui.saveTip.textContent = '已开始下载，可在下载里找到';
  } catch (e) {
    ui.saveTip.textContent = e && e.name === 'AbortError' ? '已取消' : '这台设备不支持直接保存，长按图片保存哦';
  }
}
function showFinishModal() {
  ui.finishModal.classList.add('show');
  ui.finishModal.setAttribute('aria-hidden', 'false');
  ui.saveTip.textContent = '长按图片也可以保存哦';
}
function hideFinishModal() {
  ui.finishModal.classList.remove('show');
  ui.finishModal.setAttribute('aria-hidden', 'true');
}
function finish() {
  state.finished = true;
  state.busy = false;
  state.made += 1;
  try { localStorage.setItem('lxx-skewer-made', String(state.made)); } catch { /* ignore */ }
  if (state.sound) { ui.meow.currentTime = 0; ui.meow.play().catch(() => {}); }
  const top = model.slotPos[state.count - 1].y;
  for (let i = 0; i < 3; i++) {
    setTimeout(() => burst(new THREE.Vector3(0, (top * (i + 1)) / 3, 0.3), 26, 1.5, 1300), i * 140);
  }
  controls.autoRotate = !REDUCED;
  ui.spinBtn.textContent = controls.autoRotate ? '暂停旋转' : '自动旋转';
  ui.doneTitle.textContent = state.count === MAX_MOE ? '满满一串 · 浪浪仙 ×4' : `一串 · 浪浪仙 ×${state.count}`;
  ui.tray.style.visibility = 'hidden';
  ui.done.classList.add('show');
  ui.done.setAttribute('aria-hidden', 'false');
  ui.rotateTip.classList.add('show');
  setTimeout(() => ui.rotateTip.classList.remove('show'), 3200);
  showFinishModal();
  refreshUi();
}

ui.moeBtn.addEventListener('click', addMoe);
ui.milkBtn.addEventListener('click', addMilk);
ui.againBtn.addEventListener('click', () => { hideFinishModal(); resetBuild(true); });
ui.finishClose.addEventListener('click', hideFinishModal);
ui.finishModal.addEventListener('click', (e) => { if (e.target === ui.finishModal) hideFinishModal(); });
ui.saveBtn.addEventListener('click', saveFinishPhoto);
window.__saveFinishPhoto = saveFinishPhoto;
ui.spinBtn.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  ui.spinBtn.textContent = controls.autoRotate ? '暂停旋转' : '自动旋转';
});

// ------------------------------------------------------------------ loop
function frame(now) {
  if (!loader.done && loader.phase < 2 && now % 2 < 1) loader.tickTo(Math.min(0.88, loader.shown + 0.003));
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    const p = Math.min(1, (now - t.t0) / t.dur);
    t.update(p);
    if (p >= 1) { tweens.splice(i, 1); t.done && t.done(); }
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// QA hook
window.__game = { state, addMoe, addMilk, resetBuild, controls, camera, showFinishModal, hideFinishModal };
