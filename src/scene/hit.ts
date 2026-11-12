/*
 * What the pointer is over in the scene. Shared by the scene, the tooltip
 * text (ui/describe.ts) and the controls that react to clicks and scrolling.
 */

export type HitKind =
  | "cell"
  | "trv"
  | "trv-inset"
  | "power"
  | "lockshield"
  | "thermostat"
  | "display"
  | "boiler"
  | "pump"
  | "burner"
  | "gas"
  | "wall"
  | "loft"
  | "outside"
  | "void"
  | "cupboard"
  | "room"
  | "loss-wall"
  | "loss-roof"
  | "loss-vent";

export interface Hit {
  kind: HitKind;
  /** Water cell under the pointer (kind "cell"). */
  cell?: number;
  /** Room the thing belongs to (TRV, lockshield, room air); 0 if omitted. */
  room?: number;
}

/** Scene elements that respond to click / scroll. */
export const ADJUSTABLE: ReadonlySet<HitKind> = new Set<HitKind>([
  "trv",
  "trv-inset",
  "thermostat",
  "display",
  "boiler",
  "outside",
  "power",
  "lockshield",
]);

/** Room a hit belongs to (devices without one count as room 0). */
export const roomOf = (hit: Hit | null | undefined): number => hit?.room ?? 0;
