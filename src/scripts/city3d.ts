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
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
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

let hasWebGL: boolean | null = null;
/** Checked once per page; the throw-away test context is released straight away. */
export function webglAvailable() {
  if (hasWebGL !== null) return hasWebGL;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    hasWebGL = !!gl;
  } catch {
    hasWebGL = false;
  }
  return hasWebGL;
}

// ---------- Layout (world units; −z = north, +x = east) ----------
// Follows the architect's aerial masterplan (top of the render = north): Katunayake–Veyangoda Road
// along the north-west edge, the City Gate and the Miracle Dome beside it, the fan-shaped crusade
// grounds (Zion) opening north from the glass dome stage, a river winding past, and the car park
// across the river. Carmel Hill is the "Prayer Mountain" of the labelled plan: a low landscaped
// mound between the Miracle Dome and the accommodation blocks, crowned by a glass geodesic dome.
// Carmel Hill: flat summit (prayer plaza) of radius `top`, broad landscaped slopes out to `base`.
const HILL = { x: -54, z: -47, h: 7, top: 15, base: 32 };
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
  HILL.h * (0.62 * (1 - smoothstep(HILL.top, HILL.top + (HILL.base - HILL.top) * 0.56, r)) + 0.38 * (1 - smoothstep(HILL.top, HILL.base, r)));

// Main road direction (SW → NE) and the inward normal (into the site, south-east).
const ROAD_DIR = new THREE.Vector2(0.867, -0.498);
const ROAD_IN = new THREE.Vector2(0.498, 0.867);
const ROAD_YAW = Math.atan2(-ROAD_DIR.y, ROAD_DIR.x); // rotation.y that turns local +x along the road

// City Gate: long lit façade parallel to the road, its front (local −z) facing the road.
const GATE = { x: -80, z: -86, w: 42, d: 7, h: 12 };
// The Miracle Dome (existing): oval hall, long axis NNW–SSE, glass entrance facing NE towards the gate.
const DOME = { x: -98, z: -24, rx: 30, rz: 22.4, yaw: -0.884 };
// Gold crescent walk curving round the Dome's south-east side (world angles, radians).
const CRESCENT = { r0: 44, r1: 49, a0: 0.07, a1: 1.91 };
// The Prayer Mountain's glass geodesic dome, on the summit of Carmel Hill.
const PAVILION = { x: HILL.x, z: HILL.z, r: 11 };
// 1,500-bed facility: Accommodation Buildings 2 and 3, the gold-roofed blocks north of the grounds
// (Building 1, with the museum, is the long City Gate building on the road).
const FACILITY = { x: -27, z: -67 };
const FACILITY_BLOCKS = [
  { x: -38.4, z: -77.9, w: 26, d: 15, h: 13, yaw: -0.56, seed: 1 },
  { x: -16, z: -55.5, w: 22, d: 16, h: 11, yaw: -0.7, seed: 2 },
];
// Zion Grounds (crusade grounds): the glass dome stage, a paved forecourt, and a fan of terraced
// lawns rising north from it between the angles FAN.a0 and FAN.a1 (world atan2(dz, dx)).
const ZION = { x: 22, z: 25 }; // fan apex / centre of the forecourt
const STAGE = { x: 24, z: 34, r: 10 };
const FAN = { a0: -2.612, a1: -0.535, plaza: 18, rise: 9, rims: [[-2.612, 76], [-1.231, 96], [-0.535, 100]] as const };
/** Far edge of the fan at angle `a` (linear between the sampled rims). */
const fanRim = (a: number) => {
  const r = FAN.rims;
  const c = Math.min(FAN.a1, Math.max(FAN.a0, a));
  if (c <= r[1][0]) return r[0][1] + ((c - r[0][0]) / (r[1][0] - r[0][0])) * (r[1][1] - r[0][1]);
  return r[1][1] + ((c - r[1][0]) / (r[2][0] - r[1][0])) * (r[2][1] - r[1][1]);
};
/** Fan coordinates of a point: radius from the apex, angle, and how far outside the fan's sides it is. */
const fanCoords = (x: number, z: number) => {
  const dx = x - ZION.x;
  const dz = z - ZION.z;
  const r = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx);
  const out = Math.max(FAN.a0 - a, a - FAN.a1, 0) * r; // arc length outside the sides
  return { r, a, out, rim: fanRim(a) };
};
/** 1 on the terraced lawns of the fan, 0 outside. */
const fanMask = (x: number, z: number) => {
  const f = fanCoords(x, z);
  return smoothstep(FAN.plaza - 2, FAN.plaza + 2, f.r) * (1 - smoothstep(f.rim - 3, f.rim + 1, f.r)) * (1 - smoothstep(0, 2, f.out));
};
/** The grounds are cut into a hillside: seats rise from the stage to the rim, then the land falls away. */
const bowlHeight = (x: number, z: number) => {
  const f = fanCoords(x, z);
  const rr = f.r / f.rim;
  const prof = smoothstep(FAN.plaza / f.rim, 1, rr) * (1 - smoothstep(1, 1.45, rr));
  return FAN.rise * prof * (1 - smoothstep(0, 35, f.out));
};
// River winding past the stage (south) and the Dome, between the grounds and the car park.
const RIVER = [
  [-240, 64], [-160, 55], [-120, 59.7], [-83, 47], [-64, 37.3], [-32, 35.7], [-8, 47], [8, 55], [40, 53.3],
  [72, 47], [88, 29.3], [89.6, 5.3], [104, -10.7], [128, -23.5], [160, -31.5], [230, -46],
].map(([x, z]) => new THREE.Vector2(x, z));
const RIVER_HALF = 5.5;
const RIVER_LEN = RIVER.slice(1).map((p, i) => p.distanceTo(RIVER[i]));
const RIVER_TOTAL = RIVER_LEN.reduce((s, l) => s + l, 0);
/** Distance to the river's centreline, plus how far along it (0–1) that closest point is. */
const FAR = { d: Infinity, at: 0.5 };
function riverInfo(x: number, z: number) {
  // Quick reject: most of the landscape is nowhere near the river.
  if (x < -255 || x > 245 || z < -65 || z > 80) return FAR;
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i];
    const b = RIVER[i + 1];
    const abx = b.x - a.x;
    const abz = b.y - a.y;
    const len = RIVER_LEN[i];
    const t = Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.y) * abz) / (len * len)));
    const d = Math.hypot(x - (a.x + abx * t), z - (a.y + abz * t));
    if (d < best) {
      best = d;
      at = (acc + t * len) / RIVER_TOTAL;
    }
    acc += len;
  }
  return { d: best, at };
}
/** 1 in the river, 0 on land; the river narrows away into the woods at both ends. */
function riverMask(x: number, z: number) {
  const { d, at } = riverInfo(x, z);
  const half = RIVER_HALF * smoothstep(0, 0.12, at) * (1 - smoothstep(0.88, 1, at));
  return 1 - smoothstep(half - 1.2, half + 0.8, d);
}
// Car park: lot of LOT.w × LOT.d across the river from the grounds (footbridge to the stage forecourt).
const CARPARK = { x: 14, z: 76 };
const LOT = { w: 140, d: 26 };
const FLAT_ZONES = [
  { x: DOME.x, z: DOME.z, rx: 41, rz: 36 },
  { x: -112, z: -64, rx: 24, rz: 15 }, // forecourt between the road and the Dome
  { x: GATE.x, z: GATE.z, rx: 30, rz: 20 },
  { x: FACILITY.x, z: FACILITY.z, rx: 32, rz: 27 },
  { x: ZION.x, z: ZION.z + 2, rx: 26, rz: 26 }, // stage forecourt
];
// Rectangular flat zones (half sizes): the car park lot.
const FLAT_RECTS = [{ x: CARPARK.x, z: CARPARK.z, hw: LOT.w / 2 + 2, hd: LOT.d / 2 + 2 }];
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
  for (const r of FLAT_RECTS) {
    const d = Math.hypot(Math.max(Math.abs(x - r.x) - r.hw, 0), Math.max(Math.abs(z - r.z) - r.hd, 0));
    f = Math.max(f, 1 - smoothstep(1, 8, d));
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
  if (z > -110) return 0; // the lagoon (and its channel) lies well north of this line
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
  let h = base + hill + hillCountry + bowlHeight(x, z);
  const flat = flatness(x, z);
  h = h * (1 - flat) + 0.2 * flat;
  const air = airportMask(x, z);
  h = h * (1 - air) + 0.45 * air;
  const water = Math.max(lagoonMask(x, z), oceanMask(x, z), riverMask(x, z));
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
  { x: 240, z: -125, cols: 9, rows: 8, a: 0.3 },
  { x: 125, z: 175, cols: 9, rows: 6, a: -0.2 },
  { x: -45, z: 205, cols: 7, rows: 5, a: 0.1 },
  { x: 335, z: 125, cols: 8, rows: 6, a: 0.5 },
  { x: 300, z: -230, cols: 8, rows: 4, a: -0.15 },
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
  if (riverInfo(x, z).d < RIVER_HALF + 2.5) return false;
  if (inCrescent(x, z, 3)) return false;
  // The terraced lawns keep only a scattering of shade trees (as in the renders).
  if (fanMask(x, z) > 0.02 && ((x * 7.31 + z * 3.17) % 1 + 1) % 1 > 0.07) return false;
  return true;
}

