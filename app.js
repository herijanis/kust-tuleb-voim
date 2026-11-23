(() => {
"use strict";
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const D = (d) => (RM ? 0.01 : d);
const $ = (q, r = document) => r.querySelector(q), $$ = (q, r = document) => [...r.querySelectorAll(q)];
const root = $("#root"), canvas = $("#gl");
const QS = new URLSearchParams(location.search);

/* ================= 3D (with a photo fallback if WebGL is missing or dies) ================= */
let HAS3D = !QS.has("no3d") && !!window.THREE;
let renderer, scene, camera, sun, hemi, rim;
try {
  if (HAS3D) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", failIfMajorPerformanceCaveat: false });
    if (!renderer.getContext()) throw new Error("no gl");
  }
} catch (e) { HAS3D = false; }

let PR = Math.min(1.5, window.devicePixelRatio || 1);
const L = [], lbls = $$(".lbl3");
const cam = { px: 0, py: 45, pz: 170, tx: 0, ty: 6, tz: 0, fov: 36 }, shake = { a: 0 };
const G = { x: 0, y: -260, z: -40 }, WALL = G.z - 9;
const PAINT = [{ img: "img/h_usa.jpg", x: -13 }, { img: "img/h_bastille.jpg", x: 0 }, { img: "img/ee.jpg", x: 13 }];
const puffs = [], rocks = [];
let shadowFrames = 0, canvasVisible = true, orbitOn = false, orbitA = 0;

function fitFov(v) { // keep the 16:9 horizontal framing on narrower screens (16:10, 4:3, 5:4) so nothing is cut off
  const a = camera.aspect, ref = 16 / 9; if (a >= ref) return v;
  return (Math.atan(Math.tan((v * Math.PI) / 360) * (ref / a)) * 360) / Math.PI;
}

if (HAS3D) try {
  renderer.setPixelRatio(PR);
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0xD99366);
  scene.fog = new THREE.Fog(HORIZON, 120, 420);
  camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 2000);
  // sky: raw colours, horizon == fog colour (r128 applies fog after encoding)
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 40, 20), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2B2E4C) }, mid: { value: new THREE.Color(0xB06B5E) }, bot: { value: HORIZON }, sunDir: { value: new THREE.Vector3(-0.55, 0.1, -0.83).normalize() } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top, mid, bot, sunDir; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.2 ? mix(mid, top, smoothstep(0.2, 0.8, h)) : mix(bot, mid, smoothstep(0.0, 0.2, h)); float s = max(dot(vP, sunDir), 0.0); c += vec3(1.0,0.75,0.45) * (pow(s, 40.0) * 0.8 + pow(s, 6.0) * 0.18) * smoothstep(0.0, 0.1, h); gl_FragColor = vec4(c, 1.0); }" })));
  hemi = new THREE.HemisphereLight(0xFFE3C4, 0x5A4532, 0.8); scene.add(hemi);
  sun = new THREE.DirectionalLight(0xFFC892, 2.3); sun.position.set(-80, 55, 70); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 40, bottom: -40, near: 1, far: 260 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; sun.shadow.radius = 2.5;
  scene.add(sun);
  rim = new THREE.DirectionalLight(0xFF9A6A, 0.55); rim.position.set(60, 20, -80); scene.add(rim);
  // ground
  const gc = document.createElement("canvas"); gc.width = gc.height = 512; { const x = gc.getContext("2d"); x.fillStyle = "#7A5A36"; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) { x.fillStyle = `hsla(${28 + Math.random() * 14},${40 + Math.random() * 25}%,${22 + Math.random() * 30}%,${0.25 + Math.random() * 0.4})`; x.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 3 + Math.random() * 7); } }
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(70, 70); gt.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); gt.encoding = THREE.sRGBEncoding;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshStandardMaterial({ map: gt, roughness: 1, color: 0xC9A47A }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  buildDust(); buildGallery();
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); goFlat(); });
} catch (e) { console.error(e); HAS3D = false; }

