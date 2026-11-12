/*
 * The house plan: what rooms there are, what radiator each has, and how the
 * pipes run. Pure data — the simulation builds its pipe network from this,
 * and the scene lays out its drawing from it.
 *
 * Rooms sit in a row, left to right, starting next to the boiler cupboard.
 * The pipework is a one-pipe loop: every radiator has an open bypass pipe
 * underneath it, and the water goes from one radiator's pipes to the next:
 *
 *   boiler → flow ─┬─ radiator 1 ─┬─ link ─┬─ radiator 2 ─┬─ … ─┐
 *                  └── bypass 1 ──┘        └── bypass 2 ──┘     │
 *   boiler ← return ──────────────────────────────────────────────┘
 *
 * Each radiator branch is TRV tail → radiator → lockshield tail. There is no
 * bypass valve: at each radiator the water divides between the radiator and
 * its bypass pipe, so closing TRVs never stops the loop.
 */

export interface RadiatorSpec {
  ratedW: number; // output at ΔT50 (EN 442)
  exponent: number; // output ∝ ΔT^n
  layers: number; // simulated as this many layers, top to bottom
  waterL: number;
  steelKg: number;
  /**
   * How freely water goes through the radiator (TRV and lockshield fully
   * open), relative to its bypass pipe. 1 = the loop flow splits half and
   * half.
   */
  conductance: number;
}

export interface RoomSpec {
  name: string;
  widthM: number;
  depthM: number;
  heightM: number;
  extWallM2: number; // external wall area (only the end room has a gable)
  ceilingM2: number; // ceiling under the loft
  volumeM3: number;
  heatCapacity: number; // J/K effective (air + furniture + inner wall surfaces)
  radiator: RadiatorSpec;
}

export interface PipeSpec {
  lenM: number;
  cells: number;
}

export interface HousePlan {
  rooms: readonly RoomSpec[];
  /** Room the room thermostat hangs in. */
  thermostatRoom: number;
  /** W/K through the internal wall between neighbouring rooms. */
  partitionUA: number;
  /** Water the pump sends round the loop, L/min. */
  pumpLpm: number;
  /** Boiler → first radiator. */
  flow: PipeSpec;
  /** [k] radiator k → radiator k+1, under the floor. */
  links: readonly PipeSpec[];
  /** Back to the boiler: [k] runs under room k ([0] reaches the boiler). */
  ret: readonly PipeSpec[];
  /** Each radiator tail (TRV side and lockshield side). */
  tail: PipeSpec;
  /** The open bypass pipe under each radiator. */
  bypass: PipeSpec;
}

export const MAX_ROOMS = 3;

export const DEFAULT_RADIATOR: RadiatorSpec = {
  ratedW: 1600, // double panel 1200 x 600
  exponent: 1.3,
  layers: 12,
  waterL: 6,
  steelKg: 22,
  conductance: 1,
};

const ROOM_W = 4;
const ROOM_D = 4;
const ROOM_H = 2.5;
const ROOM_C_PER_M2 = 62500; // J/K per m² of floor (1 MJ/K for a 4 x 4 m room)
const PARTITION_U = 1.7; // W/(m²·K): plastered blockwork internal wall
const CELLS_PER_M = 8; // 15 mm pipe split into 12.5 cm cells
const PUMP_LPM = 4.0; // a fully open radiator takes half: 2 L/min
const LINK_M = 2.0; // one radiator's return tee to the next one's flow tee

function room(index: number, count: number): RoomSpec {
  const end = index === count - 1;
  return {
    name: count === 1 ? "Room" : `Room ${index + 1}`,
    widthM: ROOM_W,
    depthM: ROOM_D,
    heightM: ROOM_H,
    extWallM2: end ? ROOM_D * ROOM_H : 0, // 4 m x 2.5 m gable, no window
    ceilingM2: ROOM_W * ROOM_D,
    volumeM3: ROOM_W * ROOM_D * ROOM_H,
    heatCapacity: ROOM_C_PER_M2 * ROOM_W * ROOM_D,
    radiator: { ...DEFAULT_RADIATOR },
  };
}

/** A row of `roomCount` identical rooms (1 to MAX_ROOMS). */
export function makePlan(roomCount = 1): HousePlan {
  const n = Math.max(1, Math.min(MAX_ROOMS, Math.round(roomCount)));
  const rooms = Array.from({ length: n }, (_, i) => room(i, n));
  const pipe = (lenM: number): PipeSpec => ({
    lenM,
    cells: lenM * CELLS_PER_M,
  });
  return {
    rooms,
    thermostatRoom: 0,
    partitionUA: PARTITION_U * ROOM_D * ROOM_H,
    pumpLpm: PUMP_LPM,
    flow: { lenM: 7.5, cells: 60 }, // 15 mm copper, boiler -> under the first radiator
    links: Array.from({ length: n - 1 }, () => pipe(LINK_M)),
    // Return: from the first room back to the boiler the long way round
    // (12 m); each further room adds a room's width.
    ret: [
      { lenM: 12.0, cells: 96 },
      ...Array.from({ length: n - 1 }, () => pipe(ROOM_W)),
    ],
    tail: { lenM: 0.55, cells: 5 },
    bypass: { lenM: 3.0, cells: 24 },
  };
}
