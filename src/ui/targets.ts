/*
 * Which bubble (ui/deviceCard.ts) a hover or click in the scene belongs to,
 * and the fixed spot that bubble points at.
 */
import type { Rect } from "../scene/geometry";
import type { Hit, HitKind } from "../scene/hit";
import type { HouseLayout } from "../scene/layout";
import type { Side } from "./placement";

export type CardTarget =
  | { kind: "boiler" }
  | { kind: "thermostat" }
  | { kind: "trv"; room: number }
  | { kind: "lockshield"; room: number }
  | { kind: "outside" }
  | { kind: "insulation" }
  // Details only, nothing to change: the water in a radiator.
  | { kind: "radiator"; room: number };

/** The card a click opens, or null if the thing clicked has none. */
export function targetFor(hit: Hit | null): CardTarget | null {
  if (!hit) return null;
  const room = hit.room ?? 0;
  switch (hit.kind) {
    case "boiler":
    case "display":
    case "burner":
    case "pump":
      return { kind: "boiler" };
    case "thermostat":
      return { kind: "thermostat" };
    case "trv":
    case "trv-inset":
      return { kind: "trv", room };
    case "lockshield":
      return { kind: "lockshield", room };
    case "outside":
      return { kind: "outside" };
    // The building fabric and the heat escaping through it.
    case "wall":
    case "loft":
    case "loss-wall":
    case "loss-roof":
    case "loss-vent":
      return { kind: "insulation" };
    default:
      return null;
  }
}

/**
 * The bubble that shows a hovered thing's details beside its object: its
 * own card's, or for a power button, its appliance's. Null for things
 * without one (water and pipes), which get the pointer tooltip.
 */
export function bubbleFor(hit: Hit | null): CardTarget | null {
  if (hit?.kind === "power") return { kind: "boiler" };
  if (hit?.kind === "thermostat-power") return { kind: "thermostat" };
  if (hit?.kind === "radiator")
    return { kind: "radiator", room: hit.room ?? 0 };
  return targetFor(hit);
}

/**
 * Which sides of its object a bubble may sit on, best first (undefined:
 * wherever fits). The boiler's and the thermostat's always open below
 * them; a radiator's always above it.
 */
export function sidesFor(t: CardTarget): readonly Side[] | undefined {
  if (t.kind === "boiler" || t.kind === "thermostat") return ["below"];
  if (t.kind === "radiator") return ["above"];
  return undefined;
}

const roomIn = (t: CardTarget) => ("room" in t ? t.room : -1);

export const sameTarget = (
  a: CardTarget | null,
  b: CardTarget | null,
): boolean => !!a && !!b && a.kind === b.kind && roomIn(a) === roomIn(b);

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};

/**
 * What a bubble points at, in design space: always the same spot for the
 * same thing. Insulation is reached from the walls or the loft (`part`
 * says which) and points at the one you came from.
 */
export function anchorFor(
  t: CardTarget,
  lay: HouseLayout,
  part?: HitKind,
): Rect {
  switch (t.kind) {
    case "boiler":
      return lay.boiler.body;
    case "thermostat":
      return lay.thermostat;
    case "trv": {
      const r = lay.rooms[t.room];
      return union(r.trvHead, r.trvBody);
    }
    case "lockshield":
      return lay.rooms[t.room].lockshield;
    case "radiator":
      return lay.rooms[t.room].rad;
    case "outside": {
      // The OUTSIDE reading, in the middle of the strip past the wall.
      const x = lay.wallX + WALL_W;
      return { x, y: lay.thermoReadY - 22, w: lay.W - x, h: 36 };
    }
    case "insulation":
      return part === "loft" || part === "loss-roof"
        ? { x: 0, y: 0, w: lay.wallX, h: lay.ceilY }
        : { x: lay.wallX, y: lay.ceilY, w: WALL_W, h: lay.floorY - lay.ceilY };
  }
}

/** About how thick the gable wall is drawn (it varies with insulation). */
const WALL_W = 72;
