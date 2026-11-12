/*
 * Where a card of controls goes so that it points at its object without
 * covering it: above it if there's room inside the drawing, else below, to
 * the right or to the left; on a drawing too small for any of those, just
 * under the drawing.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which side of the object the card sits on. */
export type Side = "above" | "below" | "right" | "left";

export interface Placement {
  x: number;
  y: number;
  side: Side;
  /** Where along the edge facing the object its pointer sits. */
  arrow: number;
}

export const SIDES: readonly Side[] = ["above", "below", "right", "left"];
const ARROW_INSET = 18; // keep the pointer clear of the rounded corners
const MAX_COVER = 0.35; // most of the drawing a card may cover

const within = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(Math.max(lo, hi), v));

/**
 * Place a w × h card beside `anchor`. Takes the first of `sides` (by
 * default above, below, right, left) where the card fits inside `bounds`
 * (the drawing); if none does, or the card would cover more than about a
 * third of the drawing, it goes under the drawing. Then keeps it within
 * `outer` (the page). All boxes in the same coordinates.
 */
export function placeCard(
  anchor: Box,
  w: number,
  h: number,
  bounds: Box,
  outer: Box,
  sides: readonly Side[] = SIDES,
  gap = 12,
  margin = 8,
): Placement {
  const cx = anchor.x + anchor.w / 2;
  const cy = anchor.y + anchor.h / 2;
  const at = (side: Side) => {
    if (side === "above" || side === "below")
      return {
        side,
        x: within(
          cx - w / 2,
          bounds.x + margin,
          bounds.x + bounds.w - margin - w,
        ),
        y: side === "above" ? anchor.y - gap - h : anchor.y + anchor.h + gap,
      };
    return {
      side,
      x: side === "right" ? anchor.x + anchor.w + gap : anchor.x - gap - w,
      y: within(
        cy - h / 2,
        bounds.y + margin,
        bounds.y + bounds.h - margin - h,
      ),
    };
  };
  const fits = (o: { x: number; y: number }) =>
    o.x >= bounds.x &&
    o.y >= bounds.y &&
    o.x + w <= bounds.x + bounds.w &&
    o.y + h <= bounds.y + bounds.h;

  // Little room in the drawing (a phone), where the card would hide most of
  // it: hang the card just under the drawing, pointing up at the object, so
  // the drawing stays in view.
  const roomy = w * h <= MAX_COVER * bounds.w * bounds.h;
  const best = (roomy ? sides.map(at).find(fits) : undefined) ?? {
    side: "below" as Side,
    x: cx - w / 2,
    y: bounds.y + bounds.h + gap,
  };

  const x = within(best.x, outer.x + margin, outer.x + outer.w - margin - w);
  const y = within(best.y, outer.y + margin, outer.y + outer.h - margin - h);
  const vertical = best.side === "above" || best.side === "below";
  const arrow = vertical
    ? within(cx - x, ARROW_INSET, w - ARROW_INSET)
    : within(cy - y, ARROW_INSET, h - ARROW_INSET);
  return { x, y, side: best.side, arrow };
}
