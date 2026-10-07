import { prefersReducedMotion } from "./motion";

/**
 * Brings the illustrated scenes to life:
 * - layers (`[data-depth]`) shift at different speeds while scrolling → depth,
 * - on desktop the layers lean toward the cursor and a soft gold light follows it,
 * - ambient animations (twinkles, beams, drifting clouds) only run while on screen.
 */

interface SceneState {
  el: HTMLElement;
  layers: { node: SVGGElement; depth: number }[];
  /** HTML overlays (e.g. map markers) that must move with a scene layer. */
  follows: { node: HTMLElement; depth: number }[];
  visible: boolean;
  mx: number; // target pointer offset, -1..1
  my: number;
  cx: number; // smoothed pointer offset
  cy: number;
}

const scenes = new Map<HTMLElement, SceneState>();
const finePointer = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
let frame = 0;

const io =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const state = scenes.get(entry.target as HTMLElement);
            if (!state) return;
            state.visible = entry.isIntersecting;
            state.el.classList.toggle("is-playing", entry.isIntersecting);
          });
          requestTick();
        },
        { rootMargin: "100px 0px" },
      )
    : null;

function render() {
  frame = 0;
  const vh = window.innerHeight;
  let settling = false;

  scenes.forEach((s) => {
    if (!s.visible || !s.el.isConnected) return;
    s.cx += (s.mx - s.cx) * 0.08;
    s.cy += (s.my - s.cy) * 0.08;
    if (Math.abs(s.mx - s.cx) > 0.002 || Math.abs(s.my - s.cy) > 0.002) settling = true;

    const rect = s.el.getBoundingClientRect();
    // -1 when the scene's centre is at the bottom of the viewport, +1 at the top.
    const p = Math.max(-1, Math.min(1, (vh / 2 - (rect.top + rect.height / 2)) / (vh / 2 + rect.height / 2)));

    const offset = (depth: number) => ({ x: -s.cx * depth * 34, y: p * depth * 70 - s.cy * depth * 18 });

    s.layers.forEach(({ node, depth }) => {
      const { x, y } = offset(depth);
      node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
    });

    // SVG units → CSS px for the "slice"-scaled 1600×900 viewBox.
    const scale = Math.max(rect.width / 1600, rect.height / 900);
    s.follows.forEach(({ node, depth }) => {
      if (!("followDepth" in node.dataset)) return; // released (e.g. the 3D map took over)
      const { x, y } = offset(depth);
      node.style.translate = `${(x * scale).toFixed(2)}px ${(y * scale).toFixed(2)}px`;
    });
  });

  if (settling) requestTick();
}

function requestTick() {
  if (!frame) frame = requestAnimationFrame(render);
}

export function initScene(el: HTMLElement) {
  if (scenes.has(el)) return;
  const state: SceneState = {
    el,
    layers: Array.from(el.querySelectorAll<SVGGElement>("[data-depth]"))
      .map((node) => ({ node, depth: Number(node.dataset.depth) || 0 }))
      .filter((l) => l.depth > 0),
    follows: [],
    visible: !io,
    mx: 0,
    my: 0,
    cx: 0,
    cy: 0,
  };
  scenes.set(el, state);
  if (io) io.observe(el);
  else el.classList.add("is-playing");

  if (prefersReducedMotion()) return;

  // Pointer interaction over the whole section/card the scene belongs to.
  const area = el.closest<HTMLElement>("section, article, dialog, button") ?? el;
  state.follows = Array.from(area.querySelectorAll<HTMLElement>("[data-follow-depth]")).map((node) => ({
    node,
    depth: Number(node.dataset.followDepth) || 0,
  }));
  area.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || !finePointer()) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    state.mx = Math.max(-1, Math.min(1, px * 2 - 1));
    state.my = Math.max(-1, Math.min(1, py * 2 - 1));
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
    el.classList.add("is-hover");
    requestTick();
  });
  area.addEventListener("pointerleave", () => {
    state.mx = 0;
    state.my = 0;
    el.classList.remove("is-hover");
    requestTick();
  });
}

/** Puts a lazily drawn scene (Placeholder's <template data-lazy-scene>) into the page. */
export function stampScene(host: HTMLElement) {
  const tpl = host.querySelector<HTMLTemplateElement>(":scope > template[data-lazy-scene]");
  if (!tpl) return;
  tpl.replaceWith(tpl.content);
  host.querySelectorAll<HTMLElement>("[data-scene]").forEach(initScene);
}

/** Draw each illustration only once it comes within ~a screen of the viewport. */
function lazyScenes(root: ParentNode) {
  const hosts = root.querySelectorAll<HTMLElement>("[data-lazy-scene-host]");
  if (!("IntersectionObserver" in window)) {
    hosts.forEach(stampScene);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        stampScene(entry.target as HTMLElement);
      }),
    { rootMargin: "900px 0px" },
  );
  hosts.forEach((host) => observer.observe(host));
}

export function initScenes(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-scene]").forEach(initScene);
  lazyScenes(root);
  if (!prefersReducedMotion()) {
    window.addEventListener("scroll", requestTick, { passive: true });
    window.addEventListener("resize", requestTick);
    requestTick();
  }
}
