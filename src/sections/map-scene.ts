/**
 * The 3D map on the home page: Exhibit A.
 *
 * A card model of the lab network, seen from the internet side. pfSense is a
 * wall across the board with three zone platforms behind it (corporate LAN,
 * DMZ, SIEM) and the hosts standing on them. Traffic runs along the traces as
 * light inlaid in the surface. Everything is generated in code: primitive
 * geometry and canvas textures, no model or image files.
 *
 * Interactions: the camera leans with the pointer, a click on a host opens its
 * section, and a click anywhere else throws a packet at that spot. Thrown
 * packets are simulated by a physics engine (see map-physics.ts) that is only
 * downloaded once somebody reaches for the map. Above the wall stands the
 * firewall's filter: it stops the packets the real rule set would block and
 * lets the rest through.
 */
import * as THREE from 'three';
import gsap from 'gsap';
import { FLOWS, type Flow } from '../content';
import { clamp } from '../lib/dom';
import { i18n } from '../lib/i18n';
import { watchVisibility } from '../lib/motion';
import { BOARD, BUS_Z, ENTRY, GATE, GLOBE, HOSTS, ROUTES, WALL, ZONES, ZONE_H, ZONE_Z0, ZONE_Z1, type P, type Route, type ZoneId } from './map-layout';
import type { FixedBall, FixedBox, MapPhysics } from './map-physics';

export type NodeId = 'internet' | 'pfsense' | 'dc' | 'kali' | 'endpoint' | 'wazuh';

export interface TossReport {
  /** `outside`: landed on the internet side, never reached the firewall. `wall`: aimed at the firewall itself. */
  kind: 'pass' | 'block' | 'outside' | 'wall';
  flow: Flow | null;
}

export interface MapHooks {
  /** Where a label belongs, in CSS pixels inside the stage. */
  place(id: string, x: number, y: number): void;
  report(report: TossReport): void;
  /** Number of packets currently on the map. */
  count(live: number): void;
  hover(node: NodeId | null): void;
  /** True while the physics engine is being fetched for the first throw. */
  loading(busy: boolean): void;
  /** The firewall has just ruled on a packet, at this point of the stage (CSS pixels). */
  stamp(x: number, y: number, verdict: 'pass' | 'block'): void;
}

export interface MapScene {
  /** Take every packet off the map. */
  clear(): void;
  /** Throw one packet at a zone, or at a random one. */
  send(zone?: ZoneId): void;
  /** Light up a host, e.g. while its label has focus. */
  highlight(node: NodeId | null): void;
  /** Hold everything that moves on its own (thrown packets still land). */
  setPaused(paused: boolean): void;
}

/* ───────────────────────────── Packets ───────────────────────────── */

/** The plane of the firewall's filter, just in front of the gate. */
const FILTER_Z = WALL.z + GATE.d / 2 + 0.02;
const FILTER_TOP = 9;

const PACKET = { w: 0.54, h: 0.22, d: 0.38 };
/** World units per second squared. Gentler than real gravity at this scale, so a throw can be followed by eye. */
const GRAVITY = 42;
/** Length of one physics step. Small boxes thrown fast need small steps to land and stack cleanly. */
const PHYSICS_STEP = 1 / 120;
/**
 * Air drag on a packet in flight, per second. A packet leaves the hand fast and slows as it
 * travels, like a card flicked across a room, so it comes down gently enough to stay where it
 * lands and to build stacks. Its fall speed tops out at GRAVITY / FLIGHT_DRAG.
 */
const FLIGHT_DRAG = 3.6;
const MAX_PACKETS = 48;

/** The model's colours. */
interface Palette {
  board: number;
  zones: Record<ZoneId, number>;
  host: number;
  laptop: number;
  globe: number;
  /** Outlines. */
  ink: number;
  inkOpacity: number;
  blue: number;
  /** A dropped packet on the traces. */
  red: number;
  trace: number;
  outbound: number;
  shadow: number;
  /** Ink for the print on the board and the faces of the servers. */
  print: string;
  amber: string;
  led: string;
  /** The filter's two verdict colours. */
  deny: [number, number, number];
  pass: [number, number, number];
}

const PALETTE: Palette = {
  board: 0x1c2128,
  zones: { lan: 0x292c32, dmz: 0x332d1c, siem: 0x1c2848 },
  host: 0x303844,
  laptop: 0x12151a,
  globe: 0x262e3a,
  ink: 0xd5dbe3,
  inkOpacity: 0.72,
  blue: 0x8fb0ff,
  red: 0xff7d70,
  trace: 0x4c5767,
  outbound: 0xa9b2bf,
  shadow: 0.5,
  print: '226, 230, 236',
  amber: '#f0b254',
  led: '#62d69c',
  deny: [1.0, 0.52, 0.47],
  pass: [0.38, 0.84, 0.61],
};

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

/* ───────────────────────────── Canvas helpers ───────────────────────────── */

function canvas2d(width: number, height: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D canvas is unavailable');
  return { canvas, g };
}

/** Left-aligned text with manual letter-spacing (canvas letterSpacing is not universal yet). */
function tracked(g: CanvasRenderingContext2D, text: string, x: number, y: number, tracking: number): number {
  let at = x;
  for (const char of text) {
    g.fillText(char, at, y);
    at += g.measureText(char).width + tracking;
  }
  return at;
}

