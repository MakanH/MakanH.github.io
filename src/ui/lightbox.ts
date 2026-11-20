/** Exhibit screenshots: stills on the project pages that open full size in a dialog. */
import { EXHIBITS, type Exhibit } from '../content';
import { $, el, esc, spriteHTML } from '../lib/dom';
import { both, pick } from '../lib/i18n';

const base = import.meta.env.BASE_URL;
const imageUrl = (item: Exhibit): string => `${base}img/${item.src}.webp`;
const EXHIBIT = { en: 'Exhibit', fr: 'Pièce' };

export function initStills(): void {
  const dialog = $<HTMLDialogElement>('#lightbox');
  const image = $<HTMLImageElement>('#lightbox-img');
  const caption = $('#lightbox-cap');
  if (!dialog || !image || !caption) return;

  const open = (item: Exhibit): void => {
    image.src = imageUrl(item);
    image.width = item.width;
    image.height = item.height;
    image.alt = `${pick(item.title)}. ${pick(item.caption)}`;
    caption.innerHTML = `<b>${both(EXHIBIT)} ${esc(item.ref)}</b>${both(item.caption)}`;
    dialog.showModal();
  };

  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    // A click on the dialog element itself is a click on the backdrop
    if (target === dialog || target.closest('[data-close]')) dialog.close();
  });

  const build = (mountId: string, items: Exhibit[]): void => {
    const mount = $(`#${mountId}`);
    if (!mount) return;
    for (const item of items) {
      const label = { en: `Open screenshot: ${item.title.en}`, fr: `Ouvrir la capture : ${item.title.fr}` };
      const button = el('button', {
        class: 'still__open',
        attrs: { type: 'button' },
        html: `
          <img src="${imageUrl(item)}" alt="" loading="lazy" decoding="async" width="${item.width}" height="${item.height}" />
          <span class="still__scan" aria-hidden="true"></span>
          <span class="still__zoom" aria-hidden="true">${spriteHTML('i-expand', 'icon icon--sm')}</span>
          <span class="sr-only">${both(label)}</span>`,
      });
      button.addEventListener('click', () => open(item));
      mount.append(
        el('figure', { class: 'still' }, [
          button,
          el('figcaption', {
            html: `<span class="still__ref">${both(EXHIBIT)} ${esc(item.ref)}</span><b>${both(item.title)}</b><span>${both(item.caption)}</span>`,
          }),
        ]),
      );
    }
  };

  build('siem-stills', EXHIBITS.siem);
  build('triage-stills', EXHIBITS.triage);
}
