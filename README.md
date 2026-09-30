# Miracle Dome City — Website

Cinematic one-page site for **Miracle Dome City** (`miracle-domecity.com`).

## Stack

- **Astro** (static, SEO-friendly)
- Contact inquiries via **Formspree email** (no database)

## Getting started

```bash
npm install
npm run dev
```

## Contact form (email)

1. Create a form at [Formspree](https://formspree.io)
2. Copy `.env.example` to `.env`
3. Set `PUBLIC_FORMSPREE_ID` to your form ID

## Scripts

| Command           | Action              |
| ----------------- | ------------------- |
| `npm run dev`     | Local development   |
| `npm run build`   | Production build    |
| `npm run preview` | Preview production  |

## Page sections (SRS)

1. Hero  
2. The Vision  
3. Vision Film  
4. Explore the City  
5. Zion Grounds  
6. Carmel Hill  
7. 1,500-Bed Facility  
8. The City in Numbers  
9. A Historic Day of Giving  
10. The Hour of Prosperity  
11. The Visionary  
12. Final Hero + Contact + Footer  

## Assets

Official architectural renders and photography go in `public/images/`.

Until those arrive, sections use cinematic **placeholders** (labeled frames) matching the approved mockup layout. Keep `logo.png` for brand marks.

Replace placeholders by dropping files such as:

- `hero-aerial.jpg`
- `vision-film.jpg`
- `explore-masterplan.jpg`
- `zion-grounds.jpg` / `carmel-hill.jpg` / `facility.jpg`
- `historic-*.jpg`
- `prosperity.jpg`
- `visionary.jpg`
- `final-aerial.jpg`

…and wiring them into the matching section components.
