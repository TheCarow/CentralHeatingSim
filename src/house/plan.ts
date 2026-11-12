/*
 * The house plan: what rooms there are, what radiator each has, and how the
 * pipes run. Pure data — the simulation builds its pipe network from this,
 * and (later) the scene lays out its drawing from it.
 *
 * Rooms sit in a row, left to right, starting next to the boiler cupboard.
 * The pipework is a "ladder":
 *
 *   boiler → flow main ─┬─ flow main ─┬─ … ─┬─ bypass ─┐
 *                       │ radiator 1  │     │ radiator N│
 *   boiler ← return ────┴─ return ────┴─ … ─┴──────────┘
 *
 * Each radiator branch is TRV tail → radiator → lockshield tail. One
 * automatic bypass valve sits at the end of the run, under the last radiator,
 * so with one room this is the original single loop.
 */

export interface RadiatorSpec {
  ratedW: number; // output at ΔT50 (EN 442)
  exponent: number; // output ∝ ΔT^n
  layers: number; // simulated as this many layers, top to bottom
  waterL: number;
  steelKg: number;
  designLpm: number; // flow when its TRV and lockshield are fully open
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
  /** [0] boiler → first radiator's tee; [k] tee k-1 → tee k. */
  flowMain: readonly PipeSpec[];
  /** [0] first radiator's tee → boiler; [k] tee k → tee k-1. */
  returnMain: readonly PipeSpec[];
  /** Each radiator tail (TRV side and lockshield side). */
  tail: PipeSpec;
  /** Bypass pipe under the last radiator. */
  bypass: PipeSpec;
}

export const MAX_ROOMS = 3;

export const DEFAULT_RADIATOR: RadiatorSpec = {
  ratedW: 1600, // double panel 1200 x 600
  exponent: 1.3,
  layers: 12,
  waterL: 6,
  steelKg: 22,
  designLpm: 2.0,
};

const ROOM_W = 4;
const ROOM_D = 4;
const ROOM_H = 2.5;
const ROOM_C_PER_M2 = 62500; // J/K per m² of floor (1 MJ/K for a 4 x 4 m room)
const PARTITION_U = 1.7; // W/(m²·K): plastered blockwork internal wall
const CELLS_PER_M_FLOW = 8; // 15 mm pipe split into 12.5 cm cells
const CELLS_PER_M_RETURN = 8;

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
  // Mains between neighbouring radiators run one room width.
  const between = (cellsPerM: number): PipeSpec => ({
    lenM: ROOM_W,
    cells: ROOM_W * cellsPerM,
  });
  return {
    rooms,
    thermostatRoom: 0,
    partitionUA: PARTITION_U * ROOM_D * ROOM_H,
    flowMain: [
      { lenM: 7.5, cells: 60 }, // 15 mm copper, boiler -> under the first radiator
      ...Array.from({ length: n - 1 }, () => between(CELLS_PER_M_FLOW)),
    ],
    returnMain: [
      { lenM: 12.0, cells: 96 }, // first radiator -> boiler, the longer way round
      ...Array.from({ length: n - 1 }, () => between(CELLS_PER_M_RETURN)),
    ],
    tail: { lenM: 0.55, cells: 5 },
    bypass: { lenM: 3.0, cells: 24 },
  };
}
