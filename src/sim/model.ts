/*
 * Heating system physics model.
 *
 * The house plan (src/house/plan.ts) says which rooms and radiators there
 * are; circuit.ts turns it into a loop of water "cells" and hydraulics.ts
 * decides how the pump's flow divides between the radiators and the bypass.
 *
 * Each sub-step: water is advected cell to cell (upwind finite volume, with
 * mixing where branches rejoin), every cell exchanges heat with the room
 * above it, the burner heats the heat-exchanger cell, and each room loses
 * heat through its fabric and trades heat with its neighbours.
 */
import { makePlan, type HousePlan, type RoomSpec } from "../house/plan";
import { CP, Circuit, HX, Kind, type CellInfo } from "./circuit";
import { edgeFlows } from "./hydraulics";

export { CP };

// ---- Boiler & control constants --------------------------------------------
export const K = {
  BURNER_MAX_W: 24000, // combi CH output
  BURNER_TAU_S: 20, // how hard the burner chases the set-point
  MIN_FLOW_LPM: 0.15, // below this the boiler won't fire
  PUMP_OVERRUN_S: 120, // pump keeps running after the burner stops

  THERMOSTAT_HYST: 0.25, // ±K switching band
  TRV_PBAND: 2.0, // K: fully open at target-1, shut at target+1
  TRV_TAU_S: 300, // wax/liquid sensor lag
} as const;

// ---- TRV head scale --------------------------------------------------------
// Typical manufacturer mapping (varies by brand by a degree or two).
export interface TrvSetting {
  label: string;
  target: number | null;
  note?: string;
}
export const TRV_SETTINGS: readonly TrvSetting[] = [
  { label: "0", target: null, note: "Shut" },
  { label: "❄", target: 7, note: "Frost" },
  { label: "1", target: 12 },
  { label: "2", target: 16 },
  { label: "3", target: 20 },
  { label: "4", target: 24 },
  { label: "5", target: 28 },
];

// ---- Fabric options ---------------------------------------------------------
export type WallType = "solid" | "cavity" | "filled" | "ewi";
export interface Insulation {
  label: string;
  summary: string;
  wall: { name: string; U: number; type: WallType };
  loft: { mm: number; U: number };
  ach: number; // air changes per hour (draughts)
}
export type InsulationKey = "poor" | "average" | "good" | "excellent";

export const INSULATION: Record<InsulationKey, Insulation> = {
  poor: {
    label: "Poor",
    summary: "Solid brick, 25 mm loft, draughty",
    wall: { name: 'Solid 9" brick', U: 2.1, type: "solid" },
    loft: { mm: 25, U: 1.2 },
    ach: 1.5,
  },
  average: {
    label: "Average",
    summary: "Unfilled cavity, 100 mm loft",
    wall: { name: "Unfilled cavity wall", U: 1.5, type: "cavity" },
    loft: { mm: 100, U: 0.4 },
    ach: 1.0,
  },
  good: {
    label: "Good",
    summary: "Filled cavity, 270 mm loft",
    wall: { name: "Insulated cavity wall", U: 0.55, type: "filled" },
    loft: { mm: 270, U: 0.16 },
    ach: 0.6,
  },
  excellent: {
    label: "Excellent",
    summary: "External insulation, 400 mm loft, airtight",
    wall: { name: "Filled cavity + external insulation", U: 0.18, type: "ewi" },
    loft: { mm: 400, U: 0.1 },
    ach: 0.3,
  },
};

export interface LossCoefficients {
  wall: number;
  roof: number;
  vent: number;
  total: number;
}

/** Heat-loss coefficients in W/K for each path out of a room. */
export function lossCoefficients(
  ins: Insulation,
  room: RoomSpec,
): LossCoefficients {
  const wall = ins.wall.U * room.extWallM2;
  const roof = ins.loft.U * room.ceilingM2;
  const vent = 0.33 * ins.ach * room.volumeM3; // 0.33 Wh/(m³·K) for air
  return { wall, roof, vent, total: wall + roof + vent };
}

// Condensing boiler efficiency vs return water temperature (approximate).
// Flue gases only condense when the return water is below ~54 °C.
const EFF_TABLE: ReadonlyArray<readonly [number, number]> = [
  [20, 0.98],
  [30, 0.97],
  [40, 0.955],
  [50, 0.93],
  [55, 0.895],
  [60, 0.88],
  [70, 0.87],
  [90, 0.865],
];
export const CONDENSING_BELOW = 54;

