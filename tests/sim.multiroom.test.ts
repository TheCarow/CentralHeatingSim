/*
 * Invariants that must hold for any house plan, not just the one-room
 * baseline: water is conserved at every join, energy is conserved overall,
 * and a row of rooms behaves physically.
 */
import { describe, expect, it } from "vitest";
import { MAX_ROOMS, makePlan } from "../src/house/plan";
import { flowImbalance } from "../src/sim/hydraulics";
import { Sim } from "../src/sim/model";

const ROOM_COUNTS = Array.from({ length: MAX_ROOMS }, (_, i) => i + 1);

/** Stored heat in the water, metal and room air, J (relative to 0 °C). */
function storedEnergy(sim: Sim): number {
  let e = 0;
  for (let i = 0; i < sim.N; i++) e += sim.circuit.C[i] * sim.T[i];
  sim.rooms.forEach((r, k) => (e += sim.plan.rooms[k].heatCapacity * r.T));
  return e;
}

describe.each(ROOM_COUNTS)("%i room(s)", (n) => {
  it("builds one radiator branch per room", () => {
    const sim = new Sim(makePlan(n));
    expect(sim.rooms).toHaveLength(n);
    expect(sim.params.radiators).toHaveLength(n);
    expect(sim.circuit.radiators).toHaveLength(n);
    expect(sim.circuit.flowMain).toHaveLength(n);
    expect(sim.circuit.returnMain).toHaveLength(n);
    // every cell belongs to exactly one edge, in order, with no gaps
    let next = 0;
    for (const e of sim.circuit.edges) {
      expect(e.first).toBe(next);
      next = e.last + 1;
    }
    expect(next).toBe(sim.N);
  });

  it("conserves water at every join", () => {
    const sim = new Sim(makePlan(n));
    sim.params.thermostatOn = true;
    const rand = mulberry32(n);
    for (let trial = 0; trial < 50; trial++) {
      for (const r of sim.params.radiators) {
        r.trvIndex = Math.floor(rand() * 7);
        r.lockshield = Math.round(1 + rand() * 9) / 10;
      }
      sim.advance(30);
      expect(flowImbalance(sim.circuit, sim.m)).toBeLessThan(1e-12);
      // Some water always goes round the bypass; it never takes more than the pump.
      expect(sim.bypassLpm).toBeGreaterThan(0);
      expect(sim.radiatorFlowLpm + sim.bypassLpm).toBeCloseTo(sim.flowLpm, 12);
    }
  });

  it("conserves energy: stored heat changes by burner input minus fabric loss", () => {
    const sim = new Sim(makePlan(n));
    sim.params.thermostatOn = true;
    sim.params.thermostatSet = 30; // keep the burner firing
    sim.params.radiators.forEach((r, k) => (r.trvIndex = k === 1 ? 0 : 6));
    let e0 = storedEnergy(sim);
    let worst = 0;
    // 0.1 s is below the Courant step, so each advance() is one physics step
    // and burnerW / lossW are that step's values.
    for (let s = 0; s < 20000; s++) {
      sim.advance(0.1);
      const e1 = storedEnergy(sim);
      const expected = (sim.burnerW - sim.lossW) * 0.1;
      worst = Math.max(worst, Math.abs(e1 - e0 - expected));
      e0 = e1;
    }
    expect(sim.burnerW).toBeGreaterThan(0);
    expect(worst).toBeLessThan(1e-3); // J per step, against ~1e8 J stored
  });
});

describe("a row of three rooms", () => {
  const run = (setup?: (sim: Sim) => void) => {
    const sim = new Sim(makePlan(3));
    sim.params.thermostatOn = true;
    sim.params.thermostatSet = 21;
    setup?.(sim);
    sim.advance(6 * 3600);
    return sim;
  };

  it("warms every room; the end room, with the gable wall, is coolest", () => {
    const sim = run();
    const [a, b, c] = sim.rooms.map((r) => r.T);
    for (const t of [a, b, c]) expect(t).toBeGreaterThan(15);
    // Room 1 also gets the heat from the long mains run to the boiler.
    expect(a).toBeGreaterThan(c);
    expect(b).toBeGreaterThan(c);
    expect(sim.plan.rooms[2].extWallM2).toBeGreaterThan(0);
    expect(sim.plan.rooms[1].extWallM2).toBe(0);
  });

  it("still warms a room with its TRV shut, through the walls either side", () => {
    const shut = run((sim) => (sim.params.radiators[1].trvIndex = 0));
    const open = run();
    expect(shut.rooms[1].T).toBeLessThan(open.rooms[1].T - 1);
    expect(shut.rooms[1].T).toBeGreaterThan(shut.params.outdoor + 3);
    expect(shut.radFlowLpm(1)).toBe(0);
  });

  it("keeps water moving round the bypass with every TRV shut", () => {
    const sim = new Sim(makePlan(3));
    sim.params.thermostatOn = true;
    sim.params.radiators.forEach((r) => (r.trvIndex = 0));
    sim.advance(60);
    expect(sim.status).toBe("bypass");
    expect(sim.flowLpm).toBeCloseTo(8, 12); // 2 L/min per radiator + bypass
    expect(sim.bypassLpm).toBeCloseTo(sim.flowLpm, 12);
  });

  it("shares the pump flow between radiators and bypass by how open they are", () => {
    const sim = new Sim(makePlan(3));
    sim.params.thermostatOn = true;
    sim.params.thermostatSet = 30;
    sim.advance(120); // TRV sensors still cold: fully open
    for (let k = 0; k < 3; k++) expect(sim.radFlowLpm(k)).toBeCloseTo(2, 6);
    expect(sim.bypassLpm).toBeCloseTo(2, 6);
    // Shut room 2's TRV: its share goes to the other radiators and the bypass.
    sim.params.radiators[1].trvIndex = 0;
    sim.advance(60);
    expect(sim.radFlowLpm(1)).toBe(0);
    for (const k of [0, 2]) expect(sim.radFlowLpm(k)).toBeCloseTo(8 / 3, 6);
    expect(sim.bypassLpm).toBeCloseTo(8 / 3, 6);
  });
});

/** Small deterministic PRNG so the random trials are repeatable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
