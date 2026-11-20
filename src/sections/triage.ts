/**
 * Exhibits 02-A and 02-B: the scoring replay.
 *
 * Every red flag the pipeline finds in an email is worth points, and the
 * running total is the verdict. The four sample emails replay the pipeline's
 * real output (same indicators, same reasons, same scores). "Build an email"
 * lets a visitor set the red flags and watch the real scoring rules decide.
 */
import gsap from 'gsap';
import {
  EMAILS,
  FREE_PLAY_SIGNALS,
  IOC_KIND,
  SIGNALS,
  SIGNAL_SOURCE,
  VERDICT_BANDS,
  VERDICT_LABEL,
  type Ioc,
  type Signal,
  type SignalId,
  type TriageEmail,
  type Verdict,
} from '../content';
import { $, $$, el, esc, must, spriteHTML } from '../lib/dom';
import { both, type L } from '../lib/i18n';
import { motion, onceVisible } from '../lib/motion';

const l = (en: string, fr: string): L => ({ en, fr });

const STAGES = ['extract', 'enrich', 'score', 'report'] as const;
type Stage = (typeof STAGES)[number];
const STAGE_LABEL: Record<Stage, L> = {
  extract: l('Extract', 'Extraire'),
  enrich: l('Enrich', 'Enrichir'),
  score: l('Score', 'Noter'),
  report: l('Report', 'Rapporter'),
};
const STATUS: Record<Ioc['status'], L> = { clean: l('clean', 'propre'), flagged: l('flagged', 'signalé') };
const NO_FLAGS = l('No red flags. Nothing to score.', 'Aucun signal d’alerte. Rien à noter.');
const WHY_DEFAULT = l(
  'Two or more weak signals plus a link add a compound bonus, the way an analyst weighs clues that agree.',
  'Deux signaux faibles ou plus avec un lien ajoutent un bonus composé, comme un analyste qui pèse des indices concordants.',
);

const verdictFor = (score: number): Verdict =>
  score >= VERDICT_BANDS.maliciousFrom ? 'Malicious' : score >= VERDICT_BANDS.suspiciousFrom ? 'Suspicious' : 'Benign';

const flagHTML = (signal: Signal): string =>
  `<b>+${signal.points}</b><span>${both(signal.title)}</span><i>${both(SIGNAL_SOURCE[signal.source])}</i>`;

const emailButton = (email: TriageEmail): string => `
  <button class="tr__email" type="button" aria-pressed="false" data-email="${esc(email.id)}">
    <span class="tr__file">${esc(email.file)}</span>
    <span class="tr__name">${both(email.label)}</span>
    <span class="tr__result"></span>
  </button>`;

