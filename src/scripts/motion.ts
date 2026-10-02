export const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Marks links whose `#hash` matches the section currently in the middle of the viewport. */
export function trackActiveSection(linkSelector: string) {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(linkSelector));
  const ids = [...new Set(links.map((a) => a.hash.slice(1)).filter(Boolean))];
  const sections = ids
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null);
  if (!sections.length || !("IntersectionObserver" in window)) return;

  const setActive = (id: string) => {
    links.forEach((a) => {
      const active = a.hash === `#${id}`;
      a.classList.toggle("is-active", active);
      if (active) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  sections.forEach((s) => observer.observe(s));
}

/** Counts `[data-count]` elements up from 0 to their rendered value once they scroll into view. */
export function countUpOnView(selector = "[data-count]") {
  const nodes = document.querySelectorAll<HTMLElement>(selector);
  if (!nodes.length || prefersReducedMotion() || !("IntersectionObserver" in window)) return;

  const format = new Intl.NumberFormat("en-US");
  const animate = (el: HTMLElement) => {
    const target = Number(el.dataset.count);
    const duration = 1600;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = format.format(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animate(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.6 },
  );
  nodes.forEach((el) => {
    el.textContent = "0";
    observer.observe(el);
  });
}

/** Subtle vertical parallax for `[data-parallax="<speed>"]` elements (speed ~0.05–0.2). */
export function parallax(selector = "[data-parallax]") {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  if (!nodes.length || prefersReducedMotion()) return;

  let ticking = false;
  const update = () => {
    const vh = window.innerHeight;
    nodes.forEach((el) => {
      const rect = el.parentElement?.getBoundingClientRect() ?? el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh) return;
      const speed = Number(el.dataset.parallax) || 0.1;
      const offset = (rect.top + rect.height / 2 - vh / 2) * -speed;
      el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    });
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  window.addEventListener("resize", update);
  update();
}
