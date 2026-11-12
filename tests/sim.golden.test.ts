/*
 * Characterisation ("golden") test for the simulation.
 *
 * Runs a few fixed scenarios and compares the results with values recorded
 * from the single-room baseline. Refactors of the model must keep a one-room
 * house behaving exactly as before.
 *
 *   npm test               compare against tests/golden/sim-baseline.json
 *   npm run test:golden    re-record the golden file (only when a change in
 *                          behaviour is intended)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Sim } from "../src/sim/model";

const GOLDEN = join(
  dirname(fileURLToPath(import.meta.url)),
  "golden",
  "sim-baseline.json",
);
const RECORD = import.meta.env.MODE === "golden";
const SAMPLE_S = 300; // compare every 5 simulated minutes

type Probe = Record<string, number | string | boolean | number[] | null>;

/** Everything observable about the sim that should survive a refactor. */
function probe(sim: Sim): Probe {
  const r = sim.rooms[0];
  return {
    t: sim.time,
    room: r.T,
    sensor: r.Tsensor,
    flowT: sim.flowT,
    returnT: sim.returnT,
    radInT: sim.radInT(0),
    radOutT: sim.radOutT(0),
    radW: sim.radW,
    pipeW: sim.pipeW,
    lossW: sim.lossW,
    burnerW: sim.burnerW,
    pump: sim.flowLpm,
    rad: sim.radFlowLpm(0),
    bypass: sim.bypassLpm,
    trv: r.trvOpening,
    demand: sim.demand,
    status: sim.status,
    gasJ: sim.gasJ,
    heatJ: sim.heatJ,
  };
}

/** Slower to compute: taken once an hour. */
function deepProbe(sim: Sim): Probe {
  const exp = sim.expectedRoomTemp(0);
  return {
    T: Array.from(sim.T),
    cap: sim.maxAchievableRoomTemp(0),
    expected: exp.t,
    limiter: exp.by,
  };
}

interface Scenario {
  name: string;
  hours: number;
  setup: (sim: Sim) => void;
  /** Settings changed part-way through: [sim seconds from start, change]. */
  events?: [number, (sim: Sim) => void][];
}

const SCENARIOS: Scenario[] = [
  {
    name: "cold start, thermostat on, insulation improved after 2 h",
    hours: 4,
    setup: (sim) => {
      sim.params.thermostatOn = true;
    },
    events: [[2 * 3600, (sim) => (sim.params.insulation = "good")]],
  },
  {
    name: "TRV and lockshield limiting, poor insulation, frost",
    hours: 6,
    setup: (sim) => {
      const p = sim.params;
      p.outdoor = -5;
      sim.reset(p.outdoor);
      p.thermostatOn = true;
      p.thermostatSet = 24;
      p.radiators[0].trvIndex = 3; // "2" ≈ 16 °C
      p.radiators[0].lockshield = 0.4;
      p.insulation = "poor";
      p.flowSet = 55;
    },
  },
  {
    name: "TRV modulating below the thermostat set-point",
    hours: 6,
    setup: (sim) => {
      const p = sim.params;
      p.thermostatOn = true;
      p.thermostatSet = 22;
      p.radiators[0].trvIndex = 3; // "2" ≈ 16 °C
      p.insulation = "good";
      p.flowSet = 70;
    },
  },
  {
    name: "TRV shut: all flow through the bypass",
    hours: 1.5,
    setup: (sim) => {
      sim.params.thermostatOn = true;
      sim.params.radiators[0].trvIndex = 0;
    },
    events: [[3600, (sim) => (sim.params.radiators[0].trvIndex = 4)]],
  },
  {
    name: "warm start, boiler off then on, pump overrun",
    hours: 3,
    setup: (sim) => {
      const p = sim.params;
      p.outdoor = 12;
      sim.reset(14);
      p.insulation = "excellent";
      p.thermostatOn = true;
      p.thermostatSet = 18;
      p.boilerOn = false;
    },
    events: [
      [3600, (sim) => (sim.params.boilerOn = true)],
      [7200, (sim) => (sim.params.thermostatOn = false)],
    ],
  },
];

function run(sc: Scenario) {
  const sim = new Sim();
  sc.setup(sim);
  const events = [...(sc.events ?? [])];
  const samples: Probe[] = [probe(sim)];
  const deep: Probe[] = [deepProbe(sim)];
  const steps = Math.round((sc.hours * 3600) / SAMPLE_S);
  for (let k = 1; k <= steps; k++) {
    sim.advance(SAMPLE_S);
    const elapsed = k * SAMPLE_S;
    while (events.length && events[0][0] <= elapsed) events.shift()![1](sim);
    samples.push(probe(sim));
    if (elapsed % 3600 === 0) deep.push(deepProbe(sim));
  }
  return { samples, deep };
}

/** Round so the golden file stays small and diff-friendly. */
function round<T>(v: T): T {
  if (typeof v === "number") return (Math.round(v * 1e9) / 1e9) as T;
  if (Array.isArray(v)) return v.map(round) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, round(x)]),
    ) as T;
  return v;
}

function compare(actual: unknown, expected: unknown, path: string): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const a = actual as number;
    const tol = 1e-6 + 1e-9 * Math.abs(expected);
    if (Math.abs(a - expected) > tol)
      expect.fail(`${path}: got ${a}, expected ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect((actual as unknown[]).length, `${path}.length`).toBe(
      expected.length,
    );
    expected.forEach((e, i) =>
      compare((actual as unknown[])[i], e, `${path}[${i}]`),
    );
    return;
  }
  if (expected && typeof expected === "object") {
    for (const [k, e] of Object.entries(expected))
      compare((actual as Record<string, unknown>)[k], e, `${path}.${k}`);
    return;
  }
  expect(actual, path).toBe(expected);
}

describe("single-room behaviour matches the recorded baseline", () => {
  const results = Object.fromEntries(
    SCENARIOS.map((sc) => [sc.name, round(run(sc))]),
  );

  if (RECORD) {
    it("records the golden file", () => {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify(results, null, 1) + "\n");
    });
    return;
  }

  const golden = existsSync(GOLDEN)
    ? (JSON.parse(readFileSync(GOLDEN, "utf8")) as typeof results)
    : null;

  it("has a golden file", () => {
    expect(golden, `missing ${GOLDEN}: run npm run test:golden`).not.toBe(null);
  });

  for (const sc of SCENARIOS)
    it(sc.name, () => {
      compare(results[sc.name], golden?.[sc.name], sc.name);
    });
});
