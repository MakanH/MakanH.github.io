/**
 * Home: the headline and the map of the lab network.
 *
 * The map's labels are ordinary links laid over the drawing, so every host and
 * zone is a way into a part of the page for a mouse, a finger, a keyboard or a
 * screen reader alike. The 3D scene is loaded after first paint; without WebGL
 * (or with `?no3d`) a flat drawing of the same board takes its place. The map
 * has its own pause button, which starts pressed for visitors who ask their
 * system for reduced motion.
 */
import gsap from 'gsap';
import { MAP_NODES, MAP_ZONES, ZONE_NAME } from '../content';
import { $, $$, el, must } from '../lib/dom';
import { both, i18n, pick, type L } from '../lib/i18n';
import { motion } from '../lib/motion';
import { BOARD, GATE, GLOBE, HOSTS, ROUTES, WALL, ZONES, ZONE_Z0, ZONE_Z1, type P } from './map-layout';
import type { MapScene, NodeId, TossReport } from './map-scene';

const l = (en: string, fr: string): L => ({ en, fr });

function webglAvailable(): boolean {
  // `?no3d` skips the WebGL map: handy for weak devices and for automated checks
  if (new URLSearchParams(window.location.search).has('no3d')) return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/* ───────────────────────────── Labels ───────────────────────────── */

function buildLabels(mount: HTMLElement): Map<string, HTMLElement> {
  const labels = new Map<string, HTMLElement>();

  for (const node of MAP_NODES) {
    const label = el('span', {
      class: `mlabel mlabel--${node.id}`,
      attrs: { 'data-node': node.id },
      html: `
        <span class="mlabel__body">
          <b><span class="mlabel__long">${both(node.name)}</span><span class="mlabel__short">${both(node.short)}</span></b>
          <span class="mlabel__more"><i>${both(node.sub)}</i><span class="mlabel__role">${both(node.role)}</span></span>
        </span>`,
    });
    labels.set(node.id, label);
    mount.append(label);
  }

  for (const zone of MAP_ZONES) {
    const label = el('span', {
      class: `mlabel mlabel--zone mlabel--${zone.id}`,
      attrs: { 'data-zone': zone.id },
      html: `
        <span class="mlabel__body">
          <b><span class="mlabel__long">${both(zone.name)}</span><span class="mlabel__short">${zone.short}</span></b>
          <i>${zone.subnet}</i>
        </span>`,
    });
    labels.set(`zone-${zone.id}`, label);
    mount.append(label);
  }
  return labels;
}

/** The key under the map: every zone with its subnet and hosts. */
function buildKey(): void {
  const list = $('#map-key');
  if (!list) return;
  const name = (id: string): string => {
    const node = MAP_NODES.find((item) => item.id === id);
    return node ? both(node.name) : '';
  };
  const rows = [
    `<b>${both(l('Edge', 'Bordure'))}</b><span>${name('internet')}, ${name('pfsense')} (${both(l('default deny', 'refus par défaut'))})</span>`,
    ...MAP_ZONES.map((zone) => {
      const hosts = MAP_NODES.filter((node) => node.zone === zone.id).map((node) => name(node.id));
      return `<b>${zone.short}</b><span><code>${zone.subnet}</code> ${hosts.join(', ')}</span>`;
    }),
  ];
  list.replaceChildren(...rows.map((html) => el('li', { html })));
}

/* ───────────────────────────── Filter log ───────────────────────────── */

const LOG_LINES = 2;
const TAG = { pass: l('PASS', 'AUTORISÉ'), block: l('BLOCK', 'BLOQUÉ'), none: l('MISS', 'RATÉ') };

function describe(report: TossReport): { tag: L; kind: string; line: L; note: L } {
  const flow = report.flow;
  if (report.kind === 'outside') {
    return {
      tag: TAG.none,
      kind: 'none',
      line: l('Landed outside the firewall', 'Tombé hors du pare-feu'),
      note: l('never reached pfSense, nothing to rule on', 'n’a jamais atteint pfSense, rien à juger'),
    };
  }
  if (report.kind === 'wall' || !flow) {
    return {
      tag: TAG.block,
      kind: 'block',
      line: l('Internet → pfSense', 'Internet → pfSense'),
      note: l('default deny · no pass rule for traffic from outside', 'refus par défaut · aucune règle n’autorise le trafic venant de l’extérieur'),
    };
  }
  const route = `${ZONE_NAME[flow.from]} → ${ZONE_NAME[flow.to]}`;
  const port = flow.port === 'any' ? l('any port', 'tout port') : l(`tcp/${flow.port}`, `tcp/${flow.port}`);
  return {
    tag: TAG[flow.verdict],
    kind: flow.verdict,
    line: l(`${route} · ${port.en}`, `${route} · ${port.fr}`),
    note: l(`${flow.rule.en} · ${flow.why.en}`, `${flow.rule.fr} · ${flow.why.fr}`),
  };
}

/* ───────────────────────────── Flat map (no WebGL) ───────────────────────────── */

const S = 100; // SVG units per world unit
const sx = (x: number): number => (x + BOARD.w / 2) * S;
const sz = (z: number): number => (z + BOARD.d / 2) * S;

function flatPath(points: P[]): string {
  const parts: string[] = [];
  let before = '';
  for (const [x, , z] of points) {
    const at = `${sx(x).toFixed(0)} ${sz(z).toFixed(0)}`;
    if (at === before) continue;
    parts.push(`${parts.length ? 'L' : 'M'}${at}`);
    before = at;
  }
  return parts.join(' ');
}

function flatMarkup(): string {
  const W = BOARD.w * S;
  const H = BOARD.d * S;
  const zone = (id: keyof typeof ZONES): string =>
    `<rect class="flat__zone flat__zone--${id}" x="${sx(ZONES[id].x0)}" y="${sz(ZONE_Z0)}" width="${(ZONES[id].x1 - ZONES[id].x0) * S}" height="${(ZONE_Z1 - ZONE_Z0) * S}" />`;
  const host = (id: keyof typeof HOSTS, extra = ''): string => {
    const spec = HOSTS[id];
    const depth = id === 'kali' ? 0.7 : spec.d;
    return `<rect class="flat__host ${extra}" x="${sx(spec.x - spec.w / 2)}" y="${sz(spec.z - depth / 2)}" width="${spec.w * S}" height="${depth * S}" rx="6" />`;
  };

  const traces = ROUTES.map((route) => `<path class="flat__trace" d="${flatPath(route.points)}" />`).join('');
  const dots = ROUTES.map((route) => {
    const path = flatPath(route.points);
    const seconds = 9 / route.speed + 3;
    return Array.from(
      { length: route.count },
      (_, i) =>
        `<rect class="flat__dot flat__dot--${route.kind}" x="-13" y="-5" width="26" height="10"><animateMotion dur="${seconds.toFixed(1)}s" begin="${((-seconds * i) / route.count).toFixed(2)}s" repeatCount="indefinite" rotate="auto" path="${path}" /></rect>`,
    ).join('');
  }).join('');

  const gx = sx(GLOBE.x);
  const gz = sz(GLOBE.z);
  const r = GLOBE.r * S;

  return `
    <svg class="flat" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <pattern id="flat-dots" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle class="flat__grid" cx="20" cy="20" r="1.8" />
        </pattern>
      </defs>
      <rect class="flat__board" x="2" y="2" width="${W - 4}" height="${H - 4}" />
      <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="url(#flat-dots)" />
      ${zone('lan')}${zone('dmz')}${zone('siem')}
      ${traces}
      <g class="flat__flow">${dots}</g>
      <rect class="flat__wall" x="${sx(-WALL.half)}" y="${sz(WALL.z - WALL.t / 2)}" width="${WALL.half * 2 * S}" height="${WALL.t * S}" />
      <rect class="flat__gate" x="${sx(-GATE.w / 2)}" y="${sz(WALL.z - GATE.d / 2)}" width="${GATE.w * S}" height="${GATE.d * S}" />
      <circle class="flat__ring" cx="${sx(HOSTS.wazuh.x)}" cy="${sz(HOSTS.wazuh.z)}" r="95" />
      <circle class="flat__ring" cx="${sx(HOSTS.wazuh.x)}" cy="${sz(HOSTS.wazuh.z)}" r="162" />
      ${host('dc')}${host('kali', 'flat__host--attacker')}${host('endpoint')}${host('wazuh', 'flat__host--siem')}
      <g class="flat__globe">
        <circle cx="${gx}" cy="${gz}" r="${r}" />
        <ellipse cx="${gx}" cy="${gz}" rx="${r * 0.42}" ry="${r}" />
        <path d="M${gx - r} ${gz}H${gx + r}M${gx - r * 0.86} ${gz - r * 0.5}H${gx + r * 0.86}M${gx - r * 0.86} ${gz + r * 0.5}H${gx + r * 0.86}" />
      </g>
    </svg>`;
}

/** Where each label sits on the flat map, as a fraction of the board. */
function flatAnchors(): Record<string, [number, number]> {
  const at = (x: number, z: number): [number, number] => [(x + BOARD.w / 2) / BOARD.w, (z + BOARD.d / 2) / BOARD.d];
  return {
    internet: at(GLOBE.x, GLOBE.z - GLOBE.r - 0.1),
    pfsense: at(0, WALL.z - GATE.d / 2 - 0.1),
    dc: at(HOSTS.dc.x, HOSTS.dc.z - HOSTS.dc.d / 2 - 0.1),
    kali: at(HOSTS.kali.x, HOSTS.kali.z - 0.45),
    endpoint: at(HOSTS.endpoint.x, HOSTS.endpoint.z - HOSTS.endpoint.d / 2 - 0.1),
    wazuh: at(HOSTS.wazuh.x, HOSTS.wazuh.z - HOSTS.wazuh.d / 2 - 0.1),
    'zone-lan': at(ZONES.lan.x0 + 0.05, ZONE_Z0),
    'zone-dmz': at(ZONES.dmz.x0 + 0.05, ZONE_Z0),
    'zone-siem': at(ZONES.siem.x0 + 0.05, ZONE_Z0),
  };
}

/* ───────────────────────────── Home ───────────────────────────── */

export interface Home {
  /** Resolves when the map (or its flat stand-in) is ready to show. */
  ready: Promise<void>;
  intro(): void;
}

const PAUSE = l('Pause the map', 'Mettre la carte en pause');
const RESUME = l('Resume the map', 'Relancer la carte');

export function initHome(): Home {
  const hero = must('#home');
  const stage = must('#map-stage');
  const canvas = must<HTMLCanvasElement>('#map-canvas');
  const flat = must('#map-flat');
  const log = must('#map-log');
  const clear = must<HTMLButtonElement>('#map-clear');
  const pause = must<HTMLButtonElement>('#map-pause');
  const command = must('#map-cmd');
  const fx = must('#map-fx');
  const hint = must('#map-hint');

  const labels = buildLabels(must('#map-labels'));
  buildKey();

  let scene: MapScene | null = null;
  let flatSvg: SVGSVGElement | null = null;
  let thrown = 0;

  /* ── Pause: only the map. Starts pressed when the system asks for reduced motion ── */
  let paused = motion.calm;
  let touched = false;
  const setPaused = (next: boolean): void => {
    paused = next;
    pause.setAttribute('aria-pressed', String(next));
    pause.title = pick(next ? RESUME : PAUSE);
    stage.classList.toggle('is-paused', next);
    scene?.setPaused(next);
    if (flatSvg) {
      if (next) flatSvg.pauseAnimations();
      else flatSvg.unpauseAnimations();
    }
  };
  pause.addEventListener('click', () => {
    touched = true;
    setPaused(!paused);
  });
  motion.subscribe((calm) => {
    if (!touched) setPaused(calm);
  });
  i18n.subscribe(() => {
    pause.title = pick(paused ? RESUME : PAUSE);
  });

  /* ── Filter log ── */
  const idleLine = el('p', {
    class: 'mlog mlog--idle',
    html: `<b>${both(l('IDLE', 'ATTENTE'))}</b><span>${both(l('No packets yet', 'Aucun paquet pour l’instant'))}</span><i>${both(
      l('click a zone on the map, or pick one above', 'cliquez sur une zone de la carte, ou choisissez-en une ci-dessus'),
    )}</i>`,
  });
  log.append(idleLine);

  const report = (toss: TossReport): void => {
    const { tag, kind, line, note } = describe(toss);
    idleLine.remove();
    const row = el('p', { class: `mlog mlog--${kind}`, html: `<b>${both(tag)}</b><span>${both(line)}</span><i>${both(note)}</i>` });
    log.append(row);
    while (log.childElementCount > LOG_LINES) log.firstElementChild?.remove();
    if (!motion.calm) gsap.from(row, { opacity: 0, x: -10, duration: 0.3, ease: 'power2.out' });
  };

  const noteThrow = (): void => {
    thrown++;
    if (thrown === 1) hint.classList.add('is-used');
  };

  /* ── Label behaviour shared by both maps ── */
  // On a touch screen there is no hover: a tap on a label shows its details instead
  const canHover = window.matchMedia('(hover: hover)');
  for (const label of labels.values()) {
    label.addEventListener('click', () => {
      if (canHover.matches) return;
      const open = !label.classList.contains('is-open');
      for (const other of labels.values()) other.classList.remove('is-open');
      label.classList.toggle('is-open', open);
    });
  }
  for (const [id, label] of labels) {
    if (!label.dataset.node) continue;
    const node = id as NodeId;
    label.addEventListener('pointerenter', () => scene?.highlight(node));
    label.addEventListener('pointerleave', () => scene?.highlight(null));
    label.addEventListener('focus', () => scene?.highlight(node));
    label.addEventListener('blur', () => scene?.highlight(null));
  }

  const buildFlat = (): void => {
    stage.classList.add('is-flat');
    flat.innerHTML = flatMarkup();
    const anchors = flatAnchors();
    for (const [id, label] of labels) {
      const at = anchors[id];
      if (!at) continue;
      label.style.left = `${(at[0] * 100).toFixed(2)}%`;
      label.style.top = `${(at[1] * 100).toFixed(2)}%`;
    }
    hint.innerHTML = both(l('Select a host or a zone to open its section', 'Choisissez un hôte ou une zone pour ouvrir sa section'));
    must('.map__console').hidden = true;
    flatSvg = $<SVGSVGElement>('svg', flat);
    setPaused(paused);
  };

  const ready = (async (): Promise<void> => {
    if (!webglAvailable()) {
      buildFlat();
      return;
    }
    try {
      const { createMapScene } = await import('./map-scene');
      scene = await createMapScene(
        canvas,
        stage,
        {
          place: (id, x, y) => {
            const label = labels.get(id);
            if (label) label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          },
          report,
          count: (live) => {
            clear.hidden = live === 0;
          },
          hover: (node) => {
            for (const [id, label] of labels) label.classList.toggle('is-hot', id === node);
          },
          loading: (busy) => stage.classList.toggle('is-loading', busy),
          stamp: (x, y, verdict) => {
            // The verdict, stamped in mid-air where the packet met the filter
            const mark = el('span', {
              class: `mfx mfx--${verdict}`,
              html: both(verdict === 'pass' ? l('Passed', 'Autorisé') : l('Denied', 'Refusé')),
            });
            mark.style.left = `${x.toFixed(1)}px`;
            mark.style.top = `${y.toFixed(1)}px`;
            fx.append(mark);
            if (motion.calm) {
              mark.classList.add('mfx--still');
              window.setTimeout(() => mark.remove(), 900);
            } else mark.addEventListener('animationend', () => mark.remove(), { once: true });
          },
        },
        { paused },
      );
      stage.classList.add('is-live');
    } catch (error) {
      console.warn('The 3D map is unavailable, showing the flat one.', error);
      buildFlat();
    }
  })();

  stage.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.mlabel')) for (const label of labels.values()) label.classList.remove('is-open');
    if (!scene || target.closest('a, button, .mlabel')) return;
    noteThrow();
  });

  // The command line under the map: "send --to lan | dmz | siem | any"
  command.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-zone]');
    if (!button || !scene) return;
    const zone = button.dataset.zone;
    scene.send(zone === 'lan' || zone === 'dmz' || zone === 'siem' ? zone : undefined);
    noteThrow();
    // the word flashes as if it had just been typed and entered
    button.classList.remove('is-fired');
    void button.offsetWidth;
    button.classList.add('is-fired');
  });
  clear.addEventListener('click', () => scene?.clear());

  return {
    ready,
    intro(): void {
      const lines = $$('[data-intro-line]', hero);
      const rest = $$('[data-intro]', hero);
      if (motion.calm) {
        gsap.set([...lines, ...rest], { opacity: 1, clearProps: 'transform' });
        return;
      }
      gsap.fromTo(lines, { yPercent: 108 }, { yPercent: 0, duration: 1.05, ease: 'power4.out', stagger: 0.09, delay: 0.05, clearProps: 'transform' });
      gsap.fromTo(
        rest,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08, delay: 0.35, clearProps: 'transform' },
      );
    },
  };
}
