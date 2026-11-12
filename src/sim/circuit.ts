/*
 * Builds the water circuit from a house plan.
 *
 * The circuit is a chain of "cells" (small slugs of water plus the metal
 * around them), grouped into edges: one per stretch of pipe, radiator or the
 * boiler's heat exchanger. Every cell has one upstream cell, or two where
 * branches merge, so the solver in model.ts works on any plan without knowing
 * its shape.
 *
 * The plan is a two-pipe system (see house/plan.ts). Cell order: heat
 * exchanger, flow pipe [0], then for each radiator k its TRV tail, radiator
 * and lockshield tail followed by flow pipe [k+1]; then the open bypass at
 * the end of the flow pipe, and the return pipe from the far end back to
 * the boiler. Every cell comes after the cells that feed it, so one pass in
 * cell order follows the water.
 */
import type { HousePlan, PipeSpec } from "../house/plan";

export const CP = 4186; // J/(kg·K) specific heat of water

/** Pipe properties shared by every run of 15 mm copper. */
export const PIPE = {
  C_PER_M: 665, // J/(m·K): 0.133 kg water + 0.28 kg copper per metre
  L_PER_M: 0.133, // litres of water per metre
  UA_PER_M: 0.15, // W/(m·K): lagged pipe in the floor void
  // Heat creeping along a pipe: conduction in the copper wall plus warm
  // water swirling a short way into still branches (effective k·A).
  AXIAL_KA: 0.04, // W·m/K
} as const;

export const HX = {
  C: 11000, // J/K: ~1.2 L water + heat-exchanger metal
  UA: 1.5, // W/K casing loss
} as const;

const STEEL_CP = 460; // J/(kg·K)

export const Kind = { HX: 0, PIPE: 1, RAD: 2 } as const;

/** What part of the circuit an edge is. */
export type EdgeRole =
  "hx" | "flow" | "trvTail" | "rad" | "lsTail" | "bypass" | "ret";

export interface Edge {
  id: number;
  role: EdgeRole;
  /**
   * Radiator index for trvTail / rad / lsTail; section index for the flow
   * and return pipes ([k] reaches radiator k's tee); else 0.
   */
  n: number;
  /** Room whose air this edge gives its heat to. */
  room: number;
  first: number;
  last: number;
  cells: number;
  lenM: number; // 0 for the heat exchanger and radiators
  /** Water enters this edge where two branches merge. */
  startsAtMerge: boolean;
}

export interface CellInfo {
  edge: Edge;
  role: EdgeRole;
  room: number;
  /** Radiator the cell belongs to (its tails and panel), or -1. */
  radiator: number;
  /** Position of the cell within its edge, 0 = upstream end. */
  index: number;
  /** Distance of the cell's centre from the upstream end of its edge, m. */
  alongM: number;
}

export interface RadiatorEdges {
  trvTail: Edge;
  rad: Edge;
  lsTail: Edge;
}

export class Circuit {
  readonly N: number; // cells
  readonly edges: Edge[] = [];
  readonly hx: number; // heat-exchanger cell
  /** [0] boiler → radiator 1's tee; [k] tee k-1 → tee k. */
  readonly flowMain: Edge[] = [];
  /** [0] radiator 1's tee → boiler; [k] tee k → tee k-1. */
  readonly returnMain: Edge[] = [];
  readonly radiators: RadiatorEdges[] = [];
  /** Open pipe from the end of the flow pipe into the return. */
  readonly bypass: Edge;

  readonly edgeOf: Uint8Array;
  readonly kind: Uint8Array;
  readonly room: Uint8Array; // room each cell's heat goes to
  readonly C: Float64Array; // J/K
  readonly UA: Float64Array; // W/K to the room (pipes, heat exchanger)
  readonly ratedW: Float64Array; // radiator output at ΔT50 (radiator layers)
  readonly exponent: Float64Array; // radiator exponent (radiator layers)
  readonly up1: Int16Array; // upstream cell
  readonly up2: Int16Array; // second upstream (merge) or -1
  readonly link1: Uint8Array; // edge whose flow crosses link up1 -> i
  readonly link2: Uint8Array;
  readonly condA: Int16Array; // pipe-to-pipe conduction links...
  readonly condB: Int16Array;
  readonly condG: Float64Array; // ...and their conductance, W/K
  readonly minC: number;

