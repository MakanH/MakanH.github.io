/**
 * Case File: entry point for every page.
 *
 * Shared state first (motion, language), then the page furniture, then
 * whichever sections this page has. Entrance animations and scroll reveals
 * start once the fonts are in, so nothing is measured or drawn with a
 * fallback face.
 */
import { i18n } from './lib/i18n';
import { motion } from './lib/motion';
import { initChrome } from './ui/chrome';
import { initStills } from './ui/lightbox';
import { initReveals } from './ui/reveal';
import { initTilt } from './ui/tilt';
import { initCases } from './sections/cases';
import { initHome } from './sections/home';
import { initSiem } from './sections/siem';
import { initTriage } from './sections/triage';

declare global {
  interface Window {
    /** Set once the app has started; each page's <head> uses it as a failsafe. */
    __caseFileBooted?: boolean;
  }
}

/** Run one part's setup without letting a failure there take the page down. */
function safely(name: string, init: () => void): void {
  try {
    init();
  } catch (error) {
    console.error(`[${name}] failed to start`, error);
  }
}

async function boot(): Promise<void> {
  document.documentElement.classList.add('js');
  window.__caseFileBooted = true;

  motion.init();
  i18n.init();
  safely('chrome', initChrome);
  safely('stills', initStills);
  safely('cases', initCases);
  safely('siem', initSiem);
  safely('triage', initTriage);
  safely('tilt', initTilt);

  // Only the home page has the map
  const home = document.querySelector('#map-stage') ? initHome() : null;

  const fonts = 'fonts' in document ? document.fonts.ready : Promise.resolve();
  const patience = new Promise<void>((resolve) => window.setTimeout(resolve, 1800));
  await Promise.race([fonts, patience]);

  home?.intro();
  initReveals();
  document.documentElement.classList.add('is-ready');
}

void boot();
