/**
 * Site content that drives the generated parts of the pages, in English and
 * French.
 *
 * Everything here is taken from the CV and the two project repositories (rule
 * IDs, firewall rules, log formats, scores, sample emails), so the map and the
 * exhibits replay what the projects actually do. Verbatim tool output
 * (commands, log lines, Wazuh alert text, the pipeline's own reasons) stays in
 * English in both languages, the way it appears in the real tools.
 */
import type { L } from './lib/i18n';

const l = (en: string, fr: string): L => ({ en, fr });
const same = (text: string): L => ({ en: text, fr: text });

/* ───────────────────────────── Home sections ───────────────────────────── */

export interface SectionRef {
  id: string;
  num: string;
  label: L;
}

export const SECTIONS: SectionRef[] = [
  { id: 'about', num: '01', label: l('About', 'À propos') },
  { id: 'experience', num: '02', label: l('Experience', 'Parcours') },
  { id: 'projects', num: '03', label: l('Projects', 'Projets') },
  { id: 'skills', num: '04', label: l('Skills', 'Compétences') },
  { id: 'cv', num: '05', label: same('CV') },
];

/* ───────────────────────────── Wire feed (ticker) ───────────────────────────── */

/** May contain <b> for emphasis. */
export const WIRE: L[] = [
  l('<b>3/3</b> simulated attacks detected', '<b>3/3</b> attaques simulées détectées'),
  l('<b>36</b> unit tests on the triage pipeline', '<b>36</b> tests unitaires sur le pipeline de triage'),
  l('<b>0</b> false positives on the phishing test set', '<b>0</b> faux positif sur le jeu de test d’hameçonnage'),
  same('MITRE ATT&amp;CK <b>T1046</b> · <b>T1110</b> · <b>T1566</b>'),
  same('Wazuh · pfSense · Active Directory'),
  same('Python · C# · SQL · Bash · KQL'),
  same('CTF · @Hack · Vanier Hacks'),
  l('English · French · Persian', 'Anglais · français · farsi'),
];

/* ───────────────────────────── Lab network ───────────────────────────── */

export type Zone = 'wan' | 'lan' | 'dmz' | 'siem';

export const ZONE_NAME: Record<Zone, string> = { wan: 'Internet', lan: 'LAN', dmz: 'DMZ', siem: 'SIEM' };

export interface MapNode {
  id: 'internet' | 'pfsense' | 'dc' | 'kali' | 'endpoint' | 'wazuh';
  name: L;
  short: L;
  /** Address or policy line. */
  sub: L;
  /** What the host is: shown, with the address, while its label is hovered. */
  role: L;
  zone: Zone | 'edge';
}

export const MAP_NODES: MapNode[] = [
  { id: 'pfsense', name: l('pfSense firewall', 'Pare-feu pfSense'), short: same('pfSense'), sub: l('default deny', 'refus par défaut'), role: l('filters every segment', 'filtre chaque segment'), zone: 'edge' },
  { id: 'dc', name: l('Domain controller', 'Contrôleur de domaine'), short: same('DC'), sub: same('10.10.10.10'), role: same('Windows Server 2022'), zone: 'lan' },
  { id: 'wazuh', name: l('Wazuh manager', 'Gestionnaire Wazuh'), short: same('Wazuh'), sub: same('10.10.30.10'), role: same('Wazuh 4.14'), zone: 'siem' },
  { id: 'endpoint', name: l('Linux endpoint', 'Poste Linux'), short: same('Linux'), sub: same('10.10.20.10'), role: l('runs the custom app', 'exécute l’app maison'), zone: 'dmz' },
  { id: 'kali', name: l('Kali attacker', 'Attaquant Kali'), short: same('Kali'), sub: same('10.10.10.50'), role: l('runs the attacks', 'lance les attaques'), zone: 'lan' },
  { id: 'internet', name: same('Internet'), short: same('Internet'), sub: same('WAN'), role: l('uplink through NAT', 'liaison par NAT'), zone: 'wan' },
];