  constructor(plan: HousePlan) {
    const R = plan.rooms.length;
    const last = R - 1;

    // ---- edges, in cell order ----
    let n = 0;
    const add = (
      role: EdgeRole,
      idx: number,
      room: number,
      cells: number,
      lenM: number,
      startsAtMerge = false,
    ): Edge => {
      const e: Edge = {
        id: this.edges.length,
        role,
        n: idx,
        room,
        first: n,
        last: n + cells - 1,
        cells,
        lenM,
        startsAtMerge,
      };
      n += cells;
      this.edges.push(e);
      return e;
    };
    const pipe = (role: EdgeRole, idx: number, room: number, p: PipeSpec) =>
      add(role, idx, room, p.cells, p.lenM);

    const hxEdge = add("hx", 0, 0, 1, 0);
    this.hx = hxEdge.first;
    this.flowMain.push(pipe("flow", 0, 0, plan.flowMain[0]));
    for (let k = 0; k < R; k++) {
      const rad = plan.rooms[k].radiator;
      this.radiators.push({
        trvTail: pipe("trvTail", k, k, plan.tail),
        rad: add("rad", k, k, rad.layers, 0),
        lsTail: pipe("lsTail", k, k, plan.tail),
      });
      if (k < last)
        this.flowMain.push(pipe("flow", k + 1, k + 1, plan.flowMain[k + 1]));
    }
    this.bypass = pipe("bypass", 0, last, plan.bypass);
    const ret: Edge[] = [];
    for (let k = last; k >= 0; k--) {
      const p = plan.returnMain[k];
      ret[k] = add("ret", k, k, p.cells, p.lenM, true);
    }
    this.returnMain.push(...ret);
    this.N = n;

    // ---- per-cell arrays ----
    const N = n;
    this.edgeOf = new Uint8Array(N);
    this.kind = new Uint8Array(N);
    this.room = new Uint8Array(N);
    this.C = new Float64Array(N);
    this.UA = new Float64Array(N);
    this.ratedW = new Float64Array(N);
    this.exponent = new Float64Array(N);
    this.up1 = new Int16Array(N);
    this.up2 = new Int16Array(N).fill(-1);
    this.link1 = new Uint8Array(N);
    this.link2 = new Uint8Array(N);

    for (const e of this.edges)
      for (let i = e.first; i <= e.last; i++) {
        this.edgeOf[i] = e.id;
        this.room[i] = e.room;
        this.up1[i] = i - 1;
        if (e.role === "hx") {
          this.kind[i] = Kind.HX;
          this.C[i] = HX.C;
          this.UA[i] = HX.UA;
        } else if (e.role === "rad") {
          const spec = plan.rooms[e.n].radiator;
          this.kind[i] = Kind.RAD;
          this.C[i] =
            (spec.waterL * CP + spec.steelKg * STEEL_CP) / spec.layers;
          this.ratedW[i] = spec.ratedW / spec.layers;
          this.exponent[i] = spec.exponent;
        } else {
          this.kind[i] = Kind.PIPE;
          this.C[i] = (e.lenM / e.cells) * PIPE.C_PER_M;
          this.UA[i] = (PIPE.UA_PER_M * e.lenM) / e.cells;
        }
      }

    // ---- joins between edges ----
    const up = (e: Edge, from: Edge, from2?: Edge) => {
      this.up1[e.first] = from.last;
      if (from2) this.up2[e.first] = from2.last;
    };
    up(hxEdge, this.returnMain[0]);
    up(this.flowMain[0], hxEdge);
    for (let k = 0; k < R; k++) {
      const r = this.radiators[k];
      // Tee in the flow pipe: up to the TRV, or on along the flow pipe.
      up(r.trvTail, this.flowMain[k]);
      if (k < last) up(this.flowMain[k + 1], this.flowMain[k]);
      up(r.rad, r.trvTail);
      up(r.lsTail, r.rad);
    }
    // Past the last radiator the flow pipe carries on into the return.
    up(this.bypass, this.flowMain[last]);
    // Tees in the return pipe: each radiator's lockshield tail drops into
    // the water coming back from further along (the bypass, at the far end).
    for (let k = 0; k < R; k++)
      up(
        this.returnMain[k],
        this.radiators[k].lsTail,
        k === last ? this.bypass : this.returnMain[k + 1],
      );

    // A link carries the downstream edge's flow, except at a merge where
    // each incoming link carries its own upstream edge's flow.
    for (let i = 0; i < N; i++) {
      const e = this.edges[this.edgeOf[i]];
      const merge = e.startsAtMerge && i === e.first;
      this.link1[i] = merge ? this.edgeOf[this.up1[i]] : e.id;
      if (this.up2[i] >= 0) this.link2[i] = this.edgeOf[this.up2[i]];
    }

    // Conduction links between neighbouring pipe cells, including across
    // the tees, so warmth spreads into a branch even when it isn't flowing.
    const isPipe = (i: number) => this.kind[i] === Kind.PIPE;
    const links: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      if (!isPipe(i)) continue;
      for (const u of [this.up1[i], this.up2[i]]) {
        if (u < 0 || !isPipe(u)) continue;
        const dx = (this.C[u] + this.C[i]) / 2 / PIPE.C_PER_M;
        links.push([u, i, PIPE.AXIAL_KA / dx]);
      }
    }
    this.condA = Int16Array.from(links, (l) => l[0]);
    this.condB = Int16Array.from(links, (l) => l[1]);
    this.condG = Float64Array.from(links, (l) => l[2]);
    this.minC = Math.min(...this.C);
  }

  /** The edge with this role; `n` picks the radiator or pipe section. */
  edge(role: EdgeRole, n = 0): Edge {
    switch (role) {
      case "hx":
        return this.edges[this.edgeOf[this.hx]];
      case "flow":
        return this.flowMain[n];
      case "ret":
        return this.returnMain[n];
      case "bypass":
        return this.bypass;
      case "trvTail":
      case "rad":
      case "lsTail":
        return this.radiators[n][role];
    }
  }

  cellInfo(i: number): CellInfo {
    const edge = this.edges[this.edgeOf[i]];
    const index = i - edge.first;
    const onRadiator =
      edge.role === "trvTail" || edge.role === "rad" || edge.role === "lsTail";
    return {
      edge,
      role: edge.role,
      room: edge.room,
      radiator: onRadiator ? edge.n : -1,
      index,
      alongM: ((index + 0.5) / edge.cells) * edge.lenM,
    };
  }
}
