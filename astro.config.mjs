// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://miracle-domecity.com',
  vite: {
    // The 3D map (three.js) is one lazily loaded chunk; it is expected to be large.
    build: { chunkSizeWarningLimit: 700 },
  },
});
