/**
 * Interactive 3D model of Miracle Dome City for the Explore section.
 * Everything is generated in code (no downloads), so it works before real renders exist.
 * Loaded lazily by ExploreCity.astro; the flat illustration stays as the fallback.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export interface CitySpot {
  id: string;
  anchor: [number, number, number];
}

export interface CityOptions {
  container: HTMLElement;
  spots: CitySpot[];
  /** Marker elements positioned over the canvas each frame, keyed by spot id. */
  markers: Map<string, HTMLElement>;
  modelUrl?: string;
  reducedMotion: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

export interface CityController {
  focus: (id: string) => void;
  reset: () => void;
  zoom: (factor: number) => void;
  highlight: (id: string | null) => void;
}

export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// ---------- Layout (world units ≈ metres / 4) ----------
const HILL = { x: 0, z: -40, h: 44, r: 20 };
const ZION = { x: 48, z: 26 };
const FACILITY = { x: -64, z: 8 };
const CARPARK = { x: 104, z: 34 };
const FLAT_ZONES = [
  { x: ZION.x, z: ZION.z, rx: 62, rz: 44 },
  { x: FACILITY.x, z: FACILITY.z, rx: 40, rz: 28 },
  { x: CARPARK.x, z: CARPARK.z, rx: 32, rz: 24 },
];
// Sun sets to the right of Carmel Hill so the cross stays readable against the sky.
const SUN_DIR = new THREE.Vector3(0.42, 0.07, -1).normalize();

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function flatness(x: number, z: number) {
  let f = 0;
  for (const zone of FLAT_ZONES) {
    const d = Math.hypot((x - zone.x) / zone.rx, (z - zone.z) / zone.rz);
    f = Math.max(f, 1 - smoothstep(0.75, 1.05, d));
  }
  return f;
}

