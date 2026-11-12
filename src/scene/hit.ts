/*
 * What the pointer is over in the scene. Shared by the scene, the tooltip
 * text (ui/describe.ts) and the controls that react to clicks and scrolling.
 */

export type HitKind =
  | "cell"
  | "radiator"
  | "trv"
  | "trv-inset"
  | "power"
  | "lockshield"
  | "thermostat"
  | "thermostat-power"
  | "display"
  | "boiler"
  | "pump"
  | "burner"
  | "gas"
  | "wall"
  | "loft"
  | "outside"
  | "loss-wall"
  | "loss-roof"
  | "loss-vent";

export interface Hit {
  kind: HitKind;
  /** Water cell under the pointer: in a pipe or the boiler ("cell"), or one
   *  of a radiator's layers ("radiator"). */
  cell?: number;
  /** Room the thing belongs to (TRV, lockshield, room air); 0 if omitted. */
  room?: number;
}

/**
 * Scene elements that respond to a click: the power buttons switch, and
 * the rest open their card of controls (ui/targets.ts).
 */
export const CLICKABLE: ReadonlySet<HitKind> = new Set<HitKind>([
  "power",
  "thermostat-power",
  "boiler",
  "display",
  "burner",
  "pump",
  "thermostat",
  "trv",
  "trv-inset",
  "lockshield",
  "outside",
  "wall",
  "loft",
  "loss-wall",
  "loss-roof",
  "loss-vent",
]);

/** Scene elements that turn up or down a notch when scrolled over. */
export const SCROLLABLE: ReadonlySet<HitKind> = new Set<HitKind>([
  "trv",
  "trv-inset",
  "thermostat",
  "display",
  "boiler",
  "lockshield",
  "outside",
]);

/** Room a hit belongs to (devices without one count as room 0). */
export const roomOf = (hit: Hit | null | undefined): number => hit?.room ?? 0;
