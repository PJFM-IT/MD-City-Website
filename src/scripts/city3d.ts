/**
 * Interactive 3D model of Miracle Dome City (Katunayake, Sri Lanka) for the Explore section.
 *
 * The surroundings follow the real area, with true compass directions (−z = north, +x = east)
 * but compressed distances so everything fits in one view:
 *   • flat western coastal lowland (~8 m above sea level), coconut groves, rice paddies
 *   • Negombo Lagoon to the north, with mangroves and oruwa outrigger boats
 *   • the Indian Ocean to the west, where the sun sets
 *   • Bandaranaike International Airport to the south-west (runway 04/22, NE–SW)
 *   • the Katunayake–Veyangoda Road heading inland to the north-east, with tuk-tuk traffic
 *   • red clay-tile village roofs, the Free Trade Zone, egrets, the hill country far to the east
 *
 * Everything is generated in code (no downloads). Loaded lazily by ExploreCity.astro;
 * the flat illustration stays as the fallback.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface CitySpot {
  id: string;
  anchor: [number, number, number];
}

export interface CityLabel {
  el: HTMLElement;
  pos: [number, number, number];
}

export interface CityOptions {
  container: HTMLElement;
  spots: CitySpot[];
  /** Marker elements positioned over the canvas each frame, keyed by spot id. */
  markers: Map<string, HTMLElement>;
  /** Small place-name labels (Indian Ocean, Negombo Lagoon…) that follow the camera. */
  labels?: CityLabel[];
  modelUrl?: string;
  reducedMotion: boolean;
  /**
   * Hero mode: no user control. The camera flies in from far out over the coast and settles
   * into a slow drift, with the city framed to the right of the hero text on wide screens.
   */
  cinematic?: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

export interface CityController {
  focus: (id: string) => void;
  reset: () => void;
  zoom: (factor: number) => void;
  highlight: (id: string | null) => void;
}

/** Hand control back to the browser between build stages so the page keeps animating. */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// ---------- Layout (world units; −z = north, +x = east) ----------
// Carmel Hill: flat summit (prayer plaza) of radius `top`, broad landscaped slopes out to `base`.
const HILL = { x: 0, z: -40, h: 40, top: 10, base: 74 };
/** Distance from the hill centre, with a gently irregular outline so it reads as a natural hill. */
const hillDist = (x: number, z: number) => {
  const dx = x - HILL.x;
  const dz = z - HILL.z;
  const r = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx);
  const shape = 1 + (0.07 * Math.sin(3 * a + 0.5) + 0.045 * Math.sin(5 * a + 2)) * smoothstep(HILL.top, HILL.top + 12, r);
  return r / shape;
};
/** Hill profile: a steeper upper cone onto a gentle skirt, with a level summit. */
const hillHeight = (r: number) =>
  HILL.h * (0.62 * (1 - smoothstep(HILL.top, 46, r)) + 0.38 * (1 - smoothstep(HILL.top, HILL.base, r)));
const ZION = { x: 48, z: 26 };
const FACILITY = { x: -64, z: 8 };
// Car park: lot of LOT.w × LOT.d, east of Zion Grounds, entered from the main road to the south.
const CARPARK = { x: 140, z: 22 };
const LOT = { w: 56, d: 40 };
// The Miracle Dome: beside Carmel Hill (east side), entrance facing south towards the city.
const DOME = { x: 110, z: -45, rx: 30, rz: 22.4 };
const FLAT_ZONES = [
  { x: DOME.x, z: DOME.z, rx: 50, rz: 38 },
  { x: ZION.x, z: ZION.z, rx: 62, rz: 44 },
  { x: FACILITY.x, z: FACILITY.z, rx: 40, rz: 28 },
  { x: CARPARK.x, z: CARPARK.z, rx: 40, rz: 29 },
];
// Runway 04/22 runs NE–SW (bearing ≈ 40°), south-west of the site.
const RUNWAY = { cx: -250, cz: 235, len: 300, width: 12, dir: new THREE.Vector3(Math.sin(0.7), 0, -Math.cos(0.7)) };
const FTZ = { x: -205, z: 95 }; // Katunayake Free Trade Zone, beside the airport
// Sunset over the Indian Ocean, a little north of due west.
const SUN_DIR = new THREE.Vector3(-0.92, 0.06, -0.38).normalize();
const WATER_Y = -0.6;
const TERRAIN_SIZE = 1400;

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

/** 1 on the airfield (runway + apron), 0 outside. */
function airportMask(x: number, z: number) {
  const dx = x - RUNWAY.cx;
  const dz = z - RUNWAY.cz;
  const along = dx * RUNWAY.dir.x + dz * RUNWAY.dir.z;
  const perp = dx * -RUNWAY.dir.z + dz * RUNWAY.dir.x;
  return (1 - smoothstep(175, 195, Math.abs(along))) * (1 - smoothstep(55, 75, Math.abs(perp + 20)));
}

/** West coast line: the Indian Ocean lies west of this x. */
const coastX = (z: number) => -450 + 26 * Math.sin(z * 0.008) + 12 * Math.sin(z * 0.023 + 1);

/** Negombo Lagoon (north) incl. its channel to the sea near Negombo: 0 = land, 1 = open water. */
function lagoonMask(x: number, z: number) {
  const ax = (x + 130) / 270;
  const az = (z + 255) / 115;
  const wobble = 0.12 * Math.sin(x * 0.03) + 0.1 * Math.cos(z * 0.04 + x * 0.01);
  const body = 1 - smoothstep(0.82 + wobble, 1.0 + wobble, Math.hypot(ax, az));
  // Narrow channel to the sea at the lagoon's north-west tip.
  const t = Math.min(1, Math.max(0, (x + 330) / -160));
  const cz = -300 - 40 * t;
  const channel = x < -300 && x > -500 ? 1 - smoothstep(14, 22, Math.abs(z - cz)) : 0;
  // A few mangrove islands.
  let islands = 0;
  for (const [ix, iz, r] of [[-60, -270, 26], [-170, -230, 20], [-110, -320, 16], [20, -250, 14]] as const) {
    islands = Math.max(islands, 1 - smoothstep(r * 0.7, r, Math.hypot(x - ix, z - iz)));
  }
  return Math.max(body, channel) * (1 - islands);
}

function oceanMask(x: number, z: number) {
  return smoothstep(0, -18, x - coastX(z));
}

function terrainHeight(x: number, z: number) {
  // Flat coastal lowland with gentle undulation.
  const base = 0.75 + 0.45 * Math.sin(x * 0.031) * Math.cos(z * 0.027) + 0.25 * Math.sin(x * 0.09 + 1) * Math.sin(z * 0.07);
  const hill = hillHeight(hillDist(x, z));
  // The central hill country, far inland to the east, as a hazy line on the horizon.
  const hillCountry =
    smoothstep(430, 620, x) * (1 - smoothstep(650, 695, x)) * (36 + 18 * Math.sin(z * 0.012) + 10 * Math.sin(z * 0.031 + x * 0.01));
  let h = base + hill + hillCountry;
  const flat = flatness(x, z);
  h = h * (1 - flat) + 0.2 * flat;
  const air = airportMask(x, z);
  h = h * (1 - air) + 0.45 * air;
  const water = Math.max(lagoonMask(x, z), oceanMask(x, z));
  return h * (1 - water) + -3 * water;
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

// Paddy field patchworks: centre, size in cells, rotation.
const PADDIES = [
  { x: 230, z: -125, cols: 10, rows: 8, a: 0.3 },
  { x: 125, z: 175, cols: 9, rows: 6, a: -0.2 },
  { x: -45, z: 205, cols: 7, rows: 5, a: 0.1 },
  { x: 335, z: 125, cols: 8, rows: 6, a: 0.5 },
  { x: -170, z: -75, cols: 6, rows: 5, a: 0 },
  { x: 120, z: -200, cols: 8, rows: 4, a: -0.15 },
];
const CELL = { w: 16, d: 11, gap: 1.4 };

function inPaddy(x: number, z: number) {
  for (const p of PADDIES) {
    const dx = x - p.x;
    const dz = z - p.z;
    const lx = dx * Math.cos(p.a) - dz * Math.sin(p.a);
    const lz = dx * Math.sin(p.a) + dz * Math.cos(p.a);
    if (Math.abs(lx) < (p.cols * (CELL.w + CELL.gap)) / 2 + 2 && Math.abs(lz) < (p.rows * (CELL.d + CELL.gap)) / 2 + 2) return true;
  }
  return false;
}

/** Free land for trees/houses: above water, off the landmarks, airfield and paddies. */
function freeLand(x: number, z: number) {
  if (Math.abs(x) > TERRAIN_SIZE / 2 - 10 || Math.abs(z) > TERRAIN_SIZE / 2 - 10) return false;
  if (terrainHeight(x, z) < 0.35) return false;
  if (flatness(x, z) > 0.02 || airportMask(x, z) > 0.02 || inPaddy(x, z)) return false;
  if (Math.hypot(x - FTZ.x, z - FTZ.z) < 55) return false;
  if (hillDist(x, z) < HILL.base + 4) return false; // Carmel Hill is landscaped separately
  return true;
}

// ---------- Shaders & textures ----------
const skyMaterial = () =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color("#18203c") },
      uMid: { value: new THREE.Color("#7a5068") },
      uHorizon: { value: new THREE.Color("#f2a463") },
      uGround: { value: new THREE.Color("#1a1512") },
      uSun: { value: new THREE.Color("#ffd29a") },
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
        // Warmer near the sun, cooler mauve opposite it (humid tropical dusk).
        // Guard the length: normalize(vec2(0)) is NaN straight up, which bloom would smear into black blocks.
        vec2 skyXZ = vDir.xz / max(length(vDir.xz), 1e-4);
        float toward = dot(skyXZ, normalize(uSunDir.xz)) * 0.5 + 0.5;
        vec3 horizon = mix(uMid * 1.1, uHorizon, toward);
        vec3 col = mix(horizon, uMid, smoothstep(0.0, 0.2, h));
        col = mix(col, uTop, smoothstep(0.2, 0.7, h));
        col = mix(col, uGround, smoothstep(0.0, -0.12, h));
        float d = max(dot(vDir, uSunDir), 0.0);
        col += uSun * (pow(d, 1600.0) * 2.2 + pow(d, 70.0) * 0.32 + pow(d, 9.0) * 0.16);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