const TEMPLATE = `
  <div class="wbar wbar--light">
    <span>python -m triage samples/*.eml</span>
    <ol class="tr__stages">
      ${STAGES.map((stage, i) => `<li data-stage="${stage}"><i>${i + 1}</i>${both(STAGE_LABEL[stage])}</li>`).join('')}
    </ol>
  </div>

  <div class="tr">
    <div class="tr__inbox">
      <p class="wlabel">${both(l('02-A · Four sample emails', '02-A · Quatre courriels d’exemple'))}</p>
      <div class="tr__emails" role="group">
        ${EMAILS.map(emailButton).join('')}
      </div>
      <p class="wlabel">${both(l('02-B · Your own', '02-B · Le vôtre'))}</p>
      <button class="tr__email tr__email--free" type="button" aria-pressed="false" data-email="free">
        <span class="tr__file">${both(l('free play', 'jeu libre'))}</span>
        <span class="tr__name">${both(l('Build an email', 'Composer un courriel'))}</span>
        <span class="tr__hint">${both(l('Set the red flags and watch the verdict move.', 'Choisissez les signaux d’alerte et regardez le verdict bouger.'))}</span>
      </button>
    </div>

    <div class="tr__sheet">
      <div class="tr__view" data-view="replay">
        <dl class="tr__header">
          <div><dt>${both(l('From', 'De'))}</dt><dd data-field="from"></dd></div>
          <div><dt>${both(l('Subject', 'Objet'))}</dt><dd data-field="subject"></dd></div>
        </dl>
        <p class="wlabel">${both(l('Indicators pulled from the email', 'Indicateurs extraits du courriel'))}</p>
        <ul class="tr__iocs"></ul>
        <p class="wlabel">${both(l('Red flags scored', 'Signaux d’alerte notés'))}</p>
        <ul class="tr__flags" data-flags="replay"></ul>
      </div>

      <div class="tr__view" data-view="free" hidden>
        <p class="wlabel">${both(l('Set the red flags in this email', 'Choisissez les signaux d’alerte de ce courriel'))}</p>
        <div class="tr__picker" role="group"></div>
        <div class="tr__options">
          <label class="tr__switch">
            <input type="checkbox" checked />
            <span>${both(l('Email contains a link', 'Le courriel contient un lien'))}</span>
          </label>
          <button class="btn btn--sm" type="button" data-action="clear">${both(l('Clear all', 'Tout effacer'))}</button>
        </div>
        <p class="tr__why"></p>
      </div>

      <div class="tr__score">
        <p class="tr__total">
          <span class="tr__num">0</span><span class="tr__of">/100</span>
        </p>
        <div class="tr__gauge" aria-hidden="true">
          <div class="tr__track">
            <span class="tr__zone tr__zone--benign"></span>
            <span class="tr__zone tr__zone--suspicious"></span>
            <span class="tr__zone tr__zone--malicious"></span>
            <div class="tr__slider"><span class="tr__marker"></span></div>
          </div>
          <div class="tr__scale">
            <span>${both(VERDICT_LABEL.Benign)} <b>0-24</b></span>
            <span>${both(VERDICT_LABEL.Suspicious)} <b>25-59</b></span>
            <span>${both(VERDICT_LABEL.Malicious)} <b>60+</b></span>
          </div>
        </div>
        <div class="tr__verdict" aria-live="polite">
          <p class="stamp tr__stamp" hidden><span></span><small></small></p>
          <div class="tr__whybox">
            <p class="wlabel">${both(l('Why this verdict', 'Pourquoi ce verdict'))}</p>
            <ul class="tr__reasons"></ul>
          </div>
        </div>
      </div>
    </div>
  </div>`;