/** Points on (or within `pad` of) the gold crescent walk around the Dome. */
function inCrescent(x: number, z: number, pad = 0) {
  const dx = x - DOME.x;
  const dz = z - DOME.z;
  const r = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx);
  return r > CRESCENT.r0 - pad && r < CRESCENT.r1 + pad && a > CRESCENT.a0 - pad / r && a < CRESCENT.a1 + pad / r;
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
/**
 * One city for the whole page. The hero and the Explore map never show at the same time, so they
 * share a single scene, renderer and canvas: the first call builds it, later calls attach another
 * view, and the canvas moves to whichever section is on screen. (Two separate cities doubled the
 * loading work and graphics memory, which made phones lag.)
 */
let shared: Promise<{ controller: CityController; attach: (o: CityOptions) => CityController }> | null = null;

export async function createCity3D(opts: CityOptions): Promise<CityController> {
  if (shared) {
    try {
      return (await shared).attach(opts);
    } catch {
      shared = null; // the first build failed; try a fresh one for this view
    }
  }
  shared = buildCity(opts);
  try {
    return (await shared).controller;
  } catch (err) {
    shared = null;
    throw err;
  }
}

async function buildCity(opts: CityOptions) {
  const { reducedMotion } = opts;
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  // Phones and modest computers (≤4 cores or ≤4 GB) get the light tier: fewer trees/houses,
  // native-resolution rendering and 30 fps. Everyone else renders at up to 1.5× resolution.
  const nav = navigator as Navigator & { deviceMemory?: number };
  const lowEnd = mobile || (navigator.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
  const detail = lowEnd ? 0.55 : 1;
  // Cap at 30 fps on the light tier (also used if a device turns out slower than expected).
  let minFrameMs = lowEnd ? 1000 / 31 : 0;
  const rand = rng(42);

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = "city3d__canvas";

  // A "view" = one section showing the city: its container, camera behaviour and overlays.
  interface View {
    container: HTMLElement;
    cinematic: boolean;
    markers: Map<string, HTMLElement>;
    labels: CityLabel[];
    labelPositions: THREE.Vector3[];
    anchors: Map<string, THREE.Vector3>;
    onHover: (id: string | null) => void;
    onSelect: (id: string) => void;
    visible: boolean;
    saved?: { pos: THREE.Vector3; target: THREE.Vector3 };
  }
  const makeView = (o: CityOptions): View => ({
    container: o.container,
    cinematic: !!o.cinematic,
    markers: o.markers,
    labels: o.labels ?? [],
    labelPositions: (o.labels ?? []).map((l) => new THREE.Vector3(...l.pos)),
    anchors: new Map(o.spots.map((s) => [s.id, new THREE.Vector3(...s.anchor)])),
    onHover: o.onHover,
    onSelect: o.onSelect,
    visible: false,
  });
  const views: View[] = [makeView(opts)];
  let view = views[0];
  view.visible = true; // until the first visibility check comes in
  let cinematic = view.cinematic;
  if (cinematic) renderer.domElement.style.pointerEvents = "none";
  view.container.append(renderer.domElement);

  const scene = new THREE.Scene();
  // Warm, humid coastal haze.
  const fog = new THREE.FogExp2(0x4b3a46, 0.0015);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  // Establishing shot from the south-east, looking north-west: the car park and river in front, the
  // crusade grounds rising behind the dome stage, the Miracle Dome, facility and City Gate beyond,
  // Carmel Hill to the right and the sun setting over the ocean on the left.
  const HOME = { pos: new THREE.Vector3(170, 82, 215), target: new THREE.Vector3(-22, 8, -24) };
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
    const segs = Math.round(280 * (lowEnd ? 0.7 : 1));
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
    const earth = new THREE.Color("#5a3826");
    const bank = new THREE.Color("#5d5a4e");
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
      // Crusade grounds: reddish earth between bands of lawn (the terraces), as in the renders.
      const fan = fanMask(x, z);
      if (fan > 0) {
        const terrace = 0.5 + 0.5 * Math.sin(fanCoords(x, z).r * 0.55);
        c.lerp(earth.clone().lerp(lawnA, smoothstep(0.55, 0.8, terrace) * 0.7), fan * 0.92);
      }
      // Rocky river banks.
      const rd = riverInfo(x, z).d;
      if (rd < RIVER_HALF + 4) c.lerp(bank, 1 - smoothstep(RIVER_HALF + 1, RIVER_HALF + 4, rd));
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

    // The Prayer Mountain's glass geodesic dome on the summit (lit warm red inside), as in the renders.
    const geo = new THREE.IcosahedronGeometry(PAVILION.r, 2);
    const shell = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0xb87482, emissive: 0x7a2232, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    shell.position.set(PAVILION.x, peakY + 0.4, PAVILION.z);
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), new THREE.LineBasicMaterial({ color: new THREE.Color(2.1, 1.8, 1.4) }));
    lines.position.copy(shell.position);
    landmarks.add(shell, lines);
    addGlow(new THREE.Vector3(PAVILION.x, peakY + 4, PAVILION.z), 22, 0.5);
    const light = new THREE.PointLight(0xff8a7a, 260, 40, 2);
    light.position.set(PAVILION.x, peakY + 5, PAVILION.z);
    landmarks.add(light);

    pickProxy("carmel", new THREE.SphereGeometry(HILL.top + 6, 16, 10), new THREE.Vector3(HILL.x, peakY, HILL.z));
  }

  await yieldToBrowser();
  // Zion Grounds — the crusade grounds, as in the renders: terraced lawns fanning out north from a
  // glass geodesic dome stage, a paved forecourt, radial walkways with lamps, the crowd, floodlights.
  {
    const forecourt = new THREE.Mesh(new THREE.CircleGeometry(FAN.plaza + 1, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8c8780, roughness: 0.9 }));
    forecourt.position.set(ZION.x, 0.34, ZION.z);
    landmarks.add(forecourt);

    // The stage: a glass geodesic dome (lower half below ground) with a lit frame.
    const domeGeo = new THREE.IcosahedronGeometry(STAGE.r, 2);
    const shell = new THREE.Mesh(
      domeGeo,
      new THREE.MeshStandardMaterial({ color: 0xc7a6c6, emissive: 0x5a3456, emissiveIntensity: 0.7, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    shell.position.set(STAGE.x, 0.25, STAGE.z);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(domeGeo, 1), new THREE.LineBasicMaterial({ color: new THREE.Color(2.3, 2.0, 1.6) }));
    frame.position.copy(shell.position);
    landmarks.add(shell, frame);

    // Stage deck, LED screen and the choir inside, facing the grounds (north).
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(STAGE.r - 2, STAGE.r - 1.4, 1.4, 48), new THREE.MeshStandardMaterial({ color: 0x2a292d, roughness: 0.7 }));
    deck.position.set(STAGE.x, 0.95, STAGE.z);
    landmarks.add(deck);
    const screenTex = canvasTexture(256, 128, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 256, 128);
      g.addColorStop(0, "#3b2a6e");
      g.addColorStop(0.5, "#e2763a");
      g.addColorStop(1, "#ffd28a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = "rgba(255,248,230,0.55)";
      for (let k = 0; k < 9; k++) {
        ctx.beginPath();
        ctx.moveTo(128, 18);
        ctx.lineTo(k * 32 - 6, 128);
        ctx.lineTo(k * 32 + 6, 128);
        ctx.fill();
      }
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(12, 5.2), new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.5, 1.5, 1.5) }));
    screen.position.set(STAGE.x, 5.4, STAGE.z + 4.2);
    screen.rotation.y = Math.PI; // face the audience to the north
    landmarks.add(screen);
    {
      const pos: number[] = [];
      const col: number[] = [];
      for (let row = 0; row < 3; row++)
        for (let k = 0; k < 16; k++) {
          pos.push(STAGE.x - 6 + k * 0.8, 2.3 + row * 0.5, STAGE.z + 1 + row * 0.9);
          col.push(2.2, 2.1, 1.9);
        }
      addLights(lightPoints(pos, col, 0.7, 0.3, pixelRatio));
    }
    addGlow(new THREE.Vector3(STAGE.x, 4, STAGE.z), 30, 0.75);
    const stageLight = new THREE.PointLight(0xffc9a0, 500, 70, 2);
    stageLight.position.set(STAGE.x, 8, STAGE.z - 3);
    landmarks.add(stageLight);

    // Radial walkways from the forecourt up through the terraces, with lamps.
    const span = FAN.a1 - FAN.a0;
    const walkAngles = [FAN.a0 + 0.03, FAN.a0 + span * 0.28, FAN.a0 + span * 0.55, FAN.a0 + span * 0.8, FAN.a1 - 0.03];
    const walkMat = new THREE.MeshStandardMaterial({ color: 0xb4ab9a, roughness: 0.9 });
    const lampPos: number[] = [];
    const lampCol: number[] = [];
    for (const a of walkAngles) {
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const side = new THREE.Vector2(-dir.y, dir.x);
      const end = fanRim(a) + 3;
      const verts: number[] = [];
      const idx: number[] = [];
      const STEPS = Math.round((end - FAN.plaza) / 1.5);
      for (let i = 0; i <= STEPS; i++) {
        const r = FAN.plaza + ((end - FAN.plaza) * i) / STEPS;
        for (const s of [-1, 1]) {
          const x = ZION.x + dir.x * r + side.x * 1.3 * s;
          const z = ZION.z + dir.y * r + side.y * 1.3 * s;
          verts.push(x, terrainHeight(x, z) + 0.3, z);
        }
        if (i < STEPS) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
        if (i % 6 === 3) {
          const x = ZION.x + dir.x * r + side.x * 2;
          const z = ZION.z + dir.y * r + side.y * 2;
          lampPos.push(x, terrainHeight(x, z) + 2.6, z);
          lampCol.push(2.6, 1.9, 1.0);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      landmarks.add(new THREE.Mesh(geo, walkMat));
    }
    addLights(lightPoints(lampPos, lampCol, 1.6, 0.15, pixelRatio));

    // The multitudes on the terraces (and gathered in front of the stage).
    const pos: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < 5200; i++) {
      let x: number;
      let z: number;
      if (i < 500) {
        const a = -Math.PI + rand() * Math.PI;
        const r = 4 + rand() * (FAN.plaza - 5);
        x = ZION.x + Math.cos(a) * r;
        z = ZION.z + Math.sin(a) * r;
      } else {
        const a = FAN.a0 + rand() * span;
        const r = FAN.plaza + 2 + Math.sqrt(rand()) * (fanRim(a) - FAN.plaza - 5);
        if (walkAngles.some((w) => Math.abs(w - a) * r < 2.2)) continue;
        x = ZION.x + Math.cos(a) * r;
        z = ZION.z + Math.sin(a) * r;
      }
      pos.push(x, terrainHeight(x, z) + 1.1, z);
      const w = rand();
      col.push(1.4 + w * 0.8, 0.9 + w * 0.6, 0.45 + w * 0.4);
    }
    addLights(lightPoints(pos, col, 0.75, 1, pixelRatio));

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
    beam.position.set(STAGE.x, 86, STAGE.z);
    landmarks.add(beam);

    // Floodlight towers along the top of the grounds, aimed at the stage.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 3 });
    for (let i = 0; i < 7; i++) {
      const a = FAN.a0 + 0.12 + ((span - 0.24) * i) / 6;
      const r = fanRim(a) + 4;
      const x = ZION.x + Math.cos(a) * r;
      const z = ZION.z + Math.sin(a) * r;
      const y0 = terrainHeight(x, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 22, 8), poleMat);
      pole.position.set(x, y0 + 11, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 0.8), headMat);
      head.position.set(x, y0 + 22.5, z);
      head.lookAt(STAGE.x, 0, STAGE.z);
      landmarks.add(pole, head);
      addGlow(head.position, 7, 0.4);
    }
    // Pick area: the whole fan (CylinderGeometry θ runs from +z towards +x, i.e. θ = π/2 − angle).
    pickProxy("zion", new THREE.CylinderGeometry(98, 98, 22, 32, 1, false, Math.PI / 2 - FAN.a1, span), new THREE.Vector3(ZION.x, 6, ZION.z));
    pickProxy("zion", new THREE.SphereGeometry(STAGE.r + 4, 16, 10), new THREE.Vector3(STAGE.x, 2, STAGE.z));

    // Footbridge from the forecourt over the river to the car park.
    {
      const p0 = new THREE.Vector2(13, 41);
      const p1 = new THREE.Vector2(8, 63);
      const len = p0.distanceTo(p1);
      const yaw = Math.atan2(p1.x - p0.x, p1.y - p0.y);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.7, len), new THREE.MeshStandardMaterial({ color: 0x8c8780, roughness: 0.85 }));
      deck.position.set((p0.x + p1.x) / 2, 1.3, (p0.y + p1.y) / 2);
      deck.rotation.y = yaw;
      landmarks.add(deck);
      const rail: number[] = [];
      const railCol: number[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        for (const s of [-1, 1]) {
          rail.push(p0.x + (p1.x - p0.x) * t + Math.cos(yaw) * 1.8 * s, 2.3, p0.y + (p1.y - p0.y) * t - Math.sin(yaw) * 1.8 * s);
          railCol.push(2.4, 1.8, 1.0);
        }
      }
      addLights(lightPoints(rail, railCol, 1, 0.2, pixelRatio));
    }
  }

  await yieldToBrowser();
  // City Gate: a long façade of lit hexagonal stone panels along the road, a glass entrance in the
  // middle and a drive-through arch either side; bronze lions and a globe in a fountain in front.
  {
    const g = new THREE.Group();
    g.position.set(GATE.x, 0.2, GATE.z);
    g.rotation.y = ROAD_YAW;
    landmarks.add(g);
    g.updateMatrixWorld(true);
    const PX = 24;
    const W = GATE.w * PX;
    const H = GATE.h * PX;
    // Openings in façade-local units (x from the centre): [centre x, bottom half-width, top half-width, height].
    const openings = [
      [0, 6.5, 3.4, 8.6],
      [-13.5, 4, 2.2, 6.4],
      [13.5, 4, 2.2, 6.4],
    ] as const;
    const draw = (emissive: boolean, sign: boolean) => (ctx: CanvasRenderingContext2D) => {
      const X = (x: number) => (x + GATE.w / 2) * PX;
      const Y = (y: number) => H - y * PX;
      ctx.fillStyle = emissive ? "#000" : "#7d6c50";
      ctx.fillRect(0, 0, W, H);
      // Hexagon panels.
      const R = 1.5 * PX;
      const hw = Math.sqrt(3) * R;
      const r = rng(sign ? 21 : 22);
      for (let row = 0; row * R * 1.5 < H + R; row++)
        for (let col = 0; col * hw < W + hw; col++) {
          const cx = col * hw + (row % 2 ? hw / 2 : 0);
          const cy = row * R * 1.5;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            ctx.lineTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94);
          }
          ctx.closePath();
          if (emissive) {
            ctx.fillStyle = `rgba(140, 88, 36, ${0.14 + r() * 0.08})`;
            ctx.fill();
          } else {
            ctx.fillStyle = r() < 0.5 ? "#a8956f" : "#9a8764";
            ctx.fill();
          }
        }
      // Light strips along the top and both ends.
      if (emissive) {
        ctx.fillStyle = "#ffcf8a";
        ctx.fillRect(0, 0, W, 7);
        ctx.fillRect(0, 0, 7, H);
        ctx.fillRect(W - 7, 0, 7, H);
      }
      // Openings: lit glass in the middle, dark drive-throughs with glowing frames either side.
      openings.forEach(([cx, b, t, h], i) => {
        ctx.beginPath();
        ctx.moveTo(X(cx - b), Y(0));
        ctx.lineTo(X(cx - t), Y(h));
        ctx.lineTo(X(cx + t), Y(h));
        ctx.lineTo(X(cx + b), Y(0));
        ctx.closePath();
        if (i === 0) ctx.fillStyle = emissive ? "#ffc47a" : "#f0cf98";
        else ctx.fillStyle = emissive ? "#000" : "#141210";
        ctx.fill();
        ctx.lineWidth = 9;
        ctx.strokeStyle = emissive ? "#ffb35c" : "#5a4528";
        ctx.stroke();
      });
      if (sign) {
        ctx.fillStyle = emissive ? "#fff3d8" : "#fff6e6";
        ctx.font = `600 ${1.5 * PX}px Georgia, serif`;
        ctx.textAlign = "center";
        ctx.fillText("CITY", X(0), Y(6.6));
        ctx.fillText("GATE", X(0), Y(4.9));
      }
    };
    const faceMat = (sign: boolean) =>
      new THREE.MeshStandardMaterial({ map: canvasTexture(W, H, draw(false, sign)), emissiveMap: canvasTexture(W, H, draw(true, sign)), emissive: 0xffffff, emissiveIntensity: 0.95, roughness: 0.7 });
    const plain = new THREE.MeshStandardMaterial({ color: 0x8a7858, roughness: 0.75 });
    // Box faces: +x, −x, +y, −y, +z (back, into the city), −z (front, facing the road).
    const wall = new THREE.Mesh(new THREE.BoxGeometry(GATE.w, GATE.h, GATE.d), [plain, plain, plain, plain, faceMat(false), faceMat(true)]);
    wall.position.y = GATE.h / 2;
    g.add(wall);
    addLights(lightPoints(Array.from({ length: 30 }, (_, k) => {
      const p = g.localToWorld(new THREE.Vector3(-GATE.w / 2 + (k + 0.5) * (GATE.w / 30), GATE.h + 0.1, -GATE.d / 2));
      return [p.x, p.y, p.z];
    }).flat(), new Array(90).fill(0).map((_, i) => [2.6, 2.0, 1.1][i % 3]), 1.2, 0.05, pixelRatio));

    // Fountain with the globe and two bronze lions, in front of the entrance.
    const bronze = new THREE.MeshStandardMaterial({ color: 0x7a4e2c, roughness: 0.35, metalness: 0.8, emissive: 0x2a1405, emissiveIntensity: 0.6 });
    const fz = -GATE.d / 2 - 6.5;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(22, 0.8, 7), new THREE.MeshStandardMaterial({ color: 0x8b806f, roughness: 0.8 }));
    rim.position.set(0, 0.4, fz);
    const pool = new THREE.Mesh(new THREE.BoxGeometry(21, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0x1d2a38, roughness: 0.08, metalness: 0.7 }));
    pool.position.set(0, 0.82, fz);
    const globeGeo = new THREE.IcosahedronGeometry(2.3, 2);
    const globe = new THREE.Mesh(globeGeo, bronze);
    globe.position.set(0, 3.2, fz);
    const globeLines = new THREE.LineSegments(new THREE.EdgesGeometry(globeGeo, 1), new THREE.LineBasicMaterial({ color: new THREE.Color(1.6, 1.0, 0.5) }));
    globeLines.position.copy(globe.position);
    globeLines.scale.setScalar(1.01);
    g.add(rim, pool, globe, globeLines);
    for (const sx of [-6.5, 6.5]) {
      const lion = new THREE.Group();
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 3), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.7 }));
      plinth.position.y = 1.2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 2.4), bronze);
      body.position.set(0, 2.4, 0.3);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 10), bronze);
      head.position.set(0, 3.6, -0.7);
      lion.add(plinth, body, head);
      lion.position.set(sx, 0, fz);
      g.add(lion);
    }
    const rimLights: number[] = [];
    for (let k = 0; k < 24; k++) {
      const p = g.localToWorld(new THREE.Vector3(-10.5 + (k * 21) / 23, 1.0, fz - 3.6));
      rimLights.push(p.x, p.y, p.z);
    }
    addLights(lightPoints(rimLights, new Array(72).fill(0).map((_, i) => [2.6, 1.9, 1.0][i % 3]), 0.9, 0.1, pixelRatio));
    addGlow(g.localToWorld(new THREE.Vector3(0, 4, -GATE.d / 2 - 1)), 26, 0.55);
    addGlow(g.localToWorld(new THREE.Vector3(0, 3, fz)), 14, 0.45);

    pickProxy("gate", new THREE.BoxGeometry(GATE.w + 4, 16, 24), g.localToWorld(new THREE.Vector3(0, 8, -6)));
    pickables[pickables.length - 1].rotation.y = ROAD_YAW;
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

  // 1,500-bed facility: the two gold-roofed blocks of the aerial render, glazed and lit.
  {
    const goldRoof = new THREE.MeshStandardMaterial({ color: 0x9e8b52, roughness: 0.4, metalness: 0.6 });
    for (const b of FACILITY_BLOCKS) {
      const { map, emissiveMap } = facade(Math.round(b.w / 2.4), Math.round(b.h / 3), b.seed, "#3b3733", 0.74);
      const side = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffd59a, emissiveIntensity: 1.5, roughness: 0.45, metalness: 0.2 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), [side, side, goldRoof, goldRoof, side, side]);
      mesh.position.set(b.x, b.h / 2 + 0.2, b.z);
      mesh.rotation.y = b.yaw;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1.8, 0.9, b.d + 1.8), goldRoof);
      cap.position.set(b.x, b.h + 0.65, b.z);
      cap.rotation.y = b.yaw;
      landmarks.add(mesh, cap);
    }
    addGlow(new THREE.Vector3(FACILITY.x, 4, FACILITY.z), 30, 0.2);
    pickProxy("facility", new THREE.BoxGeometry(58, 22, 30), new THREE.Vector3(FACILITY.x, 10, FACILITY.z));
    pickables[pickables.length - 1].rotation.y = -0.62;
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
    const STALL_X0 = -66; // car stalls run from here…
    const STALL_X1 = 46; // …to here; the bus bay is east of it
    const ROWS = [
      { z0: -12, z1: -7 },
      { z0: -7, z1: -2 },
      { z0: 3, z1: 8 },
    ];
    const AISLES = [0.5, 10.5];
    // Planted tree islands breaking up the rows (as in the render), and the footbridge landing.
    const ISLANDS = [-68, -28, 12];
    const BRIDGE_LX = -6;
    const keepClear = (lx: number, row: number) => ISLANDS.some((x) => Math.abs(lx - x) < 1.8) || (row === 0 && Math.abs(lx - BRIDGE_LX) < 3);

    // Painted asphalt.
    const PX = 14;
    const tex = canvasTexture(LOT.w * PX, LOT.d * PX, (ctx) => {
      const r = rng(7);
      const X = (lx: number) => (lx + HW) * PX;
      const Z = (lz: number) => (lz + HD) * PX;
      ctx.fillStyle = "#2e2d2c";
      ctx.fillRect(0, 0, LOT.w * PX, LOT.d * PX);
      for (let i = 0; i < 4000; i++) {
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
        for (const ax of [-50, -18, 28]) {
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
      for (const [z0, z1] of [[-12.5, -1.5]]) {
        for (let x = 48; x <= 66.01; x += 3) {
          ctx.beginPath();
          ctx.moveTo(X(x), Z(z0));
          ctx.lineTo(X(x), Z(z1));
          ctx.stroke();
        }
      }
      // Zebra crossing at the footbridge landing.
      ctx.fillStyle = "#e9e5dc";
      for (let k = 0; k < 5; k++) ctx.fillRect(X(BRIDGE_LX - 2.5 + k), Z(-12.8), 7, 0.9 * PX);
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
    const cars = new THREE.InstancedMesh(carGeo, vehicleMat, 140);
    let n = 0;
    ROWS.forEach((row, ri) => {
      for (let x = STALL_X0 + STALL / 2; x < STALL_X1; x += STALL) {
        if (keepClear(x, ri) || rand() < 0.22) continue; // islands + a few empty bays
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
    for (const zc of [-7]) {
      for (let k = 0; k < 6; k++) {
        if (rand() < 0.15) continue;
        buses.setMatrixAt(nbus, m.compose(at(49.5 + k * 3, zc), q.identity(), one));
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
      tuks.setMatrixAt(k, m.compose(at(-64 + k * 1.7, 10.5), q, one));
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
      for (const lx of [-55, -30, -5, 20, 45]) {
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

    // Planted islands with palms and shade trees between the bays.
    const islandMat = new THREE.MeshStandardMaterial({ color: 0x3f6128, roughness: 1 });
    const islandPalmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    addSway(islandPalmMat, time, reducedMotion ? 0 : 0.3, 8);
    const islandPalms = new THREE.InstancedMesh(palmGeometry(), islandPalmMat, 16);
    const shade = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1).translate(0, 1.4, 0), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 16);
    let np = 0;
    let nt = 0;
    for (const ix of ISLANDS) {
      for (const [z0, z1] of [[-12, -2], [3, 8]]) {
        const island = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, z1 - z0), islandMat);
        island.position.copy(at(ix, (z0 + z1) / 2, 0.45));
        landmarks.add(island);
        for (const zz of z1 - z0 > 6 ? [z0 + 2, z1 - 2] : [(z0 + z1) / 2]) {
          q.setFromAxisAngle(up, rand() * Math.PI * 2);
          if ((ix + zz) % 2 === 0 || nt >= 16) islandPalms.setMatrixAt(np++, m.compose(at(ix, zz, 0.6), q, one.clone().multiplyScalar(0.9 + rand() * 0.2)));
          else {
            shade.setMatrixAt(nt, m.compose(at(ix, zz, 0.5), q, new THREE.Vector3(2.4, 2, 2.4)));
            shade.setColorAt(nt++, c.setHSL(0.27 + rand() * 0.06, 0.45, 0.12 + rand() * 0.05));
          }
        }
      }
    }
    islandPalms.count = np;
    shade.count = nt;
    landmarks.add(islandPalms, shade);

    // Entrance booth with a barrier arm at the west end, where the access road comes in.
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.8, emissive: 0x3a2a18, emissiveIntensity: 0.4 }));
    booth.position.copy(at(-HW - 1.8, 7, 1.5));
    const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.25, 2.8), new THREE.MeshStandardMaterial({ color: 0xa8492b }));
    boothRoof.position.copy(at(-HW - 1.8, 7, 2.85));
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 4.2), new THREE.MeshStandardMaterial({ color: 0xd23a2a, emissive: 0x401010 }));
    barrier.position.copy(at(-HW - 0.4, 10.5, 1.15));
    landmarks.add(booth, boothRoof, barrier);
    addLights(lightPoints([CARPARK.x - HW - 0.6, 2.2, CARPARK.z + 7], [2.4, 1.8, 1.0], 1.6, 0, pixelRatio));

    pickProxy("carpark", new THREE.BoxGeometry(LOT.w + 4, 10, LOT.d + 4), at(0, 0, 4));
  }

  await yieldToBrowser();
  // The Miracle Dome (existing, opened 2022): oval white hall with flared walls, a low ribbed
  // metal roof, glass entrance, the white "sail" fin on its west side, an annex and its own parking.
  {
    const SX = DOME.rx / 22.4; // lathe radius 22.4 → oval footprint
    const g = new THREE.Group();
    g.position.set(DOME.x, 0.25, DOME.z);
    // Modelled with the entrance on local −z; turned as in the aerial render (long axis NNW–SSE,
    // entrance facing north-east towards the City Gate).
    g.rotation.y = DOME.yaw;
    landmarks.add(g);
    g.updateMatrixWorld(true);
    const toWorld = (x: number, y: number, z: number) => g.localToWorld(new THREE.Vector3(x, y, z));

    const white = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.55 });
    // Walls lean slightly outwards up to the rim, like the real building.
    const wallProfile = [[19.6, 0], [20.1, 3], [20.9, 7], [21.9, 10.6], [22.4, 11.3]].map(([r, y]) => new THREE.Vector2(r, y));
    const walls = new THREE.Mesh(new THREE.LatheGeometry(wallProfile, 96), white);
    walls.scale.set(SX, 1, 1);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(22.7, 22.5, 1.3, 96, 1, true), white);
    rim.scale.set(SX, 1, 1);
    rim.position.y = 11.9;

    // Low, ribbed green roof (as in the masterplan renders).
    const ribs = canvasTexture(1024, 64, (ctx) => {
      ctx.fillStyle = "#6f9a40";
      ctx.fillRect(0, 0, 1024, 64);
      ctx.fillStyle = "#5a8234";
      for (let x = 0; x < 1024; x += 8) ctx.fillRect(x, 0, 2, 64);
    });
    const roofProfile: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * (Math.PI / 2);
      roofProfile.push(new THREE.Vector2(22.4 * Math.cos(t) + 0.01, 12.5 + 6.2 * Math.sin(t)));
    }
    roofProfile.reverse();
    const roof = new THREE.Mesh(new THREE.LatheGeometry(roofProfile, 128), new THREE.MeshStandardMaterial({ map: ribs, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
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
    addGlow(toWorld(4, 4, -DOME.rz - 2), 20, 0.45);

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
      const p = toWorld(Math.cos(a) * DOME.rx * 1.01, 12.15, Math.sin(a) * DOME.rz * 1.01);
      rimPos.push(p.x, p.y, p.z);
      rimCol.push(2.2, 1.9, 1.4);
    }
    addLights(lightPoints(rimPos, rimCol, 0.9, 0.15, pixelRatio));

    // Gold crescent walk around the south-east side (world angles; see CRESCENT).
    {
      const goldMat = new THREE.MeshStandardMaterial({ color: 0x9a8850, roughness: 0.6, metalness: 0.35, side: THREE.DoubleSide });
      const len = CRESCENT.a1 - CRESCENT.a0;
      // RingGeometry lies in XY; after rotateX(−π/2) its angle θ maps to world angle −θ.
      const top = new THREE.Mesh(new THREE.RingGeometry(CRESCENT.r0, CRESCENT.r1, 72, 1, -CRESCENT.a1, len).rotateX(-Math.PI / 2), goldMat);
      top.position.set(DOME.x, 1.7, DOME.z);
      landmarks.add(top);
      // Its side walls (CylinderGeometry θ = π/2 − world angle).
      for (const r of [CRESCENT.r0, CRESCENT.r1]) {
        const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2.6, 72, 1, true, Math.PI / 2 - CRESCENT.a1, len), goldMat);
        wall.position.set(DOME.x, 0.4, DOME.z);
        landmarks.add(wall);
      }
      const lights: number[] = [];
      const lightCol: number[] = [];
      for (let k = 0; k <= 40; k++) {
        const a = CRESCENT.a0 + (len * k) / 40;
        lights.push(DOME.x + Math.cos(a) * (CRESCENT.r1 + 0.2), 1.9, DOME.z + Math.sin(a) * (CRESCENT.r1 + 0.2));
        lightCol.push(2.4, 1.9, 1.0);
      }
      addLights(lightPoints(lights, lightCol, 1, 0.1, pixelRatio));
    }

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
    pickables[pickables.length - 1].rotation.y = DOME.yaw;
  }

  await yieldToBrowser();
  // ===== Surroundings =====

  // Roads. [0] = Katunayake–Veyangoda Road: from the airport side (SW) along the north-west edge of
  // the site (as in the aerial render), inland to the NE.
  const roads = [
    [[-330, 175], [-260, 70], [-205, -35], [-160, -61], [-80, -107], [0, -153], [120, -222], [260, -302], [460, -417], [620, -509]],
    // In through the City Gate's east arch, past the facility, over the river to the car park.
    [[-77, -108], [-68.7, -92.5], [-58, -80], [-40, -62], [-28, -38], [-36, 0], [-48, 24], [-58, 40], [-60, 58], [-64, 74], [-57, 86.5]],
    [[-36, 2], [-14, 14], [4, 22]], // to the stage forecourt
    [[-130, -78], [-112, -64], [-92, -55], [-78, -42]], // Miracle Dome forecourt
    [[-160, 115], [-175, 160], [-200, 205]], // airport access
    [[-57, 86.5], [-60, 160], [-110, 300], [-140, 520]], // south towards Seeduwa / Colombo
    [[-160, -61], [-170, -90], [-205, -125]], // north towards the lagoon shore
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

  // ---------- Airliners at Bandaranaike International ----------
  // A twin-engine wide-body (local +z = nose, +x = left wing): rounded fuselage with nose and
  // tail cones, swept wings with engines, tailplane and fin, cockpit glass, lit cabin windows.
  const airlinerParts = (() => {
    const fuselage = (() => {
      // Lathe profile (radius, position along the body); rotated so +y becomes the nose (+z).
      const pts: [number, number][] = [
        [0.01, -8.4], [0.22, -8.1], [0.45, -7.4], [0.68, -6.2], [0.84, -4.6], [0.86, -3], [0.86, 5.2],
        [0.83, 6.1], [0.74, 6.9], [0.56, 7.6], [0.3, 8.1], [0.01, 8.35],
      ];
      return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 20).rotateX(Math.PI / 2);
    })();
    // Planform (x = span, y = along the body) extruded thin, then laid flat.
    const flat = (outline: [number, number][], thick: number) => {
      const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
      return new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, thick / 2, 0);
    };
    const wing = flat([[0, 2.1], [9.6, -2.5], [9.6, -3.3], [0, -1.7], [-9.6, -3.3], [-9.6, -2.5]], 0.18);
    const tailplane = flat([[0, -5.9], [3.6, -7.6], [3.6, -8.1], [0, -7.5], [-3.6, -8.1], [-3.6, -7.6]], 0.12);
    // Fin in the y/z plane.
    const fin = (() => {
      const shape = new THREE.Shape([new THREE.Vector2(-5.4, 0.5), new THREE.Vector2(-8.1, 0.5), new THREE.Vector2(-8.5, 3.7), new THREE.Vector2(-7.4, 3.7)]);
      return new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.07, 0, 0);
    })();
    const engine = new THREE.CylinderGeometry(0.42, 0.36, 2.3, 16).rotateX(Math.PI / 2);
    const intake = new THREE.CircleGeometry(0.36, 16);
    const pylon = new THREE.BoxGeometry(0.12, 0.45, 1.4);
    const windscreen = new THREE.BoxGeometry(0.62, 0.16, 0.55);
    return { fuselage, wing, tailplane, fin, engine, intake, pylon, windscreen };
  })();
  const liveries = [
    { tail: 0x1d3f7a, belly: 0xcfd3d8 },
    { tail: 0x7a1d2e, belly: 0xd8d2cf },
    { tail: 0x1f6b5c, belly: 0xcfd8d4 },
    { tail: 0xc49a3a, belly: 0xd8d5cf },
  ];
  // Slightly matte off-white so the sunset doesn't make the body glow.
  const white = new THREE.MeshStandardMaterial({ color: 0xdedcd7, roughness: 0.55, metalness: 0.15 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.4, metalness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0c1118, roughness: 0.1, metalness: 0.8, emissive: 0x1a2a3a, emissiveIntensity: 0.6 });
  const makeAirliner = (livery: (typeof liveries)[number], lit: boolean) => {
    const g = new THREE.Group();
    const accent = new THREE.MeshStandardMaterial({ color: livery.tail, roughness: 0.35, metalness: 0.3 });
    const p = airlinerParts;
    const body = new THREE.Mesh(p.fuselage, white);
    const wing = new THREE.Mesh(p.wing, white);
    wing.position.set(0, -0.35, 0);
    const tailplane = new THREE.Mesh(p.tailplane, white);
    tailplane.position.set(0, 0.25, 0);
    const fin = new THREE.Mesh(p.fin, accent);
    const windscreen = new THREE.Mesh(p.windscreen, glassMat);
    windscreen.position.set(0, 0.37, 7.2);
    windscreen.rotation.x = -0.45;
    g.add(body, wing, tailplane, fin, windscreen);
    for (const sx of [-3.4, 3.4]) {
      const eng = new THREE.Mesh(p.engine, accent);
      eng.position.set(sx, -0.85, 1.25);
      const intake = new THREE.Mesh(p.intake, darkMat);
      intake.position.set(sx, -0.85, 2.41);
      const pylon = new THREE.Mesh(p.pylon, white);
      pylon.position.set(sx, -0.48, 0.9);
      g.add(eng, intake, pylon);
    }
    // Cabin windows along both sides, and the navigation lights (red = left/+x, green = right).
    const win: number[] = [];
    const winCol: number[] = [];
    if (lit) {
      for (let z = -5.4; z <= 5.6; z += 0.42) {
        for (const sx of [-0.87, 0.87]) {
          win.push(sx, 0.18, z);
          winCol.push(1.15, 1.0, 0.75);
        }
      }
      addLights(lightPoints(win, winCol, 0.28, 0.05, pixelRatio), g);
    }
    // Kept just above the bloom threshold: visible points, not glowing halos.
    addLights(lightPoints([9.6, -0.3, -2.6, -9.6, -0.3, -2.6, 0, 0.9, -8.4], [1.5, 0.15, 0.12, 0.12, 1.5, 0.35, 1.3, 1.3, 1.3], 0.9, 0, pixelRatio), g);
    return g;
  };
  // Flashing lights (white wing-tip strobes, red beacons above and below), kept separate to blink.
  const addFlashers = (g: THREE.Group) => ({
    strobe: addLights(lightPoints([9.7, -0.3, -2.9, -9.7, -0.3, -2.9, 0, 0.4, -8.6], [1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6], 1.1, 0, pixelRatio), g),
    beacon: addLights(lightPoints([0, 0.95, 0.5, 0, -0.95, 0.5], [1.6, 0.15, 0.12, 1.6, 0.15, 0.12], 1, 0, pixelRatio), g),
  });

  // 1. Landing: final approach to runway 04 from the south-west, touchdown and roll-out.
  const plane = makeAirliner(liveries[0], true);
  addLights(lightPoints([3.2, -0.4, 0.4, -3.2, -0.4, 0.4, 0, -0.7, 7.6], [1.6, 1.55, 1.4, 1.6, 1.55, 1.4, 1.6, 1.55, 1.4], 1.4, 0, pixelRatio), plane); // landing lights
  const planeLights = addFlashers(plane);
  scene.add(plane);
  const PLANE_CYCLE = 42; // seconds
  const touchdown = -RUNWAY.len / 2 + 30;
  const planeAt = (t: number) => {
    // 0–0.62 approach, 0.62–0.8 flare + roll-out, rest: off the runway, out of sight.
    if (t < 0.62) {
      const k = t / 0.62;
      return { along: touchdown - (1 - k) * 700, alt: 2 + (1 - k) * 74, visible: true };
    }
    if (t < 0.8) {
      const k = (t - 0.62) / 0.18;
      return { along: touchdown + (1 - (1 - k) ** 2) * 190, alt: 2, visible: true };
    }
    return { along: 0, alt: 0, visible: false };
  };

  // 2. Take-off: rolls from the threshold while the lander is still far out, lifts off and climbs
  //    out to the north-east (cleared from the runway well before the lander touches down).
  const departure = makeAirliner(liveries[1], true);
  const departureLights = addFlashers(departure);
  scene.add(departure);
  const departureAt = (t: number) => {
    const start = -RUNWAY.len / 2 + 12;
    if (t < 0.04 || t > 0.5) return { along: 0, alt: 0, visible: false };
    if (t < 0.17) {
      const k = (t - 0.04) / 0.13; // accelerating roll
      return { along: start + k * k * 170, alt: 2, visible: true };
    }
    const k = (t - 0.17) / 0.33; // rotate and climb away
    return { along: start + 170 + k * 820 + k * k * 260, alt: 2 + k * 70 + k * k * 90, visible: true };
  };

  // 3. Airliners parked at the terminal gates, noses towards the building.
  {
    const gateYaw = Math.atan2(-RUNWAY.dir.z, RUNWAY.dir.x); // nose pointing at the terminal (+perp)
    [-34, -4, 26].forEach((along, i) => {
      const parked = makeAirliner(liveries[(i + 1) % liveries.length], false);
      const pos = runwayPoint(along, 40);
      parked.position.set(pos.x, 1.35, pos.z);
      parked.rotation.y = gateYaw;
      scene.add(parked);
    });
  }

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
      [60, 190], [-120, 150], [175, 62], [300, 8], [-110, -135], [380, -70],
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
  // `rot`: in-plane rotation (same convention as rotation.y) for stretched rings.
  const ringDefs: Record<string, { pos: THREE.Vector3; r: number; sx?: number; rot?: number }> = {
    gate: { pos: new THREE.Vector3(GATE.x, 0.6, GATE.z - 2), r: 13, sx: 2, rot: ROAD_YAW },
    facility: { pos: new THREE.Vector3(FACILITY.x, 0.6, FACILITY.z), r: 21, sx: 1.6, rot: -0.62 },
    carmel: { pos: new THREE.Vector3(HILL.x, peakY + 0.7, HILL.z), r: HILL.top + 2.5 },
    zion: { pos: new THREE.Vector3(ZION.x, 0.7, ZION.z + 3), r: 22 },
    carpark: { pos: new THREE.Vector3(CARPARK.x, 0.6, CARPARK.z), r: 18, sx: 4.2 },
    dome: { pos: new THREE.Vector3(DOME.x, 0.7, DOME.z), r: DOME.rz + 9, sx: (DOME.rx + 9) / (DOME.rz + 9), rot: DOME.yaw },
  };
  for (const [id, def] of Object.entries(ringDefs)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(def.r, def.r + 0.9, 96),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.rotation.z = def.rot ?? 0;
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
  // No MSAA buffer: resolving a multisampled half-float target cost ~20 ms a frame (2/3 of the
  // frame on typical laptops). Edges are smoothed by a final SMAA pass instead (~1–2 ms).
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
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
  composer.addPass(new SMAAPass(1, 1));

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
  // Touch: "pan-y" leaves vertical swipes to the browser (the page scrolls as usual), while a
  // sideways swipe reaches the map and rotates it; two fingers pinch-zoom.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  renderer.domElement.style.touchAction = "pan-y";
  controls.update();
  if (cinematic) {
    controls.enabled = false;
    controls.autoRotate = false;
  }

  // Mouse wheel scrolls the page as usual; only trackpad pinch (ctrl+wheel) zooms the map.
  const addWheel = (el: HTMLElement) =>
    el.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) e.stopPropagation();
      },
      { capture: true },
    );
  if (!cinematic) addWheel(view.container);

  // Hero fly-in: from high over the coast down to the establishing view, then a slow drift.
  const INTRO = {
    fromPos: new THREE.Vector3(560, 300, 700),
    fromTarget: new THREE.Vector3(40, 0, -10),
    toPos: new THREE.Vector3(186, 88, 230),
    toTarget: new THREE.Vector3(-18, 6, -22),
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
  const focusDistance: Record<string, number> = { carmel: 80, zion: 150, facility: 100, carpark: 125, dome: 115, gate: 85 };
  // Fixed viewing directions (from the target towards the camera), chosen to keep the sunset to
  // the side: Carmel Hill and the grounds from the south, the City Gate from the road (its front),
  // the Miracle Dome from the east over its crescent.
  const viewDir: Record<string, THREE.Vector3> = {
    carmel: new THREE.Vector3(-0.35, 0, 1),
    zion: new THREE.Vector3(0.2, 0, 1),
    gate: new THREE.Vector3(-0.498, 0, -0.867),
    facility: new THREE.Vector3(0.25, 0, -1),
    dome: new THREE.Vector3(0.9, 0, 0.45),
  };

  let highlighted: string | null = null;
  const highlight = (id: string | null) => {
    highlighted = id;
  };

  const focus = (id: string) => {
    const anchor = view.anchors.get(id);
    if (!anchor || cinematic) return;
    // Others: a three-quarter aerial from the current side.
    const carmel = id === "carmel";
    const toTarget = carmel ? new THREE.Vector3(HILL.x, peakY + 3, HILL.z) : anchor.clone().setY(Math.max(4, anchor.y - 8));
    const fixedDir = viewDir[id];
    const dir = fixedDir ? fixedDir.clone().normalize() : camera.position.clone().sub(controls.target).setY(0).normalize();
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
      view.onHover(id);
    }
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    if (hoverId) view.onHover((hoverId = null));
    renderer.domElement.style.cursor = "";
  });
  let downAt = { x: 0, y: 0 };
  renderer.domElement.addEventListener("pointerdown", (e) => (downAt = { x: e.clientX, y: e.clientY }));
  renderer.domElement.addEventListener("click", (e) => {
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 6) return; // was a drag
    if (cinematic) return;
    const id = pick(e as PointerEvent);
    if (id) view.onSelect(id);
  });

  // Size + visibility
  let width = 1;
  let height = 1;
  // Name-card sizes, measured once per resize (measuring every frame would force layout).
  const labelSize = new Map<HTMLElement, { w: number; h: number }>();
  const resize = () => {
    labelSize.clear(); // name cards change size with the breakpoint
    width = view.container.clientWidth || 1;
    height = view.container.clientHeight || 1;
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
  const resizer = new ResizeObserver(() => resize());
  resize();

  // Move the canvas to whichever view is on screen (the interactive map wins if both are).
  const switchTo = (next: View) => {
    if (!cinematic) view.saved = { pos: camera.position.clone(), target: controls.target.clone() };
    flight = null;
    if (hoverId) view.onHover((hoverId = null));
    renderer.domElement.style.cursor = "";
    view = next;
    cinematic = next.cinematic;
    next.container.append(renderer.domElement);
    renderer.domElement.style.pointerEvents = cinematic ? "none" : "";
    controls.enabled = !cinematic;
    controls.autoRotate = !cinematic && !reducedMotion;
    if (!cinematic) {
      camera.position.copy(next.saved?.pos ?? HOME.pos);
      controls.target.copy(next.saved?.target ?? HOME.target);
      controls.update();
    }
    resize();
  };
  const anyVisible = () => views.some((v) => v.visible);
  const visibility = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const v = views.find((x) => x.container === entry.target);
      if (v) v.visible = entry.isIntersecting;
    }
    const next = views.find((v) => v.visible && !v.cinematic) ?? views.find((v) => v.visible);
    if (next && next !== view) switchTo(next);
    if (anyVisible()) loop();
  });
  const watch = (v: View) => {
    visibility.observe(v.container);
    resizer.observe(v.container);
  };
  watch(view);

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
  const lifts = new Map<HTMLElement, number>();
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const positionMarkers = () => {
    const shown: { el: HTMLElement; x: number; y: number }[] = [];
    for (const [id, el] of view.markers) {
      const anchor = view.anchors.get(id);
      if (!anchor) continue;
      const { x, y } = project(el, anchor);
      el.classList.toggle("hotspot--right", x > width * 0.7);
      el.classList.toggle("hotspot--left", x < width * 0.25);
      const card = el.dataset.card;
      el.classList.toggle("hotspot--below", card === "below" || (card !== "above" && y < height * 0.45));
      if (!el.classList.contains("is-hidden")) shown.push({ el, x, y });
    }
    // Stack overlapping name cards: nearest (lowest on screen) first, others lift above them.
    shown.sort((a, b) => b.y - a.y);
    placed.length = 0;
    const STEM = 14;
    const PAD = 6;
    for (const s of shown) {
      let size = labelSize.get(s.el);
      if (!size) {
        const label = s.el.querySelector<HTMLElement>(".hotspot__label");
        size = { w: label?.offsetWidth ?? 0, h: label?.offsetHeight ?? 0 };
        labelSize.set(s.el, size);
      }
      let lift = 0;
      const x0 = s.x - size.w / 2 - PAD;
      const x1 = s.x + size.w / 2 + PAD;
      for (let tries = 0; tries < shown.length; tries++) {
        const y1 = s.y - STEM - lift;
        const y0 = y1 - size.h - PAD;
        const hit = placed.find((p) => x0 < p.x1 && x1 > p.x0 && y0 < p.y1 && y1 > p.y0);
        if (!hit) break;
        lift += y1 - hit.y0;
      }
      placed.push({ x0, x1, y0: s.y - STEM - lift - size.h - PAD, y1: s.y - STEM - lift });
      const rounded = Math.round(lift);
      if (lifts.get(s.el) !== rounded) {
        lifts.set(s.el, rounded);
        s.el.style.setProperty("--lift", `${rounded}px`);
      }
    }
    view.labels.forEach((l, i) => project(l.el, view.labelPositions[i], -10));
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

    // Arriving and departing airliners: aim each along its path (so it pitches down on approach
    // and up on climb-out), and blink the strobes and beacons.
    const cycle = (t % PLANE_CYCLE) / PLANE_CYCLE;
    const fly = (obj: THREE.Object3D, at: typeof planeAt, lights: ReturnType<typeof addFlashers>, phase: number) => {
      const s = at(cycle);
      obj.visible = s.visible;
      if (!s.visible) return;
      const next = at(Math.min(cycle + 0.004, 0.999));
      const pos = runwayPoint(s.along).setY(s.alt + 1.4);
      obj.position.copy(pos);
      const ahead = next.visible && next.along !== s.along ? runwayPoint(next.along).setY(next.alt + 1.4) : pos.clone().add(RUNWAY.dir);
      obj.lookAt(ahead);
      lights.strobe.visible = (t + phase) % 1.3 < 0.08;
      lights.beacon.visible = (t + phase) % 1.1 < 0.12;
    };
    fly(plane, planeAt, planeLights, 0);
    fly(departure, departureAt, departureLights, 0.5);

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

  // Adaptive smoothness: if a device can't keep up, cap it at 30 fps and step the resolution
  // down towards 1× (never below, and the glow/bloom always stays on so the look is unchanged).
  // Measured over ~2 s windows, skipping the first few seconds while the page is still loading.
  const perf = { frames: 0, since: 0, last: 0, start: 0 };
  const adapt = (now: number) => {
    if (!perf.start) perf.start = now;
    if (now - perf.start < 4000) return;
    if (!perf.since) perf.since = now;
    perf.frames++;
    const span = now - perf.since;
    if (span < 2000) return;
    const fps = (perf.frames * 1000) / span;
    perf.frames = 0;
    perf.since = now;
    if (fps >= (minFrameMs ? 22 : 35)) return;
    minFrameMs = 1000 / 31;
    if (pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      resize();
    }
  };

  let ready = false; // set once shaders are compiled; no frames before that
  function loop() {
    if (running || !ready) return;
    running = true;
    perf.since = 0;
    perf.frames = 0;
    const frame = (now: number) => {
      if (!anyVisible() || document.hidden) {
        running = false;
        return;
      }
      if (minFrameMs && now - perf.last < minFrameMs) {
        requestAnimationFrame(frame);
        return;
      }
      perf.last = now;
      adapt(now);
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
      beamFade.value = smoothstep(70, 150, Math.hypot(camera.position.x - STAGE.x, camera.position.z - STAGE.z));

      rings.forEach((ring, id) => {
        const mat = ring.material as THREE.MeshBasicMaterial;
        const on = !cinematic && (id === highlighted || id === hoverId);
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

  // Compile every shader in the background (parallel compile where the GPU supports it). The city
  // is drawn into the composer's off-screen target, whose shader variants differ from on-screen
  // ones (no tone mapping, linear output), so compile with that target bound — otherwise all of
  // them were compiled again, synchronously, on the first frame (a 7 s freeze on phones).
  renderer.debug.checkShaderErrors = false; // skips extra blocking driver round-trips per shader
  // The post-processing passes' shaders (bloom, SMAA…) too, via stand-in quads using their materials.
  const ppScene = new THREE.Scene();
  const quad = new THREE.PlaneGeometry(2, 2);
  for (const pass of composer.passes)
    for (const value of Object.values(pass))
      for (const m of Array.isArray(value) ? value : [value]) if (m instanceof THREE.Material) ppScene.add(new THREE.Mesh(quad, m));
  renderer.setRenderTarget(composer.readBuffer);
  try {
    await Promise.all([renderer.compileAsync(scene, camera), renderer.compileAsync(ppScene, camera)]);
  } catch {
    /* falls back to compiling on the first frame */
  }
  renderer.setRenderTarget(null);
  if (cinematic) {
    camera.position.copy(INTRO.fromPos);
    camera.lookAt(INTRO.fromTarget);
  }
  await yieldToBrowser();
  // First frame with culling off, so every mesh and texture is uploaded now rather than when
  // it first comes into view during the fly-in. This also compiles the post-processing passes.
  const culled: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  composer.render();
  culled.forEach((o) => (o.frustumCulled = true));
  await yieldToBrowser();
  ready = true;
  loop();
  const controller: CityController = { focus, reset, zoom, highlight };  // Another section showing the same city (e.g. the Explore map after the hero).
  const attach = (o: CityOptions) => {
    const v = makeView(o);
    views.push(v);
    if (!v.cinematic) addWheel(v.container);
    watch(v);
    return controller;
  };
  return { controller, attach };
}
