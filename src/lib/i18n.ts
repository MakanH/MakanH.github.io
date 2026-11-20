/**
 * English or French.
 *
 * Both languages are in the page at once: every translatable piece of text is
 * written twice, as <span lang="en"> and <span lang="fr">, and one CSS rule
 * hides whichever does not match <html lang>. Switching is instant and nothing
 * has to be re-rendered. An inline script in each page's <head> picks the
 * language before first paint: the visitor's saved choice, else the browser's
 * language, else English.
 *
 * Because of that rule, `lang` attributes inside <body> are reserved for this
 * switch: never use one to mark a single foreign word.
 */
import { esc, store } from './dom';

export type Lang = 'en' | 'fr';

/** A piece of text in both languages. */
export interface L {
  en: string;
  fr: string;
}

const KEY = 'casefile.lang';
type Listener = (lang: Lang) => void;

const listeners = new Set<Listener>();
const root = document.documentElement;
const current = (): Lang => (root.lang === 'fr' ? 'fr' : 'en');

function apply(lang: Lang): void {
  root.lang = lang;
  const title = lang === 'fr' ? root.dataset.titleFr : root.dataset.titleEn;
  if (title) document.title = title;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-set-lang]')) {
    button.setAttribute('aria-pressed', String(button.dataset.setLang === lang));
  }
  for (const listener of listeners) listener(lang);
}

export const i18n = {
  get lang(): Lang {
    return current();
  },

  init(): void {
    apply(current());
    document.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-set-lang]');
      if (!button) return;
      const lang: Lang = button.dataset.setLang === 'fr' ? 'fr' : 'en';
      store.set(KEY, lang);
      if (lang !== current()) apply(lang);
    });
  },

  /** Subscribe to changes. The listener is also called immediately. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    listener(current());
    return () => listeners.delete(listener);
  },
};

/** Text in both languages, escaped, for template strings. */
export function both(text: L | string): string {
  if (typeof text === 'string') return esc(text);
  if (text.en === text.fr) return esc(text.en);
  return `<span lang="en">${esc(text.en)}</span><span lang="fr">${esc(text.fr)}</span>`;
}

/** Like both(), for markup written in this codebase (it may contain tags). */
export function bothHTML(text: L): string {
  if (text.en === text.fr) return text.en;
  return `<span lang="en">${text.en}</span><span lang="fr">${text.fr}</span>`;
}

/** The text in the current language, for attributes such as alt and title. */
export const pick = (text: L): string => text[current()];
