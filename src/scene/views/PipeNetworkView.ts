/*
 * The water pipes: casings, the water inside (one tinted piece per model
 * cell), the flow dots, the valve bodies the tails run through, the
 * automatic bypass valve, and the places where one pipe passes in front of
 * another.
 */
import { Graphics, GraphicsContext, type Text } from "pixi.js";
import { PIPE, type Edge } from "../../sim/circuit";
import { waterColor } from "../colors";
import {
  MUTED,
  poly,
  type Frame,
  type HitPass,
  type SceneContext,
  type View,
} from "../context";
import { Polyline, distToPolyline, inRect, type Pt } from "../geometry";
import type { Hit } from "../hit";
import { pathFor } from "../layout";

const DOT_GAP = 16; // same spacing on every pipe
const HALF = 4; // half the water stroke width
const CASING = 13; // pipe casing stroke width
const CASING_COLOR = 0x36312c;

const dotCtx = new GraphicsContext()
  .circle(0, 0, 1.3)
  .fill({ color: 0xffffff, alpha: 0.45 });

/** Wrap a phase difference into (-gap/2, gap/2]. */
const wrapPhase = (d: number) => d - DOT_GAP * Math.round(d / DOT_GAP);

/**
 * Flow dots for pipes that carry the same flow. `u` is each path's distance
 * along the circuit from a common origin, so dot phase carries on across
 * junctions and spacing stays even where pipes meet.
 */
interface DotGroup {
  paths: { path: Polyline; u: number }[];
  dots: Graphics[][];
  offset: number;
  lpm: () => number;
  /** Group this one branches off; it eases into step when carrying ~all of it. */
  parent: DotGroup | null;
}

const unit = (a: Pt, b: Pt): Pt => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
};
const along = (p: Pt, d: Pt, s: number): Pt => ({
  x: p.x + d.x * s,
  y: p.y + d.y * s,
});

export class PipeNetworkView implements View {
  private readonly ctx: SceneContext;
  /** Every pipe cell's polyline, keyed by model cell index. */
  readonly pipeCells = new Map<number, Pt[]>();
  private readonly cells: number[] = [];
  private readonly water: Graphics[] = [];
  private readonly colors: Int32Array;
  private readonly groups: DotGroup[] = [];
  private readonly pxPerM: number; // drawn pixels per metre of pipe
  private readonly scratch: Pt = { x: 0, y: 0 }; // reused per-frame point
  private readonly ring = new Graphics();
  private readonly abvLabel: Text;
  /** Where a pipe crosses in front of another: its cell and water patch. */
  private readonly overpasses: { at: Pt; cell: number; water: Graphics }[] = [];
  private overpassColors: Int32Array = new Int32Array(0);

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const { sim, lay, layers } = ctx;
    const c = sim.circuit;
    const path = (e: Edge) => pathFor(lay, e.role, e.n);
    this.pxPerM = lay.pipes.flow[0].length / c.flowMain[0].lenM;

    // Split each pipe's drawn path into one piece per model cell.
    for (const e of c.edges) {
      const p = path(e);
      if (!p) continue;
      p.split(e.cells).forEach((pts, k) =>
        this.pipeCells.set(e.first + k, pts),
      );
    }

    const casing = new Graphics();
    for (const e of c.edges) {
      const p = path(e);
      if (!p) continue;
      poly(casing, p.pts).stroke({
        width: CASING,
        color: CASING_COLOR,
        cap: "round",
        join: "round",
      });
    }
    // Valve bodies go *under* the pipe so the water and flow dots are seen
    // passing through them. The dark cavity reads as the inside of the body.
    const bodies = new Graphics();
    for (const r of lay.rooms)
      for (const b of [r.trvBody, r.lsBody]) {
        bodies
          .roundRect(b.x, b.y, b.w, b.h, 4)
          .fill(0xd3d8dd)
          .stroke({ width: 1, color: 0x8b939b })
          .roundRect(b.x + 4, b.y + 3, b.w - 8, b.h - 7, 3)
          .fill(0x4f565d);
      }
    layers.pipes.addChild(bodies, casing);

    const ends = this.junctionEnds();
    for (const [i, pts] of this.pipeCells) {
      const fix = ends.get(i);
      let q = pts;
      if (fix?.start) q = [fix.start, ...q.slice(1)];
      if (fix?.end) q = [...q.slice(0, -1), fix.end];
      const g = poly(new Graphics(), q).stroke({
        width: 2 * HALF,
        color: 0xffffff,
        cap: fix ? "butt" : "round",
        join: "round",
      });
      layers.pipes.addChild(g);
      this.cells.push(i);
      this.water.push(g);
    }
    this.colors = new Int32Array(this.cells.length).fill(-1);

    this.buildDots();
    this.buildOverpasses();

