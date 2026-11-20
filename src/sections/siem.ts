/**
 * Exhibit 01-A: the attack replay.
 *
 * A plan of the lab's segmented network, three attacks to replay, and the
 * SIEM's event log. Replaying one runs it the way it ran in the real lab
 * (same commands, same log lines, same Wazuh rule IDs) while the detection
 * ladder lights up rung by rung. Between replays, ordinary baseline traffic
 * scrolls through the log.
 */
import { BASELINE_USERS, SCENARIOS, type Scenario, type ScenarioStep } from '../content';
import { $, $$, el, esc, must, pick, randInt, sleep, spriteHTML } from '../lib/dom';
import { both, type L } from '../lib/i18n';
import { motion, watchVisibility } from '../lib/motion';

const l = (en: string, fr: string): L => ({ en, fr });

const IDLE_LINES = 9;
const REPLAY_LINES = 14;
const PROMPT: Record<Scenario['id'], string> = {
  recon: 'kali@10.10.10.50:~$ ',
  smb: 'kali@10.10.10.50:~$ ',
  app: 'dmz-endpoint:~$ ',
};

const LADDER = l('Detection ladder', 'Échelle de détection');
const BASELINE = l('baseline traffic', 'trafic de référence');

/** Text in both languages, as two SVG <text> elements in the same place (CSS shows one). */
const svgText = (text: L, x: number, y: number, cls: string): string =>
  text.en === text.fr
    ? `<text class="${cls}" x="${x}" y="${y}">${esc(text.en)}</text>`
    : `<text class="${cls}" x="${x}" y="${y}" lang="en">${esc(text.en)}</text><text class="${cls}" x="${x}" y="${y}" lang="fr">${esc(text.fr)}</text>`;

/** One host on the plan: a small server box with a name and an address under it. */
const host = (x: number, y: number, name: L, short: L, ip: string, extra = ''): string => `
  <g class="rp__host ${extra}" transform="translate(${x} ${y})">
    <rect x="-17" y="-15" width="34" height="30" rx="6" />
    <path d="M-9 -5h18M-9 3h18" />
    ${svgText(name, 0, 36, 'rp__full')}
    ${svgText(short, 0, 44, 'rp__short')}
    <text class="rp__sub rp__full" x="0" y="50">${ip}</text>
  </g>`;

const zone = (x: number, width: number, name: L, short: string, subnet: string): string => `
  <rect class="rp__zone" x="${x}" y="196" width="${width}" height="218" rx="16" />
  ${svgText(name, x + 16, 220, 'rp__zonename rp__full')}
  <text class="rp__zonename rp__short" x="${x + 14}" y="226">${short}</text>
  <text class="rp__sub rp__full rp__start" x="${x + 16}" y="235">${subnet}</text>`;

/** Dots that travel along a path for as long as the plan is running. */
const dots = (path: string, count: number, seconds: number, className: string): string =>
  Array.from(
    { length: count },
    (_, i) =>
      `<circle class="${className}" r="3"><animateMotion dur="${seconds}s" begin="${((-seconds * i) / count).toFixed(2)}s" repeatCount="indefinite" path="${path}" /></circle>`,
  ).join('');

const PATH = {
  toLan: 'M320 130 C300 165 170 160 152 196',
  toDmz: 'M360 130 C362 160 392 165 395 196',
  toSiem: 'M400 130 C420 165 590 160 603 196',
  dcLogs: 'M86 284 C86 240 152 232 152 196 C170 160 300 165 320 130 L400 130 C420 165 590 160 603 196 L603 284',
  dmzLogs: 'M395 284 L395 196 C392 165 362 160 360 130 L400 130 C420 165 590 160 603 196 L603 284',
  kaliToDc: 'M200 300 L104 300',
  kaliToFirewall: 'M218 284 C218 240 152 232 152 196 C170 160 300 165 320 130',
  ghostToEndpoint: 'M338 384 Q346 338 378 312',
};

const MAP_DESCRIPTION = l(
  'Network plan of the lab. A pfSense firewall with a default-deny policy sits between the internet and three zones: a corporate LAN with a Windows domain controller and the Kali attacker, a DMZ with a Linux endpoint, and a SIEM zone with the Wazuh manager. Both endpoints forward logs to Wazuh. Traffic from the DMZ to the LAN is blocked.',
  'Plan réseau du laboratoire. Un pare-feu pfSense en refus par défaut se trouve entre Internet et trois zones : un LAN d’entreprise avec un contrôleur de domaine Windows et l’attaquant Kali, une DMZ avec un poste Linux, et une zone SIEM avec le gestionnaire Wazuh. Les deux postes transmettent leurs journaux à Wazuh. Le trafic de la DMZ vers le LAN est bloqué.',
);

