// Central content + asset config. Drop real asset paths/URLs in here when they arrive.
import type { SceneName } from "../scenes/types";

/** YouTube embed URL, e.g. "https://www.youtube.com/embed/VIDEO_ID". Empty shows "coming soon". */
export const VISION_FILM_URL = "";

export const navLinks = [
  { href: "#top", label: "Home" },
  { href: "#vision", label: "The Vision" },
  { href: "#explore", label: "Explore" },
  { href: "#zion-grounds", label: "Zion Grounds" },
  { href: "#carmel-hill", label: "Carmel Hill" },
  { href: "#facility", label: "Facility" },
  { href: "#historic-moments", label: "Historic Moments" },
  { href: "#contact", label: "Contact" },
];

export const footerLinks = [
  { href: "#top", label: "Home" },
  { href: "#vision", label: "The Vision" },
  { href: "#zion-grounds", label: "Zion Grounds" },
  { href: "#carmel-hill", label: "Carmel Hill" },
  { href: "#facility", label: "Facility" },
  { href: "#historic-moments", label: "Historic Moments" },
  { href: "#contact", label: "Contact" },
];

/**
 * Optional architect's 3D model (.glb) for the Explore map, e.g. "/models/miracle-dome-city.glb".
 * Empty = the built-in stylised city. If you set this, update each hotspot's `anchor` to match the model.
 */
export const CITY_MODEL_URL = "";

/**
 * Explore map points, laid out as in the architect's aerial masterplan.
 * `x`/`y`: position on the flat aerial render (fallback when 3D isn't available).
 * `anchor`: [x, y, z] position in the 3D city where the marker sits.
 * `image`: key of a `media` image shown inside the info card.
 */
export const hotspots = [
  {
    id: "gate",
    label: "City Gate",
    fact: "Museum & Accommodation 1",
    text: "The grand entrance on Katunayake–Veyangoda Road: the museum and Accommodation Building 1, with its lions and globe fountain.",
    href: "#explore",
    x: "24%",
    y: "10%",
    anchor: [-80, 16, -86] as [number, number, number],
    image: "cityGate" as const,
  },
  {
    // The existing Miracle Dome (opened 2022) on Katunayake–Veyangoda Road, ~1.3 km from the airport.
    id: "dome",
    label: "The Miracle Dome",
    fact: "5,000 seats",
    text: "The Miracle Dome, opened in 2022 — where the vision began. The new city grows around it.",
    href: "#contact",
    x: "19.5%",
    y: "37%",
    anchor: [-98, 24, -24] as [number, number, number],
    // Card opens upwards over the sky so the building stays visible.
    card: "above",
    image: "miracleDome" as const,
  },
  {
    id: "facility",
    label: "1,500-Bed Facility",
    fact: "1,500 beds",
    text: "Accommodation Buildings 2 and 3 — rooms and food for those travelling long distances.",
    href: "#facility",
    x: "41.5%",
    y: "14%",
    anchor: [-27, 18, -67] as [number, number, number],
    image: "facility" as const,
  },
  {
    id: "zion",
    label: "Zion Grounds",
    fact: "24,000 capacity",
    text: "The 24,000-seater crusade grounds: terraced lawns for the multitudes, facing the glass dome stage.",
    href: "#zion-grounds",
    x: "57.5%",
    y: "53%",
    anchor: [24, 16, 32] as [number, number, number],
    image: "zion" as const,
  },
  {
    id: "carmel",
    label: "Carmel Hill",
    fact: "Prayer Mountain",
    text: "A glass prayer dome on a landscaped hill — a place set apart for prayer and encounter.",
    href: "#carmel-hill",
    x: "33%",
    y: "24%",
    // Above the glass dome on the summit.
    anchor: [-54, 21, -47] as [number, number, number],
    image: "carmel" as const,
  },
  {
    id: "carpark",
    label: "Large Car Park",
    fact: "Built for the crowds",
    text: "Ample parking across the river, linked to the grounds by a footbridge.",
    href: "#city-numbers",
    x: "55%",
    y: "90%",
    anchor: [14, 7, 76] as [number, number, number],
    image: null,
  },
];

/**
 * Real section images. Put files in /public/images/ and set the path here, e.g. "/images/hero.jpg".
 * While a value is empty, the section shows its illustrated scene instead.
 */
