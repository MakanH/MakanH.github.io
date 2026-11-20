/** Small DOM + math helpers shared across the site. */

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** Like `$`, but throws a readable error when the element is missing. */
export function must<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
}

type Child = Node | string | null | undefined | false;

interface ElOptions {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string | number | boolean>;
  style?: Record<string, string | number>;
}

/** Create an element. `html` is only ever used with strings authored in this codebase. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (options.style) {
    for (const [key, value] of Object.entries(options.style)) {
      node.style.setProperty(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** `<svg class="…"><use href="#id"/></svg>` pointing at the sprite in index.html. */
export function sprite(id: string, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/** Markup version of `sprite()` for template strings. */
export function spriteHTML(id: string, className = 'icon'): string {
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
}

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const rand = (min: number, max: number): number => min + Math.random() * (max - min);
export const randInt = (min: number, max: number): number => Math.floor(rand(min, max + 1));
export const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

export const formatInt = (value: number): string => Math.round(value).toLocaleString('en-US');

/** Escape text that is interpolated into an HTML template string. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** True when the primary pointer can hover precisely (mouse / trackpad). */
export const finePointer = (): boolean => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Safe localStorage wrappers (private mode / blocked storage must never break the page). */
export const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: carry on without persistence */
    }
  },
};
