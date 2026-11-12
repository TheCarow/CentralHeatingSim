/*
 * How the pump's flow divides around the circuit.
 *
 * The pump is sized for the radiators: it delivers the sum of their design
 * flows. Each radiator takes its design flow scaled by its TRV opening and
 * lockshield setting (the two valves are in series). Whatever the radiators
 * don't take carries on along the flow main and returns through the
 * automatic bypass valve at the far end, so water always circulates.
 */
import type { Circuit } from "./circuit";

/** Fill `out` (kg/s per edge) from the pump flow and per-radiator flows. */
export function edgeFlows(
  c: Circuit,
  pump: number,
  radiator: ArrayLike<number>,
  out: Float64Array,
): void {
  out[c.edgeOf[c.hx]] = pump;
  // Along the flow main, each tee takes that radiator's share; the return
  // main mirrors it on the way back.
  let f = pump;
  for (let k = 0; k < c.radiators.length; k++) {
    out[c.flowMain[k].id] = f;
    out[c.returnMain[k].id] = f;
    const r = c.radiators[k];
    out[r.trvTail.id] = out[r.rad.id] = out[r.lsTail.id] = radiator[k];
    f -= radiator[k];
  }
  out[c.bypass.id] = f;
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
