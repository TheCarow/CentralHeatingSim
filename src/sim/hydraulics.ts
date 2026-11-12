/*
 * How the pump's flow divides around the one-pipe loop.
 *
 * All the water passes every radiator's pair of tees. At each one it splits
 * between the radiator and the open bypass pipe under it, in proportion to
 * how freely each path lets water through: the radiator's conductance scaled
 * by its TRV opening and lockshield setting (the two valves are in series),
 * against the bypass pipe's. With both valves fully open and equal
 * conductances it's half and half; as the TRV closes, more goes round the
 * bypass. Either way the loop keeps flowing.
 */
import type { Circuit } from "./circuit";

/** Share of the loop flow that goes through a radiator rather than its bypass. */
export function radiatorShare(
  conductance: number,
  trvOpening: number,
  lockshield: number,
): number {
  const k = conductance * trvOpening * lockshield;
  return k / (k + 1);
}

/** Fill `out` (kg/s per edge) from the pump flow and per-radiator flows. */
export function edgeFlows(
  c: Circuit,
  pump: number,
  radiator: ArrayLike<number>,
  out: Float64Array,
): void {
  out[c.edgeOf[c.hx]] = pump;
  out[c.flow.id] = pump;
  for (const e of c.links) out[e.id] = pump;
  for (const e of c.ret) out[e.id] = pump;
  for (let k = 0; k < c.radiators.length; k++) {
    const r = c.radiators[k];
    out[r.trvTail.id] = out[r.rad.id] = out[r.lsTail.id] = radiator[k];
    out[r.bypass.id] = pump - radiator[k];
  }
}

/**
 * Largest mass imbalance at any join, kg/s (0 when flows are consistent).
 * Every cell must receive as much water as it passes on.
 */
export function flowImbalance(c: Circuit, m: Float64Array): number {
  // Flow into the first cell of each edge vs the flow it carries; at a split
  // the upstream edge's flow must equal the sum of everything it feeds.
  const fed = new Float64Array(c.edges.length);
  let worst = 0;
  for (const e of c.edges) {
    const i = e.first;
    const u1 = c.edgeOf[c.up1[i]];
    if (e.startsAtMerge) {
      const u2 = c.edgeOf[c.up2[i]];
      worst = Math.max(worst, Math.abs(m[u1] + m[u2] - m[e.id]));
    } else if (u1 !== e.id) {
      fed[u1] += m[e.id];
    }
  }
  for (const e of c.edges) {
    // Edges that feed a merge are checked above; the rest feed splits.
    const feedsMerge = c.edges.some(
      (d) =>
        d.startsAtMerge &&
        (c.edgeOf[c.up1[d.first]] === e.id ||
          c.edgeOf[c.up2[d.first]] === e.id),
    );
    if (!feedsMerge) worst = Math.max(worst, Math.abs(fed[e.id] - m[e.id]));
  }
  return worst;
}
