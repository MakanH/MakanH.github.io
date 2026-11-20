/** Header, section index, reading progress, the clock and the wire feed. */
import { SECTIONS, WIRE } from '../content';
import { $, $$, el, must } from '../lib/dom';
import { bothHTML } from '../lib/i18n';

/** The drop-down section index on narrow screens. */
function initMenu(): void {
  const button = $<HTMLButtonElement>('#menu-toggle');
  const nav = $('#nav');
  if (!button || !nav) return;

  const set = (open: boolean): void => {
    button.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  };

  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) set(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      set(false);
      button.focus();
    }
  });
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('#nav, #menu-toggle')) set(false);
  });
  window.matchMedia('(min-width: 1081px)').addEventListener('change', () => set(false));
}

/** Highlight the section in view (home page), and draw reading progress under the header. */
function initScrollSpy(): void {
  const links = $$<HTMLAnchorElement>('[data-nav]');
  const sections = SECTIONS.map((section) => $(`#${section.id}`)).filter((node): node is HTMLElement => node !== null);
  const progress = $('#progress');
  let ticking = false;

  const update = (): void => {
    ticking = false;
    if (sections.length) {
      const probe = window.innerHeight * 0.38;
      let current = '';
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= probe) current = section.id;
      }
      for (const link of links) {
        const mine = link.dataset.nav === current;
        link.classList.toggle('is-current', mine);
        if (mine) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    }
  };

  const request = (): void => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  update();
}

/** Local time where I am, ticking in the classification banner. */
function initClock(): void {
  const node = $('#clock');
  if (!node) return;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
  } catch {
    return;
  }
  const tick = (): void => {
    node.textContent = `Montréal ${format.format(new Date())}`;
  };
  tick();
  window.setInterval(() => {
    if (!document.hidden) tick();
  }, 1000);
}

/** The wire feed: one line of facts, set twice so it can loop without a seam. */
function initWire(): void {
  const track = $('#wire-track');
  if (!track) return;
  const set = (): HTMLElement =>
    el(
      'div',
      { class: 'wire__set' },
      WIRE.map((item) => el('span', { class: 'wire__item', html: bothHTML(item) })),
    );
  track.append(set(), set());
  // Hovering the feed holds it still, so an item can be read
  const wire = must('.wire');
  wire.addEventListener('pointerenter', () => wire.classList.add('is-held'));
  wire.addEventListener('pointerleave', () => wire.classList.remove('is-held'));
}

export function initChrome(): void {
  initMenu();
  initScrollSpy();
  initClock();
  initWire();
}