export interface MapZone {
  id: Exclude<Zone, 'wan'>;
  name: L;
  short: string;
  subnet: string;
}

export const MAP_ZONES: MapZone[] = [
  { id: 'lan', name: l('Corporate LAN', 'LAN d’entreprise'), short: 'LAN', subnet: '10.10.10.0/24' },
  { id: 'dmz', name: same('DMZ'), short: 'DMZ', subnet: '10.10.20.0/24' },
  { id: 'siem', name: l('SIEM', 'Zone SIEM'), short: 'SIEM', subnet: '10.10.30.0/24' },
];

export interface FirewallRule {
  iface: 'LAN' | 'DMZ' | 'SIEM';
  n: number;
  action: 'pass' | 'block';
  source: string;
  destination: string;
  ports: string;
  purpose: L;
}

/** The pfSense rule tables, as documented in docs/02-pfsense-segmentation.md. First match wins. */
export const FIREWALL_RULES: FirewallRule[] = [
  { iface: 'DMZ', n: 1, action: 'block', source: 'DMZ net', destination: 'LAN net', ports: 'any', purpose: l('DMZ must not reach the corporate LAN (isolation)', 'La DMZ ne doit pas atteindre le LAN d’entreprise (isolation)') },
  { iface: 'DMZ', n: 2, action: 'pass', source: 'DMZ net', destination: '10.10.30.10', ports: '1514-1515', purpose: l('DMZ endpoint to Wazuh (agent logs)', 'Poste de la DMZ vers Wazuh (journaux de l’agent)') },
  { iface: 'DMZ', n: 3, action: 'pass', source: 'DMZ net', destination: 'any', ports: 'any', purpose: l('DMZ outbound (internet)', 'Sortie de la DMZ (Internet)') },
  { iface: 'SIEM', n: 1, action: 'block', source: 'SIEM net', destination: 'LAN net', ports: 'any', purpose: l('SIEM cannot pivot into the LAN it monitors', 'Le SIEM ne peut pas pivoter vers le LAN qu’il surveille') },
  { iface: 'SIEM', n: 2, action: 'block', source: 'SIEM net', destination: 'DMZ net', ports: 'any', purpose: l('SIEM cannot pivot into the DMZ it monitors', 'Le SIEM ne peut pas pivoter vers la DMZ qu’il surveille') },
  { iface: 'SIEM', n: 3, action: 'pass', source: 'SIEM net', destination: 'any', ports: 'any', purpose: l('SIEM outbound (updates, threat intel)', 'Sortie du SIEM (mises à jour, renseignement sur les menaces)') },
  { iface: 'LAN', n: 1, action: 'pass', source: '*', destination: 'LAN address', ports: '443, 80', purpose: l('Anti-lockout (GUI access)', 'Anti-verrouillage (accès à l’interface web)') },
  { iface: 'LAN', n: 2, action: 'pass', source: 'LAN net', destination: '10.10.30.10', ports: '1514-1515', purpose: l('LAN agents and dashboard to Wazuh', 'Agents du LAN et tableau de bord vers Wazuh') },
  { iface: 'LAN', n: 3, action: 'pass', source: 'LAN net', destination: 'any', ports: 'any', purpose: l('Default allow LAN to any', 'Autorisation par défaut du LAN vers tout') },
];

export interface Flow {
  from: Zone;
  to: Exclude<Zone, 'wan'>;
  port: string;
  verdict: 'pass' | 'block';
  /** Which rule decides it. */
  rule: L;
  why: L;
}

const DEFAULT_DENY = l('default deny', 'refus par défaut');
const NO_PASS_RULE = l('no pass rule for traffic from outside', 'aucune règle n’autorise le trafic venant de l’extérieur');

/**
 * What pfSense does with a packet thrown at each zone of the map. Every verdict
 * follows from the rule tables above; traffic arriving from the internet has no
 * pass rule at all, so the default deny drops it.
 */