/* ---------- dust + debris (pooled) ---------- */
function buildDust() {
  const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(230,196,150,0.9)"); g.addColorStop(0.5, "rgba(210,170,120,0.35)"); g.addColorStop(1, "rgba(200,160,110,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  for (let i = 0; i < 120; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; scene.add(sp); puffs.push({ sp, life: 0, v: new THREE.Vector3(), s: 1 }); }
  const rg = new THREE.DodecahedronGeometry(0.2), rm = new THREE.MeshStandardMaterial({ color: 0x5B4632, roughness: 1 });
  for (let i = 0; i < 40; i++) { const r = new THREE.Mesh(rg, rm); r.visible = false; scene.add(r); rocks.push({ r, v: new THREE.Vector3(), life: 0 }); }
}
function burstDust(x, z, radius) {
  let n = 0;
  for (const p of puffs) { if (p.life > 0) continue; const a = Math.random() * Math.PI * 2, d = radius * (0.6 + Math.random() * 0.5);
    p.sp.position.set(x + Math.cos(a) * d, 0.6 + Math.random(), z + Math.sin(a) * d); p.v.set(Math.cos(a) * (0.03 + Math.random() * 0.05), 0.02 + Math.random() * 0.04, Math.sin(a) * (0.03 + Math.random() * 0.05)); p.s = 2.5 + Math.random() * 3; p.life = 1; p.sp.visible = true; if (++n > 12) break; }
  n = 0;
  for (const q of rocks) { if (q.life > 0) continue; const a = Math.random() * Math.PI * 2; q.r.position.set(x + Math.cos(a) * radius * 0.8, 0.3, z + Math.sin(a) * radius * 0.8); q.v.set(Math.cos(a) * (0.05 + Math.random() * 0.1), 0.16 + Math.random() * 0.2, Math.sin(a) * (0.05 + Math.random() * 0.1)); q.life = 1; q.r.visible = true; if (++n > 4) break; }
}
function stepDust(dt) {
  const k = dt * 60;
  for (const p of puffs) if (p.life > 0) { p.life -= 0.008 * k; p.sp.position.addScaledVector(p.v, k); p.v.multiplyScalar(Math.pow(0.985, k)); p.s += 0.05 * k; p.sp.scale.setScalar(p.s); p.sp.material.opacity = Math.max(0, p.life) * 0.7; if (p.life <= 0) p.sp.visible = false; }
  for (const q of rocks) if (q.life > 0) { q.life -= 0.012 * k; q.r.position.addScaledVector(q.v, k); q.v.y -= 0.012 * k; q.r.rotation.x += 0.2 * k; if (q.r.position.y < 0.15) { q.r.position.y = 0.15; q.v.multiplyScalar(0.4); } if (q.life <= 0) q.r.visible = false; }
}

/* ---------- landmarks ---------- */
const SPOTS = [{ file: "models/cap.glb", x: -24, z: 0, w: 22, ry: 0.25 }, { file: "models/bas.glb", x: 0, z: -7, w: 17, ry: 0 }, { file: "models/too.glb", x: 24, z: 0, w: 20, ry: -0.25 }];
function placeModel(gltf, s) {
  const m = gltf.scene;
  m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; const mt = o.material; if (mt) { mt.side = THREE.FrontSide; mt.metalness = 0; mt.roughness = 0.88; if (mt.map) mt.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); } } });
  const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = s.w / Math.max(size.x, size.z); m.scale.setScalar(k); m.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  const g = new THREE.Group(); g.add(m); g.position.set(s.x, 0, s.z); g.rotation.y = s.ry; scene.add(g);
  g.userData.h = size.y * k; g.position.y = -g.userData.h - 1.5; g.visible = false; return g;
}

