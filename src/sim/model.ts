/*
 * Heating system physics model.
 *
 * The water circuit is a set of "cells" (small slugs of water plus the metal
 * around them) joined into a loop with two parallel branches:
 *
 *   boiler -> flow pipe -> (A) -+-> TRV tail -> radiator -> lockshield tail -+-> (B) -> return pipe -> boiler
 *                               +-----> bypass pipe (automatic bypass valve) --+
 *
 * The pump pushes a fixed flow round the main loop. The TRV decides how much of
 * it goes through the radiator; the automatic bypass valve passes the rest, so
 * water keeps circulating even when the TRV is fully shut.
 *
 * Each sub-step: water is advected cell to cell (upwind finite volume, with
 * mixing where the branches rejoin), every cell exchanges heat with the room,
 * the burner heats the HX cell, and the room loses heat through the fabric.
 */

export const CP = 4186; // J/(kg·K) specific heat of water

// ---- Equipment & building constants --------------------------------------
export const K = {
  FLOW_CELLS: 60,
  FLOW_LEN_M: 7.5, // 15 mm copper, boiler -> junction under the radiator
  TAIL_CELLS: 5,
  TAIL_LEN_M: 0.55, // each radiator tail (TRV side, lockshield side)
  BYPASS_CELLS: 24,
  BYPASS_LEN_M: 3.0, // bypass pipe under the radiator
  RETURN_CELLS: 96,
  RETURN_LEN_M: 12.0, // junction -> boiler
  RAD_LAYERS: 12,
  PIPE_C_PER_M: 665, // J/(m·K): 0.133 kg water + 0.28 kg copper per metre
  PIPE_L_PER_M: 0.133, // litres of water per metre of 15 mm pipe
  PIPE_UA_PER_M: 0.15, // W/(m·K): lagged pipe in the floor void
  // Heat creeping along a pipe: conduction in the copper wall plus warm
  // water swirling a short way into still branches (effective k·A).
  PIPE_AXIAL_KA: 0.04, // W·m/K

  HX_C: 11000, // J/K: ~1.2 L water + heat-exchanger metal
  HX_UA: 1.5, // W/K casing loss
  BURNER_MAX_W: 24000, // combi CH output
  BURNER_TAU_S: 20, // how hard the burner chases the set-point
  MIN_FLOW_LPM: 0.15, // below this the boiler won't fire

  MAX_FLOW_LPM: 2.0, // pump flow, shared between radiator and bypass
  PUMP_OVERRUN_S: 120, // pump keeps running after the burner stops

  RAD_RATED_W: 1600, // double panel 1200 x 600, output at ΔT50 (EN 442)
  RAD_EXPONENT: 1.3,
  RAD_WATER_L: 6,
  RAD_STEEL_KG: 22,

  ROOM: {
    width: 4,
    depth: 4,
    height: 2.5,
    extWallArea: 10, // 4 m x 2.5 m, no window
    ceilingArea: 16,
    volume: 40,
  },
  ROOM_C: 1.0e6, // J/K effective (air + furniture + inner wall surfaces)

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

/** Heat-loss coefficients in W/K for each path out of the room. */
export function lossCoefficients(ins: Insulation): LossCoefficients {
  const R = K.ROOM;
  const wall = ins.wall.U * R.extWallArea;
  const roof = ins.loft.U * R.ceilingArea;
  const vent = 0.33 * ins.ach * R.volume; // 0.33 Wh/(m³·K) for air
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
export const Kind = { HX: 0, FLOW: 1, RAD: 2, RET: 3, BYP: 4 } as const;

/** Which part of the circuit a cell belongs to (for labels and tooltips). */
export type Segment =
  "hx" | "flow" | "trvTail" | "rad" | "lsTail" | "bypass" | "ret";

// Branch whose flow rate a cell carries.
const MAIN = 0;
const RADB = 1;
const BYPB = 2;

export interface SimParams {
  flowSet: number; // °C boiler flow temperature
  thermostatSet: number; // °C room thermostat
  trvIndex: number; // index into TRV_SETTINGS
  insulation: InsulationKey;
  outdoor: number; // °C
  boilerOn: boolean; // master power switch
  thermostatOn: boolean; // thermostat heating on/off
  lockshield: number; // lockshield opening, 0.1..1 (10% steps)
}

export interface HistorySample {
  t: number;
  room: number;
  outdoor: number;
  thermostat: number;
  trv: number | null;
  flow: number;
  ret: number;
  demand: boolean;
  burner: number;
}

export type SimStatus =
  "off" | "standby" | "overrun" | "bypass" | "heating" | "idle";

export type Limiter = "thermostat" | "radiator" | "trv" | "trv-shut" | "off";

interface Range {
  first: number;
  last: number;
}

export class Sim {
  readonly N: number;
  readonly idx: {
    hx: number;
    flow: Range;
    trvTail: Range;
    rad: Range;
    lsTail: Range;
    bypass: Range;
    ret: Range;
  };
  readonly kind: Uint8Array;
  readonly C: Float64Array;
  readonly UA: Float64Array;
  readonly T: Float64Array;
  readonly q: Float64Array; // W into the room, per cell
  private readonly Told: Float64Array;
  private readonly branch: Uint8Array; // flow branch each cell carries
  private readonly up1: Int16Array; // upstream cell
  private readonly up2: Int16Array; // second upstream (merge junction) or -1
  private readonly link1: Uint8Array; // branch whose flow crosses link up1 -> i
  private readonly link2: Uint8Array;
  private readonly series: number[]; // radiator path, for steady-state analysis
  private readonly dE: Float64Array; // per-cell energy change, scratch
  private readonly mcp = new Float64Array(3); // m·cp per branch, scratch
  private hKey = ""; // insulation level the cached H was computed for
  private hVal = 0;
  private readonly condA: Int16Array; // pipe-to-pipe conduction links...
  private readonly condB: Int16Array;
  private readonly condG: Float64Array; // ...and their conductance, W/K
  private readonly minC: number;
  private readonly radLayerRated: number;

  params: SimParams = {
    flowSet: 65,
    thermostatSet: 20,
    trvIndex: 5, // setting "4" ≈ 24 °C
    insulation: "average",
    outdoor: 5,
    boilerOn: true,
    thermostatOn: false, // page opens with the thermostat off
    lockshield: 1,
  };

  time = 0; // seconds since day 1, 00:00
  Troom = 14;
  Tsensor = 14; // TRV wax capsule
  demand = false;
  overrun = 0;
  pumpOn = false;
  mMain = 0; // kg/s through the pump (1 L ≈ 1 kg)
  mRad = 0; // kg/s through the TRV and radiator
  mByp = 0; // kg/s through the bypass
  trvOpening = 0; // 0..1
  burnerW = 0;
  radW = 0;
  pipeW = 0;
  lossW = 0;
  gasJ = 0;
  heatJ = 0;
  history: HistorySample[] = [];
  private nextSample = 0;

  constructor() {
    // Lay out the cells segment by segment.
    let n = 0;
    const take = (count: number): Range => {
      const r = { first: n, last: n + count - 1 };
      n += count;
      return r;
    };
    const hx = take(1).first;
    const flow = take(K.FLOW_CELLS);
    const trvTail = take(K.TAIL_CELLS);
    const rad = take(K.RAD_LAYERS);
    const lsTail = take(K.TAIL_CELLS);
    const bypass = take(K.BYPASS_CELLS);
    const ret = take(K.RETURN_CELLS);
    this.N = n;
    this.idx = { hx, flow, trvTail, rad, lsTail, bypass, ret };

    const N = this.N;
    this.kind = new Uint8Array(N);
    this.C = new Float64Array(N);
    this.UA = new Float64Array(N);
    this.T = new Float64Array(N);
    this.Told = new Float64Array(N);
    this.q = new Float64Array(N);
    this.branch = new Uint8Array(N);
    this.up1 = new Int16Array(N);
    this.up2 = new Int16Array(N).fill(-1);
    this.link1 = new Uint8Array(N);
    this.link2 = new Uint8Array(N);
    this.radLayerRated = K.RAD_RATED_W / K.RAD_LAYERS;

    const pipe = (r: Range, lenM: number, kind: number, br: number) => {
      const cells = r.last - r.first + 1;
      for (let i = r.first; i <= r.last; i++) {
        this.kind[i] = kind;
        this.branch[i] = br;
        this.C[i] = (lenM / cells) * K.PIPE_C_PER_M;
        this.UA[i] = (K.PIPE_UA_PER_M * lenM) / cells;
        this.up1[i] = i - 1;
      }
    };
    this.kind[hx] = Kind.HX;
    this.C[hx] = K.HX_C;
    this.UA[hx] = K.HX_UA;
    this.up1[hx] = ret.last;
    pipe(flow, K.FLOW_LEN_M, Kind.FLOW, MAIN);
    pipe(trvTail, K.TAIL_LEN_M, Kind.FLOW, RADB);
    pipe(lsTail, K.TAIL_LEN_M, Kind.RET, RADB);
    pipe(bypass, K.BYPASS_LEN_M, Kind.BYP, BYPB);
    pipe(ret, K.RETURN_LEN_M, Kind.RET, MAIN);
    const radLayerC =
      (K.RAD_WATER_L * CP + K.RAD_STEEL_KG * 460) / K.RAD_LAYERS;
    for (let i = rad.first; i <= rad.last; i++) {
      this.kind[i] = Kind.RAD;
      this.branch[i] = RADB;
      this.C[i] = radLayerC;
      this.up1[i] = i - 1;
    }
    // Junction A (end of flow pipe) splits into the TRV tail and the bypass.
    this.up1[trvTail.first] = flow.last;
    this.up1[bypass.first] = flow.last;
    // Junction B (start of return) merges the lockshield tail and the bypass.
    this.up1[ret.first] = lsTail.last;
    this.up2[ret.first] = bypass.last;

    // A link carries the downstream branch's flow at a split and the upstream
    // branch's flow at a merge.
    for (let i = 0; i < N; i++) {
      this.link1[i] =
        this.branch[i] === MAIN ? this.branch[this.up1[i]] : this.branch[i];
      if (this.up2[i] >= 0) this.link2[i] = this.branch[this.up2[i]];
    }

    // Conduction links between neighbouring pipe cells, including across
    // both tees, so warmth spreads into a branch even when it isn't flowing.
    const isPipe = (i: number) => this.kind[i] !== Kind.RAD && i !== hx;
    const links: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      if (!isPipe(i)) continue;
      for (const u of [this.up1[i], this.up2[i]]) {
        if (u < 0 || !isPipe(u)) continue;
        const dx = (this.C[u] + this.C[i]) / 2 / K.PIPE_C_PER_M;
        links.push([u, i, K.PIPE_AXIAL_KA / dx]);
      }
    }
    this.condA = Int16Array.from(links, (l) => l[0]);
    this.condB = Int16Array.from(links, (l) => l[1]);
    this.condG = Float64Array.from(links, (l) => l[2]);
    this.dE = new Float64Array(N);

    const range = (r: Range) =>
      Array.from({ length: r.last - r.first + 1 }, (_, k) => r.first + k);
    this.series = [
      ...range(flow),
      ...range(trvTail),
      ...range(rad),
      ...range(lsTail),
      ...range(ret),
    ];
    this.minC = Math.min(...this.C);
    this.reset(this.params.outdoor); // cold start: everything at outside temperature
  }

  reset(startTemp = 14): void {
    this.time = 6 * 3600; // day 1, 06:00
    this.T.fill(startTemp);
    this.Troom = startTemp;
    this.Tsensor = startTemp;
    this.demand = false;
    this.overrun = 0;
    this.pumpOn = false;
    this.mMain = this.mRad = this.mByp = 0;
    this.trvOpening = 0;
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

  segment(i: number): Segment {
    const x = this.idx;
    const inR = (r: Range) => i >= r.first && i <= r.last;
    if (i === x.hx) return "hx";
    if (inR(x.flow)) return "flow";
    if (inR(x.trvTail)) return "trvTail";
    if (inR(x.rad)) return "rad";
    if (inR(x.lsTail)) return "lsTail";
    if (inR(x.bypass)) return "bypass";
    return "ret";
  }

  /** Flow (L/min) through the part of the circuit that cell i is in. */
  cellFlowLpm(i: number): number {
    const b = this.branch[i];
    return (b === MAIN ? this.mMain : b === RADB ? this.mRad : this.mByp) * 60;
  }

  get insulation(): Insulation {
    return INSULATION[this.params.insulation];
  }
  get losses(): LossCoefficients {
    return lossCoefficients(this.insulation);
  }
  get H(): number {
    if (this.hKey !== this.params.insulation) {
      this.hKey = this.params.insulation;
      this.hVal = this.losses.total;
    }
    return this.hVal;
  }
  get trvSetting(): TrvSetting {
    return TRV_SETTINGS[this.params.trvIndex];
  }
  /** Pump flow, L/min. */
  get flowLpm(): number {
    return this.mMain * 60;
  }
  get radFlowLpm(): number {
    return this.mRad * 60;
  }
  get bypassLpm(): number {
    return this.mByp * 60;
  }
  get flowT(): number {
    return this.T[this.idx.hx];
  }
  get radInT(): number {
    return this.T[this.idx.trvTail.last];
  }
  get radOutT(): number {
    return this.T[this.idx.rad.last];
  }
  get returnT(): number {
    return this.T[this.idx.ret.last];
  }
  get efficiency(): number {
    return efficiency(this.returnT);
  }
  get condensing(): boolean {
    return this.returnT < CONDENSING_BELOW;
  }
  /** Rate of change of room temperature, °C per hour. */
  get roomRatePerHour(): number {
    return ((this.radW + this.pipeW - this.lossW) / K.ROOM_C) * 3600;
  }

  get status(): SimStatus {
    if (!this.params.boilerOn) return "off";
    if (!this.demand) return this.pumpOn ? "overrun" : "standby";
    if (this.mRad < 1e-4) return "bypass";
    return this.burnerW > 50 ? "heating" : "idle";
  }

  /** Advance the simulation by dt seconds of simulated time. */
  advance(dt: number): void {
    let rem = dt;
    while (rem > 1e-9) {
      this.controls();
      const mcp = this.mMain * CP;
      let h = 1.0;
      if (mcp > 0) h = Math.min(h, (0.9 * this.minC) / mcp); // Courant limit
      h = Math.min(h, rem);
      this.physics(h);
      rem -= h;
      this.time += h;
      this.record(false);
    }
  }

  private controls(): void {
    const p = this.params;
    // Room thermostat: simple on/off with a switching band.
    // Room thermostat: on/off with a switching band; switched off, it never calls.
    if (!p.thermostatOn) {
      this.demand = false;
    } else if (this.demand) {
      if (this.Troom >= p.thermostatSet + K.THERMOSTAT_HYST)
        this.demand = false;
    } else if (this.Troom <= p.thermostatSet - K.THERMOSTAT_HYST) {
      this.demand = true;
    }
    // TRV: proportional valve driven by its own (slow) wax capsule.
    const trv = this.trvSetting;
    this.trvOpening =
      trv.target == null
        ? 0
        : clamp(0.5 + (trv.target - this.Tsensor) / K.TRV_PBAND, 0, 1);
    // Pump: runs while there is demand, then for a short overrun. Whatever the
    // TRV doesn't pass goes round through the automatic bypass valve.
    // Switched off: the boiler ignores the thermostat and the pump stops.
    if (!p.boilerOn) this.overrun = 0;
    else if (this.demand) this.overrun = K.PUMP_OVERRUN_S;
    this.pumpOn = p.boilerOn && (this.demand || this.overrun > 0);
    this.mMain = this.pumpOn ? K.MAX_FLOW_LPM / 60 : 0;
    // TRV and lockshield are in series: the lockshield caps the radiator flow.
    this.mRad = this.mMain * this.trvOpening * p.lockshield;
    this.mByp = this.mMain - this.mRad;
  }

  private physics(h: number): void {
    const { T, Told, C, UA, kind, q, N, up1, up2, link1, link2, branch, dE } =
      this;
    const p = this.params;
    const Tr = this.Troom;
    const mcp = this.mcp;
    mcp[MAIN] = this.mMain * CP;
    mcp[RADB] = this.mRad * CP;
    mcp[BYPB] = this.mByp * CP;
    const hx = this.idx.hx;
    const retLast = this.idx.ret.last;
    Told.set(T);

    // Burner: modulates to hold the heat-exchanger outlet at the flow set-point.
    let P = 0;
    if (p.boilerOn && this.demand && this.flowLpm >= K.MIN_FLOW_LPM) {
      P =
        mcp[MAIN] * (p.flowSet - Told[retLast]) +
        (K.HX_C * (p.flowSet - Told[hx])) / K.BURNER_TAU_S +
        K.HX_UA * (Told[hx] - Tr);
      P = clamp(P, 0, K.BURNER_MAX_W);
    }

    let rad = 0;
    let pipe = 0;
    const rated = this.radLayerRated;
    const n = K.RAD_EXPONENT;
    for (let i = 0; i < N; i++) {
      const d = Told[i] - Tr;
      let qi: number;
      if (kind[i] === Kind.RAD) {
        qi = rated * Math.sign(d) * Math.pow(Math.abs(d) / 50, n);
        rad += qi;
      } else {
        qi = UA[i] * d;
        pipe += qi;
      }
      let inflow = mcp[link1[i]] * Told[up1[i]];
      if (up2[i] >= 0) inflow += mcp[link2[i]] * Told[up2[i]];
      dE[i] = inflow - mcp[branch[i]] * Told[i] - qi;
      if (i === hx) dE[i] += P;
      q[i] = qi;
    }
    // Heat spreading along the pipes (matters most where water is still).
    const { condA, condB, condG } = this;
    for (let k = 0; k < condG.length; k++) {
      const a = condA[k];
      const b = condB[k];
      const f = condG[k] * (Told[a] - Told[b]);
      dE[a] -= f;
      dE[b] += f;
    }
    for (let i = 0; i < N; i++) T[i] = Told[i] + (dE[i] * h) / C[i];

    const loss = this.H * (Tr - p.outdoor);
    this.Troom = Tr + ((rad + pipe - loss) * h) / K.ROOM_C;
    this.Tsensor += ((this.Troom - this.Tsensor) * h) / K.TRV_TAU_S;
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
      room: this.Troom,
      outdoor: this.params.outdoor,
      thermostat: this.params.thermostatSet,
      trv: this.trvSetting.target,
      flow: this.flowT,
      ret: this.returnT,
      demand: this.demand,
      burner: this.burnerW,
    });
    if (this.history.length > 24 * 60 + 1) this.history.shift();
    this.nextSample = Math.floor(this.time / 60) * 60 + 60;
  }

  // ---- Analysis helpers ----

  /** Heat given to the room with the TRV fully open (no bypass flow). */
  private loopHeat(flowT: number, roomT: number, mdot: number): number {
    const mcp = mdot * CP;
    let t = flowT;
    let total = 0;
    for (const i of this.series) {
      const d = t - roomT;
      const qi =
        this.kind[i] === Kind.RAD
          ? this.radLayerRated *
            Math.sign(d) *
            Math.pow(Math.abs(d) / 50, K.RAD_EXPONENT)
          : this.UA[i] * d;
      total += qi;
      t -= qi / mcp;
    }
    return total;
  }

  /** Room temperature at which the radiator (TRV fully open) exactly balances fabric loss. */
  maxAchievableRoomTemp(): number {
    const H = this.H;
    const To = this.params.outdoor;
    const Tf = this.params.flowSet;
    const mdot = (K.MAX_FLOW_LPM / 60) * this.params.lockshield;
    let lo = To;
    let hi = Math.max(To, Tf);
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const f = this.loopHeat(Tf, mid, mdot) - H * (mid - To);
      if (f > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Where the room should settle, and which control is the limiting one. */
  expectedRoomTemp(): { t: number; by: Limiter; cap: number } {
    const p = this.params;
    const trv = this.trvSetting;
    const cap = this.maxAchievableRoomTemp();
    if (!p.boilerOn || !p.thermostatOn) return { t: p.outdoor, by: "off", cap };
    const options: { t: number; by: Limiter }[] = [
      { by: "thermostat", t: p.thermostatSet },
      { by: "radiator", t: cap },
      trv.target == null
        ? { by: "trv-shut", t: p.outdoor }
        : { by: "trv", t: trv.target },
    ];
    options.sort((a, b) => a.t - b.t);
    return { ...options[0], cap };
  }
}