const MAP = `
  <p class="sr-only">${both(MAP_DESCRIPTION)}</p>
  <svg class="rp__map" viewBox="0 0 720 430" aria-hidden="true">
    <path class="rp__link" d="M360 46 V86" />
    <circle class="rp__net" cx="360" cy="38" r="7" />
    <text class="rp__sub rp__start" x="374" y="42">Internet</text>

    <path class="rp__link" d="${PATH.toLan}" />
    <path class="rp__link" d="${PATH.toDmz}" />
    <path class="rp__link" d="${PATH.toSiem}" />

    ${zone(14, 276, l('Corporate LAN', 'LAN d’entreprise'), 'LAN', '10.10.10.0/24')}
    ${zone(306, 178, l('DMZ', 'DMZ'), 'DMZ', '10.10.20.0/24')}
    ${zone(500, 206, l('SIEM', 'Zone SIEM'), 'SIEM', '10.10.30.0/24')}

    <g class="rp__fw">
      <rect x="285" y="86" width="150" height="44" rx="10" />
      <text class="rp__fwname" x="360" y="106">pfSense</text>
      ${svgText(l('default deny', 'refus par défaut'), 360, 121, 'rp__sub rp__full')}
    </g>

    <g class="rp__blocked">
      <path d="M377 290 C350 262 320 262 294 268" />
      <path class="rp__cross" d="M287 261l12 12M299 261l-12 12" />
      ${svgText(l('blocked', 'bloqué'), 330, 256, 'rp__sub rp__full')}
    </g>

    ${svgText(l('agent logs · 1514-1515', 'journaux des agents · 1514-1515'), 556, 142, 'rp__sub rp__full rp__start')}
    <g class="rp__flow">
      ${dots(PATH.dcLogs, 3, 5.4, 'rp__dot')}
      <g class="rp__dmzflow">${dots(PATH.dmzLogs, 3, 4.2, 'rp__dot')}</g>
    </g>

    <g class="rp__attack" data-path="recon">
      <circle class="rp__radar" cx="218" cy="300" r="20" />
      <circle class="rp__radar rp__radar--late" cx="218" cy="300" r="20" />
      <path d="${PATH.kaliToDc}" /><path d="${PATH.kaliToFirewall}" />
      ${dots(PATH.kaliToDc, 3, 0.9, 'rp__adot')}${dots(PATH.kaliToFirewall, 4, 1.3, 'rp__adot')}
    </g>
    <g class="rp__attack" data-path="smb">
      <path d="${PATH.kaliToDc}" />
      ${dots(PATH.kaliToDc, 4, 0.7, 'rp__adot')}
    </g>
    <g class="rp__attack" data-path="app">
      <path d="${PATH.ghostToEndpoint}" />
      ${dots(PATH.ghostToEndpoint, 4, 0.7, 'rp__adot')}
      <circle class="rp__ghost" cx="338" cy="392" r="7" />
      ${svgText(l('10.10.20.99 · simulated', '10.10.20.99 · simulé'), 350, 396, 'rp__sub rp__full rp__start rp__ghostlabel')}
    </g>

    <circle class="rp__pulse" cx="603" cy="300" r="26" />
    ${host(86, 300, l('Domain controller', 'Contrôleur de domaine'), l('DC', 'DC'), '10.10.10.10')}
    ${host(218, 300, l('Kali attacker', 'Attaquant Kali'), l('Kali', 'Kali'), '10.10.10.50', 'rp__host--attacker')}
    ${host(395, 300, l('Linux endpoint', 'Poste Linux'), l('Endpoint', 'Poste'), '10.10.20.10')}
    ${host(603, 300, l('Wazuh manager', 'Gestionnaire Wazuh'), l('Wazuh', 'Wazuh'), '10.10.30.10', 'rp__host--siem')}
  </svg>`;

const playButton = (scenario: Scenario): string => `
  <button class="rp__play" type="button" data-scenario="${scenario.id}">
    <span class="rp__tech">${scenario.technique}</span>
    <span class="rp__name">${both(scenario.title)}</span>
    <span class="rp__tactic">${both(scenario.tactic)}</span>
    <span class="rp__go">${spriteHTML('i-play', 'icon icon--sm')}<i>${both(l('Replay', 'Rejouer'))}</i></span>
    <span class="rp__done" hidden>${spriteHTML('i-check', 'icon icon--sm')}${both(l('Detected', 'Détectée'))}</span>
  </button>`;