function terrainHeight(x: number, z: number) {
  const noise = 1.6 * Math.sin(x * 0.05) * Math.cos(z * 0.04) + 0.9 * Math.sin(x * 0.11 + 1.3) * Math.sin(z * 0.09 + 0.7);
  const hill = HILL.h * Math.exp(-((x - HILL.x) ** 2 + (z - HILL.z) ** 2) / (2 * HILL.r ** 2));
  const ridge = 10 * Math.exp(-((x + 30) ** 2 + (z + 70) ** 2) / (2 * 30 ** 2));
  const r = Math.hypot(x, z);
  const mountains = smoothstep(190, 360, r) * (70 + 28 * Math.sin(Math.atan2(z, x) * 5) + 14 * Math.sin(x * 0.03));
  const h = noise + hill + ridge + mountains;
  return h * (1 - flatness(x, z)) + 0.2 * flatness(x, z);
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

// ---------- Shaders ----------
const skyMaterial = () =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color("#0f1322") },
      uMid: { value: new THREE.Color("#4a3940") },
      uHorizon: { value: new THREE.Color("#e8975a") },
      uGround: { value: new THREE.Color("#120f0d") },
      uSun: { value: new THREE.Color("#ffd6a0") },
      uSunDir: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHorizon, uGround, uSun, uSunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, h));
        col = mix(col, uTop, smoothstep(0.22, 0.75, h));
        col = mix(col, uGround, smoothstep(0.0, -0.15, h));
        float d = max(dot(vDir, uSunDir), 0.0);
        col += uSun * (pow(d, 900.0) * 3.0 + pow(d, 40.0) * 0.6 + pow(d, 6.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

/** Twinkling point lights (crowd, city lights, path lights…). Colours >1 feed the bloom. */
function lightPoints(positions: number[], colors: number[], size: number, twinkle: number, pixelRatio: number) {
  const geo = new THREE.BufferGeometry();
  const count = positions.length / 3;
  const seeds = new Float32Array(count).map(() => Math.random());
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: size * pixelRatio },
      uTwinkle: { value: twinkle },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uSize, uTwinkle;
      attribute vec3 aColor;
      attribute float aSeed;
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (300.0 / -mv.z);
        float t = 0.65 + 0.35 * sin(uTime * (0.8 + aSeed * 2.4) + aSeed * 60.0);
        vGlow = mix(1.0, t, uTwinkle);
        vColor = aColor;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(vColor * vGlow, a * vGlow);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const glowTexture = () =>
  canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,240,205,1)");
    g.addColorStop(0.25, "rgba(255,214,150,0.45)");
    g.addColorStop(1, "rgba(255,200,130,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });

// ---------- Scene ----------
export async function createCity3D(opts: CityOptions): Promise<CityController> {
  const { container, spots, markers, reducedMotion } = opts;
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  const rand = rng(42);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "city3d__canvas";
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x3a2f38, 0.0017);

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 2500);
  // Low, cinematic establishing shot: sunset sky and Carmel Hill behind the city.
  // Target sits above the hill so the city lands below the section title.
  const HOME = { pos: new THREE.Vector3(70, 62, 235), target: new THREE.Vector3(22, 42, -20) };
  camera.position.copy(HOME.pos);

  // Sky, stars, sun glow
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), skyMaterial()));
  {
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 500; i++) {
      const a = rand() * Math.PI * 2;
      const y = 0.35 + rand() * 0.65;
      const r = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * r * 1100, y * 1100, Math.sin(a) * r * 1100);
      col.push(0.9, 0.9, 1);
    }
    const stars = lightPoints(pos, col, 2.2, 1, pixelRatio);
    (stars.material as THREE.ShaderMaterial).fog = false;
    scene.add(stars);
  }

  // Lights
  scene.add(new THREE.HemisphereLight(0x8a7590, 0x1a1512, 1.4));
  const sun = new THREE.DirectionalLight(0xffb27a, 2.4);
  sun.position.copy(SUN_DIR).multiplyScalar(400).setY(140);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6f7ba8, 0.6);
  fill.position.set(200, 160, 300);
  scene.add(fill);

  // Terrain
  {
    const geo = new THREE.PlaneGeometry(900, 900, 220, 220);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const low = new THREE.Color("#1d2619");
    const high = new THREE.Color("#323a26");
    const paved = new THREE.Color("#2c2722");
    const far = new THREE.Color("#2b2733");
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const y = terrainHeight(x, z);
      p.setY(i, y);
      c.copy(low).lerp(high, Math.min(1, y / 40));
      c.lerp(paved, flatness(x, z) * 0.85);
      c.lerp(far, smoothstep(170, 330, Math.hypot(x, z)));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })));
  }

  const landmarks = new THREE.Group();
  scene.add(landmarks);
  const pickables: THREE.Object3D[] = [];
  const pickProxy = (id: string, geo: THREE.BufferGeometry, pos: THREE.Vector3) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
    m.position.copy(pos);
    m.userData.id = id;
    scene.add(m);
    pickables.push(m);
  };
  const timeUniforms: { value: number }[] = [];
  const addLights = (pts: THREE.Points) => {
    timeUniforms.push((pts.material as THREE.ShaderMaterial).uniforms.uTime);
    scene.add(pts);
    return pts;
  };
  const glow = glowTexture();
  const addGlow = (pos: THREE.Vector3, scale: number, opacity = 0.9) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
    s.position.copy(pos);
    s.scale.setScalar(scale);
    landmarks.add(s);
    return s;
  };

  // Carmel Hill: glowing cross + winding path of lights
  const peakY = terrainHeight(HILL.x, HILL.z);
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0cf, emissiveIntensity: 1.7 });
    const cross = new THREE.Group();
    const v = new THREE.Mesh(new THREE.BoxGeometry(1.2, 15, 1.2), mat);
    v.position.y = 7.5;
    const h = new THREE.Mesh(new THREE.BoxGeometry(7.5, 1.2, 1.2), mat);
    h.position.y = 11;
    cross.add(v, h);
    cross.position.set(HILL.x, peakY - 0.5, HILL.z);
    landmarks.add(cross);
    addGlow(new THREE.Vector3(HILL.x, peakY + 9, HILL.z), 26, 0.32);
    const light = new THREE.PointLight(0xffd9a0, 900, 110, 2);
    light.position.set(HILL.x, peakY + 12, HILL.z);
    landmarks.add(light);

    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i <= 70; i++) {
      const t = i / 70;
      const a = t * Math.PI * 5.2;
      const r = 27 * (1 - t) + 2;
      const x = HILL.x + Math.sin(a) * r;
      const z = HILL.z + Math.cos(a) * r;
      pos.push(x, terrainHeight(x, z) + 0.9, z);
      col.push(2.2, 1.6, 0.8);
    }
    addLights(lightPoints(pos, col, 2.4, 0.8, pixelRatio));
    pickProxy("carmel", new THREE.SphereGeometry(20, 12, 8), new THREE.Vector3(HILL.x, peakY - 10, HILL.z));
  }

  // Zion Grounds: elliptical bowl, glowing crowd, stage and light beam
  {
    const profile = [
      [0, 0.3], [22, 0.6], [23, 1.4], [33, 7], [35, 7.6], [36.5, 7.2], [37, 0],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 96),
      new THREE.MeshStandardMaterial({ color: 0xd8cdbb, roughness: 0.75, side: THREE.DoubleSide }),
    );
    bowl.scale.set(1.5, 1, 1);
    bowl.position.set(ZION.x, 0, ZION.z);
    landmarks.add(bowl);

    const floorTex = canvasTexture(256, 256, (ctx) => {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, "#ffe2a6");
      g.addColorStop(0.35, "#b97a3e");
      g.addColorStop(1, "#3a2817");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(22.6, 64), new THREE.MeshBasicMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2;
    floor.scale.set(1.5, 1, 1);
    floor.position.set(ZION.x, 0.75, ZION.z);
    landmarks.add(floor);

    // Crowd: thousands of warm lights.
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 4200; i++) {
      const a = rand() * Math.PI * 2;
      const d = 0.16 + Math.sqrt(rand()) * 0.82;
      pos.push(ZION.x + Math.cos(a) * 33 * d, 1.2, ZION.z + Math.sin(a) * 22 * d);
      const w = rand();
      col.push(1.4 + w * 0.8, 0.9 + w * 0.6, 0.45 + w * 0.4);
    }
    addLights(lightPoints(pos, col, 0.75, 1, pixelRatio));

    // Stand lights around the rim.
    const rimPos: number[] = [];
    const rimCol: number[] = [];
    for (let i = 0; i < 140; i++) {
      const a = (i / 140) * Math.PI * 2;
      rimPos.push(ZION.x + Math.cos(a) * 52.5, 7.9, ZION.z + Math.sin(a) * 35);
      rimCol.push(2.4, 1.9, 1.1);
    }
    addLights(lightPoints(rimPos, rimCol, 1.4, 0.3, pixelRatio));

    const stage = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.6, 1.6, 32),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d6, emissiveIntensity: 2.4 }),
    );
    stage.position.set(ZION.x, 1.4, ZION.z);
    landmarks.add(stage);

    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; varying vec2 vUv;
        void main(){
          float a = pow(1.0 - vUv.y, 1.6) * (0.28 + 0.06 * sin(uTime * 1.3));
          a *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) + 0.35;
          gl_FragColor = vec4(1.0, 0.92, 0.75, a);
        }`,
    });
    timeUniforms.push(beamMat.uniforms.uTime);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(11, 1.6, 170, 32, 1, true), beamMat);
    beam.position.set(ZION.x, 86, ZION.z);
    landmarks.add(beam);
    addGlow(new THREE.Vector3(ZION.x, 4, ZION.z), 34, 0.8);

    // Floodlight towers.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 3 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = ZION.x + Math.cos(a) * 60;
      const z = ZION.z + Math.sin(a) * 42;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 24, 8), poleMat);
      pole.position.set(x, 12, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 0.8), headMat);
      head.position.set(x, 24.5, z);
      head.lookAt(ZION.x, 0, ZION.z);
      landmarks.add(pole, head);
      addGlow(head.position, 9, 0.55);
    }
    pickProxy("zion", new THREE.CylinderGeometry(38, 38, 12, 24).scale(1.5, 1, 1), new THREE.Vector3(ZION.x, 5, ZION.z));
  }

  // 1,500-bed facility: blocks with lit windows
  {
    const facade = (cols: number, rows: number, seed: number) => {
      const r = rng(seed);
      const lit: boolean[] = Array.from({ length: cols * rows }, () => r() > 0.28);
      const draw = (emissive: boolean) => (ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = emissive ? "#000" : "#d7cebf";
        ctx.fillRect(0, 0, 512, 256);
        const cw = 512 / cols;
        const rh = 256 / rows;
        lit.forEach((on, i) => {
          const x = (i % cols) * cw + cw * 0.18;
          const y = Math.floor(i / cols) * rh + rh * 0.2;
          ctx.fillStyle = emissive ? (on ? "#ffd38c" : "#000") : on ? "#f6c983" : "#3b3530";
          ctx.fillRect(x, y, cw * 0.64, rh * 0.58);
        });
      };
      return { map: canvasTexture(512, 256, draw(false)), emissiveMap: canvasTexture(512, 256, draw(true)) };
    };
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.8 });
    const blocks = [
      { x: FACILITY.x - 6, z: FACILITY.z - 8, w: 44, d: 14, h: 19, seed: 1 },
      { x: FACILITY.x + 14, z: FACILITY.z + 12, w: 32, d: 12, h: 15, seed: 2 },
      { x: FACILITY.x - 20, z: FACILITY.z + 14, w: 20, d: 12, h: 11, seed: 3 },
    ];
    for (const b of blocks) {
      const { map, emissiveMap } = facade(Math.round(b.w / 2.6), Math.round(b.h / 3.2), b.seed);
      const side = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffd59a, emissiveIntensity: 1.5, roughness: 0.7 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), [side, side, roofMat, roofMat, side, side]);
      mesh.position.set(b.x, b.h / 2, b.z);
      landmarks.add(mesh);
    }
    addGlow(new THREE.Vector3(FACILITY.x, 4, FACILITY.z + 12), 40, 0.35);
    pickProxy("facility", new THREE.BoxGeometry(60, 22, 40), new THREE.Vector3(FACILITY.x, 10, FACILITY.z + 2));
  }

  // Car park
  {
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(50, 30), new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 1 }));
    lot.rotation.x = -Math.PI / 2;
    lot.position.set(CARPARK.x, 0.3, CARPARK.z);
    landmarks.add(lot);
    const palette = [0x3a3d44, 0x6b5f50, 0x2c2f35, 0x8c8a86, 0x5a2f2a, 0x1f2a3a];
    const cars = new THREE.InstancedMesh(new THREE.BoxGeometry(3.6, 1.4, 1.8), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), 150);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 12; col++) {
        if (rand() < 0.15 || n >= 150) continue;
        m.makeTranslation(CARPARK.x - 21 + col * 3.8, 1, CARPARK.z - 12 + row * 4.8 + (row % 2) * 0.6);
        cars.setMatrixAt(n, m);
        cars.setColorAt(n, c.setHex(palette[Math.floor(rand() * palette.length)]));
        n++;
      }
    cars.count = n;
    landmarks.add(cars);
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 6; i++) {
      pos.push(CARPARK.x - 24 + i * 9.6, 9, CARPARK.z - 15, CARPARK.x - 24 + i * 9.6, 9, CARPARK.z + 15);
      col.push(2.6, 2.1, 1.3, 2.6, 2.1, 1.3);
    }
    addLights(lightPoints(pos, col, 3.2, 0.2, pixelRatio));
    pickProxy("carpark", new THREE.BoxGeometry(54, 10, 34), new THREE.Vector3(CARPARK.x, 4, CARPARK.z));
  }

  // Roads, street lights and moving traffic
  const roads = [
    [[-260, 70], [-150, 52], [-80, 40], [-20, 44], [30, 70], [90, 66], [150, 52], [260, 40]],
    [[FACILITY.x + 10, FACILITY.z + 22], [-30, 40]],
    [[ZION.x, ZION.z + 36], [ZION.x + 10, 66]],
    [[CARPARK.x - 10, CARPARK.z + 15], [CARPARK.x - 20, 58]],
  ].map((pts) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z))));
  {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.95 });
    const streetPos: number[] = [];
    const streetCol: number[] = [];
    for (const curve of roads) {
      const steps = Math.max(8, Math.round(curve.getLength() / 2));
      const verts: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        const nx = -tan.z;
        const nz = tan.x;
        for (const s of [-1, 1]) {
          const x = p.x + nx * 2.4 * s;
          const z = p.z + nz * 2.4 * s;
          verts.push(x, terrainHeight(x, z) + 0.35, z);
        }
        if (i < steps) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        if (i % 6 === 0) {
          const x = p.x + nx * 3.4;
          const z = p.z + nz * 3.4;
          streetPos.push(x, terrainHeight(x, z) + 3, z);
          streetCol.push(2.2, 1.6, 0.8);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      scene.add(new THREE.Mesh(geo, roadMat));
    }
    addLights(lightPoints(streetPos, streetCol, 1.6, 0.4, pixelRatio));
  }
  const traffic = { count: 28, t: Array.from({ length: 28 }, () => rand()), speed: Array.from({ length: 28 }, () => 0.012 + rand() * 0.01) };
  const trafficPos = new Float32Array(traffic.count * 3);
  const trafficCol: number[] = [];
  for (let i = 0; i < traffic.count; i++) trafficCol.push(...(i % 2 ? [2.6, 0.5, 0.35] : [2.6, 2.4, 2.1]));
  const trafficPts = addLights(lightPoints(Array.from(trafficPos), trafficCol, 2, 0, pixelRatio));
  const trafficAttr = trafficPts.geometry.attributes.position as THREE.BufferAttribute;

  // Trees (tall cypress-like cones + rounded crowns) and distant settlement lights
  {
    const MAX = 900;
    const treeMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3.4, 7).translate(0, 1.7, 0), treeMat, MAX);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).translate(0, 1.4, 0), treeMat, MAX);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let nc = 0;
    let nr = 0;
    for (let tries = 0; tries < 8000 && nc + nr < MAX * 1.6; tries++) {
      const onHill = rand() < 0.22;
      const a = rand() * Math.PI * 2;
      const r = onHill ? 8 + Math.sqrt(rand()) * 32 : 40 + rand() * 190;
      const x = (onHill ? HILL.x : 0) + Math.cos(a) * r;
      const z = (onHill ? HILL.z : 0) + Math.sin(a) * r;
      if (flatness(x, z) > 0.02) continue;
      // Keep a clear lane for the winding prayer path up the hill.
      if (onHill && rand() < 0.4) continue;
      const size = 0.9 + rand() * 1.3;
      p.set(x, terrainHeight(x, z) - 0.2, z);
      c.setHSL(0.26 + rand() * 0.08, 0.38, 0.05 + rand() * 0.05);
      if (rand() < 0.55 && nc < MAX) {
        s.set(size * 0.8, size * (1 + rand() * 0.5), size * 0.8);
        cones.setMatrixAt(nc, m.compose(p, q, s));
        cones.setColorAt(nc++, c);
      } else if (nr < MAX) {
        s.set(size * 1.3, size, size * 1.3);
        crowns.setMatrixAt(nr, m.compose(p, q, s));
        crowns.setColorAt(nr++, c);
      }
    }
    cones.count = nc;
    crowns.count = nr;
    scene.add(cones, crowns);

    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 900; i++) {
      const a = rand() * Math.PI * 2;
      const r = 130 + rand() * 230;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos.push(x, terrainHeight(x, z) + 1, z);
      col.push(1.8, 1.25, 0.6);
    }
    addLights(lightPoints(pos, col, 1.1, 1, pixelRatio));
  }

  // Highlight rings for hover / selection
  const rings = new Map<string, THREE.Mesh>();
  const ringDefs: Record<string, { pos: THREE.Vector3; r: number; sx?: number }> = {
    facility: { pos: new THREE.Vector3(FACILITY.x, 0.6, FACILITY.z + 2), r: 34 },
    carmel: { pos: new THREE.Vector3(HILL.x, peakY + 0.6, HILL.z), r: 9 },
    zion: { pos: new THREE.Vector3(ZION.x, 0.6, ZION.z), r: 40, sx: 1.5 },
    carpark: { pos: new THREE.Vector3(CARPARK.x, 0.6, CARPARK.z), r: 30 },
  };
  for (const [id, def] of Object.entries(ringDefs)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(def.r, def.r + 0.9, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(def.sx ?? 1, 1, 1);
    ring.position.copy(def.pos);
    landmarks.add(ring);
    rings.set(id, ring);
  }

  // Optional architect's model replaces the stylised landmarks.
  if (opts.modelUrl) {
    try {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(opts.modelUrl);
      const ringMeshes = new Set<THREE.Object3D>(rings.values());
      landmarks.children.forEach((o) => (o.visible = ringMeshes.has(o)));
      scene.add(gltf.scene);
    } catch (err) {
      console.warn("City model failed to load; using the built-in city.", err);
    }
  }

  // ---------- Rendering ----------
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: mobile ? 2 : 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.6;
  controls.minDistance = 55;
  controls.maxDistance = 320;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.4;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.35;
  // Phones: one finger keeps scrolling the page; two fingers rotate + pinch-zoom.
  controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
  renderer.domElement.style.touchAction = "pan-y";
  controls.update();

  // Mouse wheel scrolls the page as usual; only trackpad pinch (ctrl+wheel) zooms the map.
  container.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) e.stopPropagation();
    },
    { capture: true },
  );

  let idleTimer = 0;
  const pauseAutoRotate = () => {
    controls.autoRotate = false;
    window.clearTimeout(idleTimer);
    if (!reducedMotion) idleTimer = window.setTimeout(() => (controls.autoRotate = true), 9000);
  };
  controls.addEventListener("start", pauseAutoRotate);

  // Camera flights
  let flight: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; start: number; dur: number } | null = null;
  const flyTo = (toPos: THREE.Vector3, toTarget: THREE.Vector3) => {
    pauseAutoRotate();
    if (reducedMotion) {
      camera.position.copy(toPos);
      controls.target.copy(toTarget);
      controls.update();
      return;
    }
    flight = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos, toTarget, start: performance.now(), dur: 1600 };
    controls.enabled = false;
  };
  const anchors = new Map(spots.map((s) => [s.id, new THREE.Vector3(...s.anchor)]));
  const focusDistance: Record<string, number> = { carmel: 95, zion: 120, facility: 105, carpark: 90 };

  const focus = (id: string) => {
    const anchor = anchors.get(id);
    if (!anchor) return;
    // Carmel Hill: look up at the cross from the slope; others: a three-quarter aerial view.
    const toTarget = id === "carmel" ? anchor.clone().setY(anchor.y + 2) : anchor.clone().setY(Math.max(4, anchor.y - 8));
    const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
    const dist = focusDistance[id] ?? 100;
    const lift = id === "carmel" ? 0.12 : 0.42;
    const toPos = toTarget.clone().addScaledVector(dir, dist * 0.9).setY(toTarget.y + dist * lift);
    flyTo(toPos, toTarget);
    highlight(id);
  };
  const reset = () => {
    flyTo(HOME.pos.clone(), HOME.target.clone());
    highlight(null);
  };
  const zoom = (factor: number) => {
    const offset = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    flyTo(controls.target.clone().add(offset.setLength(len)), controls.target.clone());
  };

  let highlighted: string | null = null;
  const highlight = (id: string | null) => {
    highlighted = id;
  };

  // Hover + click on the 3D landmarks
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hoverId: string | null = null;
  const pick = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    return hit ? String(hit.object.userData.id) : null;
  };
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const id = pick(e);
    if (id !== hoverId) {
      hoverId = id;
      renderer.domElement.style.cursor = id ? "pointer" : "";
      opts.onHover(id);
    }
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    if (hoverId) opts.onHover((hoverId = null));
    renderer.domElement.style.cursor = "";
  });
  let downAt = { x: 0, y: 0 };
  renderer.domElement.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener("click", (e) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // was a drag
    const id = pick(e as PointerEvent);
    if (id) opts.onSelect(id);
  });

  // Size + visibility
  let width = 1;
  let height = 1;
  const resize = () => {
    width = container.clientWidth || 1;
    height = container.clientHeight || 1;
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    bloom.resolution.set(width, height);
    camera.aspect = width / height;
    // Keep the whole city in view on tall/narrow screens.
    camera.fov = camera.aspect < 0.7 ? 68 : camera.aspect < 1 ? 58 : camera.aspect < 1.4 ? 46 : 38;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  let visible = true;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) loop();
  }).observe(container);

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const v = new THREE.Vector3();
  const clock = new THREE.Clock();
  let running = false;

  const positionMarkers = () => {
    for (const [id, el] of markers) {
      const anchor = anchors.get(id);
      if (!anchor) continue;
      v.copy(anchor).project(camera);
      const behind = v.z > 1;
      const x = (v.x * 0.5 + 0.5) * width;
      const y = (-v.y * 0.5 + 0.5) * height;
      el.style.left = `${x.toFixed(1)}px`;
      el.style.top = `${y.toFixed(1)}px`;
      el.classList.toggle("is-hidden", behind || x < -40 || x > width + 40 || y < -40 || y > height + 40);
      el.classList.toggle("hotspot--right", x > width * 0.7);
      el.classList.toggle("hotspot--left", x < width * 0.25);
      el.classList.toggle("hotspot--below", el.dataset.card === "below" || y < height * 0.45);
    }
  };

  function loop() {
    if (running) return;
    running = true;
    const frame = () => {
      if (!visible || document.hidden) {
        running = false;
        return;
      }
      const t = clock.getElapsedTime();
      timeUniforms.forEach((u) => (u.value = reducedMotion ? 0 : t));

      if (flight) {
        const k = Math.min(1, (performance.now() - flight.start) / flight.dur);
        const e = ease(k);
        camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
        if (k >= 1) {
          flight = null;
          controls.enabled = true;
        }
      }
      controls.update();

      // Traffic
      if (!reducedMotion) {
        for (let i = 0; i < traffic.count; i++) {
          traffic.t[i] = (traffic.t[i] + traffic.speed[i] * 0.016 * (i % 2 ? 1 : -1) + 1) % 1;
          const p = roads[0].getPointAt(traffic.t[i]);
          const lane = i % 2 ? 1.1 : -1.1;
          trafficAttr.setXYZ(i, p.x, terrainHeight(p.x, p.z) + 1, p.z + lane);
        }
        trafficAttr.needsUpdate = true;
      }

      // Rings
      rings.forEach((ring, id) => {
        const mat = ring.material as THREE.MeshBasicMaterial;
        const on = id === highlighted || id === hoverId;
        mat.opacity += ((on ? 0.9 : 0) - mat.opacity) * 0.12;
        const pulse = on && !reducedMotion ? 1 + 0.04 * Math.sin(t * 3) : 1;
        ring.scale.set((ringDefs[id].sx ?? 1) * pulse, pulse, 1);
      });

      composer.render();
      positionMarkers();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", () => !document.hidden && loop());
  loop();

  return { focus, reset, zoom, highlight };
}