/* ---------- the gallery (underground, inside the "Capitol") ---------- */
function buildGallery() {
  const gal = new THREE.Group(); gal.position.set(G.x, G.y, G.z); scene.add(gal);
  const nf = (m) => { m.fog = false; return m; };
  const wc = document.createElement("canvas"); wc.width = wc.height = 512; { const x = wc.getContext("2d"); for (let i = 0; i < 8; i++) { x.fillStyle = `hsl(24,${38 + (i % 3) * 6}%,${20 + (i % 2) * 4}%)`; x.fillRect(0, i * 64, 512, 64); x.fillStyle = "rgba(0,0,0,.25)"; x.fillRect(0, i * 64, 512, 2); } for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${60 + Math.random() * 40},${35 + Math.random() * 20},20,.18)`; x.fillRect(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 120, 1); } }
  const wt = new THREE.CanvasTexture(wc); wt.wrapS = wt.wrapT = THREE.RepeatWrapping; wt.repeat.set(5, 3); wt.encoding = THREE.sRGBEncoding;
  const room = new THREE.Mesh(new THREE.BoxGeometry(50, 15, 30), [0, 1, 2, 3, 4, 5].map((i) => nf(i === 3 ? new THREE.MeshStandardMaterial({ map: wt, roughness: 0.55, side: THREE.BackSide }) : new THREE.MeshStandardMaterial({ color: i === 2 ? 0x0E0807 : 0x2A100E, roughness: 0.95, side: THREE.BackSide }))));
  room.position.set(0, 7.5, 6); gal.add(room);
  const trim = nf(new THREE.MeshStandardMaterial({ color: 0x2A1A14, roughness: 0.7 }));
  const wain = new THREE.Mesh(new THREE.BoxGeometry(50, 2.6, 0.3), trim); wain.position.set(0, 1.3, -8.85); gal.add(wain);
  const gold = nf(new THREE.MeshStandardMaterial({ color: 0xB8873E, metalness: 0.45, roughness: 0.4 }));
  const tl = new THREE.TextureLoader();
  PAINT.forEach((p) => {
    p.w = 8; p.h = 5.6;
    const mat = nf(new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.3 }));
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); plane.position.set(p.x, 6, -8.68); plane.scale.set(p.w, p.h, 1); gal.add(plane);
    const frame = new THREE.Group(); gal.add(frame);
    const makeFrame = () => { frame.clear(); const { w, h } = p; [[0, h / 2 + 0.3, w + 1.2, 0.6], [0, -h / 2 - 0.3, w + 1.2, 0.6], [-w / 2 - 0.3, 0, 0.6, h], [w / 2 + 0.3, 0, 0.6, h]].forEach(([fx, fy, fw, fh]) => { const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.4), gold); f.position.set(p.x + fx, 6 + fy, -8.6); frame.add(f); }); };
    makeFrame();
    tl.load(p.img, (t) => { t.encoding = THREE.sRGBEncoding; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); const a = t.image.width / t.image.height; p.h = 5.6; p.w = Math.min(9.6, p.h * a); plane.scale.set(p.w, p.h, 1); mat.color.set(0xffffff); mat.map = t; mat.emissiveMap = t; mat.needsUpdate = true; makeFrame(); });
    const sp = new THREE.SpotLight(0xFFD7A8, 2.6, 30, 0.4, 0.5, 1.0); sp.position.set(p.x, 13.5, -2.5); sp.target.position.set(p.x, 6, -8.8); gal.add(sp); gal.add(sp.target);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.9, 1.4), trim); bench.position.set(p.x, 0.45, -1); gal.add(bench);
  });
  const pl = new THREE.PointLight(0xFFB27A, 0.5, 60); pl.position.set(0, 11, 8); gal.add(pl);
}
// gallery camera poses: wide shot of a painting (painting sits right of the text panel) / painting fills the whole screen
function galPose() { return [G.x, G.y + 2.6, G.z + 22, G.x, G.y + 2.2, WALL, 40]; }
function coverPose(i) {
  const p = PAINT[i], x = G.x + p.x, y = G.y + 6, v = (fitFov(40) * Math.PI) / 180, hz = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  const d = Math.min(p.h / 2 / Math.tan(v / 2), p.w / 2 / Math.tan(hz / 2)) * 0.97;
  return [x, y, -8.68 + G.z + d, x, y, WALL, 40];
}

/* ---------- camera ---------- */
const POSES = {
  title: [0, 8, 92, 0, 14.5, 0, 34], golden: [-60, 26, 58, 2, 7, 0, 34], orbit: [0, 26, 74, 0, 6, 0, 36], end: [0, 8, 92, 0, 14.5, 0, 34],
};
const PV = (p, dur, ease) => ({ px: p[0], py: p[1], pz: p[2], tx: p[3], ty: p[4], tz: p[5], fov: p[6], duration: D(dur), ease });
const setCam = (p) => Object.assign(cam, { px: p[0], py: p[1], pz: p[2], tx: p[3], ty: p[4], tz: p[5], fov: p[6] });

/* ---------- render loop: only draws while the 3D is on screen; drops resolution on slow PCs ---------- */
const v3 = HAS3D ? new THREE.Vector3() : null;
let last = performance.now(), slowAcc = 0, slowN = 0, t = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!HAS3D || !canvasVisible) return;
  try {
    t += dt; const dr = RM ? 0 : 1;
    if (orbitOn) { orbitA += 0.07 * dt * dr; cam.px = Math.sin(orbitA) * 74; cam.pz = Math.cos(orbitA) * 74; }
    const a = shake.a;
    camera.position.set(cam.px + Math.sin(t * 0.17) * 0.9 * dr + (Math.random() - 0.5) * a, cam.py + Math.sin(t * 0.23) * 0.35 * dr + (Math.random() - 0.5) * a * 0.6, cam.pz + Math.cos(t * 0.13) * 0.8 * dr);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    const f = fitFov(cam.fov); if (Math.abs(camera.fov - f) > 0.001) { camera.fov = f; camera.updateProjectionMatrix(); }
    const inside = camera.position.y < -120; sun.intensity = inside ? 0 : 2.3; rim.intensity = inside ? 0 : 0.55; hemi.intensity = inside ? 0.22 : 0.8;
    stepDust(dt);
    if (shadowFrames > 0) { renderer.shadowMap.needsUpdate = true; shadowFrames--; }
    renderer.render(scene, camera);
    L.forEach((g, i) => { const el = lbls[i]; if (!el || !g) return; v3.set(g.position.x + Math.sin(g.rotation.y) * 9, g.position.y - 1.2, g.position.z + Math.cos(g.rotation.y) * 9).project(camera);
      const off = v3.z > 1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1; el.style.visibility = off ? "hidden" : "visible";
      el.style.transform = `translate(${((v3.x + 1) / 2) * innerWidth}px,${((1 - v3.y) / 2) * innerHeight}px) translate(-50%,0)`; });
    // adaptive quality: if frames are slow for ~2 s, lower the resolution (twice at most)
    slowAcc += dt; slowN++;
    if (slowN >= 120) { const avg = slowAcc / slowN; slowAcc = 0; slowN = 0;
      if (avg > 0.026 && PR > 0.75) { PR = PR > 1 ? 1 : 0.75; renderer.setPixelRatio(PR); resize(); } }
  } catch (e) { console.error(e); goFlat(); }
}
function shadowsFor(sec) { shadowFrames = Math.max(shadowFrames, Math.round(sec * 60)); }

/* ================= layout ================= */
function resize() {
  const w = innerWidth, h = innerHeight; const S = Math.min(w / 1600, h / 900); root.style.transform = `scale(${S})`;
  if (HAS3D) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); shadowsFor(0.1); }
}
addEventListener("resize", resize); resize();

/* ================= photo layers ================= */
const BG = {}; $$(".bg").forEach((el) => (BG[el.id.slice(3)] = el));
let curBg = null; const drift = new Map();
function kenBurns(el) { drift.get(el)?.kill(); if (RM) return; drift.set(el, gsap.to(el, { scale: 1.0, xPercent: (Math.random() < 0.5 ? -1 : 1) * 0.8, duration: 18, ease: "sine.inOut" })); }
function photo(name, d = 1.4) {
  const el = BG[name]; if (el === curBg && +gsap.getProperty(el, "opacity") > 0.5) return; const old = curBg; curBg = el;
  ["splitL", "splitR"].forEach((n) => BG[n] !== el && gsap.to(BG[n], { opacity: 0, duration: D(d * 0.7), ease: "power2.inOut", overwrite: true }));
  if (old && old !== el) { drift.get(old)?.kill(); gsap.to(old, { opacity: 0, scale: 1.1, duration: D(d), ease: "power2.inOut", overwrite: true }); }
  drift.get(el)?.kill();
  gsap.fromTo(el, { opacity: 0, scale: 1.12, xPercent: 0 }, { opacity: 1, scale: 1.05, duration: D(d * 1.25), ease: "power3.out", overwrite: true, onComplete: () => kenBurns(el) });
}
function photosOff(d = 1.2) { Object.values(BG).forEach((el) => { if (+gsap.getProperty(el, "opacity") > 0) { drift.get(el)?.kill(); gsap.to(el, { opacity: 0, duration: D(d), ease: "power2.inOut", overwrite: true }); } }); curBg = null; }
function split() {
  const old = curBg; curBg = null; if (old) { drift.get(old)?.kill(); gsap.to(old, { opacity: 0, scale: 1.1, duration: D(1.1), ease: "power2.inOut", overwrite: true }); }
  gsap.fromTo(BG.splitL, { opacity: 1, xPercent: 0, clipPath: "polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)", scale: 1.12 }, { clipPath: "polygon(0% 0%, 54% 0%, 46% 100%, 0% 100%)", scale: 1.03, duration: D(1.5), delay: D(0.15), ease: "expo.inOut", overwrite: true });
  gsap.fromTo(BG.splitR, { opacity: 1, xPercent: 0, clipPath: "polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)", scale: 1.12 }, { clipPath: "polygon(54.25% 0%, 100% 0%, 100% 100%, 46.25% 100%)", scale: 1.03, duration: D(1.5), delay: D(0.3), ease: "expo.inOut", overwrite: true });
}
function canvasOn(on, d = 1.0) { if (!HAS3D) return; if (on) canvasVisible = true; gsap.to(canvas, { opacity: on ? 1 : 0, duration: D(d), ease: "power2.inOut", overwrite: true, onComplete: () => { if (!on) canvasVisible = false; } }); }
const dimTo = (v, d = 1.1) => gsap.to("#dimmer", { opacity: v, duration: D(d), ease: "power2.inOut", overwrite: true });
const shade = (l, tp, d = 1.1) => { gsap.to("#shadeL", { opacity: l, duration: D(d), ease: "power2.inOut", overwrite: true }); gsap.to("#shadeT", { opacity: tp, duration: D(d), ease: "power2.inOut", overwrite: true }); };

// WebGL broke (or is missing): carry on with photos only
function goFlat() {
  if (!HAS3D) return; HAS3D = false; canvasVisible = false; gsap.killTweensOf(cam); gsap.set(canvas, { opacity: 0 }); gsap.set(lbls, { opacity: 0 });
  if (cur >= 0) { const [si, k] = steps[cur]; world(si, k, null, false, true); }
}

/* ================= text ================= */
const scenes = $$(".scene");
$$(".split").forEach((el) => { const walk = (node) => [...node.childNodes].forEach((n) => { if (n.nodeType === 3) { const f = document.createDocumentFragment(); n.textContent.split(/(\s+)/).forEach((w) => { if (!w) return; if (/^\s+$/.test(w)) f.append(w); else { const o = document.createElement("span"); o.className = "w"; const i = document.createElement("span"); i.textContent = w; o.append(i); f.append(o); } }); n.replaceWith(f); } else walk(n); }); walk(el); });
function showEl(el, delay = 0) {
  if (el.classList.contains("custom")) return; gsap.killTweensOf(el);
  if (el.classList.contains("split")) { gsap.set(el, { opacity: 1, y: 0 }); gsap.fromTo(el.querySelectorAll(".w>span"), { yPercent: 112 }, { yPercent: 0, duration: D(1.15), delay: D(delay), stagger: 0.06, ease: "expo.out", overwrite: true }); return; }
  const from = el.dataset.from === "left" ? { x: -60, y: 0 } : el.dataset.from === "right" ? { x: 60, y: 0 } : { x: 0, y: 34 };
  gsap.fromTo(el, { opacity: 0, ...from }, { opacity: 1, x: 0, y: 0, duration: D(1.0), delay: D(delay), ease: "expo.out" });
}
function hideEl(el, delay = 0) { gsap.killTweensOf(el); if (el.classList.contains("split")) gsap.killTweensOf(el.querySelectorAll(".w>span")); gsap.to(el, { opacity: 0, y: -20, duration: D(0.45), delay: D(delay), ease: "power2.in" }); }
const steps = []; scenes.forEach((s, i) => { for (let k = 0; k < +s.dataset.steps; k++) steps.push([i, k]); });
let cur = -1, autos = [];
const els = (s, f) => $$("[data-s]", s).filter(f);
const hooks = {
  4(k) {
    const cards = $$(".src", scenes[4]), pr = $("#principle");
    if (k >= 1) gsap.to(cards, { x: (i) => (1 - i) * 480, scale: 0.4, opacity: 0, duration: D(0.9), ease: "power3.in", stagger: 0.05, overwrite: true });
    else gsap.to(cards, { x: 0, scale: 1, opacity: 1, duration: D(0.9), ease: "expo.out", overwrite: true });
    const pin = $("#prIn");
    if (k === 0) gsap.to(pin, { opacity: 0, scale: 0.6, duration: D(0.5), overwrite: true });
    else if (+gsap.getProperty(pin, "opacity") < 0.99 && k === 1) gsap.fromTo(pin, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: D(1.3), delay: D(0.6), ease: "expo.out", overwrite: true });
    else gsap.to(pin, { opacity: 1, scale: 1, duration: D(0.6), overwrite: true });
    gsap.set(pr, { opacity: 1 });
    gsap.to(pr, { top: k >= 2 ? 236 : 300, scale: k >= 2 ? 0.72 : 1, duration: D(1.2), ease: "expo.inOut", overwrite: true });
    gsap.to("#strike i", { scaleX: k >= 4 ? 1 : 0, duration: D(0.8), ease: "power3.inOut", delay: k >= 4 ? 0.4 : 0 });
  },
  5(k) { gsap.to("#flowline", { strokeDashoffset: 1420 - Math.min(k, 3) * (1410 / 3) - 10, duration: D(1.3), ease: "expo.inOut" }); },
  6(k) {
    $$(".flip", scenes[6]).forEach((c) => { const on = k >= +c.dataset.flip, th = $(".then", c), nw = $(".now", c);
      gsap.to(th, { opacity: on ? 0 : 1, y: on ? -24 : 0, duration: D(0.55), ease: "power2.inOut", overwrite: true });
      gsap.to(nw, { opacity: on ? 1 : 0, y: on ? 0 : 24, duration: D(0.9), delay: on ? 0.2 : 0, ease: "expo.out", overwrite: true }); });
  },
};

/* ================= scenes: what the camera / picture does ================= */
let wtl = null; // the running world timeline (killed when a new one starts, so clicks never pile up)
function newTL() { if (wtl) wtl.kill(); gsap.killTweensOf(cam); gsap.killTweensOf("#fade"); wtl = gsap.timeline(); return wtl; }
// a soft dip to dark: hides a camera cut, never a hard jump
function dipCut(tl, fn, out = 0.5, inn = 1.0) { tl.to("#fade", { opacity: 1, duration: D(out), ease: "power2.in" }).call(fn).to("#fade", { opacity: 0, duration: D(inn), ease: "power2.out" }); return tl; }
const INSIDE = (si) => si >= 1 && si <= 5;

function world(si, k, prev, back, instant) {
  const from = prev ? prev[0] : -1;
  orbitOn = false;
  gsap.to(lbls, { opacity: HAS3D && (si === 0 || si === 8) ? 1 : 0, duration: D(0.8), overwrite: true });
  shade(0, si >= 2 && si <= 7 ? 1 : 0);
  dimTo({ 1: HAS3D ? 0 : 0.35, 2: 0.5, 3: 0.12, 4: 0.3, 5: 0.25, 6: 0.32, 7: 0.5 }[si] || 0);

  if (!HAS3D) { // photo-only mode
    const n = [["plain"], ["plain"], ["ee"], null, ["vote"], ["court"], ["plain"], ["plain"], ["plain"]][si];
    if (si === 3) split(); else photo(n[Math.min(k, n.length - 1)], instant ? 0.01 : 1.4);
    return;
  }
  if (si === 0 || si >= 6) { // outside: the 3D town
    const pose = POSES[si === 0 ? "title" : si === 6 ? "golden" : si === 7 ? "orbit" : "end"];
    const tl = newTL();
    if (INSIDE(from)) {
      const comingFromPhoto = from >= 2;
      if (comingFromPhoto) { setCam([pose[0] * 1.6, pose[1] + 70, pose[2] * 1.9, pose[3], pose[4], pose[5], pose[6]]); canvasOn(true, 1.3); photosOff(1.3); tl.to(cam, PV(pose, 3.4, "expo.inOut"), 0.05); }
      else dipCut(tl, () => { setCam([pose[0], pose[1] + 30, pose[2] + 60, pose[3], pose[4], pose[5], pose[6]]); }).to(cam, PV(pose, 3.0, "expo.out"), "<");
    } else if (prev) { canvasOn(true, 1.0); photosOff(1.0); tl.to(cam, PV(pose, 3.0, "expo.inOut"), 0); }
    if (si === 7) tl.call(() => { orbitOn = true; orbitA = Math.atan2(cam.px, cam.pz); });
    return;
  }
  if (si === 1) { // inside the gallery
    photosOff(0.8); canvasOn(true, 0.8);
    const tl = newTL();
    if (from === 0) { // glide toward the Capitol, dip, open inside the hall
      const g = L[0]; const box = g ? new THREE.Box3().setFromObject(g) : null; const cx = box ? (box.min.x + box.max.x) / 2 : -24, cz = box ? box.max.z : 8, cy = g ? Math.min(9, g.userData.h * 0.45) : 6;
      tl.to(cam, PV([cx + 2, cy, cz + 20, cx, cy, cz - 6, 30], 1.5, "power2.in"))
        .to("#fade", { opacity: 1, duration: D(0.55), ease: "power2.in" }, "-=0.55")
        .call(() => setCam([G.x - 6, G.y + 5, G.z + 30, G.x, G.y + 3.5, WALL, 46]))
        .to("#fade", { opacity: 0, duration: D(1.0), ease: "power2.out" })
        .to(cam, PV(galPose(k), 2.6, "expo.out"), "<");
    } else if (from === 2) { // coming back out of the painting
      setCam(coverPose(2)); tl.to(cam, PV(galPose(k), 2.4, "expo.inOut"), 0.1);
    } else dipCut(tl, () => setCam(galPose(k)));
    return;
  }
  if (si === 2 && from === 1 && !back) { // dive into the Toompea painting: it fills the screen, then becomes the real scene
    const tl = newTL(), el = BG.ee;
    drift.get(el)?.kill(); gsap.killTweensOf(el); gsap.set(el, { opacity: 0, scale: 1.0, xPercent: 0 }); curBg = el;
    dimTo(0, 0.3);
    tl.to(cam, PV(coverPose(2), 1.9, "power3.inOut"))
      .to(el, { opacity: 1, duration: D(0.7), ease: "power1.inOut" }, "-=0.35")
      .call(() => canvasOn(false, 0.01))
      .to(el, { scale: 1.06, duration: D(2.4), ease: "power2.out", onComplete: () => kenBurns(el) }, "<0.3")
      .to("#dimmer", { opacity: 0.5, duration: D(1.2), ease: "power2.inOut" }, "<");
    return;
  }
  // photo worlds
  if (wtl) { wtl.kill(); wtl = null; }
  canvasOn(false, 1.0);
  if (si === 3) split(); else photo({ 2: "ee", 4: "vote", 5: "court" }[si]);
}

function go(n) {
  if (n < 0 || n >= steps.length || n === cur) return;
  const back = n < cur, [si, k] = steps[n], prev = cur >= 0 ? steps[cur] : null; cur = n;
  const s = scenes[si];
  if (!prev || prev[0] !== si) {
    if (prev) { const ps = scenes[prev[0]]; els(ps, (e) => +gsap.getProperty(e, "opacity") > 0).forEach((e, i) => hideEl(e, i * 0.02)); gsap.delayedCall(D(0.5), () => cur >= 0 && steps[cur][0] !== prev[0] && ps.classList.remove("on")); }
    s.classList.add("on");
    els(s, (e) => +e.dataset.s > k).forEach((e) => { gsap.killTweensOf(e); gsap.set(e, { opacity: 0 }); });
    const from = prev ? prev[0] : -1;
    const wait = !prev ? 1.2 : !HAS3D ? 0.6 : si === 1 && from === 0 ? 2.2 : si === 2 && from === 1 && !back ? 2.0 : 0.7;
    world(si, k, prev, back);
    // everything inside the slide plays by itself, one part after another (one click per slide)
    autos.forEach((a) => a.kill()); autos = [];
    els(s, (e) => +e.dataset.s > 0).forEach((e) => { gsap.killTweensOf(e); gsap.set(e, { opacity: 0 }); });
    const at = (s.dataset.at || "0").split(",").map(Number);
    at.forEach((t, kk) => autos.push(gsap.delayedCall(D(wait + t), () => {
      els(s, (e) => +e.dataset.s === kk).forEach((e, i) => showEl(e, i * 0.07));
      if (hooks[si]) hooks[si](kk, false);
    })));
    if (hooks[si]) hooks[si](0, false);
  }
  $("#bar i").style.width = ((n + 1) / steps.length) * 100 + "%";
  $("#count").textContent = "SLAID " + (si + 1) + " / " + scenes.length;
  $("#notes").textContent = s.dataset.notes || "";
}
const next = () => go(cur + 1), prevStep = () => go(cur - 1);
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { if (e.target.closest && e.target.closest(".opt")) return; e.preventDefault(); next(); }
  else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); prevStep(); }
  else if (e.key === "n" || e.key === "N") toggleNotes(); else if (e.key === "f" || e.key === "F") full();
});
document.addEventListener("click", (e) => { if (e.target.closest("button,a,#notes")) return; next(); });
let tx0 = null; addEventListener("touchstart", (e) => (tx0 = e.touches[0].clientX), { passive: true });
addEventListener("touchend", (e) => { if (tx0 == null) return; const d = e.changedTouches[0].clientX - tx0; if (Math.abs(d) > 50) (d < 0 ? next : prevStep)(); tx0 = null; });
$("#bNext").onclick = next; $("#bPrev").onclick = prevStep;
function toggleNotes() { const n = $("#notes"); n.hidden = !n.hidden; }
$("#bNotes").onclick = toggleNotes;
function full() { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}); } catch (_) {} }
$("#bFull").onclick = full;
$$(".quiz").forEach((q) => {
  const ok = +q.dataset.ok, fb = $(".fb", q);
  $$(".opt", q).forEach((b, i) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (i === ok) {
      $$(".opt", q).forEach((o) => o.classList.remove("bad")); b.classList.add("good"); fb.textContent = fb.dataset.good; fb.style.color = "var(--sage)";
      gsap.fromTo(b, { scale: 0.95 }, { scale: 1, duration: D(0.9), ease: "elastic.out(1,0.5)" });
      const r = b.getBoundingClientRect();
      for (let j = 0; j < 22; j++) { const d = document.createElement("i"); d.style.cssText = `position:fixed;width:10px;height:10px;border-radius:50%;pointer-events:none;z-index:8;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;background:${["#A6C691", "#E8B970", "#E0846A", "#9DBBE0"][j % 4]}`; document.body.append(d);
        const a = (j / 22) * Math.PI * 2, dist = 90 + Math.random() * 100; gsap.to(d, { x: Math.cos(a) * dist, y: Math.sin(a) * dist - 30, opacity: 0, scale: 0.4, duration: D(1.1), ease: "power3.out", onComplete: () => d.remove() }); }
    } else {
      b.classList.add("bad"); fb.textContent = "Vale, proovi uuesti!"; fb.style.color = "var(--wrong)";
      gsap.fromTo(b, { x: -12 }, { x: 0, duration: D(0.6), ease: "elastic.out(1.2,0.3)" });
      setTimeout(() => b.classList.remove("bad"), 1400);
    }
  }));
});

/* ================= boot ================= */
$$("[data-s]").forEach((e) => gsap.set(e, { opacity: 0 }));
gsap.set($$(".pane", scenes[1]), { display: "none" }); gsap.set("#prIn", { opacity: 0 }); gsap.set(lbls, { opacity: 0 });
window.__dbg = { get cam() { return cam; }, get scene() { return scene; }, get camera() { return camera; } };
requestAnimationFrame(frame);
const bar = $("#load .tr i");
let started = false;
function riseIntro() {
  const tl = gsap.timeline({ delay: D(0.5) });
  L.forEach((g, i) => {
    if (!g) return; const at = i * 0.9; g.visible = true;
    if (RM) { g.position.y = 0; return; }
    tl.to(shake, { a: 0.45, duration: 0.25, ease: "power2.out" }, at)
      .to(g.position, { y: 0, duration: 2.8, ease: "power4.out", onUpdate: () => shadowsFor(0.05) }, at)
      .to(shake, { a: 0, duration: 2.2, ease: "power2.out" }, at + 0.35)
      .call(() => { let n = 0; const iv = setInterval(() => { burstDust(g.position.x, g.position.z, SPOTS[i].w * 0.55); if (++n > 5) clearInterval(iv); }, 160); }, null, at);
  });
  tl.call(() => shadowsFor(0.5));
}
function start() {
  if (started) return; started = true;
  const ld = $("#load"); ld.style.opacity = 0; setTimeout(() => ld.remove(), 900);
  go(0);
  if (HAS3D) { L.forEach((g) => g && (g.visible = true)); setCam([0, 40, 170, 0, 8, 0, 36]); wtl = gsap.timeline().to(cam, PV(POSES.title, 4.0, "power3.out")); riseIntro(); shadowsFor(1); }
  gsap.to("#hint", { opacity: 1, duration: 0.8, delay: 4.5 }); gsap.to("#hint", { opacity: 0, duration: 0.8, delay: 11 });
}
if (HAS3D && THREE.GLTFLoader) {
  const loader = new THREE.GLTFLoader();
  if (window.MeshoptDecoder && loader.setMeshoptDecoder) loader.setMeshoptDecoder(MeshoptDecoder);
  const prog = SPOTS.map(() => 0); let done = 0;
  const finish = () => { if (++done === SPOTS.length) (window.MeshoptDecoder && MeshoptDecoder.ready ? MeshoptDecoder.ready : Promise.resolve()).then(() => setTimeout(start, 150)); };
  SPOTS.forEach((s, i) => loader.load(s.file, (g) => { try { L[i] = placeModel(g, s); } catch (e) { console.error(e); } prog[i] = 1; finish(); },
    (x) => { if (x.total) { prog[i] = x.loaded / x.total; bar.style.width = (prog.reduce((a, b) => a + b, 0) / SPOTS.length) * 100 + "%"; } },
    (e) => { console.error(e); prog[i] = 1; finish(); }));
  setTimeout(start, 15000);
} else { gsap.to(bar, { width: "100%", duration: 0.4 }); setTimeout(start, 500); }
})();