/** Sea + lagoon: sky reflection, gentle ripples and a glittering sun path. Fog applied manually. */
const waterMaterial = (fog: THREE.FogExp2) =>
  new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR },
      uDeep: { value: new THREE.Color("#1a2236") },
      uSky: { value: new THREE.Color("#6f6488") },
      uHorizon: { value: new THREE.Color("#f2a463") },
      uSun: { value: new THREE.Color("#ffd8a8") },
      uFogColor: { value: fog.color },
      uFogDensity: { value: fog.density },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFogDensity;
      uniform vec3 uSunDir, uDeep, uSky, uHorizon, uSun, uFogColor;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz;
        vec3 n = normalize(vec3(
          sin(p.x * 0.21 + uTime * 0.9) * 0.05 + sin(p.y * 0.37 - uTime * 1.3) * 0.035 + sin((p.x + p.y) * 0.9 + uTime * 2.0) * 0.015,
          1.0,
          cos(p.y * 0.27 + uTime * 0.8) * 0.05 + cos((p.x - p.y) * 0.6 - uTime * 1.6) * 0.02));
        vec3 v = normalize(cameraPosition - vWorld);
        vec3 r = reflect(-v, n);
        float fres = pow(1.0 - max(dot(v, n), 0.0), 3.0);
        // Guarded: a vertical reflection has r.xz == 0 and normalize() would return NaN.
        vec2 rflat = r.xz / max(length(r.xz), 1e-4);
        float toward = dot(rflat, normalize(uSunDir.xz)) * 0.5 + 0.5;
        vec3 sky = mix(mix(uSky, uHorizon, toward), uSky * 0.6, smoothstep(0.0, 0.5, r.y));
        vec3 col = mix(uDeep, sky, 0.45 + fres * 0.5);
        float s = max(dot(r, uSunDir), 0.0);
        col += uSun * (pow(s, 260.0) * 4.0 + pow(s, 30.0) * 0.25);
        float d = length(cameraPosition - vWorld);
        float f = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
        gl_FragColor = vec4(mix(col, uFogColor, f), 1.0);
      }`,
  });

/** Twinkling point lights (crowd, windows, street lights…). Colours >1 feed the bloom. */
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

/** Soft, billowing tropical cumulus. */
const cloudTexture = (seed: number) =>
  canvasTexture(512, 256, (ctx) => {
    const r = rng(seed);
    for (let i = 0; i < 26; i++) {
      const x = 80 + r() * 352;
      const y = 150 - r() * 90 * Math.sin(((x - 80) / 352) * Math.PI);
      const rad = 30 + r() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  });

/**
 * Coconut palm: a gently curved trunk and a crown of drooping fronds.
 * Vertex colours carry the trunk/leaf colours; instances add a tint and sway in the shader.
 */
function palmGeometry() {
  const height = 8;
  const lean = (y: number) => 0.025 * y * y;

  const trunk = new THREE.CylinderGeometry(0.16, 0.3, height, 6, 8).translate(0, height / 2, 0);
  trunk.deleteAttribute("uv");
  const tp = trunk.attributes.position as THREE.BufferAttribute;
  const trunkColors: number[] = [];
  for (let i = 0; i < tp.count; i++) {
    tp.setX(i, tp.getX(i) + lean(tp.getY(i)));
    const ring = Math.sin(tp.getY(i) * 6) * 0.04;
    trunkColors.push(0.36 + ring, 0.31 + ring, 0.25 + ring);
  }
  trunk.setAttribute("color", new THREE.Float32BufferAttribute(trunkColors, 3));
  trunk.computeVertexNormals();

  const top = new THREE.Vector3(lean(height), height, 0);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const FRONDS = 9;
  const SEG = 6;
  for (let f = 0; f < FRONDS; f++) {
    const a = (f / FRONDS) * Math.PI * 2 + (f % 2) * 0.2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const len = 4 + (f % 3) * 0.5;
    const base = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG;
      const spine = top.clone().addScaledVector(dir, t * len).add(new THREE.Vector3(0, Math.sin(t * Math.PI * 0.55) * 1.1 - t * t * 2.6, 0));
      const w = 0.75 * (1 - t * 0.75);
      // Spine + two edges dropped slightly: a shallow "V" so fronds read from any angle.
      for (const k of [-1, 0, 1]) {
        const p = spine.clone().addScaledVector(side, k * w).add(new THREE.Vector3(0, k === 0 ? 0 : -0.22, 0));
        pos.push(p.x, p.y, p.z);
        const g = 0.32 + t * 0.12;
        col.push(0.16 + t * 0.06, g, 0.1);
      }
      if (s < SEG) {
        const r0 = base + s * 3;
        const r1 = r0 + 3;
        idx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1, r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1);
      }
    }
  }
  const fronds = new THREE.BufferGeometry();
  fronds.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  fronds.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  fronds.setIndex(idx);
  fronds.computeVertexNormals();
  return mergeGeometries([trunk, fronds])!;
}

/** Adds a wind sway (stronger higher up the tree) to an instanced material. */
function addSway(mat: THREE.Material, time: { value: number }, amount: number, height: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
      float swayK = pow(max(position.y, 0.0) / ${height.toFixed(1)}, 2.0);
      float ix = instanceMatrix[3][0];
      float iz = instanceMatrix[3][2];
      transformed.x += sin(uTime * 1.2 + ix * 0.05 + iz * 0.07) * ${amount.toFixed(2)} * swayK;
      transformed.z += cos(uTime * 1.0 + iz * 0.05) * ${(amount * 0.7).toFixed(2)} * swayK;`,
    );
  };
}