export function efficiency(tReturn: number): number {
  const t = EFF_TABLE;
  if (tReturn <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (tReturn <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return y0 + ((y1 - y0) * (tReturn - x0)) / (x1 - x0);
    }
  }
  return t[t.length - 1][1];
}

export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

// ---- Simulation ---------------------------------------------------------------

/** Settings for one radiator. */
export interface RadiatorParams {
  trvIndex: number; // index into TRV_SETTINGS
  lockshield: number; // lockshield opening, 0.1..1 (10% steps)
}

export interface SimParams {
  flowSet: number; // °C boiler flow temperature
  thermostatSet: number; // °C room thermostat
  insulation: InsulationKey;
  outdoor: number; // °C
  boilerOn: boolean; // master power switch
  thermostatOn: boolean; // thermostat heating on/off
  radiators: RadiatorParams[]; // one per room, left to right
}

/** Live state of one room and its radiator's TRV. */
export interface RoomState {
  T: number; // air temperature, °C
  Tsensor: number; // TRV wax capsule, °C
  trvOpening: number; // 0..1
  radW: number; // W from its radiator
  pipeW: number; // W from pipes under it (and the boiler, for room 0)
  lossW: number; // W out through its fabric
  partitionW: number; // W out to neighbouring rooms (negative = gaining)
}

export interface HistorySample {
  t: number;
  outdoor: number;
  thermostat: number;
  flow: number;
  ret: number;
  demand: boolean;
  burner: number;
  rooms: { T: number; trv: number | null }[];
}

export type SimStatus =
  "off" | "standby" | "overrun" | "bypass" | "heating" | "idle";

export type Limiter = "thermostat" | "radiator" | "trv" | "trv-shut" | "off";

export class Sim {
  readonly plan: HousePlan;
  readonly circuit: Circuit;
  readonly N: number; // cells
  readonly T: Float64Array; // °C per cell
  readonly q: Float64Array; // W into the room, per cell
  readonly m: Float64Array; // kg/s per edge (1 L ≈ 1 kg)
  readonly rooms: RoomState[];

  private readonly Told: Float64Array;
  private readonly dE: Float64Array; // per-cell energy change, scratch
  private readonly mcp: Float64Array; // m·cp per edge, scratch
  private readonly radFlow: Float64Array; // kg/s per radiator
  private readonly roomTold: Float64Array; // room temps at step start
  private readonly radR: Float64Array; // W per room, scratch
  private readonly pipeR: Float64Array;
  private readonly paths: number[][]; // boiler -> radiator k -> boiler
  private hKey = ""; // insulation level the cached H values are for
  private readonly hVal: Float64Array;

  params: SimParams;

  time = 0; // seconds since day 1, 00:00
  demand = false;
  overrun = 0;
  pumpOn = false;
  mMain = 0; // kg/s through the pump
  burnerW = 0;
  radW = 0; // totals over all rooms
  pipeW = 0;
  lossW = 0;
  gasJ = 0;
  heatJ = 0;
  history: HistorySample[] = [];
  private nextSample = 0;

  constructor(plan: HousePlan = makePlan(1)) {
    this.plan = plan;
    const c = (this.circuit = new Circuit(plan));
    const R = plan.rooms.length;
    this.N = c.N;
    this.T = new Float64Array(c.N);
    this.Told = new Float64Array(c.N);
    this.q = new Float64Array(c.N);
    this.dE = new Float64Array(c.N);
    this.m = new Float64Array(c.edges.length);
    this.mcp = new Float64Array(c.edges.length);
    this.radFlow = new Float64Array(R);
    this.roomTold = new Float64Array(R);
    this.radR = new Float64Array(R);
    this.pipeR = new Float64Array(R);
    this.hVal = new Float64Array(R);
    this.paths = plan.rooms.map((_, k) => c.pathThrough(k));
    this.rooms = plan.rooms.map(() => ({
      T: 14,
      Tsensor: 14,
      trvOpening: 0,
      radW: 0,
      pipeW: 0,
      lossW: 0,
      partitionW: 0,
    }));
    this.params = {
      flowSet: 65,
      thermostatSet: 20,
      insulation: "average",
      outdoor: 5,
      boilerOn: true,
      thermostatOn: false, // page opens with the thermostat off
      // setting "4" ≈ 24 °C, lockshield fully open
      radiators: plan.rooms.map(() => ({ trvIndex: 5, lockshield: 1 })),
    };
    this.reset(this.params.outdoor); // cold start: everything at outside temperature
  }

