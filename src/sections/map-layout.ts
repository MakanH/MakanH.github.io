/**
 * Where everything sits on the map board. Shared by the 3D scene and by the
 * flat drawing that stands in for it when WebGL is not available.
 *
 * World units. X runs left to right, Z toward the viewer, Y up. The board's
 * top is y = 0 and the viewer stands on the internet side.
 */

export type ZoneId = 'lan' | 'dmz' | 'siem';

export const BOARD = { w: 14.4, d: 10.4, t: 0.3 };
export const ZONE_H = 0.24;
export const ZONE_Z0 = -4.85;
export const ZONE_Z1 = -0.3;
export const ZONES: Record<ZoneId, { x0: number; x1: number; color: number }> = {
  lan: { x0: -6.6, x1: -1.5, color: 0xf4f0e6 },
  dmz: { x0: -1.05, x1: 2.35, color: 0xf7ebd0 },
  siem: { x0: 2.8, x1: 6.6, color: 0xe3e9fb },
};
export const WALL = { z: 1.3, t: 0.36, h: 0.62, half: 6.9 };
export const GATE = { w: 2.3, h: 1.0, d: 0.62 };

export const HOSTS = {
  dc: { x: -5.65, z: -2.1, w: 1.2, h: 1.3, d: 1.2 },
  kali: { x: -2.3, z: -1.9, w: 1.3, h: 0.08, d: 0.9 },
  endpoint: { x: 0.9, z: -2.1, w: 1.1, h: 1.0, d: 1.1 },
  wazuh: { x: 4.7, z: -2.1, w: 1.3, h: 1.3, d: 1.2 },
} as const;
export const GLOBE = { x: 0, z: 3.75, r: 0.7, y: 0.9 };

/* ───────────── Traces ───────────── */

export type P = [number, number, number];

export const ON_BOARD = 0.012;
export const ON_ZONE = ZONE_H + 0.012;
export const BUS_Z = 0.4;
/** Where a zone's feeder turns toward its host, just inside the platform's front edge. */
const TURN_Z = ZONE_Z1 - 0.6;
export const ENTRY: Record<ZoneId, number> = { lan: -3.9, dmz: 0.9, siem: 4.7 };
const GATE_BACK: P = [0, ON_BOARD, WALL.z - GATE.d / 2];
const GATE_FRONT: P = [0, ON_BOARD, WALL.z + GATE.d / 2];
const JUNCTION: P = [0, ON_BOARD, BUS_Z];

const front = (host: { z: number; d: number }): number => host.z + host.d / 2;
type HostId = keyof typeof HOSTS;

/** From the bus to each host: across the board, up the platform's front edge, along its top. */
const FEED: Record<HostId, P[]> = {
  dc: [
    [ENTRY.lan, ON_BOARD, BUS_Z],
    [ENTRY.lan, ON_BOARD, ZONE_Z1],
    [ENTRY.lan, ON_ZONE, ZONE_Z1],
    [ENTRY.lan, ON_ZONE, TURN_Z],
    [HOSTS.dc.x, ON_ZONE, TURN_Z],
    [HOSTS.dc.x, ON_ZONE, front(HOSTS.dc)],
  ],
  kali: [
    [ENTRY.lan, ON_BOARD, BUS_Z],
    [ENTRY.lan, ON_BOARD, ZONE_Z1],
    [ENTRY.lan, ON_ZONE, ZONE_Z1],
    [ENTRY.lan, ON_ZONE, TURN_Z],
    [HOSTS.kali.x, ON_ZONE, TURN_Z],
    [HOSTS.kali.x, ON_ZONE, front(HOSTS.kali)],
  ],
  endpoint: [
    [ENTRY.dmz, ON_BOARD, BUS_Z],
    [ENTRY.dmz, ON_BOARD, ZONE_Z1],
    [ENTRY.dmz, ON_ZONE, ZONE_Z1],
    [HOSTS.endpoint.x, ON_ZONE, front(HOSTS.endpoint)],
  ],
  wazuh: [
    [ENTRY.siem, ON_BOARD, BUS_Z],
    [ENTRY.siem, ON_BOARD, ZONE_Z1],
    [ENTRY.siem, ON_ZONE, ZONE_Z1],
    [HOSTS.wazuh.x, ON_ZONE, front(HOSTS.wazuh)],
  ],
};

const UPLINK: P[] = [GATE_FRONT, [0, ON_BOARD, GLOBE.z - 0.46]];
/** Out of a host and into the back of the firewall. */
const toGate = (host: HostId): P[] => [...FEED[host]].reverse().concat([JUNCTION, GATE_BACK]);
const fromGate = (host: HostId): P[] => [GATE_BACK, JUNCTION, ...FEED[host]];

export interface Route {
  points: P[];
  kind: 'logs' | 'outbound' | 'dropped';
  /** Dashes on the route at any moment. */
  count: number;
  speed: number;
}

/** The traffic that is always running, each line of it true to the rule set. */
export const ROUTES: Route[] = [
  // Agent logs to Wazuh on 1514-1515 (LAN rule 2, DMZ rule 2)
  { points: [...toGate('dc'), ...fromGate('wazuh')], kind: 'logs', count: 4, speed: 2.5 },
  { points: [...toGate('endpoint'), ...fromGate('wazuh')], kind: 'logs', count: 3, speed: 2.5 },
  // Outbound to the internet (LAN rule 3, SIEM rule 3)
  { points: [...toGate('kali'), ...UPLINK], kind: 'outbound', count: 2, speed: 2.1 },
  { points: [...toGate('wazuh'), ...UPLINK], kind: 'outbound', count: 2, speed: 2.1 },
  // The DMZ reaching for the LAN: dropped at the firewall (DMZ rule 1)
  { points: toGate('endpoint'), kind: 'dropped', count: 1, speed: 2.3 },
];
