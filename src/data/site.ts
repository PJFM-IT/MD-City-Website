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
 * Modest 3D map (requested by the project owner: the visuals must not look too grand for the
 * people the city serves): only Miracle Dome City on a simple floating tile, calm daylight,
 * no glow, beam or spectacle, no airport/ocean/villages. Applies to the Explore map only; the hero
 * always shows the full dusk city. Set to `false` for the full Explore map as before.
 */
export const MAP_MODEST = true;

/**
 * Explore map points: exactly the facilities on the architect's labelled masterplan
 * (Design Consortium International), plus the existing Miracle Dome.
 * `x`/`y`: position on the flat aerial render (fallback when 3D isn't available).
 * `anchor`: [x, y, z] position in the 3D city where the marker sits.
 * `short`: shorter name used on phones.
 * `image`: key of a `media` image shown inside the info card.
 */
export const hotspots = [
  {
    id: "gate",
    label: "City Gate",
    short: "City Gate",
    fact: "The way in",
    text: "The grand entrance on Katunayake–Veyangoda Road, with its lions and globe fountain.",
    href: "#explore",
    x: "18%",
    y: "14%",
    anchor: [-80, 16, -86] as [number, number, number],
    image: "cityGate" as const,
  },
  {
    // Right beside the City Gate, along the road (as on the labelled plan).
    id: "museum",
    label: "Museum & Accommodation Building 1",
    short: "Museum & Building 1",
    fact: "Museum & rooms",
    text: "The museum and the first accommodation building, next to the City Gate.",
    href: "#facility",
    x: "24%",
    y: "6%",
    anchor: [-36, 13, -111] as [number, number, number],
    image: null,
  },
  {
    // The existing Miracle Dome (opened 2022) on Katunayake–Veyangoda Road, ~1.3 km from the airport.
    id: "dome",
    label: "The Miracle Dome",
    short: "Miracle Dome",
    fact: "5,000 seats",
    text: "The Miracle Dome, opened in 2022, where the vision began. The new city grows around it.",
    href: "#contact",
    x: "19.5%",
    y: "37%",
    anchor: [-98, 24, -24] as [number, number, number],
    // Card opens upwards over the sky so the building stays visible.
    card: "above",
    image: "miracleDome" as const,
  },
  {
    // Accommodation Buildings 2 and 3 are the two gold-roofed blocks (FACILITY_BLOCKS in city3d.ts).
    id: "acc2",
    label: "Accommodation Building 2",
    short: "Accommodation 2",
    fact: "1,500 beds",
    text: "Rooms and food for those travelling long distances to the city.",
    href: "#facility",
    x: "39%",
    y: "10%",
    anchor: [-38, 17, -78] as [number, number, number],
    image: "facility" as const,
  },
  {
    id: "acc3",
    label: "Accommodation Building 3",
    short: "Accommodation 3",
    fact: "1,500 beds",
    text: "Accommodation for those coming seeking ministry and healing.",
    href: "#facility",
    x: "44%",
    y: "20%",
    anchor: [-16, 15, -55] as [number, number, number],
    image: "facility" as const,
  },
  {
    id: "carmel",
    label: "Prayer Mountain",
    short: "Prayer Mountain",
    fact: "Carmel Hill",
    text: "A glass prayer dome on a landscaped hill, a place set apart for prayer and encounter.",
    href: "#carmel-hill",
    x: "33%",
    y: "24%",
    // Above the glass dome on the summit.
    anchor: [-54, 21, -47] as [number, number, number],
    image: "carmel" as const,
  },
  {
    id: "zion",
    label: "24,000 Seater Crusade Grounds",
    short: "Crusade Grounds",
    fact: "Zion Grounds",
    text: "Terraced lawns for 24,000 people, facing the glass dome stage.",
    href: "#zion-grounds",
    x: "57.5%",
    y: "53%",
    anchor: [24, 16, 32] as [number, number, number],
    image: "zion" as const,
  },
  {
    // North-east of the crusade grounds, as on the labelled plan.
    id: "carpark",
    label: "Carpark",
    short: "Carpark",
    fact: "Built for the crowds",
    text: "Parking beside the crusade grounds, on their north-east side.",
    href: "#city-numbers",
    x: "68%",
    y: "26%",
    anchor: [150, 7, -66] as [number, number, number],
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
  /** Background of "The Hour of Prosperity" (its gallery is prosperityGallery below). */
  prosperity: "/images/photos/miracle-dome-aerial.webp",
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
  { src: "/images/renders/city-gate-stone.webp", alt: "The City Gate (stone wall design)", scene: "aerial-night" },
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
  // Photos from the day on the land ("View moments"), in the order of the day.
  { src: "/images/photos/land-01.webp", alt: "Partners arriving on the land", scene: "prayer" },
  { src: "/images/photos/land-02.webp", alt: "Welcomed onto the land by an usher", scene: "prayer" },
  { src: "/images/photos/land-03.webp", alt: "Partners gathered on the land", scene: "prayer" },
  { src: "/images/photos/land-04.webp", alt: "Opening the gathering on the land", scene: "declare" },
  { src: "/images/photos/land-05.webp", alt: "Partners sharing what the day means to them", scene: "declare" },
  { src: "/images/photos/land-06.webp", alt: "A partner sharing on the land", scene: "declare" },
  { src: "/images/photos/land-07.webp", alt: "Partners sharing their faith", scene: "declare" },
  { src: "/images/photos/land-08.webp", alt: "A partner sharing her testimony", scene: "declare" },
  { src: "/images/photos/land-09.webp", alt: "Partners sharing their story", scene: "declare" },
  { src: "/images/photos/land-10.webp", alt: "A partner sharing on the land", scene: "declare" },
  { src: "/images/photos/land-11.webp", alt: "Laying stones of remembrance at the foot of the tree", scene: "land" },
  { src: "/images/photos/land-12.webp", alt: "Anointing the stones with oil", scene: "land" },
  { src: "/images/photos/land-13.webp", alt: "Praying over the land", scene: "land" },
  { src: "/images/photos/land-14.webp", alt: "Partners in prayer on the land", scene: "prayer" },
  { src: "/images/photos/land-15.webp", alt: "Worship on the land", scene: "prayer" },
];
