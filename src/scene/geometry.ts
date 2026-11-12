export interface Pt {
  x: number;
  y: number;
}

/** A polyline with arc-length lookup. */
export class Polyline {
  readonly pts: Pt[];
  readonly cum: number[];
  readonly length: number;

  constructor(pts: Pt[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(
        this.cum[i - 1] +
          Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y),
      );
    }
    this.length = this.cum[this.cum.length - 1];
  }

  /** Point at arc-length d (clamped to the ends). */
  at(d: number): Pt {
    return this.atInto(d, { x: 0, y: 0 });
  }

  /** Same as at(), written into `out` — no allocation, for per-frame use. */
  atInto(d: number, out: Pt): Pt {
    const { pts, cum } = this;
    if (d <= 0) {
      out.x = pts[0].x;
      out.y = pts[0].y;
      return out;
    }
    if (d >= this.length) {
      out.x = pts[pts.length - 1].x;
      out.y = pts[pts.length - 1].y;
      return out;
    }
    let i = 1;
    while (cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    out.x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
    out.y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
    return out;
  }

  /** Sub-polyline between arc-lengths a and b, including any corners in between. */
  slice(a: number, b: number): Pt[] {
    const out = [this.at(a)];
    for (let i = 1; i < this.pts.length - 1; i++) {
      if (this.cum[i] > a && this.cum[i] < b) out.push({ ...this.pts[i] });
    }
    out.push(this.at(b));
    return out;
  }

  /** Split into n equal-length pieces. */
  split(n: number): Pt[][] {
    const step = this.length / n;
    return Array.from({ length: n }, (_, k) =>
      this.slice(k * step, (k + 1) * step),
    );
  }
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++)
    best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const inRect = (p: Pt, r: Rect, pad = 0) =>
  p.x >= r.x - pad &&
  p.x <= r.x + r.w + pad &&
  p.y >= r.y - pad &&
  p.y <= r.y + r.h + pad;