const TEMPLATE = `
  <div class="wbar">
    <span><span class="dot dot--red" aria-hidden="true"></span>${both(l('lab.local · Wazuh live events', 'lab.local · événements Wazuh en direct'))}</span>
    <span class="rp__tally"></span>
  </div>

  <div class="rp">
    <div class="rp__floor">
      <p class="wlabel">${both(l('Network', 'Réseau'))}</p>
      ${MAP}
    </div>

    <div class="rp__side">
      <p class="wlabel">${both(l('Replay an attack', 'Rejouer une attaque'))}</p>
      <div class="rp__deck">${SCENARIOS.map(playButton).join('')}</div>
      <p class="wlabel rp__ladderlabel"></p>
      <ol class="rp__ladder"></ol>
    </div>

    <div class="term rp__term">
      <div class="term__head"><span>${both(l('wazuh · event log', 'wazuh · journal d’événements'))}</span><span class="rp__termstate"></span></div>
      <div class="term__body" role="log" aria-live="off"></div>
    </div>

    <div class="rp__outcome" aria-live="polite">
      <p class="rp__plaque">${both(
        l(
          'Pick an attack. It plays out in the log, and the alerts climb the ladder.',
          'Choisissez une attaque. Elle se déroule dans le journal, et les alertes gravissent l’échelle.',
        ),
      )}</p>
    </div>
  </div>`;