export const FLOWS: Flow[] = [
  { from: 'dmz', to: 'lan', port: 'any', verdict: 'block', rule: l('DMZ rule 1', 'Règle DMZ 1'), why: l('DMZ must not reach the corporate LAN', 'la DMZ ne doit pas atteindre le LAN d’entreprise') },
  { from: 'siem', to: 'lan', port: 'any', verdict: 'block', rule: l('SIEM rule 1', 'Règle SIEM 1'), why: l('SIEM cannot pivot into the LAN it monitors', 'le SIEM ne peut pas pivoter vers le LAN qu’il surveille') },
  { from: 'wan', to: 'lan', port: 'any', verdict: 'block', rule: DEFAULT_DENY, why: NO_PASS_RULE },
  { from: 'lan', to: 'dmz', port: 'any', verdict: 'pass', rule: l('LAN rule 3', 'Règle LAN 3'), why: l('default allow LAN to any', 'autorisation par défaut du LAN vers tout') },
  { from: 'siem', to: 'dmz', port: 'any', verdict: 'block', rule: l('SIEM rule 2', 'Règle SIEM 2'), why: l('SIEM cannot pivot into the DMZ it monitors', 'le SIEM ne peut pas pivoter vers la DMZ qu’il surveille') },
  { from: 'wan', to: 'dmz', port: 'any', verdict: 'block', rule: DEFAULT_DENY, why: NO_PASS_RULE },
  { from: 'lan', to: 'siem', port: '1514', verdict: 'pass', rule: l('LAN rule 2', 'Règle LAN 2'), why: l('LAN agents to Wazuh', 'agents du LAN vers Wazuh') },
  { from: 'dmz', to: 'siem', port: '1514', verdict: 'pass', rule: l('DMZ rule 2', 'Règle DMZ 2'), why: l('DMZ endpoint to Wazuh (agent logs)', 'poste de la DMZ vers Wazuh (journaux de l’agent)') },
  { from: 'wan', to: 'siem', port: 'any', verdict: 'block', rule: DEFAULT_DENY, why: NO_PASS_RULE },
];

/* ───────────────────────────── Project 1: attack replays ───────────────────────────── */

export interface LadderRung {
  /** Short badge, e.g. "L10". */
  tag: string;
  /** Rule ID or log source. */
  rule: L;
  label: L;
  /** 1 = informational, 2 = high, 3 = critical. Drives the colour. */
  severity: 1 | 2 | 3;
}

export type StepKind = 'cmd' | 'out' | 'log' | 'alert' | 'note';

export interface ScenarioStep {
  kind: StepKind;
  /** Verbatim tool output: shown in English in both languages. */
  text: string;
  /** Pause before this step, in ms. */
  wait: number;
  /** Light this ladder rung (index) when the step lands. */
  rung?: number;
}

/** Which link of the network plan lights up while the scenario runs. */
export type AttackPath = 'recon' | 'app' | 'smb';

export interface Scenario {
  id: AttackPath;
  technique: string;
  tactic: L;
  title: L;
  blurb: L;
  ladder: LadderRung[];
  steps: ScenarioStep[];
  verdict: L;
  finding: L;
}

const CREDENTIAL_ACCESS = l('Credential access', 'Accès aux identifiants');

const failed = (time: string): string =>
  `Jun 30 ${time} APPSRV CustomApp: action=LOGIN_FAILED user=jdoe srcip=10.10.20.99 reason=bad_password`;