// ---------- Scene ----------
export async function createCity3D(opts: CityOptions): Promise<CityController> {
  const { container, spots, markers, reducedMotion } = opts;
  const labels = opts.labels ?? [];
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
  const detail = mobile ? 0.55 : 1;
  const rand = rng(42);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "city3d__canvas";
  const cinematic = !!opts.cinematic;
  if (cinematic) renderer.domElement.style.pointerEvents = "none";
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  // Warm, humid coastal haze.
  const fog = new THREE.FogExp2(0x4b3a46, 0.0015);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  // Establishing shot from the south-east, looking north-west: the city in front,
  // Carmel Hill and the lagoon behind, the sun setting over the ocean on the left.
  // Framed so all five places (facility, Carmel Hill, Miracle Dome, Zion, car park) are in view.
  const HOME = { pos: new THREE.Vector3(215, 84, 230), target: new THREE.Vector3(18, 28, -40) };
  camera.position.copy(HOME.pos);

  const timeUniforms: { value: number }[] = [];
  // Zion Grounds light beam fades out when the camera passes close to it (it would read as a wall).
  let beamFade: { value: number } = { value: 1 };
  const time = { value: 0 };
  timeUniforms.push(time);

  // Sky, stars, clouds
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1300, 48, 24), skyMaterial()));
  {
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 260; i++) {
      const a = rand() * Math.PI * 2;
      const y = 0.45 + rand() * 0.55;
      const r = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * r * 1200, y * 1200, Math.sin(a) * r * 1200);
      col.push(0.8, 0.8, 0.95);
    }
    scene.add(lightPoints(pos, col, 2, 1, pixelRatio));
  }
  {
    const textures = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand() * 0.3;
      const r = 850 + rand() * 250;
      const pos = new THREE.Vector3(Math.cos(a) * r, 120 + rand() * 170, Math.sin(a) * r);
      const sunward = pos.clone().normalize().dot(SUN_DIR) * 0.5 + 0.5;
      const mat = new THREE.SpriteMaterial({
        map: textures[i % 3],
        color: new THREE.Color("#8d6f86").lerp(new THREE.Color("#ffc08a"), sunward * sunward),
        transparent: true,
        depthWrite: false,
        fog: false,
        opacity: 0.7,
      });
      const cloud = new THREE.Sprite(mat);
      cloud.position.copy(pos);
      cloud.scale.set(320 + rand() * 260, 150 + rand() * 90, 1);
      scene.add(cloud);
    }
  }

  // Lights: low sun in the west, cool fill from the east.
  scene.add(new THREE.HemisphereLight(0x9a7c94, 0x1f2a18, 1.35));
  const sun = new THREE.DirectionalLight(0xffa86a, 2.5);
  sun.position.copy(SUN_DIR).multiplyScalar(400).setY(120);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6f7ba8, 0.55);
  fill.position.set(300, 160, 100);
  scene.add(fill);

  // Water: Indian Ocean + Negombo Lagoon (terrain dips below this plane)
  {
    const water = new THREE.Mesh(new THREE.CircleGeometry(1250, 96), waterMaterial(fog));
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    timeUniforms.push((water.material as THREE.ShaderMaterial).uniforms.uTime);
    scene.add(water);
  }

  await yieldToBrowser();
  // Terrain with vertex colours: lush lowland, beaches, mangrove edges, paved plots, hazy hill country
  {
    const segs = Math.round(280 * (mobile ? 0.7 : 1));
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const lush = new THREE.Color("#2f4a20");
    const lush2 = new THREE.Color("#3d5a26");
    const sand = new THREE.Color("#b19873");
    const mud = new THREE.Color("#2a2a1c");
    const paved = new THREE.Color("#3a342c");
    const airfield = new THREE.Color("#3c4a2c");
    const hills = new THREE.Color("#3b3f52");
    const lawnA = new THREE.Color("#355523");
    const lawnB = new THREE.Color("#5f8738");
    const stone = new THREE.Color("#b9ae97");
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const y = terrainHeight(x, z);
      p.setY(i, y);
      c.copy(lush).lerp(lush2, 0.5 + 0.5 * Math.sin(x * 0.02 + z * 0.015));
      // Carmel Hill: landscaped lawns in soft terraced bands, stone summit plaza.
      const hr = hillDist(x, z);
      if (hr < HILL.base + 8) {
        const band = 0.5 + 0.5 * Math.sin(y * 0.95);
        c.lerp(lawnA.clone().lerp(lawnB, smoothstep(0.42, 0.58, band)), 1 - smoothstep(HILL.base - 10, HILL.base + 8, hr));
        c.lerp(stone, 1 - smoothstep(HILL.top - 0.5, HILL.top + 1.5, hr));
      }
      const shore = x - coastX(z);
      if (shore > -4 && shore < 16) c.lerp(sand, 1 - smoothstep(8, 16, shore));
      const lag = lagoonMask(x, z);
      if (lag > 0.02) c.lerp(mud, Math.min(1, lag * 3));
      c.lerp(paved, flatness(x, z) * 0.85);
      c.lerp(airfield, airportMask(x, z) * 0.6);
      c.lerp(hills, smoothstep(400, 650, x));
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
  const addLights = (pts: THREE.Points, parent: THREE.Object3D = scene) => {
    timeUniforms.push((pts.material as THREE.ShaderMaterial).uniforms.uTime);
    parent.add(pts);
    return pts;
  };
  const glow = glowTexture();
  const addGlow = (pos: THREE.Vector3, scale: number, opacity = 0.9, parent: THREE.Object3D = landmarks) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
    s.position.copy(pos);
    s.scale.setScalar(scale);
    parent.add(s);
    return s;
  };

  await yieldToBrowser();
  // ===== Miracle Dome City landmarks =====

  // Carmel Hill: landscaped prayer hill — winding stone walkway with lamps, flowering trees,
  // a ring of coconut palms at its foot, and a summit plaza with the cross on a stepped plinth.
  const peakY = terrainHeight(HILL.x, HILL.z);
  {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xe6ddcb, roughness: 0.85 });

    // Walkway: a gentle spiral starting at the foot on the south-east (facing the city).
    const turns = 1.7;
    const a0 = 0.65;
    const pathPoints: THREE.Vector3[] = [];
    const STEPS = 220;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const r = HILL.base - 2 - (HILL.base - 2 - (HILL.top - 1)) * t;
      const a = a0 + t * turns * Math.PI * 2;
      const x = HILL.x + Math.sin(a) * r;
      const z = HILL.z + Math.cos(a) * r;
      pathPoints.push(new THREE.Vector3(x, terrainHeight(x, z), z));
    }
    {
      const half = 1.5;
      const verts: number[] = [];
      const idx: number[] = [];
      pathPoints.forEach((p, i) => {
        const next = pathPoints[Math.min(i + 1, pathPoints.length - 1)];
        const prev = pathPoints[Math.max(i - 1, 0)];
        const tan = next.clone().sub(prev).setY(0).normalize();
        for (const s of [-1, 1]) {
          const x = p.x - tan.z * half * s;
          const z = p.z + tan.x * half * s;
          verts.push(x, terrainHeight(x, z) + 0.22, z);
        }
        if (i < pathPoints.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      landmarks.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcbbd9f, roughness: 0.9 })));
    }

    // Lamp posts along the walkway, plus flowering trees (frangipani / araliya) on the outer edge.
    const lampPos: number[] = [];
    const lampCol: number[] = [];
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 3, 6).translate(0, 1.5, 0), new THREE.MeshStandardMaterial({ color: 0x2a2724 }), 80);
    const blooms = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).translate(0, 1.4, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 80);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    let nl = 0;
    let nb = 0;
    for (let i = 4; i < pathPoints.length - 4; i += 6) {
      const p = pathPoints[i];
      const tan = pathPoints[i + 1].clone().sub(pathPoints[i - 1]).setY(0).normalize();
      const side = (i / 6) % 2 ? 1 : -1;
      const lx = p.x - tan.z * 2.3 * side;
      const lz = p.z + tan.x * 2.3 * side;
      const ly = terrainHeight(lx, lz);
      poles.setMatrixAt(nl++, m.makeTranslation(lx, ly, lz));
      lampPos.push(lx, ly + 3.1, lz);
      lampCol.push(2.6, 1.9, 1.0);
      if (i % 12 === 4 && nb < 80) {
        // Trees on the downhill (outer) side of the walkway.
        const out = new THREE.Vector3(p.x - HILL.x, 0, p.z - HILL.z).normalize();
        const tx = p.x + out.x * (5 + rand() * 3);
        const tz = p.z + out.z * (5 + rand() * 3);
        const size = 1.5 + rand() * 0.8;
        blooms.setMatrixAt(nb, m.compose(new THREE.Vector3(tx, terrainHeight(tx, tz) - 0.2, tz), q, s.set(size * 1.25, size, size * 1.25)));
        blooms.setColorAt(nb++, rand() < 0.25 ? c.setHSL(0.96, 0.22, 0.62) : c.setHSL(0.26 + rand() * 0.05, 0.42, 0.2 + rand() * 0.06));
      }
    }
    poles.count = nl;
    landmarks.add(poles);
    addLights(lightPoints(lampPos, lampCol, 1.9, 0.15, pixelRatio));

    // More ornamental trees scattered across the lawns (kept off the walkway).
    const nearPath = (x: number, z: number, d: number) => pathPoints.some((p, i) => i % 3 === 0 && Math.hypot(p.x - x, p.z - z) < d);
    for (let tries = 0; tries < 600 && nb < 80; tries++) {
      const a = rand() * Math.PI * 2;
      const r = HILL.top + 6 + rand() * (HILL.base - HILL.top - 10);
      const x = HILL.x + Math.sin(a) * r;
      const z = HILL.z + Math.cos(a) * r;
      if (nearPath(x, z, 5) || flatness(x, z) > 0.02) continue;
      const size = 1.1 + rand() * 0.9;
      blooms.setMatrixAt(nb, m.compose(new THREE.Vector3(x, terrainHeight(x, z) - 0.2, z), q.identity(), s.set(size * 1.25, size, size * 1.25)));
      blooms.setColorAt(nb++, rand() < 0.14 ? c.setHSL(0.96, 0.22, 0.62) : c.setHSL(0.26 + rand() * 0.06, 0.45, 0.17 + rand() * 0.07));
    }
    blooms.count = nb;
    landmarks.add(blooms);

    // Flowering shrubs (bougainvillea, yellow allamanda, white jasmine) lining the walkway and plaza.
    const SHRUBS = 220;
    const shrubs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6).scale(1, 0.6, 1).translate(0, 0.35, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), SHRUBS);
    const flowerColors = ["#c2387a", "#d94d8f", "#e0b23a", "#f2efe6", "#a8306a"];
    let ns = 0;
    for (let i = 2; i < pathPoints.length - 2 && ns < SHRUBS - 40; i += 2) {
      const p = pathPoints[i];
      const tan = pathPoints[i + 1].clone().sub(pathPoints[i - 1]).setY(0).normalize();
      for (const side of [-1, 1]) {
        if (rand() < 0.35) continue;
        const x = p.x - tan.z * (2.1 + rand() * 0.5) * side;
        const z = p.z + tan.x * (2.1 + rand() * 0.5) * side;
        shrubs.setMatrixAt(ns, m.compose(new THREE.Vector3(x, terrainHeight(x, z), z), q.identity(), s.setScalar(0.45 + rand() * 0.3)));
        shrubs.setColorAt(ns++, c.set(flowerColors[Math.floor(rand() * flowerColors.length)]));
      }
    }
    for (let k = 0; k < 40 && ns < SHRUBS; k++) {
      const a = (k / 40) * Math.PI * 2;
      const x = HILL.x + Math.sin(a) * (HILL.top + 2.4);
      const z = HILL.z + Math.cos(a) * (HILL.top + 2.4);
      shrubs.setMatrixAt(ns, m.compose(new THREE.Vector3(x, terrainHeight(x, z), z), q.identity(), s.setScalar(0.6)));
      shrubs.setColorAt(ns++, c.set(flowerColors[k % flowerColors.length]));
    }
    shrubs.count = ns;
    landmarks.add(shrubs);

    // Open prayer pavilion on a landing halfway up the walkway.
    {
      const i = Math.round(pathPoints.length * 0.42);
      const p = pathPoints[i];
      const out = new THREE.Vector3(p.x - HILL.x, 0, p.z - HILL.z).normalize();
      const px = p.x + out.x * 6.5;
      const pz = p.z + out.z * 6.5;
      const py = Math.max(terrainHeight(px, pz), p.y);
      const pavilion = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5, 1.2, 24), stoneMat);
      base.position.y = 0.3;
      pavilion.add(base);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.4, 8), stoneMat);
        col.position.set(Math.sin(a) * 3.7, 2.6, Math.cos(a) * 3.7);
        pavilion.add(col);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xa8492b, roughness: 0.8 }));
      roof.position.y = 5.5;
      pavilion.add(roof);
      pavilion.position.set(px, py, pz);
      landmarks.add(pavilion);
      addGlow(new THREE.Vector3(px, py + 2.4, pz), 12, 0.5);
      addLights(lightPoints([px, py + 3.6, pz], [2.6, 1.9, 1.0], 3, 0.1, pixelRatio));
    }

    // Coconut palms ringing the foot of the hill.
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    addSway(palmMat, time, reducedMotion ? 0 : 0.3, 8);
    const ring = new THREE.InstancedMesh(palmGeometry(), palmMat, 64);
    let nr = 0;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2 + rand() * 0.04;
      const r = HILL.base + 1 + rand() * 4;
      const x = HILL.x + Math.sin(a) * r;
      const z = HILL.z + Math.cos(a) * r;
      if (flatness(x, z) > 0.02 || lagoonMask(x, z) > 0.02) continue;
      const pathNear = pathPoints.slice(0, 12).some((p) => Math.hypot(p.x - x, p.z - z) < 6);
      if (pathNear) continue; // leave the entrance open
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      ring.setMatrixAt(nr++, m.compose(new THREE.Vector3(x, terrainHeight(x, z) - 0.1, z), q, s.setScalar(1 + rand() * 0.3)));
    }
    ring.count = nr;
    landmarks.add(ring);

    // Summit plaza with a lit parapet.
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(HILL.top + 0.6, HILL.top + 1.4, 1.4, 64), stoneMat);
    plaza.position.set(HILL.x, peakY - 0.2, HILL.z);
    landmarks.add(plaza);
    const parapetPos: number[] = [];
    const parapetCol: number[] = [];
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      parapetPos.push(HILL.x + Math.sin(a) * (HILL.top + 0.2), peakY + 0.9, HILL.z + Math.cos(a) * (HILL.top + 0.2));
      parapetCol.push(2.3, 1.8, 1.0);
    }
    addLights(lightPoints(parapetPos, parapetCol, 0.9, 0.2, pixelRatio));

    // Stepped plinth and the cross.
    let y = peakY + 0.5;
    for (const [w, hgt] of [[6, 0.6], [4.4, 0.6], [3, 0.7]] as const) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, w), stoneMat);
      step.position.set(HILL.x, y + hgt / 2, HILL.z);
      landmarks.add(step);
      y += hgt;
    }
    const crossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0cf, emissiveIntensity: 1.35, roughness: 0.4 });
    const cross = new THREE.Group();
    const v = new THREE.Mesh(new THREE.BoxGeometry(1.1, 16, 1.1), crossMat);
    v.position.y = 8;
    const h = new THREE.Mesh(new THREE.BoxGeometry(8, 1.1, 1.1), crossMat);
    h.position.y = 11.6;
    cross.add(v, h);
    cross.position.set(HILL.x, y, HILL.z);
    landmarks.add(cross);
    addGlow(new THREE.Vector3(HILL.x, y + 2, HILL.z), 16, 0.35);
    const light = new THREE.PointLight(0xffd9a0, 700, 90, 2);
    light.position.set(HILL.x, y + 13, HILL.z);
    landmarks.add(light);

    pickProxy("carmel", new THREE.SphereGeometry(28, 12, 8), new THREE.Vector3(HILL.x, peakY - 14, HILL.z));
  }

  await yieldToBrowser();
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
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade; varying vec2 vUv;
        void main(){
          float a = pow(1.0 - vUv.y, 1.6) * (0.28 + 0.06 * sin(uTime * 1.3)) * uFade;
          a *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) + 0.35;
          gl_FragColor = vec4(1.0, 0.92, 0.75, a);
        }`,
    });
    timeUniforms.push(beamMat.uniforms.uTime);
    beamFade = beamMat.uniforms.uFade;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(11, 1.6, 170, 32, 1, true), beamMat);
    beam.position.set(ZION.x, 86, ZION.z);
    landmarks.add(beam);
    addGlow(new THREE.Vector3(ZION.x, 4, ZION.z), 34, 0.8);

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

  // Lit window façades (facility + Free Trade Zone)
  const facade = (cols: number, rows: number, seed: number, wall = "#d7cebf", litShare = 0.72) => {
    const r = rng(seed);
    const lit: boolean[] = Array.from({ length: cols * rows }, () => r() < litShare);
    const draw = (emissive: boolean) => (ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = emissive ? "#000" : wall;
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

  // 1,500-bed facility
  {
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

  await yieldToBrowser();
  // Car park: marked bays and aisles, cars, a bus bay, tuk-tuks at the entrance, lamp posts,
  // palm islands and a gate booth. Lot-local coords: lx ∈ [−w/2, w/2] (east), lz ∈ [−d/2, d/2] (south).
  {
    const HW = LOT.w / 2;
    const HD = LOT.d / 2;
    const Y = 0.32;
    const at = (lx: number, lz: number, y = Y) => new THREE.Vector3(CARPARK.x + lx, y, CARPARK.z + lz);
    const STALL = 2.5;
    const STALL_X0 = -26; // car stalls run from here…
    const STALL_X1 = 14; // …to here; the bus bay is east of it
    const ROWS = [
      { z0: -18.5, z1: -13.5 },
      { z0: -13.5, z1: -8.5 },
      { z0: -2.5, z1: 2.5 },
      { z0: 2.5, z1: 7.5 },
      { z0: 13.5, z1: 18.5 },
    ];
    const AISLES = [-5.5, 10.5];

    // Painted asphalt.
    const PX = 20;
    const tex = canvasTexture(LOT.w * PX, LOT.d * PX, (ctx) => {
      const r = rng(7);
      const X = (lx: number) => (lx + HW) * PX;
      const Z = (lz: number) => (lz + HD) * PX;
      ctx.fillStyle = "#2e2d2c";
      ctx.fillRect(0, 0, LOT.w * PX, LOT.d * PX);
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = `rgba(${r() < 0.5 ? "255,255,255" : "0,0,0"},0.035)`;
        ctx.fillRect(r() * LOT.w * PX, r() * LOT.d * PX, 3, 3);
      }
      ctx.strokeStyle = "#e9e5dc";
      ctx.lineWidth = 2.4;
      for (const row of ROWS) {
        for (let x = STALL_X0; x <= STALL_X1 + 0.01; x += STALL) {
          ctx.beginPath();
          ctx.moveTo(X(x), Z(row.z0) + 4);
          ctx.lineTo(X(x), Z(row.z1) - 4);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(X(STALL_X0), Z(row.z0));
        ctx.lineTo(X(STALL_X1), Z(row.z0));
        ctx.stroke();
      }
      // Direction arrows in the aisles.
      ctx.fillStyle = "#e9e5dc";
      for (const az of AISLES) {
        for (const ax of [-18, -4, 10]) {
          const cx = X(ax);
          const cy = Z(az);
          ctx.fillRect(cx - 26, cy - 3, 34, 6);
          ctx.beginPath();
          ctx.moveTo(cx + 8, cy - 12);
          ctx.lineTo(cx + 26, cy);
          ctx.lineTo(cx + 8, cy + 12);
          ctx.fill();
        }
      }
      // Bus bay in yellow.
      ctx.strokeStyle = "#e2b33c";
      ctx.lineWidth = 3;
      for (const [z0, z1] of [[-18.5, -6], [-1, 12]]) {
        for (let x = 16; x <= 28.01; x += 3) {
          ctx.beginPath();
          ctx.moveTo(X(x), Z(z0));
          ctx.lineTo(X(x), Z(z1));
          ctx.stroke();
        }
      }
      // Zebra crossing at the entrance.
      ctx.fillStyle = "#e9e5dc";
      for (let k = 0; k < 7; k++) ctx.fillRect(X(-17.5 + k), Z(18.8), 10, 1.2 * PX);
      // Kerb.
      ctx.strokeStyle = "#bdb6a8";
      ctx.lineWidth = 14;
      ctx.strokeRect(0, 0, LOT.w * PX, LOT.d * PX);
    });
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(LOT.w, LOT.d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }));
    lot.position.copy(at(0, 0, 0.28));
    landmarks.add(lot);
    const kerb = new THREE.Mesh(new THREE.BoxGeometry(LOT.w + 1, 0.3, LOT.d + 1), new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.9 }));
    kerb.position.copy(at(0, 0, 0.12));
    landmarks.add(kerb);

    // Vehicle shapes: white vertex colour = body (tinted per instance), dark = glass/roof trim.
    const shape = (parts: { size: [number, number, number]; pos: [number, number, number]; shade: number }[]) =>
      mergeGeometries(
        parts.map(({ size, pos, shade }) => {
          const g = new THREE.BoxGeometry(...size).translate(...pos);
          g.deleteAttribute("uv");
          g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(shade), 3));
          return g;
        }),
      )!;
    const vehicleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });
    const carGeo = shape([
      { size: [1.75, 0.8, 3.9], pos: [0, 0.62, 0], shade: 1 },
      { size: [1.55, 0.62, 2.05], pos: [0, 1.33, -0.15], shade: 0.12 },
      { size: [1.5, 0.08, 1.8], pos: [0, 1.67, -0.15], shade: 1 },
    ]);
    const tukGeo = shape([
      { size: [1.3, 1.0, 2.2], pos: [0, 0.8, 0], shade: 1 },
      { size: [1.42, 0.14, 2.0], pos: [0, 1.72, -0.1], shade: 0.08 },
    ]);
    const busGeo = shape([
      { size: [2.5, 2.6, 11], pos: [0, 1.6, 0], shade: 1 },
      { size: [2.56, 0.8, 10.2], pos: [0, 2.15, 0.1], shade: 0.1 },
    ]);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    // Cars — common Sri Lankan colours: lots of white, silver and black.
    const carColors = ["#f2f1ee", "#f2f1ee", "#f2f1ee", "#c9ccd0", "#c9ccd0", "#1d1f22", "#1d1f22", "#5a5f66", "#8e1f22", "#2a4a7a", "#5c2a2e"];
    const cars = new THREE.InstancedMesh(carGeo, vehicleMat, 120);
    let n = 0;
    ROWS.forEach((row) => {
      for (let x = STALL_X0 + STALL / 2; x < STALL_X1; x += STALL) {
        if (rand() < 0.22) continue; // a few empty bays
        const flip = rand() < 0.5 ? 0 : Math.PI;
        q.setFromAxisAngle(up, flip + (rand() - 0.5) * 0.06);
        cars.setMatrixAt(n, m.compose(at(x + (rand() - 0.5) * 0.15, (row.z0 + row.z1) / 2 + (rand() - 0.5) * 0.2), q, one));
        cars.setColorAt(n++, c.set(carColors[Math.floor(rand() * carColors.length)]));
      }
    });
    cars.count = n;
    landmarks.add(cars);

    // Buses: red SLTB-style and colourful private buses.
    const busColors = ["#8a1c1c", "#8a1c1c", "#e8e2d4", "#2a5ca8", "#d9a321", "#7a2a6a"];
    const buses = new THREE.InstancedMesh(busGeo, vehicleMat, 8);
    let nbus = 0;
    for (const zc of [-12.25, 5.5]) {
      for (let k = 0; k < 4; k++) {
        if (rand() < 0.15) continue;
        buses.setMatrixAt(nbus, m.compose(at(17.5 + k * 3, zc), q.identity(), one));
        buses.setColorAt(nbus++, c.set(busColors[Math.floor(rand() * busColors.length)]));
      }
    }
    buses.count = nbus;
    landmarks.add(buses);

    // Tuk-tuks waiting by the entrance.
    const tukColors = ["#b81f24", "#1f7a3a", "#d6a21e", "#1f4f9a", "#b81f24", "#3a3a3a"];
    const tuks = new THREE.InstancedMesh(tukGeo, vehicleMat, 8);
    for (let k = 0; k < 8; k++) {
      q.setFromAxisAngle(up, Math.PI / 2 + (rand() - 0.5) * 0.2);
      tuks.setMatrixAt(k, m.compose(at(-26 + k * 1.7, 17), q, one));
      tuks.setColorAt(k, c.set(tukColors[k % tukColors.length]));
    }
    landmarks.add(tuks);

    // Lamp posts with pools of light on the asphalt.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2a28, roughness: 0.6 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d2, emissiveIntensity: 2.6 });
    const pool = new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    const lampPos: number[] = [];
    const lampCol: number[] = [];
    for (const lz of AISLES) {
      for (const lx of [-20, -6, 8, 22]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 9, 8), poleMat);
        pole.position.copy(at(lx, lz, 4.8));
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.6), lampMat);
        head.position.copy(at(lx, lz, 9.3));
        const light = new THREE.Mesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), pool);
        light.position.copy(at(lx, lz, 0.4));
        landmarks.add(pole, head, light);
        lampPos.push(CARPARK.x + lx, 9.2, CARPARK.z + lz);
        lampCol.push(2.6, 2.3, 1.7);
      }
    }
    addLights(lightPoints(lampPos, lampCol, 2.6, 0.1, pixelRatio));

    // Planted islands with palms at the west end of each row pair.
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x3f6128, roughness: 1 });
    const islandPalmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    addSway(islandPalmMat, time, reducedMotion ? 0 : 0.3, 8);
    const islandPalms = new THREE.InstancedMesh(palmGeometry(), islandPalmMat, 10);
    let np = 0;
    for (const [z0, z1] of [[-18.5, -8.5], [-2.5, 7.5]]) {
      const island = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, z1 - z0), islandMat);
      island.position.copy(at(-27, (z0 + z1) / 2, 0.45));
      landmarks.add(island);
      for (const zz of [z0 + 2, z1 - 2]) {
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        islandPalms.setMatrixAt(np++, m.compose(at(-27, zz, 0.6), q, one.clone().multiplyScalar(0.9 + rand() * 0.2)));
      }
    }
    islandPalms.count = np;
    landmarks.add(islandPalms);

    // Entrance gate booth with a barrier arm.
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.8, emissive: 0x3a2a18, emissiveIntensity: 0.4 }));
    booth.position.copy(at(-10.5, HD + 1.8, 1.5));
    const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.25, 2.8), new THREE.MeshStandardMaterial({ color: 0xa8492b }));
    boothRoof.position.copy(at(-10.5, HD + 1.8, 2.85));
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: 0xd23a2a, emissive: 0x401010 }));
    barrier.position.copy(at(-13.2, HD + 1.2, 1.15));
    landmarks.add(booth, boothRoof, barrier);
    addLights(lightPoints([CARPARK.x - 10.5, 2.2, CARPARK.z + HD + 0.65], [2.4, 1.8, 1.0], 1.6, 0, pixelRatio));

    pickProxy("carpark", new THREE.BoxGeometry(LOT.w + 4, 10, LOT.d + 4), at(0, 0, 4));
  }

  await yieldToBrowser();
  // The Miracle Dome (existing, opened 2022): oval white hall with flared walls, a low ribbed
  // metal roof, glass entrance, the white "sail" fin on its west side, an annex and its own parking.
  {
    const SX = DOME.rx / 22.4; // lathe radius 22.4 → oval footprint
    const g = new THREE.Group();
    g.position.set(DOME.x, 0.25, DOME.z);
    // Modelled with the entrance on local −z; turned so it faces south (+z), towards the city.
    g.rotation.y = Math.PI;
    landmarks.add(g);

    const white = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.55 });
    // Walls lean slightly outwards up to the rim, like the real building.
    const wallProfile = [[19.6, 0], [20.1, 3], [20.9, 7], [21.9, 10.6], [22.4, 11.3]].map(([r, y]) => new THREE.Vector2(r, y));
    const walls = new THREE.Mesh(new THREE.LatheGeometry(wallProfile, 96), white);
    walls.scale.set(SX, 1, 1);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(22.7, 22.5, 1.3, 96, 1, true), white);
    rim.scale.set(SX, 1, 1);
    rim.position.y = 11.9;

    // Low, ribbed silver roof.
    const ribs = canvasTexture(1024, 64, (ctx) => {
      ctx.fillStyle = "#b9bcbd";
      ctx.fillRect(0, 0, 1024, 64);
      ctx.fillStyle = "#9da1a3";
      for (let x = 0; x < 1024; x += 8) ctx.fillRect(x, 0, 2, 64);
    });
    const roofProfile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * (Math.PI / 2);
      roofProfile.push(new THREE.Vector2(22.4 * Math.cos(t) + 0.01, 12.5 + 6.2 * Math.sin(t)));
    }
    roofProfile.reverse();
    const roof = new THREE.Mesh(new THREE.LatheGeometry(roofProfile, 128), new THREE.MeshStandardMaterial({ map: ribs, roughness: 0.35, metalness: 0.65, side: THREE.DoubleSide }));
    roof.scale.set(SX, 1, 1);
    g.add(walls, rim, roof);

    // Glass entrance on the north side (towards the road), with steps and a canopy.
    const { map, emissiveMap } = facade(10, 2, 11, "#5c6870", 0.95);
    const glass = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xfff0d6, emissiveIntensity: 1.5, roughness: 0.2, metalness: 0.3 });
    // Box face order: +x, −x, +y, −y, +z, −z → glass on the −z (north) face.
    const entrance = new THREE.Mesh(new THREE.BoxGeometry(15, 8.5, 3), [white, white, white, white, white, glass]);
    entrance.position.set(4, 4.6, -DOME.rz + 0.6);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 4), white);
    canopy.position.set(4, 9.1, -DOME.rz - 1.2);
    const stepsMat = new THREE.MeshStandardMaterial({ color: 0x6f7c8c, roughness: 0.8 });
    for (let k = 0; k < 3; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(18 - k * 1.5, 0.35, 5 - k * 1.2), stepsMat);
      step.position.set(4, 0.18 + k * 0.35, -DOME.rz - 2.5 + k * 0.6);
      g.add(step);
    }
    g.add(entrance, canopy);
    addGlow(new THREE.Vector3(DOME.x - 4, 4, DOME.z + DOME.rz + 2), 20, 0.45);

    // The white sweeping "sail" fin on the west side.
    const fin = new THREE.Shape();
    fin.moveTo(0, 0);
    fin.quadraticCurveTo(3, 9, 15, 12.8);
    fin.lineTo(15, 11.2);
    fin.quadraticCurveTo(7, 7.5, 5, 0);
    fin.closePath();
    // Low end on the ground out to the west, high end meeting the roof rim.
    const finMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(fin, { depth: 1.4, bevelEnabled: false, curveSegments: 24 }), white);
    finMesh.position.set(-43.5, 0, -8);
    g.add(finMesh);

    // Rim uplights and soft floodlighting at dusk.
    const rimPos: number[] = [];
    const rimCol: number[] = [];
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2;
      rimPos.push(DOME.x + Math.cos(a) * DOME.rx * 1.01, 12.4, DOME.z + Math.sin(a) * DOME.rz * 1.01);
      rimCol.push(2.2, 1.9, 1.4);
    }
    addLights(lightPoints(rimPos, rimCol, 0.9, 0.15, pixelRatio));

    // Two-storey annex to the west, behind the fin.
    const annex = facade(8, 2, 12, "#ece8e0", 0.7);
    const annexSide = new THREE.MeshStandardMaterial({ map: annex.map, emissiveMap: annex.emissiveMap, emissive: 0xffd59a, emissiveIntensity: 1.3, roughness: 0.7 });
    const annexMesh = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 10), [annexSide, annexSide, roofMat, roofMat, annexSide, annexSide]);
    annexMesh.position.set(-DOME.rx - 14, 3.5, 8);
    g.add(annexMesh);

    // Forecourt + parking around the hall, with cars and rows of motorbikes in front.
    const apron = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.32, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.9 }));
    apron.scale.set(DOME.rx, 1, DOME.rz);
    apron.position.y = 0.05;
    g.add(apron);
    const lawn = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.95, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4f7a30, roughness: 1 }));
    lawn.scale.set(DOME.rx, 1, DOME.rz);
    lawn.position.y = 0.08;
    g.add(lawn);

    const carGeo = new THREE.BoxGeometry(1.7, 1.3, 3.8).translate(0, 0.65, 0);
    const parked = new THREE.InstancedMesh(carGeo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.35 }), 60);
    const bikes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.9, 1.6).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 }), 90);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const colors = ["#f2f1ee", "#f2f1ee", "#c9ccd0", "#1d1f22", "#8e1f22", "#5a5f66"];
    let nc = 0;
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      // Leave the entrance forecourt (north) clear of parked cars.
      if (Math.sin(a) < -0.55) continue;
      if (rand() < 0.2) continue;
      const x = Math.cos(a) * DOME.rx * 1.2;
      const z = Math.sin(a) * DOME.rz * 1.22;
      q.setFromAxisAngle(up, -a);
      parked.setMatrixAt(nc, m.compose(new THREE.Vector3(x, 0, z), q, one));
      parked.setColorAt(nc++, c.set(colors[Math.floor(rand() * colors.length)]));
    }
    parked.count = nc;
    let nm = 0;
    for (let row = 0; row < 3; row++)
      for (let k = 0; k < 30 && nm < 90; k++) {
        if (rand() < 0.15) continue;
        q.setFromAxisAngle(up, (rand() - 0.5) * 0.3);
        bikes.setMatrixAt(nm++, m.compose(new THREE.Vector3(-10 + k * 0.7, 0, -DOME.rz - 6 - row * 1.9), q, one));
      }
    bikes.count = nm;
    g.add(parked, bikes);

    pickProxy("dome", new THREE.CylinderGeometry(DOME.rx + 2, DOME.rx + 2, 20, 32).scale(1, 1, DOME.rz / DOME.rx), new THREE.Vector3(DOME.x, 9, DOME.z));
  }

  await yieldToBrowser();
  // ===== Surroundings =====

  // Roads. [0] = Katunayake–Veyangoda Road: from the airport side (SW) past the site, inland to the NE.
  const roads = [
    [[-330, 175], [-220, 140], [-120, 92], [-20, 72], [80, 70], [178, 60], [245, -12], [330, -100], [460, -210], [620, -330]],
    [[FACILITY.x + 10, FACILITY.z + 22], [-50, 60], [-40, 76]],
    [[ZION.x, ZION.z + 36], [ZION.x + 6, 70]],
    [[CARPARK.x - 14, CARPARK.z + LOT.d / 2 + 0.5], [CARPARK.x - 14, 66]], // car park entrance
    [[DOME.x - 4, DOME.z + DOME.rz + 9], [150, -14], [182, 4], [184, 56]], // Miracle Dome access, east of the car park
    [[-160, 115], [-175, 160], [-200, 205]], // airport access
    [[-20, 72], [-60, 160], [-110, 300], [-140, 520]], // south towards Seeduwa / Colombo
    [[-120, 92], [-150, 20], [-170, -90], [-205, -125]], // north towards the lagoon shore
  ].map((pts) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z))));
  {
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2623, roughness: 0.95 });
    const streetPos: number[] = [];
    const streetCol: number[] = [];
    roads.forEach((curve, ri) => {
      const half = ri === 0 ? 2.8 : 2;
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
          const x = p.x + nx * half * s;
          const z = p.z + nz * half * s;
          verts.push(x, Math.max(terrainHeight(x, z), WATER_Y + 0.4) + 0.35, z);
        }
        if (i < steps) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        if (i % 7 === 0) {
          const x = p.x + nx * (half + 1.2);
          const z = p.z + nz * (half + 1.2);
          streetPos.push(x, terrainHeight(x, z) + 3, z);
          streetCol.push(2.2, 1.6, 0.8);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      scene.add(new THREE.Mesh(geo, roadMat));
    });
    addLights(lightPoints(streetPos, streetCol, 1.5, 0.4, pixelRatio));
  }
  // Tuk-tuks and buses: head- and tail-lights moving along the main road.
  const traffic = { count: 44, t: Array.from({ length: 44 }, () => rand()), speed: Array.from({ length: 44 }, () => 0.008 + rand() * 0.008) };
  const trafficCol: number[] = [];
  for (let i = 0; i < traffic.count; i++) trafficCol.push(...(i % 2 ? [2.6, 0.45, 0.3] : [2.6, 2.3, 1.9]));
  const trafficPts = addLights(lightPoints(new Array(traffic.count * 3).fill(0), trafficCol, 1.8, 0, pixelRatio));
  const trafficAttr = trafficPts.geometry.attributes.position as THREE.BufferAttribute;

  await yieldToBrowser();
  // Rice paddies: bright green and freshly flooded fields (reflecting the sunset)
  {
    const cellGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const total = PADDIES.reduce((s, p) => s + p.cols * p.rows, 0);
    const green = new THREE.InstancedMesh(cellGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), total);
    const flooded = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ color: 0x9a7272 }), total);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    let ng = 0;
    let nf = 0;
    for (const p of PADDIES) {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.a);
      for (let i = 0; i < p.cols; i++)
        for (let j = 0; j < p.rows; j++) {
          const lx = (i - (p.cols - 1) / 2) * (CELL.w + CELL.gap);
          const lz = (j - (p.rows - 1) / 2) * (CELL.d + CELL.gap);
          const x = p.x + lx * Math.cos(p.a) + lz * Math.sin(p.a);
          const z = p.z - lx * Math.sin(p.a) + lz * Math.cos(p.a);
          if (terrainHeight(x, z) < 0.3 || flatness(x, z) > 0.02) continue; // skip water and building plots
          m.compose(new THREE.Vector3(x, terrainHeight(x, z) + 0.12, z), q, new THREE.Vector3(CELL.w, 1, CELL.d));
          if (rand() < 0.22) {
            flooded.setMatrixAt(nf++, m);
          } else {
            green.setMatrixAt(ng, m);
            green.setColorAt(ng++, c.setHSL(0.24 + rand() * 0.05, 0.55, 0.22 + rand() * 0.1));
          }
        }
    }
    green.count = ng;
    flooded.count = nf;
    scene.add(green, flooded);
  }

  await yieldToBrowser();
  // Bandaranaike International Airport: runway 04/22, terminal, tower, lights
  const runwayYaw = Math.atan2(RUNWAY.dir.x, RUNWAY.dir.z);
  const runwayPoint = (along: number, perp = 0) =>
    new THREE.Vector3(
      RUNWAY.cx + RUNWAY.dir.x * along - RUNWAY.dir.z * perp,
      0.6,
      RUNWAY.cz + RUNWAY.dir.z * along + RUNWAY.dir.x * perp,
    );
  {
    const tex = canvasTexture(64, 1024, (ctx) => {
      ctx.fillStyle = "#2b2b2e";
      ctx.fillRect(0, 0, 64, 1024);
      ctx.fillStyle = "#d9d6cf";
      ctx.fillRect(3, 0, 2, 1024);
      ctx.fillRect(59, 0, 2, 1024);
      for (let y = 20; y < 1004; y += 40) ctx.fillRect(31, y, 2, 22);
      for (let k = 0; k < 6; k++) {
        ctx.fillRect(10 + k * 8, 4, 4, 30);
        ctx.fillRect(10 + k * 8, 990, 4, 30);
      }
    });
    const runway = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.len).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    runway.rotation.y = runwayYaw;
    runway.position.set(RUNWAY.cx, 0.55, RUNWAY.cz);
    scene.add(runway);
    const taxi = new THREE.Mesh(new THREE.PlaneGeometry(4, RUNWAY.len * 0.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x333236, roughness: 0.9 }));
    taxi.rotation.y = runwayYaw;
    taxi.position.copy(runwayPoint(0, 26)).setY(0.52);
    scene.add(taxi);

    const pos: number[] = [];
    const col: number[] = [];
    for (let a = -RUNWAY.len / 2; a <= RUNWAY.len / 2; a += 10) {
      for (const side of [-1, 1]) {
        const p = runwayPoint(a, side * (RUNWAY.width / 2 + 0.6));
        pos.push(p.x, 1, p.z);
        col.push(2.4, 2.3, 2.1);
      }
    }
    for (let k = -3; k <= 3; k++) {
      const th = runwayPoint(-RUNWAY.len / 2, k * 1.8);
      pos.push(th.x, 1, th.z);
      col.push(0.4, 2.6, 0.8);
      const end = runwayPoint(RUNWAY.len / 2, k * 1.8);
      pos.push(end.x, 1, end.z);
      col.push(2.6, 0.3, 0.25);
    }
    // Approach lights stretching out to the south-west.
    for (let a = 8; a <= 90; a += 8) {
      for (const k of [-2, 0, 2]) {
        const p = runwayPoint(-RUNWAY.len / 2 - a, k);
        pos.push(p.x, Math.max(terrainHeight(p.x, p.z), WATER_Y) + 1.2, p.z);
        col.push(2.6, 2.4, 1.8);
      }
    }
    addLights(lightPoints(pos, col, 1.7, 0.25, pixelRatio));

    // Terminal + control tower on the south-east side of the runway.
    const termPos = runwayPoint(10, 58);
    const { map, emissiveMap } = facade(24, 3, 7, "#cfd4d8", 0.85);
    const glass = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xfff0d0, emissiveIntensity: 1.6, roughness: 0.4 });
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(90, 9, 20), [glass, glass, roofMat, roofMat, glass, glass]);
    terminal.position.copy(termPos).setY(4.5);
    terminal.rotation.y = runwayYaw + Math.PI / 2;
    scene.add(terminal);
    const towerPos = runwayPoint(-60, 50);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 26, 10), new THREE.MeshStandardMaterial({ color: 0xc8c6c0, roughness: 0.7 }));
    tower.position.copy(towerPos).setY(13);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(4, 3, 4, 10), new THREE.MeshStandardMaterial({ color: 0x223, emissive: 0x9fd1ff, emissiveIntensity: 1.2 }));
    cab.position.copy(towerPos).setY(28);
    scene.add(tower, cab);
    addGlow(cab.position, 12, 0.4, scene);
  }

  // A plane on final approach to runway 04 (from the south-west), touching down and rolling out.
  const plane = new THREE.Group();
  {
    const body = new THREE.MeshStandardMaterial({ color: 0xe8e6e2, roughness: 0.5, metalness: 0.2 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 16, 12).rotateX(Math.PI / 2), body);
    const wings = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 3), body);
    wings.position.set(0, -0.2, 0.5);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(6, 0.25, 1.6), body);
    tail.position.set(0, 0.3, -7);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3.2, 2), body);
    fin.position.set(0, 1.8, -7);
    plane.add(fus, wings, tail, fin);
    // Landing lights + red/green navigation lights (local: +z = forward).
    addLights(lightPoints([0, -0.6, 8.4, -2.2, -0.4, 1.4, 2.2, -0.4, 1.4], [3, 2.9, 2.6, 3, 2.9, 2.6, 3, 2.9, 2.6], 4, 0, pixelRatio), plane);
    addLights(lightPoints([-9, -0.2, 0.5, 9, -0.2, 0.5], [2.6, 0.2, 0.2, 0.2, 2.6, 0.5], 2.4, 0, pixelRatio), plane);
    scene.add(plane);
  }
  const strobe = addLights(lightPoints([-9, 0, 0.5, 9, 0, 0.5, 0, 3.5, -7.5], [3, 3, 3, 3, 3, 3, 3, 3, 3], 3.2, 0, pixelRatio), plane);
  const PLANE_CYCLE = 42; // seconds
  const planeAt = (t: number) => {
    // 0–0.62 approach, 0.62–0.8 flare + roll-out, rest: parked out of sight.
    const touchdown = -RUNWAY.len / 2 + 30;
    if (t < 0.62) {
      const k = t / 0.62;
      const along = touchdown - (1 - k) * 700;
      const alt = 2 + (1 - k) * 74;
      return { along, alt, visible: true };
    }
    if (t < 0.8) {
      const k = (t - 0.62) / 0.18;
      return { along: touchdown + (1 - (1 - k) ** 2) * 190, alt: 2, visible: true };
    }
    return { along: 0, alt: 0, visible: false };
  };

  // Katunayake Free Trade Zone: big low factory sheds beside the airport
  {
    const shed = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.2 });
    for (let i = 0; i < 12; i++) {
      const x = FTZ.x + (i % 4) * 28 - 42 + (rand() - 0.5) * 6;
      const z = FTZ.z + Math.floor(i / 4) * 30 - 30 + (rand() - 0.5) * 6;
      const w = 18 + rand() * 8;
      const d = 14 + rand() * 6;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, 6, d), shed);
      box.position.set(x, 3 + terrainHeight(x, z), z);
      box.rotation.y = 0.1;
      scene.add(box);
    }
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 60; i++) {
      pos.push(FTZ.x + (rand() - 0.5) * 120, 4 + rand() * 3, FTZ.z + (rand() - 0.5) * 95);
      col.push(2.2, 2.1, 1.9);
    }
    addLights(lightPoints(pos, col, 1.2, 0.2, pixelRatio));
  }

  await yieldToBrowser();
  // Villages: whitewashed / pastel houses with red clay-tile roofs, warm windows
  {
    const centres = [
      [90, 115], [-10, 130], [175, 62], [300, 8], [-110, -125], [60, -140], [380, -70],
      [-60, 300], [200, 265], [-280, 20], [-320, -60], [460, 60], [260, -260], [-200, -140],
    ];
    const MAX = Math.round(420 * detail);
    const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX);
    const roofs = new THREE.InstancedMesh(new THREE.ConeGeometry(0.75, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.85 }), MAX);
    const wallColors = ["#eee7dc", "#e9dcc4", "#d9e3dc", "#efe0c8", "#e5d2d0", "#d8dde6"];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const windowPos: number[] = [];
    const windowCol: number[] = [];
    let n = 0;
    for (let tries = 0; tries < MAX * 6 && n < MAX; tries++) {
      const [cx, cz] = centres[tries % centres.length];
      const x = cx + (rand() - 0.5) * 90;
      const z = cz + (rand() - 0.5) * 70;
      if (!freeLand(x, z)) continue;
      const w = 3.2 + rand() * 2.2;
      const d = 3 + rand() * 2;
      const h = 2.4 + rand() * 0.6;
      const y = terrainHeight(x, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      walls.setMatrixAt(n, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d)));
      walls.setColorAt(n, c.set(wallColors[Math.floor(rand() * wallColors.length)]));
      roofs.setMatrixAt(n, m.compose(new THREE.Vector3(x, y + h, z), q, new THREE.Vector3(w * 1.25, 1.4 + rand() * 0.5, d * 1.25)));
      roofs.setColorAt(n, c.setHSL(0.03 + rand() * 0.02, 0.55, 0.3 + rand() * 0.08));
      if (rand() < 0.55) {
        windowPos.push(x + (rand() - 0.5) * w, y + 1.3, z + (rand() - 0.5) * d);
        windowCol.push(2.1, 1.4, 0.6);
      }
      n++;
    }
    walls.count = n;
    roofs.count = n;
    scene.add(walls, roofs);
    addLights(lightPoints(windowPos, windowCol, 1.1, 0.6, pixelRatio));
  }

  await yieldToBrowser();
  // Coconut groves everywhere, plus mango/jak/banana crowns and mangroves along the lagoon
  {
    const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    addSway(palmMat, time, reducedMotion ? 0 : 0.35, 8);
    const PALMS = Math.round(2600 * detail);
    const palms = new THREE.InstancedMesh(palmGeometry(), palmMat, PALMS);
    const crownMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
    const CROWNS = Math.round(900 * detail);
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).translate(0, 1.2, 0), crownMat, CROWNS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let np = 0;
    let nc = 0;
    // Groves: palms cluster in plantations, thin out near paddies and the coast.
    const groveDensity = (x: number, z: number) => 0.55 + 0.45 * Math.sin(x * 0.018 + 1.3) * Math.cos(z * 0.021 - 0.4);
    for (let tries = 0; tries < (PALMS + CROWNS) * 5 && (np < PALMS || nc < CROWNS); tries++) {
      const x = (rand() - 0.5) * (TERRAIN_SIZE - 300);
      const z = (rand() - 0.5) * (TERRAIN_SIZE - 300);
      if (x > 430 || !freeLand(x, z)) continue;
      if (rand() > groveDensity(x, z)) continue;
      const y = terrainHeight(x, z) - 0.1;
      if (rand() < 0.72 && np < PALMS) {
        const size = 0.85 + rand() * 0.55;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        palms.setMatrixAt(np, m.compose(p.set(x, y, z), q, s.setScalar(size)));
        palms.setColorAt(np++, c.setRGB(0.85 + rand() * 0.3, 0.85 + rand() * 0.3, 0.8 + rand() * 0.2));
      } else if (nc < CROWNS) {
        const size = 1.4 + rand() * 1.8;
        q.identity();
        crowns.setMatrixAt(nc, m.compose(p.set(x, y, z), q, s.set(size * 1.3, size, size * 1.3)));
        crowns.setColorAt(nc++, c.setHSL(0.27 + rand() * 0.07, 0.42, 0.09 + rand() * 0.06));
      }
    }
    // Mangroves fringing Negombo Lagoon.
    const MANGROVES = Math.round(700 * detail);
    const mangroves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0).translate(0, 0.6, 0), crownMat, MANGROVES);
    let nm = 0;
    for (let tries = 0; tries < MANGROVES * 30 && nm < MANGROVES; tries++) {
      const x = -130 + (rand() - 0.5) * 620;
      const z = -255 + (rand() - 0.5) * 300;
      const lag = lagoonMask(x, z);
      if (lag < 0.04 || lag > 0.6) continue;
      const size = 1.6 + rand() * 1.6;
      mangroves.setMatrixAt(nm, m.compose(p.set(x, WATER_Y + 0.2, z), q.identity(), s.set(size * 1.4, size, size * 1.4)));
      mangroves.setColorAt(nm++, c.setHSL(0.3 + rand() * 0.05, 0.35, 0.06 + rand() * 0.04));
    }
    palms.count = np;
    crowns.count = nc;
    mangroves.count = nm;
    scene.add(palms, crowns, mangroves);
  }

  await yieldToBrowser();
  // Oruwa outrigger canoes with lanterns on the lagoon
  const boats: { g: THREE.Group; x: number; z: number; phase: number; heading: number }[] = [];
  {
    const hull = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.8 });
    const sail = new THREE.MeshStandardMaterial({ color: 0xd8c7a6, roughness: 0.9, side: THREE.DoubleSide });
    for (let tries = 0; tries < 400 && boats.length < 12; tries++) {
      const x = -130 + (rand() - 0.5) * 480;
      const z = -255 + (rand() - 0.5) * 200;
      if (lagoonMask(x, z) < 0.95) continue;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 6), hull);
      const float = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 4), hull);
      float.position.set(2.2, -0.05, 0);
      const boom = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), hull);
      boom.position.set(1.1, 0.2, 0);
      g.add(body, float, boom);
      if (boats.length % 3 === 0) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.2), sail);
        s.position.set(0, 2.4, 0.2);
        s.rotation.y = Math.PI / 2;
        g.add(s);
      }
      addLights(lightPoints([0, 1.2, 1.5], [2.8, 1.8, 0.7], 2.6, 0.5, pixelRatio), g);
      g.position.set(x, WATER_Y + 0.25, z);
      const heading = rand() * Math.PI * 2;
      g.rotation.y = heading;
      scene.add(g);
      boats.push({ g, x, z, phase: rand() * 10, heading });
    }
  }

  // Egrets flying over the paddy fields (flapping in the shader)
  const EGRETS = 22;
  const egretMat = new THREE.MeshStandardMaterial({ color: 0xf3efe6, emissive: 0x2a2018, roughness: 0.8, side: THREE.DoubleSide });
  {
    const time2 = time;
    egretMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time2;
      shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float wing = abs(position.x) / 1.6;
        transformed.y += wing * sin(uTime * 7.0 + float(gl_InstanceID) * 1.7) * 0.9;`,
      );
    };
  }
  const egretGeo = new THREE.BufferGeometry();
  egretGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.6, -1.6, 0, -0.2, 0, 0, -0.6, 0, 0, 0.6, 0, 0, -0.6, 1.6, 0, -0.2], 3));
  egretGeo.computeVertexNormals();
  const egrets = new THREE.InstancedMesh(egretGeo, egretMat, EGRETS);
  egrets.frustumCulled = false;
  scene.add(egrets);
  const egretOffsets = Array.from({ length: EGRETS }, () => new THREE.Vector3((rand() - 0.5) * 30, (rand() - 0.5) * 8, (rand() - 0.5) * 30));

  // Highlight rings for hover / selection
  const rings = new Map<string, THREE.Mesh>();
  const ringDefs: Record<string, { pos: THREE.Vector3; r: number; sx?: number }> = {
    facility: { pos: new THREE.Vector3(FACILITY.x, 0.6, FACILITY.z + 2), r: 34 },
    carmel: { pos: new THREE.Vector3(HILL.x, peakY + 0.7, HILL.z), r: HILL.top + 2.5 },
    zion: { pos: new THREE.Vector3(ZION.x, 0.6, ZION.z), r: 40, sx: 1.5 },
    carpark: { pos: new THREE.Vector3(CARPARK.x, 0.6, CARPARK.z), r: 25, sx: 1.4 },
    dome: { pos: new THREE.Vector3(DOME.x, 0.7, DOME.z), r: DOME.rz + 9, sx: (DOME.rx + 9) / (DOME.rz + 9) },
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

  // Optional architect's model replaces the stylised landmarks (the Sri Lankan surroundings stay).
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

  await yieldToBrowser();
  // ---------- Rendering ----------
  const target = new THREE.WebGLRenderTarget(1, 1, { samples: mobile ? 2 : 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // Safety net: drop any NaN/Inf pixel before bloom. A single bad pixel would otherwise be blurred
  // through the bloom mip chain into large black rectangles on some GPUs.
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          bool bad = any(isnan(c)) || any(isinf(c));
          gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(min(c.rgb, vec3(64.0)), c.a);
        }`,
    }),
  );
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.55, 0.84);
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
  controls.maxDistance = 480;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.42;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.3;
  // Phones: one finger keeps scrolling the page; two fingers rotate + pinch-zoom.
  controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
  renderer.domElement.style.touchAction = "pan-y";
  controls.update();
  if (cinematic) {
    controls.enabled = false;
    controls.autoRotate = false;
  }

  // Mouse wheel scrolls the page as usual; only trackpad pinch (ctrl+wheel) zooms the map.
  if (!cinematic) {
    container.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) e.stopPropagation();
      },
      { capture: true },
    );
  }

  // Hero fly-in: from high over the coast down to the establishing view, then a slow drift.
  const INTRO = {
    fromPos: new THREE.Vector3(560, 300, 700),
    fromTarget: new THREE.Vector3(40, 0, -10),
    toPos: new THREE.Vector3(232, 92, 248),
    toTarget: new THREE.Vector3(24, 24, -38),
    seconds: 9,
  };
  let introStart = 0;
  const introOffset = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const cinematicCamera = () => {
    if (!introStart) introStart = performance.now();
    const elapsed = (performance.now() - introStart) / 1000;
    const k = reducedMotion ? 1 : Math.min(1, elapsed / INTRO.seconds);
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(INTRO.fromPos, INTRO.toPos, e);
    controls.target.lerpVectors(INTRO.fromTarget, INTRO.toTarget, e);
    if (!reducedMotion) {
      // After landing, sway gently around the city so the scene keeps breathing.
      const drift = Math.max(0, elapsed - INTRO.seconds);
      const angle = Math.sin(drift * 0.06) * 0.16 * smoothstep(0, 8, drift);
      introOffset.copy(camera.position).sub(controls.target).applyAxisAngle(yAxis, angle);
      camera.position.copy(controls.target).add(introOffset);
    }
    camera.lookAt(controls.target);
  };

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
  const focusDistance: Record<string, number> = { carmel: 135, zion: 120, facility: 105, carpark: 100, dome: 110 };

  let highlighted: string | null = null;
  const highlight = (id: string | null) => {
    highlighted = id;
  };

  const focus = (id: string) => {
    const anchor = anchors.get(id);
    if (!anchor) return;
    // Carmel Hill: always seen from the south, so the sunset is to the side (not glaring into
    // the lens) and the lagoon lies behind it. Others: a three-quarter aerial from the current side.
    const carmel = id === "carmel";
    const toTarget = carmel ? new THREE.Vector3(HILL.x, peakY - 6, HILL.z + 6) : anchor.clone().setY(Math.max(4, anchor.y - 8));
    // The Miracle Dome is seen from the south, where its glass entrance is (Carmel Hill behind it).
    const fixedDir = carmel ? new THREE.Vector3(-0.35, 0, 1) : id === "dome" ? new THREE.Vector3(0.35, 0, 1) : null;
    const dir = fixedDir ? fixedDir.normalize() : camera.position.clone().sub(controls.target).setY(0).normalize();
    const dist = focusDistance[id] ?? 100;
    const lift = carmel ? 0.38 : 0.42;
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
    if (cinematic || e.pointerType !== "mouse" || e.buttons) return;
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
    // Hero on wide screens: shift the picture right so the city sits beside the text.
    // On narrow/portrait screens shift it down instead, so the city sits below the text.
    // Landscape phones count as "wide" too, so the city sits beside the text.
    if (cinematic && (width > 900 || camera.aspect > 1.3)) camera.setViewOffset(width, height, -width * 0.18, 0, width, height);
    else if (cinematic) camera.setViewOffset(width, height, 0, -height * 0.2, width, height);
    else camera.clearViewOffset();
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

  const project = (el: HTMLElement, world: THREE.Vector3, margin = 40) => {
    v.copy(world).project(camera);
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-v.y * 0.5 + 0.5) * height;
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
    el.classList.toggle("is-hidden", v.z > 1 || x < -margin || x > width + margin || y < -margin || y > height + margin);
    return { x, y };
  };
  const labelPositions = labels.map((l) => new THREE.Vector3(...l.pos));

  const positionMarkers = () => {
    for (const [id, el] of markers) {
      const anchor = anchors.get(id);
      if (!anchor) continue;
      const { x, y } = project(el, anchor);
      el.classList.toggle("hotspot--right", x > width * 0.7);
      el.classList.toggle("hotspot--left", x < width * 0.25);
      const card = el.dataset.card;
      el.classList.toggle("hotspot--below", card === "below" || (card !== "above" && y < height * 0.45));
    }
    labels.forEach((l, i) => project(l.el, labelPositions[i], -10));
  };

  const egretMatrix = new THREE.Matrix4();
  const egretQuat = new THREE.Quaternion();
  const egretScale = new THREE.Vector3(1.4, 1.4, 1.4);
  const egretPos = new THREE.Vector3();

  function animateWorld(t: number) {
    // Traffic on the Katunayake–Veyangoda Road
    for (let i = 0; i < traffic.count; i++) {
      traffic.t[i] = (traffic.t[i] + traffic.speed[i] * 0.016 * (i % 2 ? 1 : -1) + 1) % 1;
      const p = roads[0].getPointAt(traffic.t[i]);
      const tan = roads[0].getTangentAt(traffic.t[i]);
      const lane = i % 2 ? 1.2 : -1.2;
      trafficAttr.setXYZ(i, p.x - tan.z * lane, Math.max(terrainHeight(p.x, p.z), WATER_Y + 0.4) + 1, p.z + tan.x * lane);
    }
    trafficAttr.needsUpdate = true;

    // Plane approach
    const cycle = (t % PLANE_CYCLE) / PLANE_CYCLE;
    const state = planeAt(cycle);
    plane.visible = state.visible;
    if (state.visible) {
      const pos = runwayPoint(state.along).setY(state.alt + 1.4);
      plane.position.copy(pos);
      plane.lookAt(pos.clone().add(RUNWAY.dir).setY(pos.y - (cycle < 0.6 ? 0.1 : 0)));
      strobe.visible = t % 1.3 < 0.08;
    }

    // Boats bobbing and drifting
    boats.forEach((b) => {
      b.g.position.y = WATER_Y + 0.25 + Math.sin(t * 1.4 + b.phase) * 0.12;
      b.g.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.04;
      b.g.rotation.y = b.heading + Math.sin(t * 0.05 + b.phase) * 0.6;
    });

    // Egret flock circling over the paddies to the north-east
    const a = t * 0.08;
    const centre = new THREE.Vector3(220 + Math.cos(a) * 140, 34 + Math.sin(t * 0.3) * 4, -100 + Math.sin(a) * 90);
    const heading = Math.atan2(-Math.sin(a) * 140, Math.cos(a) * 90);
    egretQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    for (let i = 0; i < EGRETS; i++) {
      egretPos.copy(centre).add(egretOffsets[i]);
      egrets.setMatrixAt(i, egretMatrix.compose(egretPos, egretQuat, egretScale));
    }
    egrets.instanceMatrix.needsUpdate = true;
  }

  let ready = false; // set once shaders are compiled; no frames before that
  function loop() {
    if (running || !ready) return;
    running = true;
    const frame = () => {
      if (!visible || document.hidden) {
        running = false;
        return;
      }
      const t = clock.getElapsedTime();
      timeUniforms.forEach((u) => (u.value = reducedMotion ? 0 : t));

      if (cinematic) {
        cinematicCamera();
      } else {
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
      }
      animateWorld(reducedMotion ? 9 : t);
      beamFade.value = smoothstep(70, 150, Math.hypot(camera.position.x - ZION.x, camera.position.z - ZION.z));

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

  // Compile every shader in the background (parallel compile where the GPU supports it)
  // instead of stalling the page on the first frame.
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    /* falls back to compiling on the first frame */
  }
  // Warm up in two separate steps so no single frame stalls the page for long:
  // first upload geometry/textures (plain render), then compile the post-processing passes.
  if (cinematic) {
    camera.position.copy(INTRO.fromPos);
    camera.lookAt(INTRO.fromTarget);
  }
  await yieldToBrowser();
  renderer.render(scene, camera);
  await yieldToBrowser();
  composer.render();
  await yieldToBrowser();
  ready = true;
  loop();

  return { focus, reset, zoom, highlight };
}
