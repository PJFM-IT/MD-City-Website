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
 * Explore map points.
 * `x`/`y`: position on the flat illustration (fallback).
 * `anchor`: [x, y, z] position in the 3D city where the marker sits.
 * `image`: key of a `media` image shown inside the info card once real renders arrive.
 */
export const hotspots = [
  {
    id: "facility",
    label: "1,500-Bed Facility",
    fact: "1,500 beds",
    text: "Accommodation and food for those travelling long distances.",
    href: "#facility",
    x: "20.6%",
    y: "66%",
    anchor: [-64, 20, 6] as [number, number, number],
    image: "facility" as const,
  },
  {
    id: "carmel",
    label: "Carmel Hill",
    fact: "Prayer mountain",
    text: "A place set apart for prayer and encounter.",
    href: "#carmel-hill",
    x: "52%",
    y: "54%",
    // Base of the cross; the card opens below so the cross stays visible.
    anchor: [0, 45, -40] as [number, number, number],
    card: "below",
    image: "carmel" as const,
  },
  {
    id: "zion",
    label: "Zion Grounds",
    fact: "24,000 capacity",
    text: "A monumental ground for crusades, worship and the multitudes.",
    href: "#zion-grounds",
    x: "68%",
    y: "76%",
    anchor: [48, 10, 26] as [number, number, number],
    image: "zion" as const,
  },
  {
    id: "carpark",
    label: "Large Car Park",
    fact: "Built for the crowds",
    text: "Ample parking for gatherings of multitudes.",
    href: "#city-numbers",
    x: "86%",
    y: "80%",
    anchor: [104, 6, 34] as [number, number, number],
    image: null,
  },
];

/**
 * Real section images. Put files in /public/images/ and set the path here, e.g. "/images/hero.jpg".
 * While a value is empty, the section shows its illustrated scene instead.
 */
export const media = {
  hero: "",
  vision: "",
  filmPoster: "",
  explore: "",
  zion: "",
  carmel: "",
  facility: "",
  prosperity: "",
  visionary: "",
  finalHero: "",
};

/** `src` empty = the illustrated `scene` is shown instead. */
export interface GalleryItem {
  src: string;
  alt: string;
  scene: SceneName;
}

export const givingGallery: GalleryItem[] = [
  { src: "", alt: "People lined up to give towards the vision", scene: "queue" },
  { src: "", alt: "Giving at the table", scene: "giving" },
  { src: "", alt: "Partners greeting one another", scene: "greeting" },
  { src: "", alt: "The hall during the day of giving", scene: "hall" },
  { src: "", alt: "The crowd gathered in worship", scene: "worship" },
];

export const prosperityGallery: GalleryItem[] = [
  { src: "", alt: "Partners gathered in prayer on the land", scene: "prayer" },
  { src: "", alt: "Prophet Jerome Fernando declaring over the land", scene: "declare" },
  { src: "", alt: "The land at sunset", scene: "land" },
];