export const SCENARIOS: Scenario[] = [
  {
    id: 'recon',
    technique: 'T1046',
    tactic: l('Discovery', 'Découverte'),
    title: l('Network recon', 'Reconnaissance réseau'),
    blurb: l('A full-port SYN sweep of the corporate LAN from Kali.', 'Un balayage SYN de tous les ports du LAN d’entreprise, depuis Kali.'),
    ladder: [
      { tag: 'LOG', rule: same('pfSense'), label: l('Connection attempts hit the firewall log', 'Les tentatives de connexion arrivent dans le journal du pare-feu'), severity: 1 },
      { tag: 'PATTERN', rule: same('fan-out'), label: l('One source, every port, seconds apart', 'Une seule source, tous les ports, à quelques secondes d’intervalle'), severity: 2 },
      { tag: 'T1046', rule: l('Discovery', 'Découverte'), label: l('Network service scanning identified', 'Balayage des services réseau identifié'), severity: 3 },
    ],
    steps: [
      { kind: 'cmd', text: 'sudo nmap -sS -p- --min-rate 1000 10.10.10.0/24', wait: 300 },
      { kind: 'out', text: 'Nmap scan report for pfsense.lab.local (10.10.10.1)', wait: 900, rung: 0 },
      { kind: 'out', text: '53/tcp  open  domain', wait: 260 },
      { kind: 'out', text: '80/tcp  open  http', wait: 180 },
      { kind: 'out', text: '443/tcp open  https', wait: 180 },
      { kind: 'out', text: 'Nmap scan report for 10.10.10.10', wait: 800 },
      { kind: 'out', text: 'All 65535 scanned ports are in ignored states (filtered)', wait: 320, rung: 1 },
      { kind: 'alert', text: 'T1046 · Discovery · one internal source swept all 65,535 ports on the /24', wait: 900, rung: 2 },
    ],
    verdict: l('Detected · Discovery', 'Détecté · Découverte'),
    finding: l(
      "The domain controller's default-deny host firewall showed every port filtered. pfSense's web GUI answered from the LAN, so that went on the hardening list.",
      'Le pare-feu hôte du contrôleur de domaine, en refus par défaut, montrait tous les ports filtrés. L’interface web de pfSense répondait depuis le LAN : elle s’est ajoutée à la liste de durcissement.',
    ),
  },
  {
    id: 'app',
    technique: 'T1110',
    tactic: CREDENTIAL_ACCESS,
    title: l('Brute force · custom app', 'Force brute · application maison'),
    blurb: l(
      'A burst of failed logins, then a success, caught by my own correlation rules.',
      'Une rafale de connexions échouées, puis une réussite, interceptées par mes propres règles de corrélation.',
    ),
    ladder: [
      { tag: 'L5', rule: same('100101'), label: l('A single failed login', 'Une seule connexion échouée'), severity: 1 },
      { tag: 'L10', rule: same('100102'), label: l('5+ failures from one IP in 120 s: brute force', '5 échecs ou plus d’une même IP en 120 s : force brute'), severity: 2 },
      { tag: 'L12', rule: same('100103'), label: l('Success after the burst: account compromise', 'Réussite après la rafale : compte compromis'), severity: 3 },
    ],
    steps: [
      { kind: 'cmd', text: 'dotnet run -- --scenario compromise --srcip 10.10.20.99', wait: 300 },
      { kind: 'log', text: failed('22:50:19'), wait: 800, rung: 0 },
      { kind: 'log', text: failed('22:50:21'), wait: 420 },
      { kind: 'log', text: failed('22:50:23'), wait: 420 },
      { kind: 'log', text: failed('22:50:26'), wait: 420 },
      { kind: 'log', text: failed('22:50:28'), wait: 420 },
      { kind: 'alert', text: 'rule 100102 · level 10 · possible brute force - 5+ failed logins from 10.10.20.99 in 120s', wait: 260, rung: 1 },
      { kind: 'log', text: failed('22:50:30'), wait: 700 },
      { kind: 'log', text: 'Jun 30 22:50:32 APPSRV CustomApp: action=LOGIN_SUCCESS user=jdoe srcip=10.10.20.99 reason=ok', wait: 700 },
      {
        kind: 'alert',
        text: 'rule 100103 · level 12 · successful login from 10.10.20.99 following a brute-force burst - possible account compromise',
        wait: 300,
        rung: 2,
      },
    ],
    verdict: l('Detected · Level 12', 'Détecté · niveau 12'),
    finding: l(
      'Seven individually boring log lines became one high-severity alert. That escalation, from level 5 to level 12, is the whole point of correlation.',
      'Sept lignes de journal anodines prises une à une sont devenues une seule alerte de haute gravité. Cette escalade, du niveau 5 au niveau 12, est tout l’intérêt de la corrélation.',
    ),
  },
  {
    id: 'smb',
    technique: 'T1110',
    tactic: CREDENTIAL_ACCESS,
    title: l('Brute force · SMB', 'Force brute · SMB'),
    blurb: l(
      'A password spray against a service account on the domain controller.',
      'Une pulvérisation de mots de passe contre un compte de service du contrôleur de domaine.',
    ),
    ladder: [
      { tag: 'L5', rule: same('60122'), label: l('Logon failure, Event 4625', 'Échec d’ouverture de session, événement 4625'), severity: 1 },
      { tag: 'L10', rule: same('60204'), label: l('Multiple Windows logon failures', 'Multiples échecs d’ouverture de session Windows'), severity: 2 },
      { tag: 'L6', rule: same('92652'), label: l('Remote logon succeeded after the failures', 'Ouverture de session à distance réussie après les échecs'), severity: 3 },
    ],
    steps: [
      { kind: 'cmd', text: 'nxc smb 10.10.10.10 -u tservice -p pw.txt --continue-on-success', wait: 300 },
      { kind: 'out', text: '[*] Windows Server 2022 Build 20348 (domain:lab.local)', wait: 800 },
      { kind: 'out', text: '[-] lab.local\\tservice:admin        STATUS_LOGON_FAILURE', wait: 520, rung: 0 },
      { kind: 'out', text: '[-] lab.local\\tservice:Welcome1     STATUS_LOGON_FAILURE', wait: 380 },
      { kind: 'out', text: '[-] lab.local\\tservice:Summer2025   STATUS_LOGON_FAILURE', wait: 380 },
      { kind: 'alert', text: 'rule 60204 · level 10 · Multiple Windows Logon Failures', wait: 420, rung: 1 },
      { kind: 'out', text: '[+] lab.local\\tservice:Password1', wait: 800 },
      { kind: 'alert', text: 'rule 92652 · level 6 · Successful Remote Logon Detected - NTLM authentication', wait: 380, rung: 2 },
    ],
    verdict: l('Detected · Level 10 + flagged logon', 'Détecté · niveau 10 + connexion signalée'),
    finding: l(
      'The fix is boring and effective: an account lockout policy, and a long random password (or a gMSA) for the service account.',
      'Le correctif est simple et efficace : une politique de verrouillage des comptes, et un mot de passe long et aléatoire (ou un gMSA) pour le compte de service.',
    ),
  },
];

