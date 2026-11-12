/*
 * The drawing layout: the one-room house must keep its exact coordinates,
 * and for any number of rooms the drawn pipes must join up the way the
 * simulated circuit does.
 */
import { describe, expect, it } from "vitest";
import { MAX_ROOMS, makePlan } from "../src/house/plan";
import { Circuit, type Edge } from "../src/sim/circuit";
import { computeLayout, pathFor } from "../src/scene/layout";
import type { Pt } from "../src/scene/geometry";

const first = (pts: Pt[]) => pts[0];
const last = (pts: Pt[]) => pts[pts.length - 1];

describe("one room keeps the original drawing", () => {
  const lay = computeLayout(makePlan(1));
  const r = lay.rooms[0];

  it("places the room, radiator and valves where they always were", () => {
    expect(lay.W).toBe(1200);
    expect(lay.H).toBe(700);
    expect(lay.wallX).toBe(1000);
    expect(r.rect).toEqual({ x: 316, y: 84, w: 684, h: 476 });
    expect(r.rad).toEqual({ x: 630, y: 392, w: 220, h: 118 });
    expect([r.trvX, r.lockX, r.tailY]).toEqual([607, 873, 504]);
    expect(r.trvHead).toEqual({ x: 592, y: 420, w: 30, h: 64 });
    expect(r.trvBody).toEqual({ x: 594, y: 484, w: 26, h: 33 });
    expect(r.lockshield).toEqual({ x: 860, y: 468, w: 26, h: 49 });
    expect(lay.thermostat).toEqual({ x: 380, y: 236, w: 90, h: 70 });
    expect(lay.bypass.valve).toEqual({ x: 740, y: 546 });
    expect(lay.partitions).toEqual([{ x: 300, y: 84, w: 16, h: 476 }]);
    expect(lay.losses.roofX).toBe(486);
  });

  it("routes the pipes the same way", () => {
    const pts = (p: { pts: Pt[] }) => p.pts.map((q) => [q.x, q.y]);
    expect(pts(lay.pipes.flow[0])).toEqual([
      [215, 360],
      [215, 588],
      [607, 588],
      [607, 546],
    ]);
    expect(pts(lay.pipes.trvTail[0])).toEqual([
      [607, 546],
      [607, 504],
      [630, 504],
    ]);
    expect(pts(lay.pipes.lsTail[0])).toEqual([
      [850, 504],
      [873, 504],
      [873, 546],
    ]);
    expect(pts(lay.pipes.bypass)).toEqual([
      [607, 546],
      [873, 546],
    ]);
    expect(pts(lay.pipes.ret[0])).toEqual([
      [873, 546],
      [873, 612],
      [130, 612],
      [130, 360],
    ]);
  });
});

describe.each(Array.from({ length: MAX_ROOMS }, (_, i) => i + 1))(
  "%i room(s)",
  (n) => {
    const plan = makePlan(n);
    const lay = computeLayout(plan);
    const circuit = new Circuit(plan);
    const path = (e: Edge) => pathFor(lay, e.role, e.n);

    it("lays the rooms out left to right without overlapping", () => {
      expect(lay.rooms).toHaveLength(n);
      expect(lay.partitions).toHaveLength(n);
      let x = lay.cupboard.x + lay.cupboard.w;
      lay.rooms.forEach((r, k) => {
        expect(lay.partitions[k].x).toBe(x);
        expect(r.rect.x).toBe(x + lay.partitions[k].w);
        x = r.rect.x + r.rect.w;
        // the radiator and both valves sit inside their room
        expect(r.trvHead.x).toBeGreaterThan(r.rect.x);
        expect(r.lockshield.x + r.lockshield.w).toBeLessThan(x);
      });
      expect(lay.wallX).toBe(x);
      expect(lay.W).toBeGreaterThan(lay.wallX);
      const stat = lay.rooms[plan.thermostatRoom].rect;
      expect(lay.thermostat.x).toBeGreaterThanOrEqual(stat.x);
      expect(lay.thermostat.x + lay.thermostat.w).toBeLessThanOrEqual(
        stat.x + stat.w,
      );
    });

    it("draws a path for every pipe in the circuit", () => {
      for (const e of circuit.edges) {
        const p = path(e);
        if (e.role === "hx" || e.role === "rad") expect(p).toBeNull();
        else expect(p!.length).toBeGreaterThan(0);
      }
    });

    it("joins each pipe to the one feeding it", () => {
      for (const e of circuit.edges) {
        const p = path(e);
        if (!p) continue;
        const start = first(p.pts);
        for (const u of [circuit.up1[e.first], circuit.up2[e.first]]) {
          if (u < 0) continue;
          const up = path(circuit.edges[circuit.edgeOf[u]]);
          if (up) expect(last(up.pts), `${e.role} ${e.n}`).toEqual(start);
        }
      }
    });

    it("connects pipes to the radiators and the boiler", () => {
      const b = lay.boiler;
      expect(first(lay.pipes.flow[0].pts)).toEqual({
        x: b.flowX,
        y: b.bottom,
      });
      expect(last(lay.pipes.ret[0].pts)).toEqual({
        x: b.returnX,
        y: b.bottom,
      });
      lay.rooms.forEach((r, k) => {
        expect(last(lay.pipes.trvTail[k].pts)).toEqual({
          x: r.rad.x,
          y: r.tailY,
        });
        expect(first(lay.pipes.lsTail[k].pts)).toEqual({
          x: r.rad.x + r.rad.w,
          y: r.tailY,
        });
      });
    });
  },
);
