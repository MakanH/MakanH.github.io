/**
 * Reduced motion.
 *
 * "Calm" follows the visitor's system setting (prefers-reduced-motion). While
 * it is on, everything that moves on its own stays still. Animations that
 * answer a direct action (a packet you threw, a replay you started) still run,
 * just faster. The map also has its own pause button (see home.ts).
 */
type Listener = (calm: boolean) => void;

const listeners = new Set<Listener>();
const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

let calm = false;

function apply(): void {
  document.documentElement.classList.toggle('calm', calm);
  for (const listener of listeners) listener(calm);
}

export const motion = {
  get calm(): boolean {
    return calm;
  },

  init(): void {
    calm = systemReduced.matches;
    apply();
    systemReduced.addEventListener('change', (event) => {
      calm = event.matches;
      apply();
    });
  },

  /** Subscribe to changes. The listener is also called immediately. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(calm);
    return () => listeners.delete(listener);
  },

  /** Scale a duration (seconds) for direct-response animations. */
  dur(seconds: number): number {
    return calm ? Math.min(seconds, 0.12) : seconds;
  },
};

/** Call `callback(true|false)` as `target` enters or leaves the viewport. */
export function watchVisibility(
  target: Element,
  callback: (visible: boolean) => void,
  options: IntersectionObserverInit = { threshold: 0.05 },
): IntersectionObserver {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) callback(entry.isIntersecting);
  }, options);
  observer.observe(target);
  return observer;
}

/** Run `callback` once, the first time `target` is at least `amount` visible. */
export function onceVisible(target: Element, callback: () => void, amount = 0.25): void {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        callback();
      }
    },
    { threshold: amount },
  );
  observer.observe(target);
}