/** Baseline traffic that scrolls through the terminal while no attack is running. */
export const BASELINE_USERS = ['jdoe', 'asmith', 'svc_backup', 'mwilson'] as const;

/* ───────────────────────────── Project 2: threat triage ───────────────────────────── */

export type IocKind = 'ip' | 'domain' | 'url' | 'hash' | 'file';

export const IOC_KIND: Record<IocKind, L> = {
  ip: same('IP'),
  domain: l('Domain', 'Domaine'),
  url: same('URL'),
  hash: l('Hash', 'Empreinte'),
  file: l('File', 'Fichier'),
};

export interface Ioc {
  kind: IocKind;
  value: string;
  status: 'clean' | 'flagged';
  /** What the enrichment stage found (tool output, English). */
  detail: string;
}

export type SignalId = 'hash' | 'ipMalicious' | 'ipSuspicious' | 'url' | 'doubleExt' | 'macro' | 'lookalike' | 'urgency' | 'compound';

export interface Signal {
  id: SignalId;
  points: number;
  title: L;
  /** One line on why it is weighted the way it is. */
  why: L;
  /** Threat intel, a structural heuristic, or the bonus for signals that agree. */
  source: 'intel' | 'heuristic' | 'compound';
  /** "Weak" signals are the ones that can combine into the compound bonus. */
  weak: boolean;
}

