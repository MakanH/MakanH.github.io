/**
 * Rigid-body physics for the packets thrown onto the map.
 *
 * Uses Rapier (Rust compiled to WebAssembly). Thrown packets are real dynamic
 * bodies: they collide with the board, the zone platforms, the firewall, every
 * node and each other, so they bounce, stack, lean, and tip off an edge when
 * their weight hangs past it.
 *
 * The firewall's filter is a real collider too. Collision groups decide who it
 * stops: a packet the rules block hits it like glass, a packet the rules pass
 * never touches it.
 *
 * The engine is a large download and nothing needs it until a packet is
 * thrown, so this module is imported lazily, on the first interaction.
 */
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A fixed box: centre, half extents and an optional rotation. */
export interface FixedBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  rotation?: Quat;
  friction?: number;
}

export interface FixedBall {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface MapPhysicsOptions {
  gravity: number;
  /** Length of one physics step, in seconds. The scene aims its throws with the same number. */
  step: number;
  /** Air drag on a packet in flight (per second). It is why a thrown packet arrives gently. */
  flightDrag: number;
  /** Half extents of a packet. */
  packet: { hx: number; hy: number; hz: number };
  boxes: FixedBox[];
  balls: FixedBall[];
  /** The firewall's filter. Only packets spawned as blocked collide with it. */
  filter: FixedBox;
  /** A blocked packet has just hit the filter, at this point. */
  onFilterHit(id: number, at: Vec3): void;
}

export interface MapPhysics {
  /** Launch a packet. Returns its id. */
  spawn(position: Vec3, linvel: Vec3, angvel: Vec3, blocked: boolean): number;
  remove(id: number): void;
  /** Advance the simulation by one rendered frame. */
  step(dt: number): void;
  /** Copy a packet's pose into `position` / `quaternion` (three.js objects fit). False if the id is unknown. */
  read(id: number, position: Vec3, quaternion: Quat): boolean;
  /** True once the packet has stopped moving. */
  resting(id: number): boolean;
  /** True while any packet is still moving. */
  anyAwake(): boolean;
  /** Physics steps run so far: a clock that keeps pace with the simulation, whatever the frame rate. */
  steps(): number;
  /** Send a flying packet off somewhere new (pfSense forwarding it). */
  redirect(id: number, linvel: Vec3, angvel: Vec3): void;
}

interface Packet {
  body: RigidBody;
  collider: Collider;
  /** False until it first touches the board, a host or another packet. */
  landed: boolean;
}

const MAX_SUBSTEPS = 4;
/** Drag once a packet has landed: little enough that it tips and falls off an edge naturally. */
const RESTING_DRAG = 0.3;
/** Card on paper loses its spin quickly once it is down, which is what lets packets stack. */
const RESTING_SPIN_DRAG = 0.9;

// Collision groups: the upper 16 bits say what a collider is, the lower 16 what it hits.
const WORLD = 0x0001;
const PASSED = 0x0002;
const BLOCKED = 0x0004;
const FILTER = 0x0008;
const groups = (membership: number, mask: number): number => (membership << 16) | mask;

export async function createMapPhysics(options: MapPhysicsOptions): Promise<MapPhysics> {
  const RAPIER = await import('@dimforge/rapier3d-compat');
  await RAPIER.init();

  const { hx, hy, hz } = options.packet;
  const SUBSTEP = options.step;
  /** Slightly rounded edges: boxes settle more naturally and edge contacts are stabler. */
  const ROUND = Math.min(0.025, hy * 0.2);

  const world = new RAPIER.World({ x: 0, y: -options.gravity, z: 0 });
  world.numSolverIterations = 8;
  const events = new RAPIER.EventQueue(true);

  /* ── Fixed things ── */
  const everything = WORLD | PASSED | BLOCKED;

  for (const box of options.boxes) {
    const desc = RAPIER.ColliderDesc.cuboid(box.hx, box.hy, box.hz)
      .setTranslation(box.x, box.y, box.z)
      .setFriction(box.friction ?? 0.7)
      .setRestitution(0.2)
      .setCollisionGroups(groups(WORLD, everything));
    if (box.rotation) desc.setRotation(box.rotation);
    world.createCollider(desc);
  }

  for (const ball of options.balls) {
    world.createCollider(
      RAPIER.ColliderDesc.ball(ball.r)
        .setTranslation(ball.x, ball.y, ball.z)
        .setFriction(0.5)
        .setRestitution(0.35)
        .setCollisionGroups(groups(WORLD, everything)),
    );
  }

  // The filter: dead (no bounce) and slippery, so a blocked packet stops against it and drops
  const filter = world.createCollider(
    RAPIER.ColliderDesc.cuboid(options.filter.hx, options.filter.hy, options.filter.hz)
      .setTranslation(options.filter.x, options.filter.y, options.filter.z)
      .setFriction(0.05)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0.04)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setCollisionGroups(groups(FILTER, BLOCKED)),
  );

