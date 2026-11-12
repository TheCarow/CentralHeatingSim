/*
 * The settings you can change from the scene, with their ranges, and the
 * small changes made directly on objects: scrolling over one turns it up or
 * down a notch, and the power buttons switch.
 */
import {
  INSULATION,
  TRV_SETTINGS,
  clamp,
  type InsulationKey,
  type SimParams,
} from "../sim/model";
import { roomOf, type Hit } from "../scene/hit";

export const RANGE = {
  flow: { min: 30, max: 80, step: 1 }, // °C
  thermostat: { min: 5, max: 30, step: 0.5 }, // °C
  outdoor: { min: -15, max: 25, step: 1 }, // °C
  lockshield: { min: 10, max: 100, step: 10 }, // % open
} as const;

export const INS_KEYS = Object.keys(INSULATION) as InsulationKey[];

export const INS_ITEMS = INS_KEYS.map((k) => ({
  label: INSULATION[k].label,
  title: `${INSULATION[k].label}: ${INSULATION[k].summary}`,
}));

export const TRV_ITEMS = TRV_SETTINGS.map((s) => ({
  label: s.label,
  title:
    s.target == null
      ? "0: shut"
      : `${s.label === "❄" ? "Frost" : s.label}: about ${s.target} °C`,
}));

/** What a TRV setting aims for, e.g. "≈20 °C". */
export const trvText = (index: number): string => {
  const t = TRV_SETTINGS[index].target;
  return t == null ? "shut" : `≈${t} °C`;
};

/** Turn the object under the pointer up (1) or down (-1) a notch. */
export function nudge(p: SimParams, hit: Hit, dir: 1 | -1): void {
  const rad = p.radiators[roomOf(hit)];
  const step = (v: number, r: { min: number; max: number; step: number }) =>
    clamp(v + dir * r.step, r.min, r.max);
  switch (hit.kind) {
    case "trv":
    case "trv-inset":
      rad.trvIndex = clamp(rad.trvIndex + dir, 0, TRV_SETTINGS.length - 1);
      break;
    case "thermostat":
      p.thermostatSet = step(p.thermostatSet, RANGE.thermostat);
      break;
    case "display":
    case "boiler":
      p.flowSet = step(p.flowSet, RANGE.flow);
      break;
    case "lockshield":
      rad.lockshield =
        Math.round(step(rad.lockshield * 100, RANGE.lockshield)) / 100;
      break;
    case "outside":
      p.outdoor = step(p.outdoor, RANGE.outdoor);
      break;
  }
}

/** Flip a power button (boiler or thermostat). False if `hit` isn't one. */
export function togglePower(p: SimParams, hit: Hit): boolean {
  if (hit.kind === "power") p.boilerOn = !p.boilerOn;
  else if (hit.kind === "thermostat-power") p.thermostatOn = !p.thermostatOn;
  else return false;
  return true;
}
