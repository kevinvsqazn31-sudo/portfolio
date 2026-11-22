// Mar de Fondo · océano en tiempo real con ola rompiente y surfista (Three.js, WebGL2)
// Contrato de threejs-water-optics: una sola lista de olas (Gerstner + ola de la serie) alimenta
// desplazamiento, normal analítica, métrica de cresta/espuma y la altura en CPU que usa el surfista.
import * as THREE from 'three';

const canvas = document.getElementById('sea');
const coarse = matchMedia('(pointer: coarse)').matches;
const small = matchMedia('(max-width: 760px)').matches;
const lowTier = coarse || small;

function webglOK() { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } }
if (!webglOK()) { document.documentElement.classList.add('no-webgl'); throw new Error('Sin WebGL2: fondo estático'); }

// ---------- utilidades ----------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const damp = THREE.MathUtils.damp;
function keys(list) {
  return (p) => {
    if (p <= list[0][0]) return list[0][1];
    for (let i = 0; i < list.length - 1; i++) {
      const [pa, a] = list[i], [pb, b] = list[i + 1];
      if (p <= pb) { const t = sstep(pa, pb, p); return typeof a === 'number' ? lerp(a, b, t) : a.clone().lerp(b, t); }
    }
    return list[list.length - 1][1];
  };
}
const C = (h) => new THREE.Color(h);
const V3 = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

// ---------- estado del mar (historia p 0..1; después, modo surf al amanecer) ----------
const S = {
  zenith: keys([[0, C('#03070d')], [0.4, C('#050c16')], [0.72, C('#0b1624')], [1, C('#17263d')]]),
  horizon: keys([[0, C('#0c1823')], [0.4, C('#11222f')], [0.72, C('#2c4153')], [1, C('#9a5a3e')]]),
  deep: keys([[0, C('#010509')], [0.4, C('#02080d')], [0.72, C('#041019')], [1, C('#051a22')]]),
  scatter: keys([[0, C('#0b3138')], [0.4, C('#0c3a44')], [0.72, C('#11505a')], [1, C('#2a6f6a')]]),
  sunCol: keys([[0, C('#000000')], [0.62, C('#000000')], [0.8, C('#c4552a')], [1, C('#e8a36c')]]),
  sunDir: keys([[0, V3(0.15, -0.3, -1)], [0.7, V3(0.28, -0.08, -1)], [1, V3(0.3, 0.035, -1)]]),
  moon: keys([[0, 1], [0.55, 0.85], [0.8, 0], [1, 0]]),
  stars: keys([[0, 0.55], [0.4, 1], [0.7, 0.35], [0.85, 0]]),
  light: keys([[0, 0], [0.45, 0], [0.58, 1], [0.86, 1], [0.97, 0]]),
  amp: keys([[0, 2.3], [0.4, 2.0], [0.72, 1.9], [1, 1.6]]),
  len: keys([[0, 0.72], [0.4, 1.25], [0.72, 1.3], [1, 1.25]]),
  chop: keys([[0, 1.35], [0.4, 0.6], [0.72, 0.55], [1, 0.5]]),
  foam: keys([[0, 0.62], [0.4, 0.4], [0.72, 0.34], [1, 0.32]]),
  fog: keys([[0, 0.0065], [0.4, 0.0042], [0.72, 0.0036], [1, 0.0026]]),
  camY: keys([[0, 16], [0.25, 9], [0.45, 4.2], [0.7, 2.6], [0.88, 3.2], [1, 6]]),
  pitch: keys([[0, -0.16], [0.45, -0.05], [0.7, 0.0], [1, 0.03]]),
  exposure: keys([[0, 1.0], [0.72, 1.05], [1, 0.95]]),
};

// ---------- olas de fondo (12 bandas) ----------
const WAVES = [
  [8, 64, 1.0, 0.5, 0], [-15, 45, 0.62, 0.5, 0], [27, 33, 0.42, 0.48, 0], [-34, 23, 0.28, 0.45, 1],
  [50, 15.5, 0.17, 0.42, 1], [-61, 10.5, 0.11, 0.38, 1], [74, 6.8, 0.065, 0.32, 1], [-83, 4.4, 0.04, 0.28, 1],
  [18, 3.1, 0.028, 0.26, 1], [-41, 2.3, 0.02, 0.22, 1], [63, 1.6, 0.013, 0.2, 1], [-12, 1.15, 0.009, 0.18, 1],
];
const N = WAVES.length;
const waveVec = Array.from({ length: N }, () => new THREE.Vector4());
const waveQ = new Float32Array(N);
function updateWaves(amp, len, chop) {
  WAVES.forEach(([deg, lam, a, q, shortBand], i) => {
    const r = THREE.MathUtils.degToRad(deg + 180);
    const L = lam * len;
    let A = amp * a * (shortBand ? chop : 1) * (lam / 64) ** 0.35;
    const k = (2 * Math.PI) / L;
    A = Math.min(A, 0.9 / (k * N * q));
    waveVec[i].set(Math.sin(r), Math.cos(r), L, A);
    waveQ[i] = q;
  });
}