export function initTriage(): void {
  const mount = $('#triage-replay');
  if (!mount) return;
  mount.innerHTML = TEMPLATE;

  const stageItems = $$('.tr__stages li', mount);
  const emailButtons = $$<HTMLButtonElement>('.tr__email', mount);
  const views = $$('.tr__view', mount);
  const fromField = must('[data-field="from"]', mount);
  const subjectField = must('[data-field="subject"]', mount);
  const iocList = must('.tr__iocs', mount);
  const flags = must('[data-flags="replay"]', mount);
  const picker = must('.tr__picker', mount);
  const linkSwitch = must<HTMLInputElement>('.tr__switch input', mount);
  const why = must('.tr__why', mount);
  const total = must('.tr__total', mount);
  const number = must('.tr__num', mount);
  const slider = must('.tr__slider', mount);
  const stampEl = must('.tr__stamp', mount);
  const stampWord = must('span', stampEl);
  const stampScore = must('small', stampEl);
  const reasonsEl = must('.tr__reasons', mount);

  /* ───────────── Score, gauge and stamp (shared by replay and free play) ───────────── */
  const shown = { score: 0 };
  let stamped: Verdict | null = null;

  const setScore = (score: number, animate: boolean): void => {
    const duration = animate ? motion.dur(0.45) : 0;
    gsap.to(shown, {
      score,
      duration,
      ease: 'power2.out',
      overwrite: true,
      onUpdate: () => {
        number.textContent = String(Math.round(shown.score));
      },
    });
    gsap.to(slider, { xPercent: score, duration, ease: 'power3.out', overwrite: true });
    total.dataset.verdict = verdictFor(score).toLowerCase();
  };

  const setStamp = (verdict: Verdict | null, score: number, animate: boolean): void => {
    gsap.killTweensOf(stampEl);
    if (!verdict) {
      stampEl.hidden = true;
      stamped = null;
      return;
    }
    const changed = verdict !== stamped;
    stamped = verdict;
    stampEl.hidden = false;
    stampEl.dataset.verdict = verdict.toLowerCase();
    stampWord.innerHTML = both(VERDICT_LABEL[verdict]);
    stampScore.innerHTML = both(l(`score ${score}/100`, `note ${score}/100`));
    if (animate && changed && !motion.calm) {
      gsap.fromTo(stampEl, { scale: 2.2, rotation: -15, opacity: 0 }, { scale: 1, rotation: -5, opacity: 0.95, duration: 0.28, ease: 'power4.in' });
    } else {
      gsap.set(stampEl, { scale: 1, rotation: -5, opacity: 0.95 });
    }
  };

  /** Each line is markup: escaped tool output, or both() text. */
  const setReasons = (lines: string[]): void => {
    reasonsEl.replaceChildren(...lines.map((html) => el('li', { html })));
  };

  const setStage = (current: Stage | 'idle' | 'done'): void => {
    const at = current === 'done' ? STAGES.length : current === 'idle' ? -1 : STAGES.indexOf(current);
    stageItems.forEach((item, i) => {
      item.classList.toggle('is-done', i < at);
      item.classList.toggle('is-current', i === at);
      if (i === at) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
  };

  /* ───────────── Replay of a sample email ───────────── */
  let timeline: gsap.core.Timeline | null = null;

  const markPlayed = (email: TriageEmail): void => {
    const slot = $(`.tr__email[data-email="${email.id}"] .tr__result`, mount);
    if (!slot || slot.childElementCount) return;
    slot.append(el('span', { class: `pill pill--${email.verdict.toLowerCase()}`, html: `${both(VERDICT_LABEL[email.verdict])} · ${email.score}` }));
  };

  const iocItem = (ioc: Ioc): HTMLLIElement =>
    el('li', {
      class: 'tr__ioc',
      html: `
        <span class="tr__kind">${both(IOC_KIND[ioc.kind])}</span>
        <code class="tr__value">${esc(ioc.value)}</code>
        <span class="tr__status" data-status="${ioc.status}">
          ${spriteHTML(ioc.status === 'clean' ? 'i-check' : 'i-close', 'icon icon--sm')}
          <b>${both(STATUS[ioc.status])}</b><i>${esc(ioc.detail)}</i>
        </span>`,
    });

  const replay = (email: TriageEmail, animate: boolean): void => {
    timeline?.kill();
    timeline = null;
    gsap.killTweensOf([shown, slider, reasonsEl]);

    fromField.textContent = email.from;
    subjectField.textContent = email.subject;
    const iocs = email.iocs.map(iocItem);
    iocList.replaceChildren(...iocs);
    const rows = email.signals.map((id) => el('li', { class: `tr__flag tr__flag--${SIGNALS[id].source}`, html: flagHTML(SIGNALS[id]) }));
    flags.replaceChildren(...(rows.length ? rows : [el('li', { class: 'tr__empty', html: both(NO_FLAGS) })]));
    setReasons(email.reasons.map(esc));

    if (!animate || motion.calm) {
      // The finished sheet, no replay
      iocs.forEach((item) => item.classList.add('is-enriched'));
      gsap.set(reasonsEl, { opacity: 1 });
      setScore(email.score, false);
      setStamp(email.verdict, email.score, false);
      setStage('done');
      markPlayed(email);
      return;
    }

    gsap.set(iocs, { opacity: 0, y: 10 });
    gsap.set(rows, { opacity: 0, x: 36 });
    gsap.set(reasonsEl, { opacity: 0 });
    setScore(0, false);
    setStamp(null, 0, false);
    setStage('idle');

    const tl = gsap.timeline({
      onComplete: () => {
        setStage('done');
        markPlayed(email);
      },
    });
    // 1. Extract: the indicators come out of the email
    tl.call(() => setStage('extract'));
    tl.to(iocs, { opacity: 1, y: 0, duration: 0.3, stagger: 0.13, ease: 'power2.out' });
    // 2. Enrich: each one is checked against threat intel
    tl.call(() => setStage('enrich'), [], '+=0.2');
    for (const item of iocs) tl.call(() => item.classList.add('is-enriched'), [], '+=0.22');
    // 3. Score: one row per red flag, the total climbing as each lands
    tl.call(() => setStage('score'), [], '+=0.35');
    let running = 0;
    email.signals.forEach((id, i) => {
      running = Math.min(VERDICT_BANDS.max, running + SIGNALS[id].points);
      const after = running;
      tl.to(rows[i]!, { opacity: 1, x: 0, duration: 0.36, ease: 'power3.out' }, '+=0.14');
      tl.call(() => setScore(after, true));
      tl.to({}, { duration: 0.34 });
    });
    // 4. Report: the verdict, and the reasons behind it
    tl.call(() => setStage('report'), [], '+=0.15');
    tl.call(() => setStamp(email.verdict, email.score, true));
    tl.to(reasonsEl, { opacity: 1, duration: 0.4 }, '+=0.3');
    timeline = tl;
  };

  /* ───────────── Free play ───────────── */
  const selected = new Set<SignalId>();
  const pickButtons = new Map<SignalId, HTMLButtonElement>();

  for (const id of FREE_PLAY_SIGNALS) {
    const signal = SIGNALS[id];
    const button = el('button', {
      class: `tr__pick tr__flag--${signal.source}`,
      attrs: { type: 'button', 'aria-pressed': 'false' },
      html: `${flagHTML(signal)}<span class="tr__tick" aria-hidden="true">${spriteHTML('i-check', 'icon icon--sm')}</span>`,
    });
    pickButtons.set(id, button);
    picker.append(button);
  }

  // The compound bonus is applied by the rules, never picked by hand
  const autoRow = el('div', {
    class: 'tr__pick tr__pick--auto tr__flag--compound',
    attrs: { hidden: true },
    html: `${flagHTML(SIGNALS.compound)}<span class="tr__auto">auto</span>`,
  });
  picker.append(autoRow);

  const showWhy = (id: SignalId | null): void => {
    if (!id) {
      why.innerHTML = both(WHY_DEFAULT);
      return;
    }
    const { title, why: reason } = SIGNALS[id];
    why.innerHTML = both(l(`${title.en}: ${reason.en}`, `${title.fr} : ${reason.fr}`));
  };

  const updateFree = (animate: boolean): void => {
    const picked = FREE_PLAY_SIGNALS.filter((id) => selected.has(id));
    const weak = picked.filter((id) => SIGNALS[id].weak).length;
    // Same rule as score.py: two or more weak signals, and something to click
    const compound = weak >= 2 && linkSwitch.checked;
    const raw = picked.reduce((sum, id) => sum + SIGNALS[id].points, 0) + (compound ? SIGNALS.compound.points : 0);
    const score = Math.min(VERDICT_BANDS.max, raw);

    for (const [id, button] of pickButtons) button.setAttribute('aria-pressed', String(selected.has(id)));
    autoRow.hidden = !compound;

    const lines = picked.map((id) => both(l(`+${SIGNALS[id].points} · ${SIGNALS[id].title.en}`, `+${SIGNALS[id].points} · ${SIGNALS[id].title.fr}`)));
    if (compound) {
      lines.push(both(l(`+${SIGNALS.compound.points} · Compound bonus: ${weak} weak signals and a link`, `+${SIGNALS.compound.points} · Bonus composé : ${weak} signaux faibles et un lien`)));
    }
    if (raw > VERDICT_BANDS.max) lines.push(both(l(`Capped at ${VERDICT_BANDS.max}`, `Plafonné à ${VERDICT_BANDS.max}`)));
    setReasons(lines.length ? lines : [both(NO_FLAGS)]);
    gsap.set(reasonsEl, { opacity: 1 });
    setScore(score, animate);
    setStamp(verdictFor(score), score, animate);
  };

  for (const [id, button] of pickButtons) {
    button.addEventListener('click', () => {
      if (selected.has(id)) selected.delete(id);
      else {
        selected.add(id);
        // an IP is either suspicious or malicious, not both
        if (id === 'ipSuspicious') selected.delete('ipMalicious');
        if (id === 'ipMalicious') selected.delete('ipSuspicious');
      }
      showWhy(id);
      updateFree(true);
    });
    button.addEventListener('pointerenter', () => showWhy(id));
    button.addEventListener('focus', () => showWhy(id));
  }
  linkSwitch.addEventListener('change', () => updateFree(true));
  must('[data-action="clear"]', mount).addEventListener('click', () => {
    selected.clear();
    linkSwitch.checked = true;
    showWhy(null);
    updateFree(true);
  });
  showWhy(null);

  /* ───────────── Choosing what to look at ───────────── */
  const choose = (id: string, animate: boolean): void => {
    const free = id === 'free';
    for (const button of emailButtons) button.setAttribute('aria-pressed', String(button.dataset.email === id));
    for (const view of views) view.hidden = (view.dataset.view === 'free') !== free;
    mount.classList.toggle('is-free', free);

    if (free) {
      timeline?.kill();
      timeline = null;
      setStage('score');
      stamped = null;
      updateFree(false);
      return;
    }
    const email = EMAILS.find((item) => item.id === id);
    if (email) replay(email, animate);
  };

  for (const button of emailButtons) {
    button.addEventListener('click', () => choose(button.dataset.email ?? '', true));
  }

  // Show the first email's finished sheet straight away, then replay it for real once it is on screen
  const first = EMAILS[0];
  if (first) {
    choose(first.id, false);
    onceVisible(mount, () => choose(first.id, true), 0.3);
  }
}