  reset(startTemp = 14): void {
    this.time = 6 * 3600; // day 1, 06:00
    this.T.fill(startTemp);
    for (const r of this.rooms) {
      r.T = r.Tsensor = startTemp;
      r.trvOpening = 0;
      r.radW = r.pipeW = r.lossW = r.partitionW = 0;
    }
    this.demand = false;
    this.overrun = 0;
    this.pumpOn = false;
    this.mMain = 0;
    this.m.fill(0);
    this.radFlow.fill(0);
    this.burnerW = 0;
    this.radW = 0;
    this.pipeW = 0;
    this.lossW = 0;
    this.gasJ = 0;
    this.heatJ = 0;
    this.history = [];
    this.nextSample = this.time;
    this.controls();
    this.record(true);
  }

  // ---- Queries ----

  cellInfo(i: number): CellInfo {
    return this.circuit.cellInfo(i);
  }

  /** Flow (L/min) through the part of the circuit that cell i is in. */
  cellFlowLpm(i: number): number {
    return this.m[this.circuit.edgeOf[i]] * 60;
  }

  get insulation(): Insulation {
    return INSULATION[this.params.insulation];
  }
  /** Heat-loss coefficients (W/K) of room k. */
  lossesFor(k: number): LossCoefficients {
    return lossCoefficients(this.insulation, this.plan.rooms[k]);
  }
  /** Heat-loss coefficients (W/K) summed over the whole house. */
  get losses(): LossCoefficients {
    const sum = { wall: 0, roof: 0, vent: 0, total: 0 };
    for (let k = 0; k < this.rooms.length; k++) {
      const c = this.lossesFor(k);
      sum.wall += c.wall;
      sum.roof += c.roof;
      sum.vent += c.vent;
      sum.total += c.total;
    }
    return sum;
  }
  /** Heat escaping right now through each path, W, summed over rooms. */
  lossWatts(): LossCoefficients {
    const sum = { wall: 0, roof: 0, vent: 0, total: 0 };
    const To = this.params.outdoor;
    this.rooms.forEach((r, k) => {
      const c = this.lossesFor(k);
      const dT = r.T - To;
      sum.wall += c.wall * dT;
      sum.roof += c.roof * dT;
      sum.vent += c.vent * dT;
      sum.total += c.total * dT;
    });
    return sum;
  }
  /** Total fabric loss coefficient of room k, W/K (cached). */
  H(k: number): number {
    if (this.hKey !== this.params.insulation) {
      this.hKey = this.params.insulation;
      for (let r = 0; r < this.rooms.length; r++)
        this.hVal[r] = this.lossesFor(r).total;
    }
    return this.hVal[k];
  }
  trvSetting(k: number): TrvSetting {
    return TRV_SETTINGS[this.params.radiators[k].trvIndex];
  }
  get thermostatRoom(): number {
    return this.plan.thermostatRoom;
  }
  /** Air temperature where the room thermostat hangs. */
  get thermostatT(): number {
    return this.rooms[this.plan.thermostatRoom].T;
  }
  /** Pump flow, L/min. */
  get flowLpm(): number {
    return this.mMain * 60;
  }
  radFlowLpm(k: number): number {
    return this.radFlow[k] * 60;
  }
  /** Flow through all radiators together, L/min. */
  get radiatorFlowLpm(): number {
    return this.radiatorFlow * 60;
  }
  private get radiatorFlow(): number {
    let s = 0;
    for (let k = 0; k < this.radFlow.length; k++) s += this.radFlow[k];
    return s;
  }
  get bypassLpm(): number {
    return this.m[this.circuit.bypass.id] * 60;
  }
  get flowT(): number {
    return this.T[this.circuit.hx];
  }
  radInT(k: number): number {
    return this.T[this.circuit.radiators[k].trvTail.last];
  }
  radOutT(k: number): number {
    return this.T[this.circuit.radiators[k].rad.last];
  }
  get returnT(): number {
    return this.T[this.circuit.returnMain[0].last];
  }
  get efficiency(): number {
    return efficiency(this.returnT);
  }
  get condensing(): boolean {
    return this.returnT < CONDENSING_BELOW;
  }
  /** Rate of change of room k's temperature, °C per hour. */
  roomRatePerHour(k: number): number {
    const r = this.rooms[k];
    const net = r.radW + r.pipeW - r.lossW - r.partitionW;
    return (net / this.plan.rooms[k].heatCapacity) * 3600;
  }

  get status(): SimStatus {
    if (!this.params.boilerOn) return "off";
    if (!this.demand) return this.pumpOn ? "overrun" : "standby";
    if (this.radiatorFlow < 1e-4) return "bypass";
    return this.burnerW > 50 ? "heating" : "idle";
  }