// ---------- ola de la serie: rompe de izquierda a derecha (misma fórmula en GPU y CPU) ----------
const SET = { on: 0, H: 2.6, z: 0, peel: 0 };
function setWaveCPU(x, z) {
  if (SET.on <= 0.001) return 0;
  const d = z - SET.z; const w = d > 0 ? 5.5 : 17;
  const prof = Math.exp(-(d * d) / (w * w));
  const open = sstep(SET.peel - 14, SET.peel + 4, x);
  return SET.H * (0.42 + 0.58 * open) * prof * SET.on;
}
function heightAt(x, z, t) {
  let h = 0;
  for (let i = 0; i < N; i++) {
    const w = waveVec[i], k = (2 * Math.PI) / w.z, om = Math.sqrt(9.81 * k);
    h += w.w * Math.sin(k * (w.x * x + w.y * z) - om * t);
  }
  return h + setWaveCPU(x, z);
}

// ---------- cielo compartido ----------
const skyGLSL = /* glsl */`
  uniform vec3 uZenith, uHorizon, uSunDir, uSunCol, uMoonDir, uLightDir;
  uniform float uMoon, uStars, uLight, uTime;
  float hash13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  vec3 sky(vec3 d){
    float h = d.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0., 1.), .3));
    col += uSunCol * .35 * exp(-max(h, 0.) * 14.) * (.4 + .6 * pow(max(dot(normalize(vec3(d.x, 0., d.z)), normalize(vec3(uSunDir.x, 0., uSunDir.z))), 0.), 2.));
    col = mix(col, uHorizon * .55, clamp(-h * 6., 0., 1.));
    float s = max(dot(d, uSunDir), 0.);
    col += uSunCol * (pow(s, 1400.) * 14. + pow(s, 90.) * .3 + pow(s, 10.) * .14);
    float m = max(dot(d, uMoonDir), 0.);
    col += vec3(.82, .88, 1.) * uMoon * (smoothstep(.99955, .9997, m) * 2.2 + pow(m, 140.) * .18 + pow(m, 8.) * .05);
    if (h > 0.) { vec3 g = floor(d * 420.); col += vec3(step(.9965, hash13(g)) * hash13(g + 7.) * smoothstep(0., .25, h)) * uStars * 1.4; }
    float cyc = mod(uTime, 20.), fl = 0.;
    for (int i = 0; i < 4; i++) { float c = float(i) * 1.6; fl += smoothstep(c, c + .12, cyc) * (1. - smoothstep(c + .35, c + .7, cyc)); }
    float l = max(dot(d, uLightDir), 0.);
    col += vec3(1., .72, .32) * uLight * fl * (smoothstep(.99993, .99998, l) * 30. + pow(l, 2600.) * 3. + pow(l, 90.) * .25);
    return col;
  }
`;

// ---------- renderizador y escena ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowTier, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowTier ? 1 : 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 5000);

const shared = {
  uTime: { value: 0 },
  uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
  uMoonDir: { value: V3(0.42, 0.2, -1) }, uMoon: { value: 1 }, uStars: { value: 1 },
  uLightDir: { value: V3(-0.28, 0.008, -1) }, uLight: { value: 0 },
};
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), new THREE.ShaderMaterial({
  uniforms: shared, side: THREE.BackSide, depthWrite: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
  fragmentShader: skyGLSL + `varying vec3 vDir; void main(){ gl_FragColor = vec4(sky(normalize(vDir)), 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`,
}));
skyMesh.renderOrder = -1; scene.add(skyMesh);

// Malla del mar con resolución variable: muy densa cerca del foco, ancha hacia el horizonte
const SEG = lowTier ? 220 : 340, HALF = 520, EXP = 2.4;
const seaGeo = new THREE.PlaneGeometry(2, 2, SEG, SEG); seaGeo.rotateX(-Math.PI / 2);
{ const p = seaGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i);
  p.setX(i, Math.sign(x) * Math.pow(Math.abs(x), EXP) * HALF); p.setZ(i, Math.sign(z) * Math.pow(Math.abs(z), EXP) * HALF); } }