export const SIGNAL_SOURCE: Record<Signal['source'], L> = {
  intel: l('Threat intel', 'Renseignement'),
  heuristic: l('Heuristic', 'Heuristique'),
  compound: l('Compound', 'Composé'),
};

/** The scoring model, exactly as weighted in src/triage/score.py. */
export const SIGNALS: Record<SignalId, Signal> = {
  hash: {
    id: 'hash',
    points: 60,
    title: l('File hash flagged', 'Empreinte de fichier signalée'),
    why: l('Multi-engine antivirus consensus on VirusTotal. Decisive on its own.', 'Consensus de plusieurs moteurs antivirus sur VirusTotal. Décisif à lui seul.'),
    source: 'intel',
    weak: false,
  },
  ipMalicious: {
    id: 'ipMalicious',
    points: 30,
    title: l('Source IP malicious', 'IP source malveillante'),
    why: l('AbuseIPDB confidence of 50% or more for the sending infrastructure.', 'Indice de confiance AbuseIPDB de 50 % ou plus pour l’infrastructure d’envoi.'),
    source: 'intel',
    weak: false,
  },
  ipSuspicious: {
    id: 'ipSuspicious',
    points: 15,
    title: l('Source IP suspicious', 'IP source suspecte'),
    why: l('AbuseIPDB confidence between 25% and 49%.', 'Indice de confiance AbuseIPDB entre 25 % et 49 %.'),
    source: 'intel',
    weak: false,
  },
  url: {
    id: 'url',
    points: 25,
    title: l('URL or domain flagged', 'URL ou domaine signalé'),
    why: l('Known-bad web infrastructure on VirusTotal.', 'Infrastructure web connue comme malveillante sur VirusTotal.'),
    source: 'intel',
    weak: false,
  },
  doubleExt: {
    id: 'doubleExt',
    points: 25,
    title: l('Double-extension file', 'Fichier à double extension'),
    why: l('An attachment like invoice.doc.exe: a classic malware disguise.', 'Une pièce jointe comme invoice.doc.exe : un déguisement classique de logiciel malveillant.'),
    source: 'heuristic',
    weak: true,
  },
  macro: {
    id: 'macro',
    points: 20,
    title: l('"Enable macros" lure', 'Leurre « activez les macros »'),
    why: l('A direct request to open a common malware execution path.', 'Une demande directe d’ouvrir une voie d’exécution courante pour les logiciels malveillants.'),
    source: 'heuristic',
    weak: true,
  },
  lookalike: {
    id: 'lookalike',
    points: 20,
    title: l('Lookalike domain', 'Domaine sosie'),
    why: l('A sender domain built to impersonate a brand.', 'Un domaine d’expéditeur conçu pour usurper une marque.'),
    source: 'heuristic',
    weak: true,
  },
  urgency: {
    id: 'urgency',
    points: 10,
    title: l('Urgency language', 'Langage d’urgence'),
    why: l('Pressure to act now. Common in phishing, weak alone.', 'Pression pour agir tout de suite. Courant dans l’hameçonnage, faible à lui seul.'),
    source: 'heuristic',
    weak: true,
  },
  compound: {
    id: 'compound',
    points: 20,
    title: l('Compound bonus', 'Bonus composé'),
    why: l(
      'Two or more weak signals plus a clickable link are far stronger together.',
      'Deux signaux faibles ou plus, combinés à un lien cliquable, sont bien plus forts ensemble.',
    ),
    source: 'compound',
    weak: false,
  },
};

/** The order the free-play signals are laid out in. */
export const FREE_PLAY_SIGNALS: SignalId[] = ['urgency', 'lookalike', 'macro', 'doubleExt', 'url', 'ipSuspicious', 'ipMalicious', 'hash'];

