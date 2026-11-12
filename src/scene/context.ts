/*
 * What every part of the scene shares: the sim, the layout, the drawing
 * layers, a text factory, and the small interface each view implements.
 */
import { Container, Text, type Graphics } from "pixi.js";
import type { Sim } from "../sim/model";
import type { Pt } from "./geometry";
import type { Hit } from "./hit";
import type { HouseLayout } from "./layout";

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const INK = 0x2b2a27;
export const MUTED = 0x6f6a62;

/** Drawing layers, back to front. Views add their pieces to these. */
export interface Layers {
  bg: Container;
  fabric: Container;
  pipes: Container;
  fx: Container;
  devices: Container;
  labels: Container;
  overlay: Container;
}

export function makeLayers(): Layers {
  return {
    bg: new Container(),
    fabric: new Container(),
    pipes: new Container(),
    fx: new Container(),
    devices: new Container(),
    labels: new Container(),
    overlay: new Container(),
  };
}

export interface LabelOpts {
  size?: number;
  color?: number;
  weight?: "400" | "500" | "600" | "700";
  ax?: number;
  ay?: number;
  spacing?: number;
  parent?: Container;
}

/** Per-frame input to every view. */
export interface Frame {
  dt: number; // real seconds since the last frame
  speed: number; // sim seconds per real second (0 when paused)
  clock: number; // real seconds since the scene started
  hover: Hit | null;
  /** True a few times a second: time to refresh text. */
  refreshText: boolean;
  showLosses: boolean;
}

/**
 * Hit-testing runs in passes so small devices win over what's behind them:
 * valves and buttons, then water in the pipes, then radiators, appliances
 * and arrows, and finally rooms and building fabric.
 */
export type HitPass = "device" | "water" | "body" | "space";
export const HIT_PASSES: readonly HitPass[] = [
  "device",
  "water",
  "body",
  "space",
];

export interface View {
  update(f: Frame): void;
  hitTest?(p: Pt, pass: HitPass): Hit | null;
  /** The hovered thing changed (place highlights immediately). */
  setHover?(hit: Hit | null): void;
}

export class SceneContext {
  readonly sim: Sim;
  readonly lay: HouseLayout;
  readonly layers: Layers;
  private readonly texts: Text[] = [];
  private textRes = 1;

  constructor(sim: Sim, lay: HouseLayout, layers: Layers) {
    this.sim = sim;
    this.lay = lay;
    this.layers = layers;
  }

  /** A text label (in the labels layer unless `parent` is given). */
  label(str: string, x: number, y: number, o: LabelOpts = {}): Text {
    const t = new Text({
      text: str,
      style: {
        fontFamily: FONT,
        fontSize: o.size ?? 12,
        fill: o.color ?? INK,
        fontWeight: o.weight ?? "500",
        letterSpacing: o.spacing ?? 0,
      },
      resolution: this.textRes,
    });
    t.anchor.set(o.ax ?? 0, o.ay ?? 0);
    t.position.set(x, y);
    (o.parent ?? this.layers.labels).addChild(t);
    this.texts.push(t);
    return t;
  }

  /** Re-rasterise every label at a new resolution (when the scene is scaled). */
  setTextResolution(res: number): void {
    if (Math.abs(res - this.textRes) <= 0.01) return;
    this.textRes = res;
    for (const t of this.texts) t.resolution = res;
  }
}

/** Trace a polyline into a Graphics path (call .stroke() on the result). */
export const poly = (g: Graphics, pts: Pt[]) => {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  return g;
};