const seaU = Object.assign({}, shared, {
  uW: { value: waveVec }, uQ: { value: waveQ },
  uDeep: { value: new THREE.Color() }, uScatter: { value: new THREE.Color() },
  uFoamT: { value: 0.4 }, uFog: { value: 0.004 },
  uSetOn: { value: 0 }, uSetH: { value: 2.6 }, uSetZ: { value: 0 }, uSetPeel: { value: 0 },
  uWake: { value: new THREE.Vector3(0, 0, 0) },
});
const sea = new THREE.Mesh(seaGeo, new THREE.ShaderMaterial({
  uniforms: seaU,
  vertexShader: /* glsl */`
    uniform vec4 uW[${N}]; uniform float uQ[${N}]; uniform float uTime;
    uniform float uSetOn, uSetH, uSetZ, uSetPeel;
    varying vec3 vWorld; varying vec3 vN; varying float vCrest, vH, vBroken, vLip, vFace;
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.);
      vec2 xz = wp.xz; vec3 p = vec3(xz.x, 0., xz.y);
      vec3 nacc = vec3(0.); float yacc = 0.;
      for (int i = 0; i < ${N}; i++) {
        vec2 d = uW[i].xy; float L = uW[i].z, A = uW[i].w, q = uQ[i];
        float k = 6.2831853 / L, om = sqrt(9.81 * k);
        float ph = k * dot(d, xz) - om * uTime;
        float c = cos(ph), s = sin(ph), kA = k * A;
        p.x += d.x * q * A * c; p.z += d.y * q * A * c; p.y += A * s;
        nacc.x += d.x * kA * c; nacc.z += d.y * kA * c; yacc += q * kA * s;
      }
      // Ola de la serie: frente empinado hacia la orilla (+z), espalda larga; ya rota en x < uSetPeel
      float d = xz.y - uSetZ; float w = d > 0. ? 5.5 : 17.;
      float prof = exp(-(d * d) / (w * w));
      float a0 = uSetPeel - 14., a1 = uSetPeel + 4.;
      float tt = clamp((xz.x - a0) / (a1 - a0), 0., 1.);
      float open = tt * tt * (3. - 2. * tt), dOpen = 6. * tt * (1. - tt) / (a1 - a0);
      float H = uSetH * (.42 + .58 * open) * uSetOn;
      p.y += H * prof;
      float lipP = exp(-((d - .4) * (d - .4)) / 5.) * open * uSetOn;
      p.z += uSetH * .42 * lipP;                       // el labio se adelanta: la cara se pone casi vertical
      nacc.x += uSetH * .58 * dOpen * prof * uSetOn;
      nacc.z += H * prof * (-2. * d / (w * w));
      vN = normalize(vec3(-nacc.x, 1. - yacc, -nacc.z));
      vCrest = 1. - yacc;
      vH = p.y;
      vFace = prof * open * uSetOn * step(0., d);
      vBroken = (1. - open) * exp(-((d + 1.5) * (d + 1.5)) / 60.) * uSetOn;
      vLip = open * exp(-((d - .4) * (d - .4)) / 1.6) * (1. - smoothstep(uSetPeel + 3., uSetPeel + 26., xz.x)) * uSetOn;
      vWorld = p;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
    }`,
  fragmentShader: skyGLSL + /* glsl */`
    uniform vec3 uDeep, uScatter; uniform float uFoamT, uFog; uniform vec3 uWake;
    varying vec3 vWorld; varying vec3 vN; varying float vCrest, vH, vBroken, vLip, vFace;
    // ruido con derivadas analíticas: normales finas coherentes, sin texturas
    vec3 noised(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f*f*f*(f*(f*6.-15.)+10.), du = 30.*f*f*(f*(f-2.)+1.);
      float a = hash13(vec3(i,3.)), b = hash13(vec3(i+vec2(1,0),3.)), c = hash13(vec3(i+vec2(0,1),3.)), d = hash13(vec3(i+1.,3.));
      float k1 = b-a, k2 = c-a, k4 = a-b-c+d;
      return vec3(a + k1*u.x + k2*u.y + k4*u.x*u.y, du * vec2(k1 + k4*u.y, k2 + k4*u.x));
    }
    vec2 ripples(vec2 xz, float fp){
      vec2 g = vec2(0.); float amp = .5, fr = .55;
      mat2 rot = mat2(.8, -.6, .6, .8);
      for (int i = 0; i < 5; i++) {
        float vis = 1. - smoothstep(.35, 1.4, fp * fr);   // solo lo que el píxel puede resolver
        vec3 n = noised(xz * fr + vec2(uTime * (.35 + float(i) * .12), -uTime * .21));
        g += n.yz * amp * fr * vis;
        xz = rot * xz; fr *= 2.03; amp *= .5;
      }
      return g;
    }
    float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++){ s += noised(p).x * a; p *= 2.07; a *= .5; } return s; }
    void main(){
      vec2 xz = vWorld.xz;
      float fp = length(fwidth(xz));
      vec3 n = normalize(vN);
      vec2 g = ripples(xz, fp);
      float turb = clamp(vBroken * 1.6 + vLip, 0., 1.);
      n = normalize(n + vec3(-g.x, 0., -g.y) * (.07 + turb * .25 + vFace * .16));

      vec3 V = normalize(cameraPosition - vWorld);
      float cosT = clamp(dot(n, V), 0., 1.);
      float F = .02 + .98 * pow(1. - cosT, 5.);
      vec3 R = reflect(-V, n); R.y = abs(R.y) + .002;
      vec3 refl = sky(R);

      // Cuerpo: profundo, más claro en crestas y en la cara de la ola cuando la atraviesa la luz
      vec3 L = normalize(vec3(uSunDir.x, max(uSunDir.y, .05), uSunDir.z));
      float back = pow(clamp(dot(-V, L) * .5 + .5, 0., 1.), 3.);
      float lift = clamp(vH * .22 + .3, 0., 1.);
      float light = .35 + length(uSunCol) * .45 + uMoon * .25;
      float faceH = clamp(vH / 2.6, 0., 1.);
      vec3 body = uDeep + uScatter * (lift * (.25 + .75 * back) + vFace * (.15 + 1.5 * faceH * faceH) * (.55 + 1.2 * back)) * light;
      body *= 1. - vFace * (1. - faceH) * .45;
      vec3 col = mix(body, refl, F);

      // Destellos: estrechos donde se resuelven las ondas, anchos a lo lejos
      float sh = mix(1800., 180., clamp(fp * .6, 0., 1.));
      col += uSunCol * pow(max(dot(R, uSunDir), 0.), sh) * (sh * .004);
      col += vec3(.82, .88, 1.) * uMoon * pow(max(dot(R, uMoonDir), 0.), 600.) * 1.4;

      // Espuma: crestas, estelas alargadas, labio, ola rota y estela de la tabla
      float streak = fbm(vec2(xz.x * .18, xz.y * .9) + vec2(uTime * .04, -uTime * .3));
      float crestFoam = smoothstep(uFoamT + .12, uFoamT - .18, vCrest) * smoothstep(.42, .72, streak);
      float white = smoothstep(.15, .65, vBroken * (.55 + fbm(xz * .45 - uTime * .6) * .9));
      float lip = smoothstep(.3, .9, vLip * (.6 + fbm(xz * .9 + uTime * 1.2)));
      vec2 wk = xz - uWake.xy; float wake = uWake.z * exp(-dot(wk, wk) / 1.4) * smoothstep(.3, .7, fbm(xz * 1.7 + uTime));
      float runs = smoothstep(.56, .8, fbm(vec2(xz.x * .55, vH * 1.6 - uTime * .9))) * vFace * smoothstep(.2, .9, vH);  // regueros que bajan por la pared
      float foam = clamp(crestFoam * .7 + white + lip + wake + runs * .45, 0., 1.);
      vec3 foamCol = vec3(.93, .95, .96) * (.25 + .75 * clamp(light * .9, 0., 1.)) + uSunCol * .12;
      col = mix(col, foamCol, foam * .9);

      float dist = length(vWorld - cameraPosition);
      float f = 1. - exp(-dist * uFog);
      col = mix(col, sky(normalize(vec3(-V.x, .015, -V.z))), clamp(f, 0., 1.));
      gl_FragColor = vec4(col, 1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
sea.frustumCulled = false; scene.add(sea);

// ---------- luces para el surfista ----------
const hemi = new THREE.HemisphereLight(0x9fb4c4, 0x0c2a30, 0.9); scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffffff, 0); scene.add(sunLight, sunLight.target);
const fill = new THREE.DirectionalLight(0x8fb0c8, 0.7); scene.add(fill, fill.target);

// ---------- tablas: misma silueta que los dibujos de la web, a su tamaño real ----------
const BOARDS = [
  { id: 'galerna', length: 1.88, width: 0.49, color: 0xf1eee6, rail: 0xf0b45a, stance: 0.62 },
  { id: 'orbayu', length: 1.73, width: 0.53, color: 0x8fc4bb, rail: 0x0d151e, stance: 0.58 },
  { id: 'bajamar', length: 2.79, width: 0.57, color: 0xd9b480, rail: 0x6b4a2a, stance: 0.8 },
];
function boardFromSVG(def, i) {
  const pathEl = document.querySelectorAll('.board__outline')[i];
  const shape = new THREE.Shape();
  const total = pathEl.getTotalLength(), M = 96;
  let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9; const pts = [];
  for (let k = 0; k <= M; k++) { const q = pathEl.getPointAtLength((k / M) * total); pts.push(q); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); }
  const sx = def.width / (maxX - minX), sy = def.length / (maxY - minY);
  pts.forEach((q, k) => { const x = (q.x - 60) * sx, y = ((maxY + minY) / 2 - q.y) * sy; k ? shape.lineTo(x, y) : shape.moveTo(x, y); });
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.02, bevelSegments: 3, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2); // silueta en el plano XZ, punta hacia -z
  geo.rotateY(Math.PI);      // punta hacia +z (adelante)
  const p = geo.attributes.position;
  for (let k = 0; k < p.count; k++) { const z = p.getZ(k) / (def.length / 2); p.setY(k, p.getY(k) + (z > 0 ? 0.1 * z ** 2.2 : 0.04 * (-z) ** 2.5)); } // rocker: punta y cola levantadas
  geo.computeVertexNormals();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: def.color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 })));
  const str = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.062, def.length * 0.94), new THREE.MeshStandardMaterial({ color: def.rail, roughness: 0.5 }));
  str.position.y = 0.012; g.add(str);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.4 });
  const fins = def.id === 'bajamar' ? [[0, 0.11]] : def.id === 'orbayu' ? [[-0.15, 0.08], [0.15, 0.08]] : [[0, 0.09], [-0.15, 0.08], [0.15, 0.08]];
  fins.forEach(([x, h]) => { const f = new THREE.Mesh(new THREE.BoxGeometry(0.01, h, 0.1), finMat); f.position.set(x, -0.03 - h / 2, -def.length * 0.42); g.add(f); });
  return g;
}

// ---------- surfista articulado ----------
function buildSurfer() {
  const suit = new THREE.MeshPhysicalMaterial({ color: 0x14181c, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb98365, roughness: 0.55 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.8 });
  const limb = (len, r, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 6, 12), mat); m.geometry.translate(0, -len / 2, 0); return m; };
  const root = new THREE.Group();
  const hips = new THREE.Group(); root.add(hips);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), suit); pelvis.scale.set(1.2, 0.8, 0.85); hips.add(pelvis);
  const chest = new THREE.Group(); hips.add(chest);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.36, 8, 16), suit); torso.position.y = 0.27; torso.scale.set(1.25, 1, 0.8); chest.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), skin); neck.position.y = 0.55; chest.add(neck);
  const head = new THREE.Group(); head.position.y = 0.68; chest.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 18), skin); skull.scale.set(0.9, 1.05, 0.95); head.add(skull);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hairM.position.y = 0.02; hairM.rotation.x = -0.25; head.add(hairM);
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(0.21 * side, 0.45, 0); chest.add(sh);
    sh.add(limb(0.3, 0.05, suit));
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    el.add(limb(0.27, 0.042, suit));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skin); hand.position.y = -0.29; el.add(hand);
    return { sh, el };
  };
  const leg = (side) => {
    const hip = new THREE.Group(); hip.position.set(0.1 * side, -0.05, 0); hips.add(hip);
    hip.add(limb(0.44, 0.07, suit));
    const kn = new THREE.Group(); kn.position.y = -0.44; hip.add(kn);
    kn.add(limb(0.43, 0.055, suit));
    const ft = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.1), skin); ft.position.set(0, -0.45, 0); kn.add(ft);
    return { hip, kn };
  };
  return { root, hips, chest, head, armF: arm(1), armB: arm(-1), legF: leg(1), legB: leg(-1) };
}
const rider = new THREE.Group(); scene.add(rider);   // marco de la tabla sobre el agua: z = punta, y = arriba
const boardSlot = new THREE.Group(); rider.add(boardSlot);
const boards = BOARDS.map((b, i) => boardFromSVG(b, i));
let boardIdx = 0; boardSlot.add(boards[0]);
const surfer = buildSurfer(); rider.add(surfer.root);
// De lado sobre la tabla: los hombros alineados con la tabla y el pecho hacia la orilla (la cámara)
surfer.root.rotation.y = -Math.PI / 2;

// IK de dos huesos: la cadera se orienta hacia la rodilla y la tibia hacia el pie, rodilla hacia delante
const NEG_Y = new THREE.Vector3(0, -1, 0), FWD_HINT = new THREE.Vector3(0, 0, 1);
const vD = new THREE.Vector3(), vPerp = new THREE.Vector3(), vKnee = new THREE.Vector3(), vTmp = new THREE.Vector3(), qInv = new THREE.Quaternion();
function solveLeg(legObj, footP) {
  const a = 0.44, b = 0.43, hip = legObj.hip.position;
  vD.copy(footP).sub(hip); const dist = clamp(vD.length(), 0.15, a + b - 0.005); vD.normalize();
  const cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
  vPerp.copy(FWD_HINT).addScaledVector(vD, -FWD_HINT.dot(vD)).normalize();
  vKnee.copy(hip).addScaledVector(vD, a * cosA).addScaledVector(vPerp, a * Math.sqrt(1 - cosA * cosA));
  vTmp.copy(vKnee).sub(hip).normalize();
  legObj.hip.quaternion.setFromUnitVectors(NEG_Y, vTmp);
  vTmp.copy(footP).sub(vKnee).normalize();
  qInv.copy(legObj.hip.quaternion).invert(); vTmp.applyQuaternion(qInv);
  legObj.kn.quaternion.setFromUnitVectors(NEG_Y, vTmp);
}
const footF = new THREE.Vector3(), footB = new THREE.Vector3();

// ---------- spray de la cola ----------
const SPRAY = lowTier ? 260 : 520;
const sprayGeo = new THREE.BufferGeometry();
const sprayPos = new Float32Array(SPRAY * 3), sprayVel = new Float32Array(SPRAY * 3), sprayLife = new Float32Array(SPRAY);
sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
sprayGeo.setAttribute('life', new THREE.BufferAttribute(sprayLife, 1));
const sprayMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uCol: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 1 } },
  vertexShader: `attribute float life; varying float vL; uniform float uScale; void main(){ vL = life; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = uScale * (4. + 12. * (1. - life)) * 10. / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vL; uniform vec3 uCol; void main(){ vec2 c = gl_PointCoord - .5; float a = smoothstep(.5, .1, length(c)) * vL * .55; if (a < .01) discard; gl_FragColor = vec4(uCol, a);
    #include <colorspace_fragment>
  }`,
});
const spray = new THREE.Points(sprayGeo, sprayMat); spray.frustumCulled = false; scene.add(spray);
let sprayHead = 0;
function emitSpray(origin, dir, sideV, rate, dt) {
  const n = Math.floor(rate * dt + Math.random());
  for (let k = 0; k < n; k++) {
    const i = sprayHead = (sprayHead + 1) % SPRAY;
    sprayPos[i * 3] = origin.x; sprayPos[i * 3 + 1] = origin.y; sprayPos[i * 3 + 2] = origin.z;
    const upV = 2.5 + Math.random() * 3.5, out = 2 + Math.random() * 3;
    sprayVel[i * 3] = sideV.x * out - dir.x * 1.5 + (Math.random() - 0.5);
    sprayVel[i * 3 + 1] = upV;
    sprayVel[i * 3 + 2] = sideV.z * out - dir.z * 1.5 + (Math.random() - 0.5);
    sprayLife[i] = 1;
  }
}
function stepSpray(dt) {
  for (let i = 0; i < SPRAY; i++) {
    if (sprayLife[i] <= 0) continue;
    sprayVel[i * 3 + 1] -= 9.81 * dt;
    sprayPos[i * 3] += sprayVel[i * 3] * dt; sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt; sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt;
    sprayLife[i] -= dt * 1.1;
  }
  sprayGeo.attributes.position.needsUpdate = true; sprayGeo.attributes.life.needsUpdate = true;
}

// ---------- control desde la página ----------
let target = 0, prog = 0, surfTarget = 0, surf = 0;
window.__seaSetProgress = (p) => { target = clamp(p); };
window.__seaSetSurf = (v) => { surfTarget = clamp(v); };
const story = { period: 0, height: 0, board: 0 };
window.__seaState = story;
let hop = 0, swapT = 1;
window.__seaSetBoard = (i) => {
  const next = ((i % BOARDS.length) + BOARDS.length) % BOARDS.length;
  if (next === boardIdx) return;
  boardIdx = next; story.board = next; swapT = 0; hop = 1;
  window.dispatchEvent(new CustomEvent('sea:board', { detail: next }));
};
window.__seaNextBoard = () => window.__seaSetBoard(boardIdx + 1);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
let running = true;
document.addEventListener('visibilitychange', () => { running = !document.hidden; });
window.__seaPause = (v) => { running = !v; };

// ---------- bucle ----------
const timer = new THREE.Timer(); timer.connect(document);
let camZ = 0, camY = 16, surfClock = 0;
const storyCam = new THREE.Vector3(), surfCam = new THREE.Vector3(), lookB = new THREE.Vector3();
const qStory = new THREE.Quaternion(), qSurf = new THREE.Quaternion(), mtx = new THREE.Matrix4(), eul = new THREE.Euler();
const fwd = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), tail = new THREE.Vector3(), sprSide = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0), spWhite = new THREE.Color(0.85, 0.88, 0.9), hemiTint = new THREE.Color(0xb8c8d4);

renderer.setAnimationLoop(() => {
  timer.update();
  if (!running) return;
  const dt = Math.min(timer.getDelta(), 0.05), t = timer.getElapsed();
  prog = damp(prog, target, 3.2, dt);
  surf = damp(surf, surfTarget, 2.4, dt);
  const p = prog;
  const ps = lerp(p, 1, surf);  // el surf ocurre con la luz del amanecer

  updateWaves(lerp(S.amp(ps), 0.75, surf), lerp(S.len(ps), 1.1, surf), lerp(S.chop(ps), 0.45, surf));
  shared.uTime.value = t;
  shared.uZenith.value.copy(S.zenith(ps)); shared.uHorizon.value.copy(S.horizon(ps));
  shared.uSunDir.value.copy(S.sunDir(ps)); shared.uSunCol.value.copy(S.sunCol(ps));
  shared.uMoon.value = S.moon(ps); shared.uStars.value = S.stars(ps); shared.uLight.value = S.light(ps);
  seaU.uDeep.value.copy(S.deep(ps)); seaU.uScatter.value.copy(S.scatter(ps));
  seaU.uFoamT.value = S.foam(ps); seaU.uFog.value = S.fog(ps);
  renderer.toneMappingExposure = lerp(S.exposure(ps), 1.08, surf);

  // ----- cámara de la historia -----
  camZ -= dt * (1.2 + 4 * p) * (1 - surf);
  const z = camZ - p * 220;
  const baseY = S.camY(p);
  const wv = heightAt(0, z, t);
  camY = damp(camY, baseY + wv * clamp(1.4 - baseY / 8, 0.15, 0.9), 2.2, dt);
  storyCam.set(Math.sin(t * 0.07) * 2, Math.max(camY, wv + 1.1), z);
  eul.set(S.pitch(p) + Math.sin(t * 0.6) * 0.006, Math.sin(t * 0.05) * 0.03,
    (heightAt(-3, z, t) - heightAt(3, z, t)) * 0.03 * clamp(1.2 - baseY / 10, 0, 1), 'YXZ');
  qStory.setFromEuler(eul);

  // ----- ola de la serie y surfista -----
  SET.on = surf; seaU.uSetOn.value = surf;
  if (surf > 0.01) surfClock += dt; else surfClock = 0;
  const c = 6.5, vx = 7;                      // la ola avanza hacia la orilla y el surfista recorre la pared
  const anchorZ = z - 70;
  SET.z = anchorZ + c * surfClock;
  const sx = vx * surfClock;
  SET.peel = sx - 9 - Math.sin(surfClock * 0.7) * 2.5;
  seaU.uSetZ.value = SET.z; seaU.uSetPeel.value = SET.peel; seaU.uSetH.value = SET.H;

  // Trayectoria: baja y sube por la pared (giros), siempre por delante de la rompiente
  const carve = Math.sin(surfClock * 0.95);
  const dz = 1.1 + 1.9 * (carve * 0.5 + 0.5);
  const rz = SET.z + dz;
  const ry = heightAt(sx, rz, t) + 0.06;
  rider.position.set(sx, ry, rz);
  const e2 = 0.25;
  const hx = heightAt(sx + e2, rz, t) - heightAt(sx - e2, rz, t);
  const hz = heightAt(sx, rz + e2, t) - heightAt(sx, rz - e2, t);
  up.set(-hx / (2 * e2), 1, -hz / (2 * e2)).normalize();
  fwd.set(vx, 0, c + 0.9 * Math.cos(surfClock * 0.95)).normalize();
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  side.crossVectors(up, fwd).normalize();
  mtx.makeBasis(side, up, fwd);
  rider.quaternion.setFromRotationMatrix(mtx);
  rider.rotateZ(-carve * 0.28);
  rider.visible = surf > 0.02; spray.visible = surf > 0.02;

  // Cambio de tabla en plena ola: un salto y la tabla nueva aparece debajo
  swapT = Math.min(1, swapT + dt * 4);
  hop = damp(hop, 0, 4.5, dt);
  if (boardSlot.children[0] !== boards[boardIdx] && swapT > 0.35) { boardSlot.clear(); boardSlot.add(boards[boardIdx]); }
  const sc = swapT < 0.35 ? 1 - swapT / 0.35 : (swapT - 0.35) / 0.65;
  boardSlot.scale.setScalar(0.35 + 0.65 * sstep(0, 1, sc));
  const def = BOARDS[boardIdx];

  // Postura según la tabla y el giro (la tabla larga se surfea más erguido)
  const crouch = (def.id === 'bajamar' ? 0.1 : 0.22) + 0.08 * Math.max(0, -carve) + 0.03 * Math.sin(t * 3.1);
  surfer.root.position.set(0, 0.06 + hop * 0.55, 0);
  const hipH = 0.93 - crouch * 1.5;
  surfer.hips.position.set(0, hipH, 0);
  surfer.hips.rotation.set(0, 0, carve * 0.1);
  surfer.chest.rotation.set(0.22 + crouch * 0.9, carve * 0.25, 0);
  surfer.head.rotation.set(-0.25 - crouch * 0.6, 0.95, 0);
  surfer.armF.sh.rotation.set(-0.5 + carve * 0.35, 0, 1.2); surfer.armF.el.rotation.set(-0.35, 0, 0.2);
  surfer.armB.sh.rotation.set(0.35, 0, -1.0 - carve * 0.3); surfer.armB.el.rotation.set(-0.5, 0, -0.2);
  const st = def.stance * 0.5;
  footF.set(st, -(hipH - 0.03) - hop * 0.2, 0.02);
  footB.set(-st, -(hipH - 0.03) - hop * 0.2, -0.02);
  solveLeg(surfer.legF, footF); solveLeg(surfer.legB, footB);

  // Estela y spray desde la cola
  tail.copy(fwd).multiplyScalar(-def.length * 0.45).add(rider.position);
  seaU.uWake.value.set(tail.x, tail.z, surf);
  sprSide.copy(side).multiplyScalar(carve > 0 ? 1 : -1);
  emitSpray(tail, fwd, sprSide, surf * (120 + 260 * Math.abs(carve)), dt);
  stepSpray(dt);
  sprayMat.uniforms.uCol.value.copy(shared.uSunCol.value).multiplyScalar(0.35).add(spWhite);
  sprayMat.uniforms.uScale.value = renderer.getPixelRatio();

  // ----- cámara del surf: a ras de agua, delante del hombro de la ola -----
  const tall = camera.aspect < 0.8;
  surfCam.set(sx + (tall ? 3 : 6.5), Math.max(heightAt(sx + 6, SET.z + 10, t) + 1.3, 1.4), SET.z + (tall ? 15 : 10));
  lookB.set(sx - (tall ? 0.5 : 1.5), ry + (tall ? -1.6 : 0.9), rz - 0.5);
  mtx.lookAt(surfCam, lookB, UPY); qSurf.setFromRotationMatrix(mtx);

  const k = sstep(0, 1, surf);
  camera.position.lerpVectors(storyCam, surfCam, k);
  camera.quaternion.slerpQuaternions(qStory, qSurf, k);
  camera.fov = lerp(tall ? 64 : 52, tall ? 56 : 40, k); camera.updateProjectionMatrix();

  // Luces coherentes con el cielo
  const sd = shared.uSunDir.value;
  sunLight.position.copy(rider.position).addScaledVector(vTmp.set(sd.x, Math.max(sd.y, 0.25), sd.z).normalize(), 30);
  sunLight.target.position.copy(rider.position); sunLight.color.copy(shared.uSunCol.value); sunLight.intensity = 2.2 * surf;
  fill.position.copy(camera.position).y += 6; fill.target.position.copy(rider.position);
  hemi.color.copy(shared.uHorizon.value).lerp(hemiTint, 0.4);

  // La malla del mar sigue al foco: la cámara en la historia, el surfista en el surf
  const fx = lerp(camera.position.x, sx, k), fz = lerp(z - 30, rz, k);
  sea.position.set(Math.round(fx * 2) / 2, 0, Math.round(fz * 2) / 2);
  skyMesh.position.copy(camera.position);

  story.period = lerp(8, 16, sstep(0.05, 0.42, p)) - lerp(0, 2, sstep(0.7, 1, p));
  story.height = S.amp(p) * 1.45;

  renderer.render(scene, camera);
});
document.documentElement.classList.add('sea-ready');