export const VERDICT_BANDS = {
  suspiciousFrom: 25,
  maliciousFrom: 60,
  max: 100,
} as const;

export type Verdict = 'Benign' | 'Suspicious' | 'Malicious';

export const VERDICT_LABEL: Record<Verdict, L> = {
  Benign: l('Benign', 'Bénin'),
  Suspicious: l('Suspicious', 'Suspect'),
  Malicious: l('Malicious', 'Malveillant'),
};

export interface TriageEmail {
  id: string;
  file: string;
  label: L;
  from: string;
  subject: string;
  hasLink: boolean;
  iocs: Ioc[];
  signals: SignalId[];
  /** The pipeline's own explanation lines, from reports/sample-report.json. */
  reasons: string[];
  score: number;
  verdict: Verdict;
}

/** The four sample emails in the repo, with the pipeline's real output for each. */
export const EMAILS: TriageEmail[] = [
  {
    id: 'credential',
    file: '01-credential-phish.eml',
    label: l('Credential phish', 'Hameçonnage d’identifiants'),
    from: 'security@micros0ft-support.com',
    subject: 'Urgent: Your account will be suspended in 24 hours',
    hasLink: true,
    iocs: [
      { kind: 'ip', value: '203.0.113.44', status: 'clean', detail: '0% abuse confidence' },
      { kind: 'domain', value: 'micros0ft-support.com', status: 'clean', detail: '0 engine detections' },
      { kind: 'url', value: 'micros0ft-support.com/verify?id=8842', status: 'clean', detail: 'Not on record' },
    ],
    signals: ['urgency', 'lookalike', 'compound'],
    reasons: [
      'Urgency / pressure language typical of phishing',
      "Sender domain 'micros0ft-support.com' contains digits (possible brand impersonation)",
      'Multiple phishing indicators (2) combined with an actionable link (compound risk)',
    ],
    score: 50,
    verdict: 'Suspicious',
  },
  {
    id: 'invoice',
    file: '02-invoice-attachment.eml',
    label: l('Invoice attachment', 'Facture en pièce jointe'),
    from: 'billing@invoice-delivery.net',
    subject: 'Invoice #INV-2026-0918 - Payment Overdue',
    hasLink: false,
    iocs: [
      { kind: 'ip', value: '198.51.100.23', status: 'clean', detail: '0% abuse confidence' },
      { kind: 'domain', value: 'invoice-delivery.net', status: 'clean', detail: '0 engine detections' },
      { kind: 'file', value: 'Invoice_2026_0918.doc.exe', status: 'flagged', detail: 'Double extension' },
    ],
    signals: ['urgency', 'macro', 'doubleExt'],
    reasons: [
      'Urgency / pressure language typical of phishing',
      'Asks the recipient to enable macros (common malware lure)',
      "Attachment 'Invoice_2026_0918.doc.exe' uses a deceptive double extension",
    ],
    score: 55,
    verdict: 'Suspicious',
  },
  {
    id: 'malware',
    file: '03-malware-link.eml',
    label: l('Malware link', 'Lien malveillant'),
    from: 'tracking@dhl-shipment-track.com',
    subject: 'Your package could not be delivered',
    hasLink: true,
    iocs: [
      { kind: 'ip', value: '185.220.101.47', status: 'flagged', detail: '100% abuse confidence, 144 reports' },
      { kind: 'domain', value: 'dhl-shipment-track.com', status: 'clean', detail: '0 engine detections' },
      { kind: 'url', value: 'dhl-shipment-track.com/label/DHL772910.zip', status: 'clean', detail: 'Not on record' },
      { kind: 'hash', value: '275a021b…f651fd0f', status: 'flagged', detail: '65 engines (EICAR test file)' },
    ],
    signals: ['ipMalicious', 'hash'],
    reasons: ['Source IP 185.220.101.47 has 100% abuse confidence (AbuseIPDB)', 'File hash flagged malicious by 65 engines (VirusTotal)'],
    score: 90,
    verdict: 'Malicious',
  },
  {
    id: 'newsletter',
    file: '04-legitimate-newsletter.eml',
    label: l('Legit newsletter', 'Infolettre légitime'),
    from: 'noreply@github.com',
    subject: 'Your weekly digest',
    hasLink: true,
    iocs: [
      { kind: 'ip', value: '140.82.112.25', status: 'clean', detail: '0% abuse confidence' },
      { kind: 'domain', value: 'github.com', status: 'clean', detail: '0 engine detections' },
      { kind: 'url', value: 'github.com/dashboard', status: 'clean', detail: '0 engine detections' },
    ],
    signals: [],
    reasons: ['No threat-intel hits or structural red flags detected'],
    score: 0,
    verdict: 'Benign',
  },
];