export function initSiem(): void {
  const mount = $('#siem-replay');
  if (!mount) return;
  mount.classList.add('widget--dark');
  mount.innerHTML = TEMPLATE;

  const map = must<SVGSVGElement>('.rp__map', mount);
  const tally = must('.rp__tally', mount);
  const ladder = must('.rp__ladder', mount);
  const ladderLabel = must('.rp__ladderlabel', mount);
  const termBody = must('.term__body', mount);
  const termState = must('.rp__termstate', mount);
  const outcome = must('.rp__outcome', mount);
  const pulse = must('.rp__pulse', mount);
  const buttons = $$<HTMLButtonElement>('.rp__play', mount);
  const detected = new Set<Scenario['id']>();

  const setTally = (): void => {
    const n = detected.size;
    tally.innerHTML = both(l(`Detected ${n} of ${SCENARIOS.length}`, `${n} sur ${SCENARIOS.length} détectées`));
  };
  setTally();
  termState.innerHTML = both(BASELINE);

  /* ───────────── Ladder ───────────── */
  const showLadder = (scenario: Scenario, preview: boolean): void => {
    ladderLabel.innerHTML = preview ? both(LADDER) : both(l(`${LADDER.en} · ${scenario.title.en}`, `${LADDER.fr} · ${scenario.title.fr}`));
    ladder.classList.toggle('is-preview', preview);
    ladder.replaceChildren(
      ...scenario.ladder.map((rung) =>
        el('li', {
          class: 'rp__rung',
          attrs: { 'data-severity': rung.severity },
          html: `<b class="rp__tag">${esc(rung.tag)}</b><code>${both(rung.rule)}</code><span>${both(rung.label)}</span>`,
        }),
      ),
    );
  };

  const lightRung = (index: number): void => {
    ladder.children[index]?.classList.add('is-lit');
    // restart the ring around the Wazuh node
    pulse.classList.remove('is-on');
    void pulse.getBoundingClientRect();
    pulse.classList.add('is-on');
  };

  /* ───────────── Terminal ───────────── */
  const pushLine = (line: HTMLElement, keep: number): void => {
    termBody.append(line);
    while (termBody.childElementCount > keep) termBody.firstElementChild?.remove();
  };

  // A clock for the baseline traffic, so idle lines read like a real log
  let clock = 22 * 3600 + 41 * 60 + 7;
  const stamp = (): string => {
    clock = (clock + randInt(2, 9)) % 86400;
    const part = (value: number): string => String(Math.floor(value)).padStart(2, '0');
    return `Jun 30 ${part(clock / 3600)}:${part((clock % 3600) / 60)}:${part(clock % 60)}`;
  };

  const baselineLine = (): HTMLElement => {
    const fail = Math.random() < 0.1;
    const action = fail ? 'LOGIN_FAILED' : 'LOGIN_SUCCESS';
    const text = `${stamp()} APPSRV CustomApp: action=${action} user=${pick(BASELINE_USERS)} srcip=10.10.10.${randInt(20, 59)} reason=${fail ? 'bad_password' : 'ok'}`;
    return el('span', {
      class: 'term__line term__line--log',
      html: `<b class="rp__lvl${fail ? ' rp__lvl--warn' : ''}">${fail ? 'L5' : 'L3'}</b>${esc(text)}`,
    });
  };

  const stepLine = (step: ScenarioStep, scenario: Scenario): HTMLElement => {
    const line = el('span', { class: `term__line term__line--${step.kind}`, text: step.text });
    if (step.kind === 'cmd') line.dataset.prompt = PROMPT[scenario.id];
    if (step.kind === 'alert' && step.rung !== undefined) {
      line.dataset.severity = String(scenario.ladder[step.rung]?.severity ?? 2);
    }
    return line;
  };

  /* ───────────── Idle: baseline traffic and log flow ───────────── */
  let visible = false;
  let playing = false;
  /** How many log lines stay on screen: grows once a replay has been shown, so it is not trimmed away. */
  let keepLines = IDLE_LINES;
  let idleTimer = 0;
  let resumeTimer = 0;

  const idleAllowed = (): boolean => visible && !playing && !motion.calm && !document.hidden;

  const tickIdle = (): void => {
    window.clearTimeout(idleTimer);
    if (!idleAllowed()) return;
    pushLine(baselineLine(), keepLines);
    idleTimer = window.setTimeout(tickIdle, randInt(1300, 1900));
  };

  const refreshAmbient = (): void => {
    // SMIL dots on the plan follow the same rule as every other ambient loop
    if (visible && !motion.calm && !document.hidden) map.unpauseAnimations();
    else map.pauseAnimations();
    window.clearTimeout(idleTimer);
    if (idleAllowed()) idleTimer = window.setTimeout(tickIdle, 600);
  };

  for (let i = 0; i < 5; i++) pushLine(baselineLine(), IDLE_LINES);
  watchVisibility(mount, (inView) => {
    visible = inView;
    refreshAmbient();
  });
  motion.subscribe(refreshAmbient);
  document.addEventListener('visibilitychange', refreshAmbient);

  /* ───────────── Replay ───────────── */
  let run = 0;

  const setPlaying = (scenario: Scenario | null): void => {
    playing = scenario !== null;
    mount.classList.toggle('is-playing', playing);
    if (scenario) map.dataset.attack = scenario.id;
    else delete map.dataset.attack;
    for (const button of buttons) {
      const mine = button.dataset.scenario === scenario?.id;
      button.classList.toggle('is-active', mine);
      if (playing && !mine) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    }
  };

  const play = async (scenario: Scenario): Promise<void> => {
    const mine = ++run;
    window.clearTimeout(resumeTimer);
    window.clearTimeout(idleTimer);
    setPlaying(scenario);
    keepLines = REPLAY_LINES;
    showLadder(scenario, false);
    termBody.replaceChildren();
    termState.innerHTML = both(l(`replaying ${scenario.technique}`, `reconstitution ${scenario.technique}`));
    outcome.replaceChildren(el('p', { class: 'rp__plaque', html: both(scenario.blurb) }));

    const pace = motion.calm ? 0.35 : 1;
    for (const step of scenario.steps) {
      await sleep(Math.max(60, step.wait * pace));
      if (mine !== run) return;
      pushLine(stepLine(step, scenario), REPLAY_LINES);
      if (step.rung !== undefined) lightRung(step.rung);
    }
    await sleep(Math.max(60, 650 * pace));
    if (mine !== run) return;

    detected.add(scenario.id);
    setTally();
    const button = buttons.find((item) => item.dataset.scenario === scenario.id);
    const done = button ? $('.rp__done', button) : null;
    if (done) done.hidden = false;
    button?.classList.add('is-done');
    outcome.replaceChildren(
      el('p', {
        class: 'rp__result',
        html: `<span class="pill pill--pass">${spriteHTML('i-check', 'icon icon--sm')}${both(l('Detected', 'Détecté'))}</span><b>${both(scenario.verdict)}</b>`,
      }),
      el('p', { class: 'rp__plaque', html: `<strong>${both(l('Finding.', 'Constat.'))}</strong> ${both(scenario.finding)}` }),
    );
    setPlaying(null);
    termState.innerHTML = both(BASELINE);
    // Leave the replay on screen for a while before ordinary traffic resumes under it
    resumeTimer = window.setTimeout(refreshAmbient, 5000);
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true' || playing) return;
      const scenario = SCENARIOS.find((item) => item.id === button.dataset.scenario);
      if (scenario) void play(scenario);
    });
  }

  // Until an attack is replayed, the ladder of the custom-rule scenario is shown as a preview
  const preview = SCENARIOS.find((item) => item.id === 'app') ?? SCENARIOS[0];
  if (preview) showLadder(preview, true);
}