export const media = {
  /** Shown only if the 3D hero can't run. */
  hero: "/images/renders/aerial-masterplan.webp",
  vision: "/images/renders/aerial-close.webp",
  filmPoster: "/images/renders/crusade-grounds-dome-sm.webp",
  /** Architect's aerial masterplan (shown if the 3D map can't run). */
  explore: "/images/renders/aerial-masterplan.webp",
  zion: "/images/renders/crusade-grounds-night.webp",
  /** Prayer Mountain and Accommodation Buildings 2 & 3, cropped from the close aerial render. */
  carmel: "/images/renders/carmel-hill.webp",
  facility: "/images/renders/accommodation.webp",
  prosperity: "",
  /** Official portrait (prophetjerome.com); the section shows it in black and white. */
  visionary: "/images/photos/prophet-jerome-fernando.webp",
  finalHero: "/images/renders/city-gate-lit.webp",
  /** Real photo of the existing Miracle Dome (shown in its 3D map card). */
  miracleDome: "/images/miracle-dome.webp",
  cityGate: "/images/renders/city-gate-lit-sm.webp",
};

/** Architect's renders of the masterplan (Design Consortium International), opened from Explore. */
export const masterplanGallery: GalleryItem[] = [
  { src: "/images/renders/aerial-masterplan.webp", alt: "Aerial view of the Miracle Dome City masterplan", scene: "aerial" },
  { src: "/images/renders/aerial-close.webp", alt: "The Miracle Dome, the crusade grounds and the glass dome stage from above", scene: "aerial" },
  { src: "/images/renders/crusade-grounds-night.webp", alt: "Worship at the crusade grounds at dusk", scene: "zion" },
  { src: "/images/renders/crusade-grounds-sunset.webp", alt: "The terraced crusade grounds facing the glass dome stage", scene: "zion" },
  { src: "/images/renders/crusade-grounds-dome.webp", alt: "Crowds gathering at the glass dome stage", scene: "zion" },
  { src: "/images/renders/crusade-grounds-day.webp", alt: "Walking up through the grounds towards the dome stage", scene: "zion" },
  { src: "/images/renders/city-gate-lit.webp", alt: "The City Gate at night", scene: "aerial-night" },
  { src: "/images/renders/city-gate.webp", alt: "The City Gate with its lions and globe fountain", scene: "aerial-night" },
  { src: "/images/renders/city-gate-stone.webp", alt: "The City Gate — stone wall design", scene: "aerial-night" },
  { src: "/images/renders/aerial-masterplan-warm.webp", alt: "The masterplan in the morning light", scene: "aerial" },
];

/** `src` empty = the illustrated `scene` is shown instead. */
export interface GalleryItem {
  src: string;
  alt: string;
  scene: SceneName;
}

// Official high-resolution photos from the ministry's websites (miracle-dome.com, prophetjerome.com).
// Lead: the ministry's own "Partner Give" photo; the rest are services at the Miracle Dome.
export const givingGallery: GalleryItem[] = [
  { src: "/images/photos/partners-giving.webp", alt: "Partners giving towards the vision", scene: "queue" },
  { src: "/images/photos/dome-service.webp", alt: "A full Miracle Dome during a service", scene: "giving" },
  { src: "/images/photos/dome-worship.webp", alt: "Worship at the Miracle Dome", scene: "greeting" },
  { src: "/images/photos/dome-congregation-wide.webp", alt: "The Miracle Dome congregation", scene: "hall" },
  { src: "/images/photos/dome-service-wide.webp", alt: "The Miracle Dome filled to capacity", scene: "worship" },
];

// The real Miracle Dome on its land, then the architect's renders of the city to come.
export const prosperityGallery: GalleryItem[] = [
  { src: "/images/photos/miracle-dome-aerial.webp", alt: "The Miracle Dome and its land in Katunayake", scene: "prayer" },
  { src: "/images/renders/crusade-grounds-day.webp", alt: "The crusade grounds on the land (architect's render)", scene: "declare" },
  { src: "/images/renders/aerial-masterplan.webp", alt: "Miracle Dome City in its forest setting (architect's render)", scene: "land" },
];