  // ---- Time stepping ----

  /** Advance the simulation by dt seconds of simulated time. */
  advance(dt: number): void {
    let rem = dt;
    while (rem > 1e-9) {
      this.controls();
      const mcp = this.mMain * CP;
      let h = 1.0;
      if (mcp > 0) h = Math.min(h, (0.9 * this.circuit.minC) / mcp); // Courant limit
      h = Math.min(h, rem);
      this.physics(h);
      rem -= h;
      this.time += h;
      this.record(false);
    }
  }

  private controls(): void {
    const p = this.params;
    // Room thermostat: on/off with a switching band; switched off, it never calls.
    const stat = this.thermostatT;
    if (!p.thermostatOn) {
      this.demand = false;
    } else if (this.demand) {
      if (stat >= p.thermostatSet + K.THERMOSTAT_HYST) this.demand = false;
    } else if (stat <= p.thermostatSet - K.THERMOSTAT_HYST) {
      this.demand = true;
    }
    // TRVs: proportional valves, each driven by its own (slow) wax capsule.
    this.rooms.forEach((r, k) => {
      const trv = this.trvSetting(k);
      r.trvOpening =
        trv.target == null
          ? 0
          : clamp(0.5 + (trv.target - r.Tsensor) / K.TRV_PBAND, 0, 1);
    });
    // Pump: runs while there is demand, then for a short overrun.
    // Switched off: the boiler ignores the thermostat and the pump stops.
    if (!p.boilerOn) this.overrun = 0;
    else if (this.demand) this.overrun = K.PUMP_OVERRUN_S;
    this.pumpOn = p.boilerOn && (this.demand || this.overrun > 0);
    // The pump is sized for every radiator's design flow. Each TRV and its
    // lockshield (in series) cut that radiator's share; whatever the
    // radiators don't take goes round through the automatic bypass valve.
    const specs = this.plan.rooms;
    let design = 0;
    for (const s of specs) design += s.radiator.designLpm;
    this.mMain = this.pumpOn ? design / 60 : 0;
    for (let k = 0; k < specs.length; k++) {
      const share = this.pumpOn ? specs[k].radiator.designLpm / 60 : 0;
      this.radFlow[k] =
        share * this.rooms[k].trvOpening * p.radiators[k].lockshield;
    }
    edgeFlows(this.circuit, this.mMain, this.radFlow, this.m);
  }

  private physics(h: number): void {
    const c = this.circuit;
    const { C, UA, kind, ratedW, exponent, up1, up2, link1, link2 } = c;
    const { edgeOf, room, N, hx } = c;
    const { T, Told, q, dE, mcp, m, rooms, radR, pipeR } = this;
    const p = this.params;
    const Tr = this.roomTold;
    for (let r = 0; r < rooms.length; r++) Tr[r] = rooms[r].T;
    for (let e = 0; e < m.length; e++) mcp[e] = m[e] * CP;
    const retLast = c.returnMain[0].last;
    Told.set(T);

    // Burner: modulates to hold the heat-exchanger outlet at the flow set-point.
    let P = 0;
    if (p.boilerOn && this.demand && this.flowLpm >= K.MIN_FLOW_LPM) {
      P =
        mcp[edgeOf[hx]] * (p.flowSet - Told[retLast]) +
        (HX.C * (p.flowSet - Told[hx])) / K.BURNER_TAU_S +
        HX.UA * (Told[hx] - Tr[room[hx]]);
      P = clamp(P, 0, K.BURNER_MAX_W);
    }

    radR.fill(0);
    pipeR.fill(0);
    for (let i = 0; i < N; i++) {
      const d = Told[i] - Tr[room[i]];
      let qi: number;
      if (kind[i] === Kind.RAD) {
        qi = ratedW[i] * Math.sign(d) * Math.pow(Math.abs(d) / 50, exponent[i]);
        radR[room[i]] += qi;
      } else {
        qi = UA[i] * d;
        pipeR[room[i]] += qi;
      }
      let inflow = mcp[link1[i]] * Told[up1[i]];
      if (up2[i] >= 0) inflow += mcp[link2[i]] * Told[up2[i]];
      dE[i] = inflow - mcp[edgeOf[i]] * Told[i] - qi;
      if (i === hx) dE[i] += P;
      q[i] = qi;
    }
    // Heat spreading along the pipes (matters most where water is still).
    const { condA, condB, condG } = c;
    for (let k = 0; k < condG.length; k++) {
      const a = condA[k];
      const b = condB[k];
      const f = condG[k] * (Told[a] - Told[b]);
      dE[a] -= f;
      dE[b] += f;
    }
    for (let i = 0; i < N; i++) T[i] = Told[i] + (dE[i] * h) / C[i];

    // Rooms: radiator and pipe heat in, fabric loss out, and heat through
    // the internal walls to the rooms either side.
    const G = this.plan.partitionUA;
    const last = rooms.length - 1;
    let rad = 0;
    let pipe = 0;
    let loss = 0;
    for (let r = 0; r <= last; r++) {
      const rs = rooms[r];
      const lossR = this.H(r) * (Tr[r] - p.outdoor);
      let part = 0;
      if (r > 0) part += G * (Tr[r] - Tr[r - 1]);
      if (r < last) part += G * (Tr[r] - Tr[r + 1]);
      rs.T =
        Tr[r] +
        ((radR[r] + pipeR[r] - lossR - part) * h) /
          this.plan.rooms[r].heatCapacity;
      rs.Tsensor += ((rs.T - rs.Tsensor) * h) / K.TRV_TAU_S;
      rs.radW = radR[r];
      rs.pipeW = pipeR[r];
      rs.lossW = lossR;
      rs.partitionW = part;
      rad += radR[r];
      pipe += pipeR[r];
      loss += lossR;
    }
    if (!this.demand && this.overrun > 0) this.overrun -= h;

    this.burnerW = P;
    this.radW = rad;
    this.pipeW = pipe;
    this.lossW = loss;
    if (P > 0) this.gasJ += (P / efficiency(Told[retLast])) * h;
    this.heatJ += rad * h;
  }

