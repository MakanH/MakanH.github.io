/**
 * Project pages: the parts generated from content.ts so they can never drift
 * from the data the exhibits use. That is the firewall policy table
 * (Project 1), the scoring model (Project 2) and the contents rail that
 * follows the reader down the page.
 */
import { FIREWALL_RULES, SIGNALS, SIGNAL_SOURCE, VERDICT_BANDS, VERDICT_LABEL, type FirewallRule } from '../content';
import { $, $$, el, esc } from '../lib/dom';
import { both, type L } from '../lib/i18n';

type Iface = FirewallRule['iface'];

const l = (en: string, fr: string): L => ({ en, fr });

const ACTION: Record<FirewallRule['action'], L> = { pass: l('pass', 'passer'), block: l('block', 'bloquer') };

const NOTES: Record<Iface | 'All', L> = {
  All: l(
    'pfSense filters traffic as it enters each interface, top down, first match wins. Nine documented rules across three interfaces.',
    'pfSense filtre le trafic à son entrée dans chaque interface, de haut en bas : la première règle qui correspond l’emporte. Neuf règles documentées sur trois interfaces.',
  ),
  LAN: l(
    'The trusted LAN keeps its default allow-any, with an explicit Wazuh rule above it to document the SIEM relationship.',
    'Le LAN de confiance garde son autorisation par défaut, avec une règle Wazuh explicite au-dessus pour documenter le lien avec le SIEM.',
  ),
  DMZ: l(
    'The block sits above the allows, so DMZ traffic for the LAN is dropped before it can match a pass rule.',
    'Le blocage se trouve au-dessus des autorisations : le trafic de la DMZ vers le LAN est donc rejeté avant de pouvoir correspondre à une règle de passage.',
  ),
  SIEM: l(
    'These only constrain connections the SIEM itself starts. Agents reach it through rules on the LAN and DMZ interfaces.',
    'Ces règles ne limitent que les connexions lancées par le SIEM lui-même. Les agents l’atteignent grâce aux règles des interfaces LAN et DMZ.',
  ),
};

const head = (cells: L[]): string => `<tr>${cells.map((cell) => `<th scope="col">${both(cell)}</th>`).join('')}</tr>`;

/** Project 1: the pfSense rule tables, filterable by interface. */
function initPolicy(): void {
  const mount = $('#policy');
  if (!mount) return;

  const filters: Array<Iface | 'All'> = ['All', 'LAN', 'DMZ', 'SIEM'];
  const buttons = filters.map((name) =>
    el('button', {
      attrs: { type: 'button', 'aria-pressed': String(name === 'All') },
      html: name === 'All' ? both(l('All', 'Toutes')) : name,
    }),
  );
  const rows = FIREWALL_RULES.map((rule) =>
    el('tr', {
      attrs: { 'data-iface': rule.iface },
      html: `
        <th scope="row">${esc(rule.iface)}</th>
        <td>${rule.n}</td>
        <td><span class="pill pill--${rule.action}">${both(ACTION[rule.action])}</span></td>
        <td>${esc(rule.source)}</td>
        <td><code>${esc(rule.destination)}</code></td>
        <td><code>${esc(rule.ports)}</code></td>
        <td>${both(rule.purpose)}</td>`,
    }),
  );
  const table = el('table', { class: 'tbl policy__tbl' }, [
    el('thead', {
      html: head([
        l('Interface', 'Interface'),
        l('#', '#'),
        l('Action', 'Action'),
        l('Source', 'Source'),
        l('Destination', 'Destination'),
        l('Ports', 'Ports'),
        l('Purpose', 'Raison'),
      ]),
    }),
    el('tbody', {}, rows),
  ]);
  const note = el('p', { class: 'policy__note', attrs: { 'aria-live': 'polite' } });

  const show = (name: Iface | 'All'): void => {
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(filters[i] === name)));
    for (const row of rows) row.hidden = name !== 'All' && row.dataset.iface !== name;
    note.innerHTML = both(NOTES[name]);
  };
  buttons.forEach((button, i) => button.addEventListener('click', () => show(filters[i]!)));

  mount.append(
    el('div', { class: 'policy__head' }, [
      el('span', { class: 'label', html: `${esc(mount.dataset.num ?? '')} ${both(l('Firewall policy', 'Politique du pare-feu'))}` }),
      el('div', { class: 'seg', attrs: { role: 'group' } }, buttons),
    ]),
    el('div', { class: 'tblwrap', attrs: { tabindex: 0, role: 'region', 'aria-label': 'pfSense' } }, [table]),
    note,
  );
  show('All');
}

/** Project 2: every signal the scoring engine knows, heaviest first. */
function initModel(): void {
  const mount = $('#model');
  if (!mount) return;
  const signals = Object.values(SIGNALS).sort((a, b) => b.points - a.points);
  const top = signals[0]?.points ?? 1;

  const rows = signals.map((signal, i) =>
    el('tr', {
      html: `
        <th scope="row">${both(signal.title)}</th>
        <td>
          <span class="model__pts">+${signal.points}
            <span class="model__bar model__bar--${signal.source}"><i style="--w: ${(signal.points / top).toFixed(3)}; --i: ${i}"></i></span>
          </span>
        </td>
        <td>${both(SIGNAL_SOURCE[signal.source])}</td>
        <td>${both(signal.why)}</td>`,
    }),
  );

  mount.append(
    el('div', { class: 'tblwrap', attrs: { tabindex: 0, role: 'region', 'aria-label': 'Score' } }, [
      el('table', { class: 'tbl' }, [
        el('caption', { html: `${esc(mount.dataset.num ?? '')} ${both(l('Scoring model', 'Modèle de pointage'))}` }),
        el('thead', {
          html: head([l('Signal', 'Signal'), l('Points', 'Points'), l('Source', 'Source'), l('Why it is weighted this way', 'Pourquoi ce poids')]),
        }),
        el('tbody', {}, rows),
      ]),
    ]),
    el('p', {
      class: 'model__bands',
      html: `${both(l('Verdict bands:', 'Seuils de verdict :'))}
        <span class="pill pill--benign">${both(VERDICT_LABEL.Benign)} 0-${VERDICT_BANDS.suspiciousFrom - 1}</span>
        <span class="pill pill--suspicious">${both(VERDICT_LABEL.Suspicious)} ${VERDICT_BANDS.suspiciousFrom}-${VERDICT_BANDS.maliciousFrom - 1}</span>
        <span class="pill pill--malicious">${both(VERDICT_LABEL.Malicious)} ${VERDICT_BANDS.maliciousFrom}+</span>`,
    }),
  );
}

/** The contents rail of a project page marks the part being read. */
function initContents(): void {
  for (const rail of $$('[data-toc]')) {
    const links = $$<HTMLAnchorElement>('a', rail);
    const parts = links.map((link) => document.getElementById(link.hash.slice(1))).filter((part): part is HTMLElement => part !== null);
    if (!parts.length) continue;
    let ticking = false;

    const update = (): void => {
      ticking = false;
      const mark = window.innerHeight * 0.4;
      let current = -1;
      parts.forEach((part, i) => {
        if (part.getBoundingClientRect().top <= mark) current = i;
      });
      // nothing is marked once the reader has left the report
      const last = parts[parts.length - 1]!;
      if (last.getBoundingClientRect().bottom < 0) current = -1;
      links.forEach((link, i) => link.classList.toggle('is-current', i === current));
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
}

export function initCases(): void {
  initPolicy();
  initModel();
  initContents();
}