  /* ── Packets ── */
  const packets = new Map<number, Packet>();
  const packetByCollider = new Map<number, number>();
  let nextId = 1;
  let leftover = 0;
  let stepCount = 0;

  const handleContacts = (): void => {
    // Collect first, act after: bodies must not be touched while the queue is being drained
    const onFilter: number[] = [];
    const touched: number[] = [];
    events.drainCollisionEvents((first, second, started) => {
      if (!started) return;
      const a = packetByCollider.get(first);
      const b = packetByCollider.get(second);
      if (first === filter.handle || second === filter.handle) {
        const id = a ?? b;
        if (id !== undefined) onFilter.push(id);
        return;
      }
      if (a !== undefined) touched.push(a);
      if (b !== undefined) touched.push(b);
    });

    for (const id of onFilter) {
      const packet = packets.get(id);
      if (!packet) continue;
      // The filter takes the tumble out of a packet, so it drops instead of cartwheeling away
      const v = packet.body.linvel();
      const w = packet.body.angvel();
      packet.body.setLinvel({ x: v.x * 0.35, y: v.y, z: v.z }, true);
      packet.body.setAngvel({ x: w.x * 0.3, y: w.y * 0.3, z: w.z * 0.3 }, true);
      options.onFilterHit(id, packet.body.translation());
    }

    for (const id of touched) {
      const packet = packets.get(id);
      if (!packet || packet.landed) continue;
      packet.landed = true;
      // Card on paper: the first touch takes most of the slide and tumble out of a packet,
      // so it stays near where it came down instead of skating across the board.
      const v = packet.body.linvel();
      const w = packet.body.angvel();
      packet.body.setLinvel({ x: v.x * 0.2, y: v.y, z: v.z * 0.2 }, true);
      packet.body.setAngvel({ x: w.x * 0.2, y: w.y * 0.4, z: w.z * 0.2 }, true);
      packet.body.setLinearDamping(RESTING_DRAG);
      packet.body.setAngularDamping(RESTING_SPIN_DRAG);
    }
  };

  return {
    spawn(position, linvel, angvel, blocked) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(position.x, position.y, position.z)
          .setLinvel(linvel.x, linvel.y, linvel.z)
          .setAngvel(angvel)
          .setLinearDamping(options.flightDrag)
          .setAngularDamping(0.35)
          .setCcdEnabled(true),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(hx - ROUND, hy - ROUND, hz - ROUND, ROUND)
          .setDensity(1)
          .setFriction(0.78)
          .setRestitution(0.14)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
          .setCollisionGroups(blocked ? groups(BLOCKED, everything | FILTER) : groups(PASSED, everything)),
        body,
      );
      const id = nextId++;
      packets.set(id, { body, collider, landed: false });
      packetByCollider.set(collider.handle, id);
      return id;
    },

    remove(id) {
      const packet = packets.get(id);
      if (!packet) return;
      packetByCollider.delete(packet.collider.handle);
      packets.delete(id);
      world.removeRigidBody(packet.body);
    },

    step(dt) {
      const total = Math.min(dt + leftover, SUBSTEP * MAX_SUBSTEPS);
      const count = Math.floor(total / SUBSTEP);
      leftover = total - count * SUBSTEP;
      world.timestep = SUBSTEP;
      for (let i = 0; i < count; i++) {
        world.step(events);
        stepCount++;
        handleContacts();
      }
    },

    read(id, position, quaternion) {
      const packet = packets.get(id);
      if (!packet) return false;
      const t = packet.body.translation();
      const r = packet.body.rotation();
      position.x = t.x;
      position.y = t.y;
      position.z = t.z;
      quaternion.x = r.x;
      quaternion.y = r.y;
      quaternion.z = r.z;
      quaternion.w = r.w;
      return true;
    },

    resting(id) {
      const packet = packets.get(id);
      if (!packet) return true;
      if (packet.body.isSleeping()) return true;
      const v = packet.body.linvel();
      return v.x * v.x + v.y * v.y + v.z * v.z < 0.01;
    },

    steps() {
      return stepCount;
    },

    redirect(id, linvel, angvel) {
      const packet = packets.get(id);
      if (!packet) return;
      packet.body.setLinvel(linvel, true);
      packet.body.setAngvel(angvel, true);
    },

    anyAwake() {
      for (const packet of packets.values()) if (!packet.body.isSleeping()) return true;
      return false;
    },
  };
}
