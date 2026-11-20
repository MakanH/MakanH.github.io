import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

// Relative base so the built site works from any path
// (a GitHub Pages user site, a project site, or opened from a sub-folder).
export default defineConfig({
  base: './',
  // Pre-bundle the lazily imported libraries at startup, so the dev server does not
  // stop to re-optimise (and reload the page) the first time the map asks for them.
  optimizeDeps: {
    include: ['three', 'gsap', '@dimforge/rapier3d-compat'],
  },
  build: {
    target: 'es2022',
    // three.js and the physics engine are large, but both load lazily after first paint
    chunkSizeWarningLimit: 4600,
    rollupOptions: {
      // The home page and one page per project
      input: {
        main: page('./index.html'),
        siem: page('./siem-home-lab.html'),
        triage: page('./threat-triage.html'),
      },
    },
  },
});