  private record(force: boolean): void {
    if (!force && this.time < this.nextSample) return;
    this.history.push({
      t: this.time,
      outdoor: this.params.outdoor,
      thermostat: this.params.thermostatSet,
      flow: this.flowT,
      ret: this.returnT,
      demand: this.demand,
      burner: this.burnerW,
      rooms: this.rooms.map((r, k) => ({
        T: r.T,
        trv: this.trvSetting(k).target,
      })),
    });
    if (this.history.length > 24 * 60 + 1) this.history.shift();
    this.nextSample = Math.floor(this.time / 60) * 60 + 60;
  }

  // ---- Analysis helpers ----

  /**
   * Heat given to the room by the water on its way from the boiler through
   * radiator k and back, at a steady flow `mdot` (TRV fully open).
   */
  private loopHeat(
    k: number,
    flowT: number,
    roomT: number,
    mdot: number,
  ): number {
    const c = this.circuit;
    const mcp = mdot * CP;
    let t = flowT;
    let total = 0;
    for (const i of this.paths[k]) {
      const d = t - roomT;
      const qi =
        c.kind[i] === Kind.RAD
          ? c.ratedW[i] *
            Math.sign(d) *
            Math.pow(Math.abs(d) / 50, c.exponent[i])
          : c.UA[i] * d;
      total += qi;
      t -= qi / mcp;
    }
    return total;
  }

  /**
   * Room temperature at which radiator k (TRV fully open) exactly balances
   * that room's fabric loss. Ignores heat traded with neighbouring rooms.
   */
  maxAchievableRoomTemp(k: number): number {
    const H = this.H(k);
    const To = this.params.outdoor;
    const Tf = this.params.flowSet;
    const mdot =
      (this.plan.rooms[k].radiator.designLpm / 60) *
      this.params.radiators[k].lockshield;
    let lo = To;
    let hi = Math.max(To, Tf);
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      const f = this.loopHeat(k, Tf, mid, mdot) - H * (mid - To);
      if (f > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Where room k should settle, and which control is the limiting one. */
  expectedRoomTemp(k: number): { t: number; by: Limiter; cap: number } {
    const p = this.params;
    const trv = this.trvSetting(k);
    const cap = this.maxAchievableRoomTemp(k);
    if (!p.boilerOn || !p.thermostatOn) return { t: p.outdoor, by: "off", cap };
    const options: { t: number; by: Limiter }[] = [];
    if (k === this.plan.thermostatRoom)
      options.push({ by: "thermostat", t: p.thermostatSet });
    options.push({ by: "radiator", t: cap });
    options.push(
      trv.target == null
        ? { by: "trv-shut", t: p.outdoor }
        : { by: "trv", t: trv.target },
    );
    options.sort((a, b) => a.t - b.t);
    return { ...options[0], cap };
  }
}