/** The print on the board: a dot grid, crop marks, the interface names and a title block. */
function boardCanvas(palette: Palette): HTMLCanvasElement {
  const ink = (alpha: number): string => `rgba(${palette.print}, ${alpha})`;
  const S = 100; // pixels per world unit
  const W = BOARD.w * S;
  const H = BOARD.d * S;
  // drawn at twice the size, so the printed lines and labels stay crisp
  const K = 2;
  const { canvas, g } = canvas2d(W * K, H * K);
  g.scale(K, K);
  const px = (x: number): number => (x + BOARD.w / 2) * S;
  const pz = (z: number): number => (z + BOARD.d / 2) * S;

  g.fillStyle = ink(0.17);
  for (let x = 0.4; x < BOARD.w; x += 0.4) {
    for (let z = 0.4; z < BOARD.d; z += 0.4) {
      g.beginPath();
      g.arc(x * S, z * S, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Crop marks in the corners
  g.strokeStyle = ink(0.6);
  g.lineWidth = 2;
  for (const [cx, cz, sx, sz] of [
    [30, 30, 1, 1],
    [W - 30, 30, -1, 1],
    [30, H - 30, 1, -1],
    [W - 30, H - 30, -1, -1],
  ] as const) {
    g.beginPath();
    g.moveTo(cx + sx * 46, cz);
    g.lineTo(cx, cz);
    g.lineTo(cx, cz + sz * 46);
    g.stroke();
  }

  g.textBaseline = 'alphabetic';

  // pfSense's real interface assignments, next to the trace each one feeds
  g.font = `500 19px ${MONO}`;
  g.fillStyle = ink(0.7);
  const gap = (ZONE_Z1 + BUS_Z) / 2 + 0.1;
  tracked(g, 'EM0 · WAN', px(0.22), pz((WALL.z + GLOBE.z) / 2 + 0.1), 1.5);
  tracked(g, 'EM1 · LAN', px(ENTRY.lan + 0.18), pz(gap), 1.5);
  tracked(g, 'EM2 · DMZ', px(ENTRY.dmz + 0.18), pz(gap), 1.5);
  tracked(g, 'EM3 · SIEM', px(ENTRY.siem + 0.18), pz(gap), 1.5);

  return canvas;
}

/** "DEFAULT DENY" along the front of the wall. */
function wallCanvas(length: number, words = 'DEFAULT DENY'): HTMLCanvasElement {
  const S = 300;
  const { canvas, g } = canvas2d(Math.round(length * S), Math.round(WALL.h * S));
  g.fillStyle = 'rgba(255, 255, 255, 0.9)';
  g.font = `600 58px ${MONO}`;
  g.textBaseline = 'middle';
  let x = 46;
  while (x < canvas.width - 300) {
    x = tracked(g, words, x, canvas.height / 2 + 4, 14) + 60;
    g.fillRect(x, canvas.height / 2 - 12, 62, 24);
    x += 62 + 74;
  }
  return canvas;
}

function gateCanvas(): HTMLCanvasElement {
  const S = 300;
  const W = Math.round(GATE.w * S);
  const H = Math.round(GATE.h * S);
  const { canvas, g } = canvas2d(W, H);
  g.fillStyle = '#ffffff';
  g.textBaseline = 'alphabetic';
  g.font = `600 124px ${MONO}`;
  const end = tracked(g, 'pfSense', 52, 156, 2);
  g.fillRect(52, 186, end - 54, 8);
  // a row of ports, two of them lit
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i === 1 || i === 4 ? '#9ff0c0' : 'rgba(255, 255, 255, 0.42)';
    g.fillRect(52 + i * 54, 228, 36, 36);
  }
  return canvas;
}

/** The face of a server: drive bays, a stripe in its accent colour and status lights. */
function serverCanvas(w: number, h: number, accent: string, bays: number, glyph: string, palette: Palette): HTMLCanvasElement {
  const ink = (alpha: number): string => `rgba(${palette.print}, ${alpha})`;
  const S = 280;
  const W = Math.round(w * S);
  const H = Math.round(h * S);
  const { canvas, g } = canvas2d(W, H);
  g.fillStyle = accent;
  g.fillRect(0, 0, W, 22);
  g.strokeStyle = ink(0.78);
  g.lineWidth = 3;
  const top = 56;
  const pitch = (H - top - 26) / bays;
  for (let i = 0; i < bays; i++) {
    const y = top + i * pitch;
    g.strokeRect(26, y, W - 52, pitch - 16);
    g.fillStyle = ink(0.78);
    for (let v = 0; v < 5; v++) g.fillRect(48 + v * 20, y + (pitch - 16) / 2 - 2, 10, 4);
    g.fillStyle = i === 0 ? palette.led : ink(0.25);
    g.beginPath();
    g.arc(W - 54, y + (pitch - 16) / 2, 7, 0, Math.PI * 2);
    g.fill();
  }
  if (glyph) {
    g.fillStyle = accent;
    g.font = `600 40px ${MONO}`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'right';
    g.fillText(glyph, W - 26, 50);
  }
  return canvas;
}

/** The attacker's screen: a prompt and a few lines of scan output. */
function screenCanvas(): HTMLCanvasElement {
  const { canvas, g } = canvas2d(400, 264);
  g.fillStyle = '#0f1318';
  g.fillRect(0, 0, 400, 264);
  g.font = `500 25px ${MONO}`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ff6b5e';
  g.fillText('kali@lab:~$', 22, 50);
  g.fillStyle = '#e8edf3';
  g.fillText('nmap -sS', 206, 50);
  g.fillStyle = 'rgba(232, 237, 243, 0.55)';
  for (let i = 0; i < 5; i++) g.fillRect(22, 78 + i * 32, 110 + ((i * 97) % 190), 9);
  g.fillStyle = '#ff6b5e';
  g.fillRect(22, 236, 16, 5);
  return canvas;
}

type PacketLook = 'neutral' | 'pass' | 'block';

/** The label on top of a packet: a header band, two lines of payload and, once judged, the verdict. */
function packetCanvas(look: PacketLook): HTMLCanvasElement {
  const { canvas, g } = canvas2d(260, 190);
  const band = look === 'pass' ? '#17693f' : look === 'block' ? '#b3261e' : '#15181d';
  g.fillStyle = '#fffdf6';
  g.fillRect(0, 0, 260, 190);
  g.fillStyle = band;
  g.fillRect(0, 0, 74, 190);
  g.fillStyle = 'rgba(255, 255, 255, 0.92)';
  g.fillRect(16, 22, 42, 9);
  g.fillRect(16, 42, 42, 9);
  g.fillRect(16, 62, 24, 9);
  g.fillStyle = 'rgba(21, 24, 29, 0.3)';
  g.fillRect(94, 26, 142, 10);
  g.fillRect(94, 48, 98, 10);
  g.fillStyle = band;
  g.font = `600 50px ${MONO}`;
  g.textBaseline = 'alphabetic';
  g.fillText(look === 'pass' ? 'PASS' : look === 'block' ? 'DENY' : 'PKT', 92, 152);
  return canvas;
}

function packetSideCanvas(look: PacketLook): HTMLCanvasElement {
  const { canvas, g } = canvas2d(128, 64);
  g.fillStyle = '#f6f1e4';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = look === 'pass' ? '#17693f' : look === 'block' ? '#b3261e' : '#15181d';
  g.fillRect(0, 24, 128, 16);
  return canvas;
}

async function loadCanvasFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  const wanted = [`500 20px ${MONO}`, `600 20px ${MONO}`, `400 20px ${MONO}`];
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
  await Promise.race([Promise.all(wanted.map((font) => document.fonts.load(font, 'PASS 0123'))).then(() => undefined), timeout]);
}

/* ───────────────────────────── Traces ───────────────────────────── */

const routeColor = (kind: Route['kind'], palette: Palette): number =>
  kind === 'logs' ? palette.blue : kind === 'outbound' ? palette.outbound : palette.red;

/** A polyline that can be walked by distance. */
class Track {
  readonly points: THREE.Vector3[];
  readonly lengths: number[] = [0];
  readonly total: number;

  constructor(points: P[]) {
    this.points = points
      .filter((point, i) => i === 0 || point.some((value, axis) => value !== points[i - 1]![axis]))
      .map(([x, y, z]) => new THREE.Vector3(x, y, z));
    for (let i = 1; i < this.points.length; i++) {
      this.lengths.push(this.lengths[i - 1]! + this.points[i]!.distanceTo(this.points[i - 1]!));
    }
    this.total = this.lengths[this.lengths.length - 1] ?? 0;
  }

  /** Position `distance` along the track, and the direction of travel there. */
  at(distance: number, position: THREE.Vector3, direction: THREE.Vector3): void {
    const d = clamp(distance, 0, this.total);
    let i = 1;
    while (i < this.lengths.length - 1 && this.lengths[i]! < d) i++;
    const a = this.points[i - 1]!;
    const b = this.points[i]!;
    const span = this.lengths[i]! - this.lengths[i - 1]! || 1;
    position.lerpVectors(a, b, (d - this.lengths[i - 1]!) / span);
    direction.subVectors(b, a).normalize();
  }
}

/* ───────────────────────────── Scene ───────────────────────────── */

interface Host {
  id: NodeId;
  /** Where its label goes. */
  anchor: THREE.Vector3;
  edges: THREE.LineBasicMaterial[];
}

interface Packet {
  /** Its body in the physics world. */
  id: number;
  mesh: THREE.Mesh;
  flow: Flow | null;
  where: ZoneId | 'wall' | 'outside';
  blocked: boolean;
  /** The firewall has ruled on it (or it never needed a ruling). */
  judged: boolean;
  born: number;
  lastZ: number;
  /** When it came to rest off the board, if it has. */
  strandedAt: number;
  /** Shrinking away; no longer simulated. */
  leaving: boolean;
  /** Sent between zones: pfSense forwards it to `to` once the physics clock reaches `atStep`. */
  relay: { atStep: number; to: THREE.Vector3 } | null;
  /** Dropped by pfSense between zones: discarded once it comes to rest, so it never piles up in the way. */
  discard: boolean;
}

const FILTER_VERTEX = /* glsl */ `
  varying vec2 vAt;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vAt = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FILTER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uSweep;
  uniform float uLive;
  uniform float uBase;
  uniform float uHalf;
  uniform vec3 uDeny;
  uniform vec3 uPass;
  uniform vec4 uHits[8]; // x, y, start time, +1 pass / -1 block
  varying vec2 vAt;

  const float CELL = 0.3; // width of one cell of the mesh, in world units
  const vec2 GRID = vec2(1.0, 1.7320508);

  // 0 at the middle of a hexagon, 0.5 on its rim
  float hexDistance(vec2 p) {
    p = abs(p);
    return max(dot(p, GRID * 0.5), p.x);
  }

  // xy: position inside the cell. zw: the centre of that cell. All in cell widths.
  vec4 hexCell(vec2 p) {
    vec4 centre = floor(vec4(p, p - vec2(0.5, 1.0)) / GRID.xyxy) + 0.5;
    vec4 offset = vec4(p - centre.xy * GRID, p - (centre.zw + 0.5) * GRID);
    return dot(offset.xy, offset.xy) < dot(offset.zw, offset.zw)
      ? vec4(offset.xy, centre.xy * GRID)
      : vec4(offset.zw, (centre.zw + 0.5) * GRID);
  }

  void main() {
    // High above the wall nothing shows unless a packet has just hit the filter
    if (vAt.y - uBase > 3.2 && uLive < 0.5) discard;
    vec4 cell = hexCell(vAt / CELL);
    float rim = 0.5 - hexDistance(cell.xy);
    float line = smoothstep(0.075, 0.02, rim);
    vec2 centre = cell.zw * CELL;
    float h = max(0.0, vAt.y - uBase);

    // At rest only the lowest rows of the mesh show, just above the wall, and a slow sweep climbs it
    float rest = exp(-h * 2.3);
    float sweep = smoothstep(0.4, 0.0, abs(centre.y - uBase - mod(uSweep * 0.5, 3.2))) * exp(-h * 1.5);
    vec3 color = uDeny;
    float alpha = line * (rest * 0.36 + sweep * 0.3) + rest * 0.05;

    // Where a packet meets the filter, the cells around that point answer: they flash solid when it
    // is stopped, and only their rims light when it is let through.
    for (int i = 0; i < 8; i++) {
      float age = uTime - uHits[i].z;
      if (age < 0.0 || age > 0.85) continue;
      float d = distance(centre, uHits[i].xy);
      if (d > 1.5) continue;
      float life = 1.0 - age / 0.85;
      float reach = 0.2 + age * 3.6;
      float inside = smoothstep(reach, reach - 0.3, d);
      float front = smoothstep(0.4, 0.0, abs(d - reach));
      float falloff = 1.0 - d / 1.5;
      bool passed = uHits[i].w > 0.0;
      float fill = passed ? front * 0.12 : inside * 0.62 * life * life + front * 0.34;
      float glow = line * (inside * 1.25 * life + front * 0.7);
      float amount = clamp((fill + glow) * falloff, 0.0, 1.0);
      color = mix(color, passed ? uPass : uDeny, clamp(amount * 4.0, 0.0, 1.0));
      alpha = max(alpha, amount);
    }
    // nothing spills past the ends of the wall
    alpha *= smoothstep(uHalf, uHalf - 0.35, abs(vAt.x));
    gl_FragColor = vec4(color, alpha);
  }
`;

export async function createMapScene(
  canvas: HTMLCanvasElement,
  stage: HTMLElement,
  hooks: MapHooks,
  options: { paused: boolean } = { paused: false },
): Promise<MapScene> {
  await loadCanvasFonts();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The board never changes: shadows are redrawn only when packets move (see frame)
  renderer.shadowMap.autoUpdate = false;

  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const texture = (source: HTMLCanvasElement): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(source);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    return tex;
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 90);
  const cameraTarget = new THREE.Vector3(0, 0.25, 0.35);

  /* ── Lights: a soft sky and one sun, tuned so a white top face reads as paper ── */
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8b6, 1.72));
  const sun = new THREE.DirectionalLight(0xfffaf0, 1.75);
  sun.position.set(-5, 14, 9);
  sun.target.position.set(0, 0, -1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -11;
  sun.shadow.camera.right = 11;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 5;
  sun.shadow.intensity = 0.6;
  scene.add(sun, sun.target);

  /* ── Building blocks ── */
  /** Everything a click can land on. */
  const solids: THREE.Object3D[] = [];
  const colliders: FixedBox[] = [];
  const balls: FixedBall[] = [];

  /* ── Colours ── */
  const palette = PALETTE;
  /** A matte card material. */
  const card = (pick: (from: Palette) => number): THREE.MeshLambertMaterial => {
    const material = new THREE.MeshLambertMaterial({ color: pick(palette) });
    return material;
  };
  /** An outline material. */
  const outline = (pick: (from: Palette) => number = (from) => from.ink, opacity?: number): THREE.LineBasicMaterial => {
    const material = new THREE.LineBasicMaterial({ color: pick(palette), transparent: true, opacity: opacity ?? palette.inkOpacity });
    return material;
  };
  const inkEdges = outline();

  interface BoxOptions {
    edges?: THREE.LineBasicMaterial;
    rotationX?: number;
    node?: NodeId;
  }

  /** A solid box: drawn, outlined in ink, shadow-casting, clickable, and present in the physics world. */
  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material | THREE.Material[],
    options: BoxOptions = {},
  ): THREE.Mesh => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (options.rotationX) mesh.rotation.x = options.rotationX;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), options.edges ?? inkEdges));
    if (options.node) mesh.userData.node = options.node;
    scene.add(mesh);
    solids.push(mesh);
    const q = mesh.quaternion;
    colliders.push({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, rotation: { x: q.x, y: q.y, z: q.z, w: q.w } });
    return mesh;
  };

  /** A flat print on a surface. Never solid: packets rest on top of it. */
  const addDecal = (w: number, h: number, map: THREE.Texture, opacity = 1): THREE.Mesh => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    scene.add(mesh);
    return mesh;
  };

  /* ── The desk under the board: catches shadows, and packets that go over the edge ── */
  const deskMaterial = new THREE.ShadowMaterial({ opacity: palette.shadow });
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), deskMaterial);
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -BOARD.t;
  desk.receiveShadow = true;
  scene.add(desk);
  colliders.push({ x: 0, y: -BOARD.t - 1, z: 0, hx: 40, hy: 1, hz: 40, friction: 0.85 });

  /* ── Board ── */
  addBox(BOARD.w, BOARD.t, BOARD.d, 0, -BOARD.t / 2, 0, card((from) => from.board));
  const print = addDecal(BOARD.w, BOARD.d, texture(boardCanvas(palette)));
  print.rotation.x = -Math.PI / 2;
  print.position.y = 0.003;

  /* ── Zones ── */
  const zoneDepth = ZONE_Z1 - ZONE_Z0;
  const zoneZ = (ZONE_Z0 + ZONE_Z1) / 2;
  for (const [id, zone] of Object.entries(ZONES) as Array<[ZoneId, (typeof ZONES)[ZoneId]]>) {
    addBox(zone.x1 - zone.x0, ZONE_H, zoneDepth, (zone.x0 + zone.x1) / 2, ZONE_H / 2, zoneZ, card((from) => from.zones[id]));
  }

  /* ── Firewall: a wall across the board, with the pfSense unit in the middle ── */
  const hosts = new Map<NodeId, Host>();
  // Each host has its own outline, so it can light up on its own (see paintHosts)
  const hostEdges = (): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({ color: palette.ink, transparent: true, opacity: 0.85 });

  const wallMaterial = card(() => 0xc4382b);
  const wallLength = WALL.half - GATE.w / 2;
  const wallText = texture(wallCanvas(wallLength));
  for (const side of [-1, 1]) {
    const x = side * (GATE.w / 2 + wallLength / 2);
    addBox(wallLength, WALL.h, WALL.t, x, WALL.h / 2, WALL.z, wallMaterial);
    const decal = addDecal(wallLength, WALL.h, wallText);
    decal.position.set(x, WALL.h / 2, WALL.z + WALL.t / 2 + 0.004);
  }
  const gateEdges = hostEdges();
  addBox(GATE.w, GATE.h, GATE.d, 0, GATE.h / 2, WALL.z, card(() => 0xb3261e), { edges: gateEdges, node: 'pfsense' });
  const gateFace = addDecal(GATE.w, GATE.h, texture(gateCanvas()));
  gateFace.position.set(0, GATE.h / 2, WALL.z + GATE.d / 2 + 0.004);
  hosts.set('pfsense', { id: 'pfsense', anchor: new THREE.Vector3(0, GATE.h + 0.12, WALL.z), edges: [gateEdges] });

  /* ── The filter above the wall ── */
  const hits = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 1));
  let nextHit = 0;
  const filterMaterial = new THREE.ShaderMaterial({
    vertexShader: FILTER_VERTEX,
    fragmentShader: FILTER_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uSweep: { value: 0 },
      uLive: { value: 0 },
      uBase: { value: WALL.h },
      uHalf: { value: WALL.half },
      uDeny: { value: new THREE.Vector3(...palette.deny) },
      uPass: { value: new THREE.Vector3(...palette.pass) },
      uHits: { value: hits },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const filter = new THREE.Mesh(new THREE.PlaneGeometry(WALL.half * 2, FILTER_TOP - WALL.h), filterMaterial);
  filter.position.set(0, (FILTER_TOP + WALL.h) / 2, FILTER_Z);
  filter.renderOrder = 5;
  scene.add(filter);

  /* ── Hosts ── */
  const server = (id: 'dc' | 'endpoint' | 'wazuh', accent: (from: Palette) => string, bays: number, glyph: string): void => {
    const spec = HOSTS[id];
    const edges = hostEdges();
    addBox(spec.w, spec.h, spec.d, spec.x, ZONE_H + spec.h / 2, spec.z, card((from) => from.host), { edges, node: id });
    const draw = (from: Palette): HTMLCanvasElement => serverCanvas(spec.w, spec.h, accent(from), bays, glyph, from);
    const face = addDecal(spec.w, spec.h, texture(draw(palette)));
    face.position.set(spec.x, ZONE_H + spec.h / 2, spec.z + spec.d / 2 + 0.004);
    hosts.set(id, { id, anchor: new THREE.Vector3(spec.x, ZONE_H + spec.h + 0.12, spec.z), edges: [edges] });
  };
  server('dc', (from) => hex(from.ink), 4, 'AD');
  server('endpoint', (from) => from.amber, 3, '>_');
  server('wazuh', (from) => hex(from.blue), 4, 'SIEM');

  // The attacker: an open laptop, dark, with a red edge
  {
    const spec = HOSTS.kali;
    const edges = new THREE.LineBasicMaterial({ color: 0xff6b5e, transparent: true, opacity: 0.95 });
    const dark = card((from) => from.laptop);
    addBox(spec.w, spec.h, spec.d, spec.x, ZONE_H + spec.h / 2, spec.z, dark, { edges, node: 'kali' });
    const lean = -0.24;
    const lidH = 0.86;
    const lidY = ZONE_H + spec.h + (lidH / 2) * Math.cos(lean);
    const lidZ = spec.z - spec.d / 2 + 0.04 + (lidH / 2) * Math.sin(lean);
    addBox(spec.w, lidH, 0.05, spec.x, lidY, lidZ, dark, { edges, rotationX: lean, node: 'kali' });
    const screen = addDecal(spec.w - 0.1, lidH - 0.1, texture(screenCanvas()));
    screen.rotation.x = lean;
    screen.position.set(spec.x, lidY + 0.03 * Math.sin(-lean), lidZ + 0.03 * Math.cos(lean));
    hosts.set('kali', { id: 'kali', anchor: new THREE.Vector3(spec.x, ZONE_H + spec.h + lidH + 0.1, spec.z - 0.3), edges: [edges] });
  }

  // A beacon on top of the SIEM, and its sweep across the zone floor (light, not a solid)
  addBox(0.4, 0.16, 0.4, HOSTS.wazuh.x, ZONE_H + HOSTS.wazuh.h + 0.08, HOSTS.wazuh.z, card((from) => from.blue), { node: 'wazuh' });
  /** A flat, unlit blue: the SIEM's sweep and range rings. */
  const blueLight = (opacity: number): THREE.MeshBasicMaterial => {
    const material = new THREE.MeshBasicMaterial({ color: palette.blue, transparent: true, opacity, depthWrite: false });
    return material;
  };
  hosts.get('wazuh')!.anchor.y += 0.16;
  const sweep = new THREE.Mesh(
    new THREE.CircleGeometry(1.62, 40, 0, 0.8),
    blueLight(0.15),
  );
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.set(HOSTS.wazuh.x, ZONE_H + 0.006, HOSTS.wazuh.z);
  scene.add(sweep);
  for (const radius of [0.95, 1.62]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.012, radius + 0.012, 72),
      blueLight(0.32),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(HOSTS.wazuh.x, ZONE_H + 0.005, HOSTS.wazuh.z);
    scene.add(ring);
  }

  // The internet: a globe on a low plinth
  const globeEdges = new THREE.LineBasicMaterial({ color: palette.blue, transparent: true, opacity: 0.9 });
  addBox(1.0, 0.12, 1.0, GLOBE.x, 0.06, GLOBE.z, card((from) => from.host));
  const globe = new THREE.Mesh(new THREE.SphereGeometry(GLOBE.r, 40, 28), card((from) => from.globe));
  globe.position.set(GLOBE.x, GLOBE.y, GLOBE.z);
  globe.castShadow = true;
  globe.userData.node = 'internet';
  scene.add(globe);
  solids.push(globe);
  balls.push({ x: GLOBE.x, y: GLOBE.y, z: GLOBE.z, r: GLOBE.r });
  const graticule = new THREE.Group();
  {
    const points: number[] = [];
    const R = GLOBE.r * 1.004;
    const arc = (at: (t: number) => [number, number, number]): void => {
      const steps = 48;
      for (let i = 0; i < steps; i++) {
        points.push(...at((i / steps) * Math.PI * 2), ...at(((i + 1) / steps) * Math.PI * 2));
      }
    };
    for (const lat of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const r = Math.cos(lat) * R;
      const y = Math.sin(lat) * R;
      arc((t) => [Math.cos(t) * r, y, Math.sin(t) * r]);
    }
    for (let i = 0; i < 6; i++) {
      const lon = (i / 6) * Math.PI;
      arc((t) => [Math.cos(t) * R * Math.cos(lon), Math.sin(t) * R, Math.cos(t) * R * Math.sin(lon)]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    graticule.add(new THREE.LineSegments(geometry, globeEdges));
  }
  graticule.position.copy(globe.position);
  graticule.rotation.z = 0.36;
  scene.add(graticule);
  hosts.set('internet', { id: 'internet', anchor: new THREE.Vector3(GLOBE.x, GLOBE.y + GLOBE.r + 0.12, GLOBE.z), edges: [globeEdges] });

  /* ── Traces, and the traffic running along them ── */
  const tracks = ROUTES.map((route) => new Track(route.points));
  {
    // Every stretch of trace once, however many routes share it
    const seen = new Set<string>();
    const traceMaterial = new THREE.MeshBasicMaterial({ color: palette.trace });
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const route of ROUTES) {
      for (let i = 1; i < route.points.length; i++) {
        const from = route.points[i - 1]!;
        const to = route.points[i]!;
        const key = [from, to].map((p) => p.join(',')).sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        a.set(...from);
        b.set(...to);
        const length = a.distanceTo(b);
        if (length < 0.001) continue;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(length + 0.05, 0.006, 0.05), traceMaterial);
        strip.position.copy(a).add(b).multiplyScalar(0.5);
        strip.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
        scene.add(strip);
      }
    }
  }

  const dashTotal = ROUTES.reduce((sum, route) => sum + route.count, 0);
  const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.02, 0.09), new THREE.MeshBasicMaterial(), dashTotal);
  dashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const paintDashes = (from: Palette): void => {
    const color = new THREE.Color();
    let index = 0;
    for (const route of ROUTES) {
      for (let i = 0; i < route.count; i++) dashes.setColorAt(index++, color.set(routeColor(route.kind, from)));
    }
    if (dashes.instanceColor) dashes.instanceColor.needsUpdate = true;
  };
  paintDashes(palette);
  scene.add(dashes);

  /* ── Zone tabs ── */
  const zoneAnchors: Record<ZoneId, THREE.Vector3> = {
    lan: new THREE.Vector3(ZONES.lan.x0 + 0.05, ZONE_H, ZONE_Z0),
    dmz: new THREE.Vector3(ZONES.dmz.x0 + 0.05, ZONE_H, ZONE_Z0),
    siem: new THREE.Vector3(ZONES.siem.x0 + 0.05, ZONE_H, ZONE_Z0),
  };

  /* ── Packets ── */
  const packetGeometry = new THREE.BoxGeometry(PACKET.w, PACKET.h, PACKET.d);
  const packetEdgeGeometry = new THREE.EdgesGeometry(packetGeometry);
  // Packets are paper, so their outline stays dark
  const packetEdges = new THREE.LineBasicMaterial({ color: 0x15181d, transparent: true, opacity: 0.82 });
  const looks = {} as Record<PacketLook, THREE.Material[]>;
  for (const look of ['neutral', 'pass', 'block'] as const) {
    const top = new THREE.MeshLambertMaterial({ map: texture(packetCanvas(look)) });
    const side = new THREE.MeshLambertMaterial({ map: texture(packetSideCanvas(look)) });
    looks[look] = [side, side, top, top, side, side];
  }
  const packets: Packet[] = [];
  const packetMeshes: THREE.Object3D[] = [];

  /* ── Physics (fetched on the first interaction) ── */
  let physics: MapPhysics | null = null;
  let physicsLoading: Promise<void> | null = null;
  /** Throws asked for while the engine was still loading, run as soon as it is ready. */
  const pending: Array<() => void> = [];

  const loadPhysics = (): Promise<void> => {
    physicsLoading ??= (async (): Promise<void> => {
      hooks.loading(true);
      try {
        const { createMapPhysics } = await import('./map-physics');
        physics = await createMapPhysics({
          gravity: GRAVITY,
          step: PHYSICS_STEP,
          flightDrag: FLIGHT_DRAG,
          packet: { hx: PACKET.w / 2, hy: PACKET.h / 2, hz: PACKET.d / 2 },
          boxes: colliders,
          balls,
          // A thick slab behind the plane, so nothing fast can get through it
          filter: { x: 0, y: FILTER_TOP / 2 + 3, z: FILTER_Z - 0.5, hx: 12, hy: FILTER_TOP / 2 + 3, hz: 0.5 },
          onFilterHit: (id, at) => {
            const packet = packets.find((item) => item.id === id && !item.leaving);
            if (packet && !packet.judged) judge(packet, at.x, at.y, at.z);
          },
        });
        for (const run of pending.splice(0)) run();
      } catch (error) {
        console.warn('The physics engine could not load, so packet throwing is off.', error);
        pending.length = 0;
      } finally {
        hooks.loading(false);
      }
    })();
    return physicsLoading;
  };

  /* ── Camera fit: the whole board in frame, whatever the shape of the stage ── */
  let width = 1;
  let height = 1;
  let distance = 20;
  let elevation = 0.74;
  const fitPoints: THREE.Vector3[] = [];
  for (const x of [-BOARD.w / 2, BOARD.w / 2]) {
    fitPoints.push(new THREE.Vector3(x, 0, BOARD.d / 2), new THREE.Vector3(x, 0, -BOARD.d / 2), new THREE.Vector3(x * 0.92, 1.4, ZONE_Z0));
  }
  const probe = new THREE.Vector3();

  const aimCamera = (yaw: number, pitch: number): void => {
    const e = elevation + pitch;
    camera.position.set(
      cameraTarget.x + Math.sin(yaw) * Math.cos(e) * distance,
      cameraTarget.y + Math.sin(e) * distance,
      cameraTarget.z + Math.cos(yaw) * Math.cos(e) * distance,
    );
    camera.lookAt(cameraTarget);
  };

  /* ── Resolution: rendered above the screen's own and scaled down, so thin outlines and printed
     text stay sharp even on a standard-density display. If a device cannot keep that smooth, the
     frame loop steps it down (see watchFrameRate). ── */
  const RATIO_FLOOR = 1;
  let ratio = Math.min(Math.max((window.devicePixelRatio || 1) * 1.5, 2), 3);
  let shadowDirty = true;

  const layout = (): void => {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    renderer.setPixelRatio(ratio);
    shadowDirty = true;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // Look down more steeply when the stage is tall, so the board's depth uses the height
    elevation = clamp(1.6 - 0.52 * camera.aspect, 0.88, 1.12);
    distance = 20;
    for (let i = 0; i < 6; i++) {
      aimCamera(0, 0);
      camera.updateMatrixWorld();
      let worst = 0;
      for (const point of fitPoints) {
        probe.copy(point).project(camera);
        worst = Math.max(worst, Math.abs(probe.x) / 0.95, probe.y > 0 ? probe.y / 0.84 : -probe.y / 0.78);
      }
      distance *= worst;
    }
  };

  /* ── Pointer ── */
  const pointer = new THREE.Vector2(0, 0);
  const pointerSmooth = new THREE.Vector2(0, 0);
  const pointerNdc = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();
  let activeUntil = 0;
  let hovered: NodeId | null = null;
  let lit: NodeId | null = null;
  /** Hosts that have just sent a packet, lit for a moment. */
  const pinged = new Set<NodeId>();

  const kick = (ms = 1600): void => {
    activeUntil = performance.now() + ms;
    refreshLoop();
  };

  const setNdc = (event: { clientX: number; clientY: number }): void => {
    const rect = stage.getBoundingClientRect();
    pointerNdc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
  };

  const paintHosts = (): void => {
    for (const host of hosts.values()) {
      const on = host.id === hovered || host.id === lit || pinged.has(host.id);
      const rest = host.id === 'kali' ? 0xff6b5e : host.id === 'internet' ? palette.blue : palette.ink;
      for (const material of host.edges) material.color.set(on ? palette.blue : rest);
    }
  };

  const hostUnderPointer = (): NodeId | null => {
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(solids, false)[0];
    return (hit?.object.userData.node as NodeId | undefined) ?? null;
  };

  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const frugal = connection?.saveData === true || /(^|-)2g$/.test(connection?.effectiveType ?? '');

  stage.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    // A mouse over the map is somebody about to use it: fetch the engine now, so the first throw is instant
    if (!physicsLoading && !frugal) void loadPhysics();
    setNdc(event);
    pointer.copy(pointerNdc);
    const overLabel = (event.target as HTMLElement).closest('a, button, .mlabel') !== null;
    const next = overLabel ? null : hostUnderPointer();
    if (next !== hovered) {
      hovered = next;
      paintHosts();
      hooks.hover(hovered);
      stage.classList.toggle('is-over-node', hovered !== null);
    }
    kick();
  });

  stage.addEventListener('pointerleave', () => {
    pointer.set(0, 0);
    if (hovered) {
      hovered = null;
      paintHosts();
      hooks.hover(null);
      stage.classList.remove('is-over-node');
    }
    kick();
  });

  /* ── Throwing ── */
  const liveCount = (): number => packets.reduce((sum, packet) => sum + (packet.leaving ? 0 : 1), 0);

  /** Take a packet off the map: it shrinks away and leaves the simulation. */
  const retire = (packet: Packet): void => {
    if (packet.leaving) return;
    packet.leaving = true;
    physics?.remove(packet.id);
    const index = packetMeshes.indexOf(packet.mesh);
    if (index >= 0) packetMeshes.splice(index, 1);
    gsap.to(packet.mesh.scale, {
      x: 0,
      y: 0,
      z: 0,
      duration: 0.28,
      ease: 'power2.in',
      onComplete: () => {
        scene.remove(packet.mesh);
        const at = packets.indexOf(packet);
        if (at >= 0) packets.splice(at, 1);
      },
    });
    hooks.count(liveCount());
    kick(700);
  };

  /** The firewall rules on a packet: it takes its colours, the filter answers, and the verdict is stamped where it was. */
  function judge(packet: Packet, x: number, y: number, z = FILTER_Z): void {
    packet.judged = true;
    packet.mesh.material = looks[packet.blocked ? 'block' : 'pass'];
    const slot = hits[nextHit++ % hits.length]!;
    const hitY = Math.max(y, WALL.h + 0.1);
    slot.set(x, hitY, filterMaterial.uniforms.uTime!.value as number, packet.blocked ? -1 : 1);
    probe.set(x, hitY, z).project(camera);
    hooks.stamp((probe.x * 0.5 + 0.5) * width, (-probe.y * 0.5 + 0.5) * height, packet.blocked ? 'block' : 'pass');
    hooks.report({ kind: packet.where === 'wall' ? 'wall' : packet.blocked ? 'block' : 'pass', flow: packet.flow });
  }

  const whereIs = (point: THREE.Vector3): Packet['where'] => {
    if (Math.abs(point.x) > BOARD.w / 2 || Math.abs(point.z) > BOARD.d / 2 || point.z > FILTER_Z) return 'outside';
    if (point.z > WALL.z - GATE.d / 2 - 0.05) return 'wall';
    if (point.x < (ZONES.lan.x1 + ZONES.dmz.x0) / 2) return 'lan';
    return point.x < (ZONES.dmz.x1 + ZONES.siem.x0) / 2 ? 'dmz' : 'siem';
  };

  /** Pick what kind of traffic this packet is. Verdicts alternate where a zone has both, so neither runs long. */
  const streak: Record<ZoneId, { verdict: Flow['verdict'] | null; run: number }> = {
    lan: { verdict: null, run: 0 },
    dmz: { verdict: null, run: 0 },
    siem: { verdict: null, run: 0 },
  };
  const pickFlow = (zone: ZoneId): Flow => {
    const options = FLOWS.filter((flow) => flow.to === zone);
    const memory = streak[zone];
    const passes = options.filter((flow) => flow.verdict === 'pass');
    const blocks = options.filter((flow) => flow.verdict === 'block');
    let pool = options;
    if (passes.length && blocks.length) {
      const wantPass = memory.run >= 2 ? memory.verdict === 'block' : Math.random() < 0.55;
      pool = wantPass ? passes : blocks;
    }
    const flow = pool[Math.floor(Math.random() * pool.length)]!;
    memory.run = flow.verdict === memory.verdict ? memory.run + 1 : 1;
    memory.verdict = flow.verdict;
    return flow;
  };

  /** Packets leave one at a time from any one spot: a new one would otherwise begin inside the last. */
  let lastThrown: Packet | null = null;
  let waitingThrows = 0;
  const crowded = (start: THREE.Vector3): boolean =>
    lastThrown !== null && !lastThrown.leaving && lastThrown.mesh.position.distanceTo(start) < PACKET.w * 2.2;
  /** Try again in a moment, with at most ten throws waiting. */
  const later = (retry: () => void): void => {
    if (waitingThrows >= 10) return;
    waitingThrows++;
    window.setTimeout(() => {
      waitingThrows--;
      retry();
    }, 60);
  };

  /**
   * The launch velocity that lands a packet on `aim` after `flight` seconds. The simulation applies
   * drag and gravity step by step, so the velocity is solved for those same steps.
   */
  const solveThrow = (start: THREE.Vector3, aim: THREE.Vector3, flight: number): { velocity: THREE.Vector3; steps: number } => {
    const steps = Math.max(1, Math.round(flight / PHYSICS_STEP));
    // Each step the engine adds gravity, moves the packet, then takes the drag off its speed.
    const keep = 1 / (1 + FLIGHT_DRAG * PHYSICS_STEP); // share of its speed a packet keeps each step
    const reach0 = (1 - keep ** steps) / (1 - keep); // steps' worth of travel per unit of launch speed
    const pull = (-GRAVITY * PHYSICS_STEP) / (1 - keep); // what gravity adds up to against the drag
    const velocity = new THREE.Vector3(
      (aim.x - start.x) / (PHYSICS_STEP * reach0),
      ((aim.y - start.y) / PHYSICS_STEP - pull * (steps - keep * reach0)) / reach0,
      (aim.z - start.z) / (PHYSICS_STEP * reach0),
    );
    return { velocity, steps };
  };
  const flightFor = (start: THREE.Vector3, aim: THREE.Vector3): number =>
    clamp(0.5 + start.distanceTo(aim) * 0.018, 0.66, 0.92) + Math.random() * 0.04;

  /** A flat spin, like a card flicked across a table, with only a slight wobble so it comes down level. */
  const flatSpin = (careful: boolean): { x: number; y: number; z: number } => {
    const wobble = careful ? 0.2 : 0.9;
    return {
      x: (Math.random() - 0.5) * wobble,
      y: (Math.random() < 0.5 ? -1 : 1) * (careful ? 1.5 + Math.random() * 1.5 : 3 + Math.random() * 4),
      z: (Math.random() - 0.5) * wobble,
    };
  };

  /** Put a packet into the world. `emerge`: it grows out of the host that sent it. */
  const spawnPacket = (
    sim: MapPhysics,
    start: THREE.Vector3,
    velocity: THREE.Vector3,
    spin: { x: number; y: number; z: number },
    flow: Flow | null,
    where: Packet['where'],
    blocked: boolean,
    emerge = false,
  ): Packet => {
    const mesh = new THREE.Mesh(packetGeometry, looks.neutral);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(start);
    mesh.add(new THREE.LineSegments(packetEdgeGeometry, packetEdges));
    scene.add(mesh);
    packetMeshes.push(mesh);
    if (emerge) gsap.from(mesh.scale, { x: 0.15, y: 0.15, z: 0.15, duration: 0.2, ease: 'power2.out' });

    const packet: Packet = {
      id: sim.spawn(start, velocity, spin, blocked),
      mesh,
      flow,
      where,
      blocked,
      judged: where === 'outside',
      born: performance.now(),
      lastZ: start.z,
      strandedAt: 0,
      leaving: false,
      relay: null,
      discard: false,
    };
    mesh.userData.packet = packet;
    packets.push(packet);
    lastThrown = packet;
    if (where === 'outside') hooks.report({ kind: 'outside', flow: null });

    // Keep the board from silting up: once it is crowded, the oldest packet is taken away
    const live = packets.filter((item) => !item.leaving);
    if (live.length > MAX_PACKETS) retire(live[0]!);
    hooks.count(liveCount());
    kick(5000);
    return packet;
  };

  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();

  /** A throw from the viewer's hand. `onPacket`: aimed at the top of a resting packet, so placed with more care. */
  function launch(target: THREE.Vector3, onPacket = false): void {
    const sim = physics;
    if (!sim) {
      // Engine still loading: remember the click and throw as soon as it is ready
      if (pending.length < 8) {
        const copy = target.clone();
        pending.push(() => launch(copy, onPacket));
      }
      void loadPhysics();
      return;
    }

    const aim = target.clone();
    const scatter = onPacket ? 0.02 : 0.06;
    aim.y += PACKET.h * 0.6;
    aim.x += (Math.random() - 0.5) * scatter;
    aim.z += (Math.random() - 0.5) * scatter;

    // Start just under the bottom edge of the frame, as if flicked from the viewer's hand
    camera.getWorldDirection(forward);
    up.copy(camera.up).applyQuaternion(camera.quaternion);
    const reach = Math.min(7, distance * 0.36);
    const drop = reach * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.3;
    const start = camera.position.clone().addScaledVector(forward, reach).addScaledVector(up, -drop);
    start.x += (aim.x - start.x) * 0.3;
    if (crowded(start)) {
      later(() => launch(target, onPacket));
      return;
    }

    const where = whereIs(target);
    const flow = where === 'lan' || where === 'dmz' || where === 'siem' ? pickFlow(where) : null;
    const blocked = where === 'wall' || flow?.verdict === 'block';
    // The packet comes down on the spot that was clicked
    const { velocity } = solveThrow(start, aim, flightFor(start, aim));
    spawnPacket(sim, start, velocity, flatSpin(onPacket), flow, where, blocked);
  }

  /** Where pfSense hands on the packets it routes between zones: just above the firewall. */
  const RELAY = new THREE.Vector3(0, GATE.h + 0.6, WALL.z);

  /** The host that sends each kind of traffic, and the spot just in front of it where its packet appears. */
  const senderOf = (flow: Flow): { node: NodeId; at: THREE.Vector3 } => {
    const before = (host: { x: number; z: number; h: number; d: number }): THREE.Vector3 =>
      new THREE.Vector3(host.x, ZONE_H + host.h * 0.6, host.z + host.d / 2 + 0.35);
    switch (flow.from) {
      case 'wan':
        // just behind the top of the globe, on the internet side of the filter
        return { node: 'internet', at: new THREE.Vector3(GLOBE.x, GLOBE.y + 0.95, GLOBE.z - 0.65) };
      case 'lan':
        // agent logs leave the domain controller; anything else leaves the Kali laptop
        return flow.to === 'siem'
          ? { node: 'dc', at: before(HOSTS.dc) }
          : { node: 'kali', at: new THREE.Vector3(HOSTS.kali.x, ZONE_H + 0.35, HOSTS.kali.z + HOSTS.kali.d / 2 + 0.3) };
      case 'dmz':
        return { node: 'endpoint', at: before(HOSTS.endpoint) };
      case 'siem':
        return { node: 'wazuh', at: before(HOSTS.wazuh) };
    }
  };

  /** The sending host lights up for a moment. */
  const ping = (node: NodeId): void => {
    pinged.add(node);
    paintHosts();
    window.setTimeout(() => {
      pinged.delete(node);
      paintHosts();
      kick(200);
    }, 700);
  };

  /**
   * A packet from the command line starts where that kind of traffic really starts. From the
   * internet it is thrown straight at the zone and has to cross the filter. Between zones it is
   * routed through pfSense, like real traffic between segments: it flies to the firewall first,
   * which drops it there or passes it on to the zone.
   */
  function sendFrom(zone: ZoneId): void {
    if (!physics) {
      if (pending.length < 8) pending.push(() => sendFrom(zone));
      void loadPhysics();
      return;
    }
    dispatch(pickFlow(zone));
  }

  function dispatch(flow: Flow): void {
    const sim = physics;
    if (!sim) return;
    const sender = senderOf(flow);
    if (crowded(sender.at)) {
      later(() => dispatch(flow));
      return;
    }
    const destination = targetIn(flow.to);
    destination.y += PACKET.h * 0.6;
    const viaFirewall = flow.from !== 'wan';
    // A little spread at the firewall, so dropped packets do not all fall on the same spot
    const aim = viaFirewall ? RELAY.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.3, 0)) : destination;
    const { velocity, steps } = solveThrow(sender.at, aim, flightFor(sender.at, aim));
    const packet = spawnPacket(sim, sender.at.clone(), velocity, flatSpin(true), flow, flow.to, flow.verdict === 'block', true);
    if (viaFirewall) {
      packet.relay = { atStep: sim.steps() + steps, to: destination };
      packet.discard = flow.verdict === 'block';
    }
    ping(sender.node);
  }

  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), BOARD.t);
  const groundHit = new THREE.Vector3();

  stage.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a, button, .mlabel')) return;
    setNdc(event);
    raycaster.setFromCamera(pointerNdc, camera);

    // A click on a packet aims at its top, so stacks are easy to build
    const onPacket = raycaster.intersectObjects(packetMeshes, false)[0];
    const onSolid = raycaster.intersectObjects(solids, false)[0];
    if (onPacket && (!onSolid || onPacket.distance < onSolid.distance)) {
      const mesh = onPacket.object as THREE.Mesh;
      launch(new THREE.Vector3(mesh.position.x, mesh.position.y + PACKET.h / 2, mesh.position.z), true);
      return;
    }
    if (onSolid) {
      launch(onSolid.point.clone());
      return;
    }
    // Off the board: it lands on the desk, close by
    if (raycaster.ray.intersectPlane(ground, groundHit) && Math.abs(groundHit.x) < 11 && Math.abs(groundHit.z) < 8.5) {
      launch(groundHit.clone());
    }
  });

  /* ── Frame loop ── */
  const dashPosition = new THREE.Vector3();
  const dashDirection = new THREE.Vector3();
  const dashQuat = new THREE.Quaternion();
  const dashScale = new THREE.Vector3(1, 1, 1);
  const dashMatrix = new THREE.Matrix4();
  const xAxis = new THREE.Vector3(1, 0, 0);

  /** Development only: holds the filter's clock still so one moment of an impact can be inspected. */
  let frozenClock: number | null = null;
  let last = performance.now();
  let time = 0;
  let paused = options.paused;
  let idle = paused ? 0 : 1;
  let running = false;
  let raf = 0;
  let onScreen = true;
  const placed = new Map<string, { x: number; y: number }>();

  const place = (id: string, anchor: THREE.Vector3): void => {
    probe.copy(anchor).project(camera);
    const x = (probe.x * 0.5 + 0.5) * width;
    const y = (-probe.y * 0.5 + 0.5) * height;
    const before = placed.get(id);
    if (before && Math.abs(before.x - x) < 0.2 && Math.abs(before.y - y) < 0.2) return;
    placed.set(id, { x, y });
    hooks.place(id, x, y);
  };

  /** Thrown packets: step the simulation, then give each mesh the pose of its body. */
  function stepPackets(dt: number, now: number): void {
    const sim = physics;
    if (!sim) return;
    sim.step(dt);
    for (const packet of packets) {
      if (packet.leaving) continue;
      sim.read(packet.id, packet.mesh.position, packet.mesh.quaternion);
      const at = packet.mesh.position;

      // pfSense forwards a packet routed between zones once it reaches the firewall
      if (packet.relay && sim.steps() >= packet.relay.atStep) {
        const onward = packet.relay.to;
        packet.relay = null;
        if (!packet.blocked) {
          judge(packet, at.x, at.y, at.z);
          const { velocity } = solveThrow(at, onward, flightFor(at, onward));
          sim.redirect(packet.id, velocity, flatSpin(true));
        }
      }

      if (!packet.judged) {
        // Passed packets never touch the filter, so watch for the moment they go through its plane
        if (!packet.blocked && packet.lastZ > FILTER_Z && at.z <= FILTER_Z) judge(packet, at.x, at.y);
        // A blocked one that somehow never reached the filter is still ruled on
        else if (now - packet.born > 2600) judge(packet, at.x, WALL.h + 0.4);
      }
      packet.lastZ = at.z;

      // Fell a long way, or flew out of the frame. (The near bound follows the camera:
      // a packet starts its flight beside it, well in front of the board.)
      if (at.y < -4 || Math.abs(at.x) > 15 || at.z < -13 || at.z > camera.position.z + 3) {
        retire(packet);
        continue;
      }
      // Off the board and lying on the desk, or dropped by pfSense between zones: taken away after a moment
      const discarded = packet.discard && packet.judged;
      if ((at.y < -0.05 || discarded) && sim.resting(packet.id)) {
        if (!packet.strandedAt) packet.strandedAt = now;
        else if (now - packet.strandedAt > (discarded ? 1200 : 2600)) retire(packet);
      } else packet.strandedAt = 0;
    }
  }

  /** Step the resolution down while frames come too slowly, measured over about a second. */
  let windowTime = 0;
  let windowFrames = 0;
  /** The first moments include shader compiles and texture uploads, which say nothing about the device. */
  const measureFrom = performance.now() + 2000;
  const watchFrameRate = (elapsed: number, calm: boolean): void => {
    // Only a loop that runs on its own says anything about the device; a long gap is a hidden tab
    if (calm || ratio <= RATIO_FLOOR || elapsed > 1500 || performance.now() < measureFrom) {
      windowTime = 0;
      windowFrames = 0;
      return;
    }
    windowTime += elapsed;
    windowFrames++;
    if (windowTime < 1000 && windowFrames < 45) return;
    const average = windowTime / windowFrames;
    windowTime = 0;
    windowFrames = 0;
    if (average > 24) {
      ratio = Math.max(RATIO_FLOOR, ratio * 0.75);
      layout();
      placed.clear();
    }
  };

  const frame = (now: number): void => {
    const elapsed = now - last;
    const dt = Math.min(0.05, elapsed / 1000);
    last = now;
    const calm = paused;
    watchFrameRate(elapsed, calm);
    idle += ((calm ? 0 : 1) - idle) * (1 - Math.exp(-dt * 3));
    time += dt * idle;
    const ease = 1 - Math.exp(-dt * 5);

    pointerSmooth.x += (pointer.x - pointerSmooth.x) * ease;
    pointerSmooth.y += (pointer.y - pointerSmooth.y) * ease;

    // The camera drifts a little on its own and leans with the pointer
    aimCamera(Math.sin(time * 0.21) * 0.04 * idle + pointerSmooth.x * 0.075, pointerSmooth.y * -0.03);
    camera.updateMatrixWorld();

    // Traffic along the traces
    let index = 0;
    ROUTES.forEach((route, r) => {
      const track = tracks[r]!;
      for (let i = 0; i < route.count; i++) {
        const along = (time * route.speed + (i / route.count) * track.total) % track.total;
        track.at(along, dashPosition, dashDirection);
        dashQuat.setFromUnitVectors(xAxis, dashDirection);
        // a dropped packet shrinks to nothing as it reaches the firewall
        const fade = route.kind === 'dropped' ? clamp((track.total - along) / 0.7, 0, 1) : 1;
        dashScale.set(fade, 1, fade);
        dashMatrix.compose(dashPosition, dashQuat, dashScale);
        dashes.setMatrixAt(index++, dashMatrix);
      }
    });
    dashes.instanceMatrix.needsUpdate = true;

    graticule.rotation.y = time * 0.35;
    sweep.rotation.z = -time * 0.9;
    const clock = frozenClock ?? now / 1000;
    filterMaterial.uniforms.uTime!.value = clock;
    filterMaterial.uniforms.uSweep!.value = time;
    filterMaterial.uniforms.uLive!.value = hits.some((hit) => clock - hit.z < 0.9) ? 1 : 0;

    stepPackets(dt, now);
    const sim = physics;

    if (shadowDirty || (sim?.anyAwake() ?? false) || packets.some((packet) => packet.leaving)) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }
    renderer.render(scene, camera);

    for (const host of hosts.values()) place(host.id, host.anchor);
    for (const [id, anchor] of Object.entries(zoneAnchors)) place(`zone-${id}`, anchor);

    // In calm mode the loop only runs for a moment after each interaction
    const busy = (sim?.anyAwake() ?? false) || packets.some((packet) => packet.leaving || packet.strandedAt > 0);
    const ringing = hits.some((hit) => now / 1000 - hit.z < 1.0);
    if (calm && !busy && !ringing && now > activeUntil && idle < 0.02) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  function refreshLoop(): void {
    const should = onScreen && !document.hidden && (!paused || performance.now() < activeUntil);
    if (should && !running) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!should && running && (!onScreen || document.hidden)) {
      running = false;
      cancelAnimationFrame(raf);
    }
  }

  watchVisibility(stage, (visible) => {
    onScreen = visible;
    refreshLoop();
  });
  document.addEventListener('visibilitychange', refreshLoop);
  // The words printed along the wall follow the page language
  i18n.subscribe((lang) => {
    wallText.image = wallCanvas(wallLength, lang === 'fr' ? 'REFUS PAR DÉFAUT' : 'DEFAULT DENY');
    wallText.needsUpdate = true;
    kick(300);
  });

  let resizeTimer = 0;
  new ResizeObserver(() => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      layout();
      placed.clear();
      kick(400);
    }, 60);
  }).observe(stage);

  layout();

  // Draw one frame before the canvas fades in
  frame(performance.now());
  cancelAnimationFrame(raf);
  running = false;
  refreshLoop();

  const ZONE_IDS = Object.keys(ZONES) as ZoneId[];
  /** Somewhere in the open front part of a zone, clear of its hosts. */
  const targetIn = (id: ZoneId): THREE.Vector3 => {
    const zone = ZONES[id];
    return new THREE.Vector3(
      zone.x0 + 0.5 + Math.random() * (zone.x1 - zone.x0 - 1),
      ZONE_H,
      ZONE_Z1 - 0.35 - Math.random() * 0.5,
    );
  };

  if (import.meta.env.DEV) {
    // Development only (stripped from the production build): lets automated checks throw packets
    // at exact board coordinates and read back where they came to rest.
    (window as unknown as Record<string, unknown>).__mapDebug = {
      ready: (): boolean => physics !== null,
      load: (): Promise<void> => loadPhysics(),
      toss: (x: number, z: number, y = 0, onPacket = false): void => launch(new THREE.Vector3(x, y, z), onPacket),
      send: (zone: ZoneId): void => sendFrom(zone),
      route: (from: Flow['from'], to: ZoneId): void => {
        const flow = FLOWS.find((item) => item.from === from && item.to === to);
        if (flow) dispatch(flow);
      },
      /** Show the filter's answer to an impact at (x, y), frozen `age` seconds after it happened. */
      flash: (x: number, y: number, passed: boolean, age: number): void => {
        hits[nextHit++ % hits.length]!.set(x, y, 1000, passed ? 1 : -1);
        frozenClock = 1000 + age;
        probe.set(x, y, FILTER_Z).project(camera);
        hooks.stamp((probe.x * 0.5 + 0.5) * width, (-probe.y * 0.5 + 0.5) * height, passed ? 'pass' : 'block');
        kick(4000);
      },
      /** Run the simulation forward without waiting for frames (headless rendering is slow). */
      settle: (seconds: number): void => {
        for (let i = 0; i < seconds * 60; i++) stepPackets(1 / 60, performance.now());
      },
      packets: (): Array<Record<string, number | string | boolean>> =>
        packets
          .filter((packet) => !packet.leaving)
          .map((packet) => {
            const q = packet.mesh.quaternion;
            return {
              x: Number(packet.mesh.position.x.toFixed(3)),
              y: Number(packet.mesh.position.y.toFixed(3)),
              z: Number(packet.mesh.position.z.toFixed(3)),
              // 1 = lying flat on its largest face, 0 = standing on an edge
              flat: Number(Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)).toFixed(3)),
              where: packet.where,
              blocked: packet.blocked,
              route: packet.flow ? `${packet.flow.from}>${packet.flow.to}` : '',
              resting: physics?.resting(packet.id) ?? false,
            };
          }),
    };
  }

  return {
    clear(): void {
      for (const packet of [...packets]) retire(packet);
    },
    send(zone): void {
      sendFrom(zone ?? ZONE_IDS[Math.floor(Math.random() * ZONE_IDS.length)]!);
    },
    setPaused(next): void {
      paused = next;
      kick(1500);
    },
    highlight(node): void {
      lit = node;
      paintHosts();
      kick(600);
    },
  };
}