    // Automatic bypass valve: spring-loaded, opens as the TRVs close.
    const { x, y } = lay.bypass.valve;
    const abv = new Graphics()
      .poly([x - 12, y - 8, x, y, x - 12, y + 8])
      .fill(0xcfa94e)
      .stroke({ width: 1, color: 0x8d6d25 })
      .poly([x + 12, y - 8, x, y, x + 12, y + 8])
      .fill(0xcfa94e)
      .stroke({ width: 1, color: 0x8d6d25 })
      .moveTo(x, y)
      .lineTo(x, y - 11)
      .stroke({ width: 2, color: 0x5b6470 });
    abv.moveTo(x, y - 11);
    for (let k = 0; k < 4; k++)
      abv.lineTo(k % 2 ? x - 4 : x + 4, y - 13 - k * 2);
    abv.lineTo(x, y - 21).stroke({ width: 1.2, color: 0x5b6470 });
    abv.roundRect(x - 6, y - 24, 12, 4, 1).fill(0x5b6470);
    layers.devices.addChild(abv);
    this.abvLabel = ctx.label("Bypass valve", x + 16, y - 24, {
      size: 11,
      color: MUTED,
    });
    this.abvLabel.visible = false; // shown only while the valve is hovered

    // Hover highlight for a pipe cell.
    this.ring
      .circle(0, 0, 9)
      .stroke({ width: 3, color: 0x111111, alpha: 0.6 })
      .circle(0, 0, 9)
      .stroke({ width: 1.5, color: 0xffffff });
    this.ring.visible = false;
    layers.overlay.addChild(this.ring);
  }

  /**
   * Where three pipe ends meet, rounded ends would overlap in three colours
   * and make a lumpy blob, so the cells touching a junction get square ends
   * instead. At a split the pipe feeding it fills the junction square and the
   * branches start at its edges; at a merge the incoming pipes stop at its
   * edges and the outgoing pipe fills it.
   */
  private junctionEnds(): Map<number, { start?: Pt; end?: Pt }> {
    const { sim, lay } = this.ctx;
    const c = sim.circuit;
    const path = (e: Edge) => pathFor(lay, e.role, e.n);
    const edgeAt = (cell: number) => c.edges[c.edgeOf[cell]];
    const ends = new Map<number, { start?: Pt; end?: Pt }>();
    const set = (cell: number, key: "start" | "end", p: Pt) =>
      ends.set(cell, { ...ends.get(cell), [key]: p });
    const dirIn = (p: Polyline) =>
      unit(p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]);
    const dirOut = (p: Polyline) => unit(p.pts[0], p.pts[1]);

    // Splits: pipes fed by the same upstream pipe.
    const feeds = new Map<number, Edge[]>();
    for (const e of c.edges) {
      if (!path(e) || e.startsAtMerge) continue;
      const u = edgeAt(c.up1[e.first]);
      if (!path(u)) continue;
      feeds.set(u.id, [...(feeds.get(u.id) ?? []), e]);
    }
    for (const [id, outs] of feeds) {
      if (outs.length < 2) continue;
      const u = c.edges[id];
      const pu = path(u)!;
      const J = pu.pts[pu.pts.length - 1];
      set(u.last, "end", along(J, dirIn(pu), HALF));
      for (const e of outs)
        set(e.first, "start", along(J, dirOut(path(e)!), HALF));
    }
    // Merges.
    for (const e of c.edges) {
      const pe = path(e);
      if (!pe || !e.startsAtMerge) continue;
      const J = pe.pts[0];
      set(e.first, "start", along(J, dirOut(pe), -HALF));
      for (const up of [c.up1[e.first], c.up2[e.first]]) {
        const u = edgeAt(up);
        const pu = path(u);
        if (pu) set(u.last, "end", along(J, dirIn(pu), -HALF));
      }
    }
    return ends;
  }

  /** Moving dots show where water is flowing; each branch has its own rate. */
  private buildDots(): void {
    const { sim, lay, layers } = this.ctx;
    const c = sim.circuit;
    const P = lay.pipes;
    const n = lay.rooms.length;
    const group = (
      paths: { path: Polyline; u: number }[],
      lpm: () => number,
      parent: DotGroup | null,
    ): DotGroup => {
      const dots = paths.map(({ path }) =>
        Array.from({ length: Math.ceil(path.length / DOT_GAP) + 1 }, () => {
          const d = new Graphics(dotCtx);
          layers.pipes.addChild(d);
          return d;
        }),
      );
      const g = { paths, dots, offset: 0, lpm, parent };
      this.groups.push(g);
      return g;
    };

    // Circuit distance along the main line: the flow main from the boiler,
    // the bypass, then the return main back to the boiler.
    const uFlow: number[] = [];
    const uRet: number[] = [];
    let u = 0;
    for (let k = 0; k < n; k++) {
      uFlow[k] = u;
      u += P.flow[k].length;
    }
    const uBypass = u;
    u += P.bypass.length;
    for (let k = n - 1; k >= 0; k--) {
      uRet[k] = u;
      u += P.ret[k].length;
    }

    let main: DotGroup | null = null;
    for (let k = 0; k < n; k++) {
      // A stretch of flow main and the return main under it carry the same flow.
      const cell = c.flowMain[k].first;
      main = group(
        [
          { path: P.flow[k], u: uFlow[k] },
          { path: P.ret[k], u: uRet[k] },
        ],
        () => sim.cellFlowLpm(cell),
        main,
      );
      // A radiator's tails: the TRV tail leaves the flow main where this
      // stretch ends; the lockshield tail lines up with the return it joins.
      group(
        [
          { path: P.trvTail[k], u: uFlow[k] + P.flow[k].length },
          { path: P.lsTail[k], u: uRet[k] - P.lsTail[k].length },
        ],
        () => sim.radFlowLpm(k),
        main,
      );
    }
    group([{ path: P.bypass, u: uBypass }], () => sim.bypassLpm, main);
  }

  /**
   * Where a pipe passes in front of another (a lockshield drop over the flow
   * main), cover the pipe behind with a short piece of the front pipe's
   * casing and water, so the two read as crossing, not joined. Drawn above
   * the flow dots, so the dots behind disappear under the crossing too.
   */
  private buildOverpasses(): void {
    const { sim, lay, layers } = this.ctx;
    const c = sim.circuit;
    const reach = CASING / 2 + 2; // past both edges of the pipe behind
    for (const x of lay.crossings) {
      const e = c.edge(x.front.role, x.front.n);
      let cell = e.first;
      let best = Infinity;
      for (let i = e.first; i <= e.last; i++) {
        const d = distToPolyline(x.at, this.pipeCells.get(i)!);
        if (d < best) [best, cell] = [d, i];
      }
      // The front pipe is vertical (layout.findCrossings).
      const { x: px, y: py } = x.at;
      const casing = new Graphics()
        .rect(px - CASING / 2, py - reach, CASING, 2 * reach)
        .fill(CASING_COLOR);
      const water = new Graphics()
        .rect(px - HALF, py - reach, 2 * HALF, 2 * reach)
        .fill(0xffffff);
      layers.pipes.addChild(casing, water);
      this.overpasses.push({ at: x.at, cell, water });
    }
    this.overpassColors = new Int32Array(this.overpasses.length).fill(-1);
  }

  update(f: Frame): void {
    const sim = this.ctx.sim;
    const { dt, speed } = f;
    for (let j = 0; j < this.cells.length; j++) {
      const col = waterColor(sim.T[this.cells[j]]);
      if (col !== this.colors[j]) {
        this.colors[j] = col;
        this.water[j].tint = col;
      }
    }
    this.overpasses.forEach((o, j) => {
      const col = waterColor(sim.T[o.cell]);
      if (col !== this.overpassColors[j]) {
        this.overpassColors[j] = col;
        o.water.tint = col;
      }
    });

    // Pump speed sets the pace (capped so it stays watchable); each branch
    // moves in proportion to the share of the flow it carries.
    const pump = sim.flowLpm;
    const pumpPx = Math.min(
      (pump / 60 / PIPE.L_PER_M) * this.pxPerM * speed,
      160,
    );
    for (const g of this.groups) {
      const lpm = g.lpm();
      const flowing = lpm > 0.01;
      if (flowing && speed > 0 && pump > 0) {
        g.offset += pumpPx * (lpm / pump) * dt;
        // A branch carrying (almost) all of its parent's flow eases back into
        // step with it so its dots run straight on through the junctions.
        if (g.parent && lpm > 0.98 * g.parent.lpm())
          g.offset +=
            wrapPhase(g.parent.offset - g.offset) * Math.min(1, dt * 3);
      }
      g.paths.forEach(({ path, u }, k) =>
        this.placeDots(path, g.dots[k], g.offset - u, flowing),
      );
    }

    this.abvLabel.visible = f.hover?.kind === "bypass-valve";
  }

  private placeDots(
    path: Polyline,
    dots: Graphics[],
    phase: number,
    show: boolean,
  ): void {
    const start = ((phase % DOT_GAP) + DOT_GAP) % DOT_GAP;
    dots.forEach((d, i) => {
      const s = start + i * DOT_GAP;
      d.visible = show && s <= path.length;
      if (!d.visible) return;
      const pt = path.atInto(s, this.scratch);
      d.position.set(pt.x, pt.y);
    });
  }

  hitTest(p: Pt, pass: HitPass): Hit | null {
    if (pass === "device") {
      if (inRect(p, this.ctx.lay.bypass.box)) return { kind: "bypass-valve" };
    } else if (pass === "water") {
      // At a crossing, the pipe in front is the one under the pointer.
      for (const o of this.overpasses)
        if (Math.abs(p.x - o.at.x) <= 7 && Math.abs(p.y - o.at.y) <= 7)
          return { kind: "cell", cell: o.cell };
      let best = 9.5;
      let cell = -1;
      for (const [i, pts] of this.pipeCells) {
        const d = distToPolyline(p, pts);
        if (d < best) [best, cell] = [d, i];
      }
      if (cell >= 0) return { kind: "cell", cell };
    }
    return null;
  }

  setHover(hit: Hit | null): void {
    const pts =
      hit?.kind === "cell" && hit.cell != null
        ? this.pipeCells.get(hit.cell)
        : undefined;
    this.ring.visible = !!pts;
    if (!pts) return;
    const a = pts[0];
    const b = pts[pts.length - 1];
    this.ring.position.set((a.x + b.x) / 2, (a.y + b.y) / 2);
  }
}
