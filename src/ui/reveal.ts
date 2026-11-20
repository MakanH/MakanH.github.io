/**
 * Things that happen as the page scrolls: blocks fade up, redaction bars pull
 * away, stamps land, numbers count, and each timeline draws its own spine.
 */
import gsap from 'gsap';
import { $$ } from '../lib/dom';
import { motion } from '../lib/motion';

function countUp(node: HTMLElement): void {
  const target = Number(node.dataset.count ?? '0');
  if (motion.calm) {
    node.textContent = String(target);
    return;
  }
  // A target of zero rolls down to it, so "0 false positives" still gets a moment
  const state = { value: target === 0 ? 9 : 0 };
  gsap.to(state, {
    value: target,
    duration: 1.4,
    ease: 'power2.out',
    onUpdate: () => {
      node.textContent = String(Math.round(state.value));
    },
  });
}

/** Add `className` to each match the first time it is on screen. */
function onEnter(selector: string, className: string, options: IntersectionObserverInit, then?: (node: HTMLElement) => void): void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      entry.target.classList.add(className);
      then?.(entry.target as HTMLElement);
    }
  }, options);
  $$(selector).forEach((node) => observer.observe(node));
}

/** The spine of a timeline fills in as the list scrolls past the middle of the screen. */
function initTimelines(): void {
  const lists = $$('[data-timeline]');
  if (!lists.length) return;
  let ticking = false;

  const update = (): void => {
    ticking = false;
    const mark = window.innerHeight * 0.62;
    for (const list of lists) {
      const rect = list.getBoundingClientRect();
      const done = Math.min(1, Math.max(0, (mark - rect.top) / Math.max(1, rect.height)));
      list.style.setProperty('--done', done.toFixed(4));
      for (const item of Array.from(list.children) as HTMLElement[]) {
        item.classList.toggle('is-past', item.getBoundingClientRect().top < mark);
      }
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

export function initReveals(): void {
  // Stagger the children of a group, and items that sit side by side
  for (const group of $$('[data-reveal-group]')) {
    Array.from(group.children).forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i)));
  }

  onEnter('[data-reveal], [data-reveal-group]', 'is-in', { threshold: 0.08, rootMargin: '0px 0px -6% 0px' }, (node) => {
    $$('[data-count]', node).forEach(countUp);
  });
  onEnter('.redact', 'is-open', { threshold: 1, rootMargin: '0px 0px -18% 0px' });
  // A low threshold on purpose: a waiting stamp is drawn oversized, so part of it is always
  // clipped by its sheet and it would never count as fully visible.
  onEnter('[data-stamp]', 'is-in', { threshold: 0.1, rootMargin: '0px 0px -22% 0px' });
  initTimelines();
}