/* ───────────────────────────── Exhibits: screenshots ───────────────────────────── */

export interface Exhibit {
  /** File name in public/img, without extension. */
  src: string;
  width: number;
  height: number;
  /** Exhibit reference, e.g. "01-B". */
  ref: string;
  title: L;
  caption: L;
}

export const EXHIBITS: Record<'siem' | 'triage', Exhibit[]> = {
  siem: [
    {
      src: 'siem-alert-ladder',
      width: 1800,
      height: 576,
      ref: '01-B',
      title: l('The alert ladder', 'L’échelle d’alertes'),
      caption: l(
        'Wazuh Threat Hunting, filtered to my three custom rules: a run of level-5 failed logins, the level-10 brute-force correlation, then the level-12 compromise alert.',
        'La chasse aux menaces de Wazuh, filtrée sur mes trois règles personnalisées : une série de connexions échouées de niveau 5, la corrélation de force brute de niveau 10, puis l’alerte de compromission de niveau 12.',
      ),
    },
    {
      src: 'siem-logtest',
      width: 1276,
      height: 739,
      ref: '01-C',
      title: l('Decoder under test', 'Le décodeur à l’essai'),
      caption: l(
        'wazuh-logtest decoding a CustomApp log line into fields and matching rule 100101, mapped to ATT&CK T1110 (Brute Force).',
        'wazuh-logtest décode une ligne du journal CustomApp en champs et déclenche la règle 100101, associée à ATT&CK T1110 (force brute).',
      ),
    },
    {
      src: 'siem-smb-bruteforce',
      width: 1800,
      height: 781,
      ref: '01-D',
      title: l('SMB brute force on the DC', 'Force brute SMB sur le contrôleur de domaine'),
      caption: l(
        'Windows logon events on the domain controller during the SMB brute force: rule 60122, then 60204 at level 10, then the flagged remote logon 92652.',
        'Les événements d’ouverture de session Windows sur le contrôleur de domaine pendant la force brute SMB : la règle 60122, puis 60204 au niveau 10, puis la connexion à distance signalée 92652.',
      ),
    },
    {
      src: 'siem-mitre',
      width: 1800,
      height: 623,
      ref: '01-E',
      title: l('ATT&CK coverage', 'Couverture ATT&CK'),
      caption: l(
        "Wazuh's MITRE ATT&CK module after the attack simulations, showing the tactics and techniques triggered against the domain controller.",
        'Le module MITRE ATT&CK de Wazuh après les simulations d’attaque, avec les tactiques et techniques déclenchées contre le contrôleur de domaine.',
      ),
    },
  ],
  triage: [
    {
      src: 'triage-report',
      width: 1280,
      height: 645,
      ref: '02-C',
      title: l('The triage report', 'Le rapport de triage'),
      caption: l(
        'The self-contained HTML report the pipeline writes: one card per email with its verdict, score, reasons and enriched indicators.',
        'Le rapport HTML autonome produit par le pipeline : une fiche par courriel avec son verdict, sa note, ses raisons et ses indicateurs enrichis.',
      ),
    },
  ],
};
