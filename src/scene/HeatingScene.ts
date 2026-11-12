/*
 * The illustrated cut-away house, drawn with PixiJS.
 *
 * Everything is laid out in a fixed 1200 x 700 "design space" inside `world`,
 * which is scaled to fit the canvas. Geometry is built once; per frame we only
 * change tints (water colours), transforms (flow dots, flames, pump) and a few
 * throttled text labels.
 */
import {
  Application,
  Container,
  Graphics,
  GraphicsContext,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import {
  K,
  TRV_SETTINGS,
  clamp,
  lossCoefficients,
  type Sim,
  type SimStatus,
  type WallType,
} from "../sim/model";
import { roomTint, skyTint, waterColor } from "./colors";
import { CUTAWAY_H, CUTAWAY_W, TrvCutaway } from "./TrvCutaway";
import {
  Polyline,
  distToPolyline,
  inRect,
  type Pt,
  type Rect,
} from "./geometry";

export const SCENE_W = 1200;
export const SCENE_H = 700;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const INK = 0x2b2a27;
const MUTED = 0x6f6a62;
const LOSS_COLOR = 0xe8590c;

// ---- Layout (design-space coordinates) ---------------------------------------
const WALL_X = 1000; // inner face of the external wall
const LOFT_FLOOR = 76;
const CEIL_Y = 84;
const FLOOR_Y = 560;
const VOID_BOTTOM = 632;
const ROOM: Rect = { x: 316, y: CEIL_Y, w: WALL_X - 316, h: FLOOR_Y - CEIL_Y };
const CUPBOARD: Rect = { x: 0, y: CEIL_Y, w: 300, h: FLOOR_Y - CEIL_Y };
const BOILER: Rect = { x: 90, y: 110, w: 160, h: 250 };
const DISPLAY: Rect = { x: 104, y: 120, w: 108, h: 30 };
const POWER = { x: 228, y: 135, r: 9 }; // boiler on/off button
const CUTAWAY: Rect = { x: 102, y: 158, w: 136, h: 190 };
const HX: Rect = { x: 116, y: 168, w: 108, h: 38 };
const BURNER: Rect = { x: 140, y: 208, w: 60, h: 22 };
const PUMP = { x: 130, y: 300, r: 13 };
const GAS_X = 172;
const SHOW_FLUE = false; // exhaust flue on top of the boiler, hidden for now
const SHOW_GAS_PIPE = false; // gas supply stub under the boiler, hidden for now
const SHOW_TRV_CUTAWAY = false; // magnified TRV diagram on hover, hidden for now
const RAD: Rect = { x: 630, y: 392, w: 220, h: 118 };
const TRV_X = 607;
const LOCK_X = 873;
const TAIL_Y = 504;
const TRV_HEAD: Rect = { x: 592, y: 420, w: 30, h: 64 }; // sits on the valve body
// Valve bodies: the pipe runs through a cavity inside each one.
const BODY_UP = 20; // body extends this far above the tail line...
const BODY_DOWN = 13; // ...and this far below it
const TRV_BODY: Rect = {
  x: TRV_X - 13,
  y: TAIL_Y - BODY_UP,
  w: 26,
  h: BODY_UP + BODY_DOWN,
};
const LS_BODY: Rect = {
  x: LOCK_X - 13,
  y: TAIL_Y - BODY_UP,
  w: 26,
  h: BODY_UP + BODY_DOWN,
};
const LOCKSHIELD: Rect = { x: LOCK_X - 13, y: TAIL_Y - 36, w: 26, h: 49 };
// Plug travel on the real units: closed it sits across the inlet just below
// the corner; fully open it is lifted clear of the channel.
const PLUG_CLOSED_Y = TAIL_Y + 1;
const PLUG_TRAVEL = 14; // fully open = plug just clear of the channel
const THERMOSTAT: Rect = { x: 380, y: 236, w: 90, h: 70 };
const THERMO_READ_Y = THERMOSTAT.y + 21; // centre of the thermostat's big reading
const CUT: Rect = { x: 352, y: 338, w: CUTAWAY_W, h: CUTAWAY_H };
const FLOW_X = 215;
const RETURN_X = 130;
const FLOW_Y = 588;
const RETURN_Y = 612;
const BOILER_BOTTOM = BOILER.y + BOILER.h;
const ROOF_ARROW_X = 486;

// Flow and return meet the bypass at two junctions just under the radiator.
const JUNCTION_Y = 546;
const ABV = { x: (TRV_X + LOCK_X) / 2, y: JUNCTION_Y };
const ABV_BOX: Rect = { x: ABV.x - 14, y: JUNCTION_Y - 24, w: 28, h: 32 };
const FLOW_PATH = new Polyline([
  { x: FLOW_X, y: BOILER_BOTTOM },
  { x: FLOW_X, y: FLOW_Y },
  { x: TRV_X, y: FLOW_Y },
  { x: TRV_X, y: JUNCTION_Y },
]);
const TRV_TAIL_PATH = new Polyline([
  { x: TRV_X, y: JUNCTION_Y },
  { x: TRV_X, y: TAIL_Y },
  { x: RAD.x, y: TAIL_Y },
]);
const LS_TAIL_PATH = new Polyline([
  { x: RAD.x + RAD.w, y: TAIL_Y },
  { x: LOCK_X, y: TAIL_Y },
  { x: LOCK_X, y: JUNCTION_Y },
]);
const BYPASS_PATH = new Polyline([
  { x: TRV_X, y: JUNCTION_Y },
  { x: LOCK_X, y: JUNCTION_Y },
]);
const RETURN_PATH = new Polyline([
  { x: LOCK_X, y: JUNCTION_Y },
  { x: LOCK_X, y: RETURN_Y },
  { x: RETURN_X, y: RETURN_Y },
  { x: RETURN_X, y: BOILER_BOTTOM },
]);
const ALL_PIPES = [
  FLOW_PATH,
  TRV_TAIL_PATH,
  LS_TAIL_PATH,
  BYPASS_PATH,
  RETURN_PATH,
];
const INT_FLOW: Pt[] = [
  { x: FLOW_X, y: HX.y + HX.h },
  { x: FLOW_X, y: BOILER_BOTTOM },
];
const INT_RETURN: Pt[] = [
  { x: RETURN_X, y: BOILER_BOTTOM },
  { x: RETURN_X, y: HX.y + HX.h },
];
const GAS_PIPE: Pt[] = [
  { x: GAS_X, y: BOILER_BOTTOM },
  { x: GAS_X, y: BOILER_BOTTOM + 38 },
];
const PX_PER_M = FLOW_PATH.length / K.FLOW_LEN_M;
const DOT_GAP = 16; // same spacing on every pipe

export type HitKind =
  | "cell"
  | "trv"
  | "trv-inset"
  | "power"
  | "bypass-valve"
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
  cell?: number;
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

const STATUS_TEXT: Record<SimStatus, string> = {
  standby: "STANDBY",
  overrun: "OVERRUN",
  bypass: "BYPASS",
  heating: "HEATING",
  idle: "AT TEMP",
  off: "OFF",
};

interface LabelOpts {
  size?: number;
  color?: number;
  weight?: "400" | "500" | "600" | "700";
  ax?: number;
  ay?: number;
  spacing?: number;
  parent?: Container;
}

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
}

/** Wrap a phase difference into (-gap/2, gap/2]. */
const wrapPhase = (d: number) => d - DOT_GAP * Math.round(d / DOT_GAP);

interface LossArrow {
  kind: HitKind;
  g: Graphics;
  name: Text;
  value: Text;
  box: Rect;
  width: number;
}

const poly = (g: Graphics, pts: Pt[]) => {
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  return g;
};

export class HeatingScene {
  readonly app = new Application();
  hover: Hit | null = null;
  /** Heat-loss arrows (walls, roof, draughts) are hidden unless switched on. */
  showLosses = false;
  onHover?: (hit: Hit | null, clientX: number, clientY: number) => void;
  onAdjust?: (kind: HitKind, dir: 1 | -1, source: "click" | "wheel") => void;

  private readonly sim: Sim;
  private readonly world = new Container();
  private readonly L = {
    bg: new Container(),
    fabric: new Container(),
    pipes: new Container(),
    fx: new Container(),
    devices: new Container(),
    labels: new Container(),
    overlay: new Container(),
  };
  private readonly texts: Text[] = [];
  private textRes = 1;

  // tinted pieces
  private readonly cellG: (Graphics | undefined)[] = [];
  private readonly cellColor: Int32Array;
  private roomWall = new Graphics();
  private sky = new Graphics();
  private hxG = new Graphics();
  private intFlowG = new Graphics();
  private intRetG = new Graphics();
  private led = new Graphics();
  private thermoScreen = new Graphics();

  // rebuilt when insulation changes
  private wallG = new Graphics();
  private loftG = new Graphics();
  private outsideGround = new Graphics();
  private wallEnd = WALL_X + 72;
  private builtInsulation = "";

  // animated pieces
  /** Every pipe cell's polyline, keyed by model cell index. */
  private readonly pipeCells = new Map<number, Pt[]>();
  private readonly dotGroups: DotGroup[] = [];
  private readonly scratch: Pt = { x: 0, y: 0 }; // reused per-frame point
  private lossesShown = false;
  private readonly snow: { g: Graphics; x: number; y: number; v: number }[] =
    [];
  private readonly flames: Graphics[] = [];
  private impeller = new Graphics();
  private cutaway!: TrvCutaway;
  private cutLead = new Graphics();
  private cutHold = 0; // seconds the cut-away stays up after the pointer leaves the TRV
  private powerBtn = new Graphics();
  private trvPlug!: Graphics;
  private lsPlug = new Graphics();
  private trvLift = 1; // eased 0..1 plug lift shown on the real TRV
  private ring = new Graphics();
  private layerBox = new Graphics();
  private clock = 0;
  private lastLabels = -1;
  private arrows: LossArrow[] = [];

  // text
  private thermoTemp!: Text;
  private thermoSet!: Text;
  private thermoState!: Text;
  private trvNumber!: Text;
  private displayTemp!: Text;
  private displayStatus!: Text;
  private outsideTitle!: Text;
  private outsideTemp!: Text;
  private loftText!: Text;
  private lsLabel!: Text;
  private trvLabel!: Text;
  private abvLabel!: Text;

  constructor(sim: Sim) {
    this.sim = sim;
    this.cellColor = new Int32Array(sim.N).fill(-1);
    const { idx } = sim;
    const segments: [Polyline, { first: number; last: number }][] = [
      [FLOW_PATH, idx.flow],
      [TRV_TAIL_PATH, idx.trvTail],
      [LS_TAIL_PATH, idx.lsTail],
      [BYPASS_PATH, idx.bypass],
      [RETURN_PATH, idx.ret],
    ];
    for (const [path, r] of segments)
      path
        .split(r.last - r.first + 1)
        .forEach((pts, k) => this.pipeCells.set(r.first + k, pts));
  }

  async init(el: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: el,
      background: 0xf1ede5,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      // We hit-test ourselves and listen to wheel natively.
      eventFeatures: {
        move: true,
        globalMove: false,
        click: true,
        wheel: false,
      },
    });
    el.appendChild(this.app.canvas);
    this.app.canvas.setAttribute("role", "img");
    this.app.canvas.setAttribute(
      "aria-label",
      "Cut-away of a room heated by a combi boiler: pipes, radiator with TRV, room thermostat and external wall.",
    );

    this.app.stage.addChild(this.world);
    for (const layer of Object.values(this.L)) this.world.addChild(layer);

    this.buildBackground();
    this.buildFabricContainers();
    this.buildPipes();
    this.buildRadiator();
    this.buildBoiler();
    this.buildThermostat();
    this.buildEffects();
    this.buildLabels();
    this.rebuildFabric();

    new ResizeObserver(() => this.app.queueResize()).observe(el);
    this.app.renderer.on("resize", (w: number, h: number) => this.layout(w, h));
    this.layout(this.app.screen.width, this.app.screen.height);
    this.setupInput();
  }

  // ---------------------------------------------------------------------------
  // Layout & input
  // ---------------------------------------------------------------------------

  private layout(w: number, h: number): void {
    const s = Math.min(w / SCENE_W, h / SCENE_H);
    this.world.scale.set(s);
    this.world.position.set((w - SCENE_W * s) / 2, (h - SCENE_H * s) / 2);
    // Keep text crisp when the scene is scaled up.
    // Quantised so small size changes don't re-rasterise every label.
    const res =
      this.app.renderer.resolution * Math.max(1, Math.ceil(s * 2) / 2);
    if (Math.abs(res - this.textRes) > 0.01) {
      this.textRes = res;
      for (const t of this.texts) t.resolution = res;
    }
  }

  private setupInput(): void {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    // Hit-testing is done in hitTest(); stop Pixi walking ~460 children per event.
    stage.interactiveChildren = false;

    stage.on("pointermove", (e: FederatedPointerEvent) => {
      const hit = this.hitTest(this.world.toLocal(e.global));
      stage.cursor = hit && ADJUSTABLE.has(hit.kind) ? "pointer" : "default";
      this.setHover(hit, e.client.x, e.client.y);
    });
    stage.on("pointertap", (e: FederatedPointerEvent) => {
      const hit = this.hitTest(this.world.toLocal(e.global));
      if (hit && ADJUSTABLE.has(hit.kind))
        this.onAdjust?.(hit.kind, e.shiftKey ? -1 : 1, "click");
    });
    this.app.canvas.addEventListener("pointerleave", () =>
      this.setHover(null, 0, 0),
    );

    // Scroll over an adjustable device to turn it. Only then block page scroll.
    this.app.canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        const r = this.app.canvas.getBoundingClientRect();
        const hit = this.hitTest(
          this.world.toLocal({ x: e.clientX - r.left, y: e.clientY - r.top }),
        );
        if (hit && ADJUSTABLE.has(hit.kind)) {
          e.preventDefault();
          this.onAdjust?.(hit.kind, e.deltaY < 0 ? 1 : -1, "wheel");
        }
      },
      { passive: false },
    );
  }

  private setHover(hit: Hit | null, x: number, y: number): void {
    this.hover = hit;
    this.placeHighlight();
    this.onHover?.(hit, x, y);
  }

  hitTest(p: Pt): Hit | null {
    if (p.x < 0 || p.y < 0 || p.x > SCENE_W || p.y > SCENE_H) return null;
    const { idx } = this.sim;
    if (inRect(p, TRV_HEAD, 3)) return { kind: "trv" };
    if (inRect(p, TRV_BODY, 2)) return { kind: "trv-inset" };
    if (this.cutaway.alpha > 0.3 && inRect(p, CUT))
      return { kind: "trv-inset" };
    if (Math.hypot(p.x - POWER.x, p.y - POWER.y) <= POWER.r + 3)
      return { kind: "power" };
    if (inRect(p, LOCKSHIELD, 2)) return { kind: "lockshield" };
    if (inRect(p, THERMOSTAT, 2)) return { kind: "thermostat" };
    if (inRect(p, DISPLAY)) return { kind: "display" };
    if (Math.hypot(p.x - PUMP.x, p.y - PUMP.y) <= PUMP.r + 2)
      return { kind: "pump" };
    if (inRect(p, HX)) return { kind: "cell", cell: 0 };
    if (inRect(p, BURNER)) return { kind: "burner" };
    if (distToPolyline(p, INT_FLOW) <= 6) return { kind: "cell", cell: 0 };
    if (distToPolyline(p, INT_RETURN) <= 6)
      return { kind: "cell", cell: idx.ret.last };
    if (SHOW_GAS_PIPE && distToPolyline(p, GAS_PIPE) <= 6)
      return { kind: "gas" };

    if (inRect(p, ABV_BOX)) return { kind: "bypass-valve" };
    let best = 9.5;
    let cell = -1;
    for (const [i, pts] of this.pipeCells) {
      const d = distToPolyline(p, pts);
      if (d < best) [best, cell] = [d, i];
    }
    if (cell >= 0) return { kind: "cell", cell };

    if (inRect(p, RAD)) {
      const layer = clamp(
        Math.floor(((p.y - RAD.y) / RAD.h) * K.RAD_LAYERS),
        0,
        K.RAD_LAYERS - 1,
      );
      return { kind: "cell", cell: idx.rad.first + layer };
    }
    if (inRect(p, BOILER)) return { kind: "boiler" };
    for (const a of this.arrows)
      if (a.g.visible && inRect(p, a.box, 4)) return { kind: a.kind };
    if (p.x >= WALL_X && p.x <= this.wallEnd && p.y <= VOID_BOTTOM)
      return { kind: "wall" };
    if (p.y < CEIL_Y && p.x < WALL_X) return { kind: "loft" };
    if (p.x > this.wallEnd && p.y < VOID_BOTTOM) return { kind: "outside" };
    if (p.y >= FLOOR_Y && p.y < VOID_BOTTOM && p.x < WALL_X)
      return { kind: "void" };
    if (inRect(p, CUPBOARD)) return { kind: "cupboard" };
    if (inRect(p, ROOM)) return { kind: "room" };
    return null;
  }

  private placeHighlight(): void {
    const h = this.hover;
    const { idx } = this.sim;
    this.ring.visible = false;
    this.layerBox.visible = false;
    if (!h || h.kind !== "cell" || h.cell == null) return;
    const i = h.cell;
    const pts = this.pipeCells.get(i);
    if (pts) {
      const a = pts[0];
      const b = pts[pts.length - 1];
      this.ring.position.set((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.ring.visible = true;
    } else if (i >= idx.rad.first && i <= idx.rad.last) {
      this.layerBox.position.set(
        RAD.x,
        RAD.y + ((i - idx.rad.first) * RAD.h) / K.RAD_LAYERS,
      );
      this.layerBox.visible = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private label(str: string, x: number, y: number, o: LabelOpts = {}): Text {
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
    (o.parent ?? this.L.labels).addChild(t);
    this.texts.push(t);
    return t;
  }

  private buildBackground(): void {
    const g = new Graphics();
    // loft void with rafters
    g.rect(0, 0, WALL_X, LOFT_FLOOR).fill(0xe8e1d4);
    for (let x = -60; x < WALL_X; x += 96)
      g.moveTo(x, LOFT_FLOOR).lineTo(x + 64, 0);
    g.stroke({ width: 3, color: 0xdad1c1 });
    g.rect(0, LOFT_FLOOR, WALL_X, CEIL_Y - LOFT_FLOOR).fill(0xd5cec1); // ceiling
    g.rect(CUPBOARD.x, CUPBOARD.y, CUPBOARD.w, CUPBOARD.h).fill(0xe9e4da);
    g.rect(300, CEIL_Y, 16, FLOOR_Y - CEIL_Y).fill(0xd3cbbe); // partition
    g.moveTo(300, CEIL_Y)
      .lineTo(300, FLOOR_Y)
      .moveTo(316, CEIL_Y)
      .lineTo(316, FLOOR_Y);
    g.stroke({ width: 1, color: 0xbdb4a5 });
    // floorboards
    g.rect(0, FLOOR_Y, WALL_X, 10).fill(0xa87d54);
    for (let x = 40; x < WALL_X; x += 80)
      g.moveTo(x, FLOOR_Y).lineTo(x, FLOOR_Y + 10);
    g.stroke({ width: 1, color: 0x8a643f });
    // floor void with joists
    g.rect(0, FLOOR_Y + 10, WALL_X, VOID_BOTTOM - FLOOR_Y - 10).fill(0x4a433c);
    for (let x = 30; x < WALL_X; x += 110)
      g.rect(x, FLOOR_Y + 10, 14, 30).fill(0x6e5c49);
    // ground
    g.rect(0, VOID_BOTTOM, SCENE_W, SCENE_H - VOID_BOTTOM).fill(0x8b8378);
    for (let x = -80; x < SCENE_W; x += 22)
      g.moveTo(x, SCENE_H).lineTo(x + 68, VOID_BOTTOM);
    g.stroke({ width: 1, color: 0x7a7267 });
    this.L.bg.addChild(g);

    this.roomWall.rect(ROOM.x, ROOM.y, ROOM.w, ROOM.h).fill(0xffffff);
    this.L.bg.addChild(this.roomWall);
  }

  private buildFabricContainers(): void {
    this.L.fabric.addChild(
      this.sky,
      this.outsideGround,
      this.wallG,
      this.loftG,
    );
  }

  /** Wall build-up, loft insulation and outside area — depends on insulation level. */
  private rebuildFabric(): void {
    const ins = this.sim.insulation;
    this.builtInsulation = this.sim.params.insulation;

    const g = this.wallG.clear();
    const top = 0;
    const bottom = VOID_BOTTOM;
    const H = bottom - top;
    let x = WALL_X;
    const layer = (w: number, color: number) => {
      g.rect(x, top, w, H).fill(color);
      const r = { x, w };
      x += w;
      return r;
    };
    const courses = (
      r: { x: number; w: number },
      step: number,
      color: number,
    ) => {
      for (let y = top + step; y < bottom; y += step)
        g.moveTo(r.x, y).lineTo(r.x + r.w, y);
      g.stroke({ width: 1, color, alpha: 0.8 });
    };
    const insulationFill = (r: { x: number; w: number }) => {
      g.moveTo(r.x + 2, top);
      for (let y = top, k = 0; y < bottom; y += 6, k++)
        g.lineTo(k % 2 ? r.x + 2 : r.x + r.w - 2, y);
      g.stroke({ width: 1.2, color: 0xd29f24 });
    };

    layer(6, 0xf1ebe1); // plaster
    const type: WallType = ins.wall.type;
    if (type === "solid") {
      courses(layer(64, 0xb5643c), 9, 0xd7b19a);
    } else {
      courses(layer(26, 0xbdb5a8), 22, 0xa59d90); // inner blockwork
      const cav = layer(16, type === "cavity" ? 0xf5f2ed : 0xf2c94c);
      if (type === "cavity") {
        for (let y = top + 40; y < bottom; y += 60)
          g.moveTo(cav.x, y).lineTo(cav.x + cav.w, y);
        g.stroke({ width: 1.5, color: 0x9a9388 }); // wall ties
      } else {
        insulationFill(cav);
      }
      courses(layer(24, 0xb5643c), 9, 0xd7b19a); // outer brick
      if (type === "ewi") {
        const e = layer(30, 0xe6ebef);
        for (let y = top + 4; y < bottom; y += 8)
          for (let dx = 5; dx < e.w; dx += 9) g.circle(e.x + dx, y, 1.1);
        g.fill(0xb7c0c8);
        layer(4, 0xf3eee4); // render
      }
    }
    g.rect(WALL_X, top, x - WALL_X, H).stroke({
      width: 1,
      color: 0x8f877b,
      alignment: 1,
    });
    this.wallEnd = x;

    this.sky
      .clear()
      .rect(x, 0, SCENE_W - x, FLOOR_Y)
      .fill(0xffffff);
    this.outsideGround
      .clear()
      .rect(x, FLOOR_Y - 4, SCENE_W - x, 10)
      .fill(0x7da35c)
      .rect(x, FLOOR_Y + 6, SCENE_W - x, VOID_BOTTOM - FLOOR_Y - 6)
      .fill(0x8a7660);

    // loft insulation
    const th = Math.max(3, ins.loft.mm * 0.14);
    const lg = this.loftG
      .clear()
      .rect(0, LOFT_FLOOR - th, WALL_X, th)
      .fill(0xf2c94c);
    if (th > 6) {
      lg.moveTo(0, LOFT_FLOOR - 2);
      for (let xx = 0, k = 0; xx <= WALL_X; xx += 10, k++)
        lg.lineTo(xx, k % 2 ? LOFT_FLOOR - th + 2 : LOFT_FLOOR - 2);
      lg.stroke({ width: 1.2, color: 0xd29f24 });
    }
    this.loftText.text = `Loft insulation ${ins.loft.mm} mm`;
    this.loftText.y = Math.max(4, LOFT_FLOOR - th - 18);

    const cx = (x + SCENE_W) / 2;
    this.outsideTitle.x = cx;
    this.outsideTemp.x = cx;
    for (const s of this.snow) s.x = x + Math.random() * (SCENE_W - x);
    this.layoutArrows();
  }

  private buildPipes(): void {
    const sim = this.sim;
    const casing = new Graphics();
    for (const path of ALL_PIPES)
      poly(casing, path.pts).stroke({
        width: 13,
        color: 0x36312c,
        cap: "round",
        join: "round",
      });
    // Valve bodies go *under* the pipe so the water and flow dots are seen
    // passing through them. The dark cavity reads as the inside of the body.
    const bodies = new Graphics();
    for (const b of [TRV_BODY, LS_BODY]) {
      bodies
        .roundRect(b.x, b.y, b.w, b.h, 4)
        .fill(0xd3d8dd)
        .stroke({ width: 1, color: 0x8b939b })
        .roundRect(b.x + 4, b.y + 3, b.w - 8, b.h - 7, 3)
        .fill(0x4f565d);
    }
    this.L.pipes.addChild(bodies, casing);

    // At the two bypass junctions three pipe ends meet. Rounded ends there
    // overlap in three colours and make a lumpy blob, so the cells touching a
    // junction get square ends instead: the pipe that feeds the junction fills
    // the junction square, and the branches start exactly at its edges.
    const { idx } = sim;
    const half = 4; // half the water stroke width
    const A = { x: TRV_X, y: JUNCTION_Y };
    const B = { x: LOCK_X, y: JUNCTION_Y };
    const startAt = (p: Pt) => (pts: Pt[]) => [p, ...pts.slice(1)];
    const endAt = (p: Pt) => (pts: Pt[]) => [...pts.slice(0, -1), p];
    const junctionEnds = new Map<number, (pts: Pt[]) => Pt[]>([
      [idx.flow.last, endAt({ x: A.x, y: A.y - half })], // feeds A
      [idx.trvTail.first, startAt({ x: A.x, y: A.y - half })],
      [idx.bypass.first, startAt({ x: A.x + half, y: A.y })],
      [idx.bypass.last, endAt({ x: B.x - half, y: B.y })],
      [idx.lsTail.last, endAt({ x: B.x, y: B.y - half })],
      [idx.ret.first, startAt({ x: B.x, y: B.y - half })], // fills B
    ]);

    for (const [i, pts] of this.pipeCells) {
      const fix = junctionEnds.get(i);
      const g = poly(new Graphics(), fix ? fix(pts) : pts).stroke({
        width: 2 * half,
        color: 0xffffff,
        cap: fix ? "butt" : "round",
        join: "round",
      });
      this.L.pipes.addChild(g);
      this.cellG[i] = g;
    }

    // Moving dots show where water is flowing; each branch has its own rate.
    const dotCtx = new GraphicsContext()
      .circle(0, 0, 1.3)
      .fill({ color: 0xffffff, alpha: 0.45 });
    const group = (
      paths: { path: Polyline; u: number }[],
      lpm: () => number,
    ) => {
      const dots = paths.map(({ path }) =>
        Array.from({ length: Math.ceil(path.length / DOT_GAP) + 1 }, () => {
          const d = new Graphics(dotCtx);
          this.L.pipes.addChild(d);
          return d;
        }),
      );
      this.dotGroups.push({ paths, dots, offset: 0, lpm });
    };
    // Circuit distances: flow pipe from 0; both branches start where it ends;
    // the return carries on from the end of the bypass, and the lockshield
    // tail is placed so it also lines up with the return.
    const lf = FLOW_PATH.length;
    const lb = BYPASS_PATH.length;
    group(
      [
        { path: FLOW_PATH, u: 0 },
        { path: RETURN_PATH, u: lf + lb },
      ],
      () => sim.flowLpm,
    );
    group(
      [
        { path: TRV_TAIL_PATH, u: lf },
        { path: LS_TAIL_PATH, u: lf + lb - LS_TAIL_PATH.length },
      ],
      () => sim.radFlowLpm,
    );
    group([{ path: BYPASS_PATH, u: lf }], () => sim.bypassLpm);

    // Automatic bypass valve: spring-loaded, opens as the TRV closes.
    const { x, y } = ABV;
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
    this.L.devices.addChild(abv);
    this.abvLabel = this.label("Bypass valve", x + 16, y - 24, {
      size: 11,
      color: MUTED,
    });
    this.abvLabel.visible = false; // shown only while the valve is hovered
  }

  private buildRadiator(): void {
    const { idx } = this.sim;
    const R = K.RAD_LAYERS;
    const lh = RAD.h / R;
    const grille = new Graphics()
      .roundRect(RAD.x + 3, RAD.y - 7, RAD.w - 6, 8, 2)
      .fill(0xdedcd6)
      .stroke({ width: 1, color: 0x9a968f });
    for (let x = RAD.x + 8; x < RAD.x + RAD.w - 6; x += 5)
      grille.moveTo(x, RAD.y - 5).lineTo(x, RAD.y - 1);
    grille.stroke({ width: 1, color: 0x9a968f, alpha: 0.7 });
    this.L.devices.addChild(grille);

    for (let i = 0; i < R; i++) {
      const g = new Graphics()
        .rect(RAD.x, RAD.y + i * lh, RAD.w, lh + 0.6)
        .fill(0xffffff);
      this.L.devices.addChild(g);
      this.cellG[idx.rad.first + i] = g;
    }
    const over = new Graphics();
    for (let x = RAD.x + 9; x < RAD.x + RAD.w - 4; x += 10)
      over.moveTo(x, RAD.y + 3).lineTo(x, RAD.y + RAD.h - 3);
    over.stroke({ width: 2, color: 0x000000, alpha: 0.1 });
    for (let x = RAD.x + 12; x < RAD.x + RAD.w - 4; x += 10)
      over.moveTo(x, RAD.y + 3).lineTo(x, RAD.y + RAD.h - 3);
    over.stroke({ width: 1, color: 0xffffff, alpha: 0.18 });
    over
      .roundRect(RAD.x, RAD.y, RAD.w, RAD.h, 3)
      .stroke({ width: 2, color: 0x76726b });
    this.L.devices.addChild(over);

    // TRV (flow side) and lockshield (return side)
    // Plugs on pins, drawn before the heads so the pins slide up out of sight.
    const plugCtx = new GraphicsContext()
      .rect(-1.5, -32, 3, 32)
      .fill(0xa7afb7)
      .roundRect(-7, 0, 14, 6, 1.5)
      .fill(0x1f1f1f);
    this.trvPlug = new Graphics(plugCtx);
    this.trvPlug.position.set(TRV_X, PLUG_CLOSED_Y - PLUG_TRAVEL);
    // Lockshield: short spindle that ends inside its cap; left fully open.
    const lsPlug = this.lsPlug
      .rect(-1.5, -16, 3, 16)
      .fill(0xa7afb7)
      .roundRect(-7, 0, 14, 6, 1.5)
      .fill(0x1f1f1f);
    lsPlug.position.set(LOCK_X, PLUG_CLOSED_Y - PLUG_TRAVEL); // moved by the setting in update()
    this.L.devices.addChild(this.trvPlug, lsPlug);

    // Union nuts where the pipes leave each body.
    const nuts = new Graphics()
      .rect(TRV_X - 8, TAIL_Y + BODY_DOWN - 3, 16, 4)
      .rect(TRV_X + 10, TAIL_Y - 8, 4, 16)
      .rect(LOCK_X - 14, TAIL_Y - 8, 4, 16)
      .rect(LOCK_X - 8, TAIL_Y + BODY_DOWN - 3, 16, 4)
      .fill(0xb9c0c7)
      .stroke({ width: 1, color: 0x7d858c });
    this.L.devices.addChild(nuts);

    const v = new Graphics()
      .roundRect(TRV_HEAD.x, TRV_HEAD.y, TRV_HEAD.w, TRV_HEAD.h, 6)
      .fill(0xfbfbf9)
      .stroke({ width: 1.5, color: 0xa9a399 });
    for (let y = TRV_HEAD.y + 7; y < TRV_HEAD.y + 28; y += 4)
      v.moveTo(TRV_HEAD.x + 4, y).lineTo(TRV_HEAD.x + TRV_HEAD.w - 4, y);
    v.stroke({ width: 1, color: 0xcfc9be });
    v.roundRect(TRV_HEAD.x + 4, TRV_HEAD.y + 32, TRV_HEAD.w - 8, 26, 3)
      .fill(0xf0eee8)
      .stroke({ width: 1, color: 0xbdb6aa });
    v.roundRect(LOCK_X - 7, TAIL_Y - 36, 14, 17, 3)
      .fill(0xfbfbf9)
      .stroke({ width: 1, color: 0xa9a399 });
    // Magnifier: leader from the cut-away to the real valve body.
    const lead = this.cutLead
      .circle(TRV_X, TAIL_Y - 4, 22)
      .stroke({ width: 1.5, color: 0x8a857c })
      .moveTo(CUT.x + CUT.w, CUT.y + 107)
      .lineTo(TRV_X - 21, TAIL_Y - 8)
      .stroke({ width: 1.5, color: 0x8a857c });
    this.L.devices.addChild(v, lead);

    this.cutaway = new TrvCutaway((s, x, y, o) => this.label(s, x, y, o));
    this.cutaway.position.set(CUT.x, CUT.y);
    // Shown only while the TRV is hovered (see update()).
    this.cutaway.alpha = lead.alpha = 0;
    this.cutaway.visible = lead.visible = false;
    this.L.devices.addChild(this.cutaway);

    this.trvNumber = this.label("4", TRV_X, TRV_HEAD.y + 45, {
      size: 16,
      weight: "700",
      ax: 0.5,
      ay: 0.5,
    });
    this.trvLabel = this.label("TRV", TRV_X, TRV_HEAD.y - 4, {
      size: 12,
      weight: "700",
      ax: 0.5,
      ay: 1,
    });
    this.trvLabel.visible = false; // shown only while the TRV is hovered
    this.lsLabel = this.label("Lockshield", LOCK_X + 16, TAIL_Y - 38, {
      size: 11,
      color: MUTED,
    });
    this.lsLabel.visible = false; // appears only while the lockshield is hovered
  }

  private buildBoiler(): void {
    const b = new Graphics();
    if (SHOW_FLUE)
      b.rect(100, 90, 20, 22)
        .fill(0xbab5ac)
        .stroke({ width: 1, color: 0x9a948a })
        .circle(110, 90, 10)
        .fill(0xa9a49a);
    b.roundRect(BOILER.x, BOILER.y, BOILER.w, BOILER.h, 10)
      .fill(0xf8f8f6)
      .stroke({ width: 2, color: 0xb3ada2 })
      .roundRect(DISPLAY.x, DISPLAY.y, DISPLAY.w, DISPLAY.h, 4)
      .fill(0x1f2b26)
      .roundRect(CUTAWAY.x, CUTAWAY.y, CUTAWAY.w, CUTAWAY.h, 6)
      .fill(0x2b2723);
    // gas pipe stub
    if (SHOW_GAS_PIPE) {
      poly(b, GAS_PIPE).stroke({ width: 9, color: 0x6b5a1e, cap: "round" });
      poly(b, GAS_PIPE).stroke({ width: 5, color: 0xe2b93b, cap: "round" });
    }
    // internal pipe casings
    poly(b, INT_FLOW).stroke({ width: 9, color: 0x161412 });
    poly(b, INT_RETURN).stroke({ width: 9, color: 0x161412 });
    this.L.devices.addChild(b);

    poly(this.intFlowG, INT_FLOW).stroke({ width: 5, color: 0xffffff });
    poly(this.intRetG, INT_RETURN).stroke({ width: 5, color: 0xffffff });
    this.hxG.roundRect(HX.x, HX.y, HX.w, HX.h, 4).fill(0xffffff);
    const fins = new Graphics();
    for (let x = HX.x + 5; x < HX.x + HX.w - 2; x += 6)
      fins.moveTo(x, HX.y + 2).lineTo(x, HX.y + HX.h - 2);
    fins.stroke({ width: 1.5, color: 0x000000, alpha: 0.22 });
    fins
      .roundRect(HX.x, HX.y, HX.w, HX.h, 4)
      .stroke({ width: 1.5, color: 0x0f0d0b });
    const burnerBar = new Graphics()
      .rect(BURNER.x, BURNER.y + BURNER.h - 4, BURNER.w, 4)
      .fill(0x8d8d8d);
    this.L.devices.addChild(
      this.intFlowG,
      this.intRetG,
      this.hxG,
      fins,
      burnerBar,
    );

    // flames: one stable shape each, animated by scale
    const flameCtx = new GraphicsContext()
      .moveTo(-4, 0)
      .quadraticCurveTo(-5.5, -7, 0, -15)
      .quadraticCurveTo(5.5, -7, 4, 0)
      .closePath()
      .fill({ color: 0xf59e0b, alpha: 0.95 })
      .moveTo(-2.2, 0)
      .quadraticCurveTo(-2.8, -4, 0, -8)
      .quadraticCurveTo(2.8, -4, 2.2, 0)
      .closePath()
      .fill(0x60a5fa);
    for (let i = 0; i < 5; i++) {
      const f = new Graphics(flameCtx);
      f.position.set(BURNER.x + 8 + i * 11, BURNER.y + BURNER.h - 4);
      this.flames.push(f);
      this.L.devices.addChild(f);
    }

    const pump = new Graphics()
      .circle(PUMP.x, PUMP.y, PUMP.r)
      .fill(0x56606b)
      .stroke({ width: 1.5, color: 0x9aa3ad });
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3;
      this.impeller.moveTo(0, 0).lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
    }
    this.impeller
      .stroke({ width: 2.5, color: 0xe5e7eb, cap: "round" })
      .circle(0, 0, 2.5)
      .fill(0xe5e7eb);
    this.impeller.position.set(PUMP.x, PUMP.y);
    this.L.devices.addChild(pump, this.impeller);

    this.displayTemp = this.label(
      "",
      DISPLAY.x + 9,
      DISPLAY.y + DISPLAY.h / 2,
      {
        size: 16,
        weight: "700",
        color: 0xb9f6ca,
        ay: 0.5,
      },
    );
    this.displayStatus = this.label(
      "",
      DISPLAY.x + DISPLAY.w - 8,
      DISPLAY.y + DISPLAY.h / 2,
      {
        size: 9,
        weight: "600",
        color: 0x8fd9a8,
        ax: 1,
        ay: 0.5,
        spacing: 0.5,
      },
    );
    // Power button: tinted green (on) or grey (off); glyph stays white.
    this.powerBtn.circle(POWER.x, POWER.y, POWER.r).fill(0xffffff);
    const glyph = new Graphics()
      .arc(
        POWER.x,
        POWER.y + 0.5,
        4.3,
        -Math.PI / 2 + 0.75,
        (3 * Math.PI) / 2 - 0.75,
      )
      .stroke({ width: 1.6, color: 0xffffff, cap: "round" })
      .moveTo(POWER.x, POWER.y - 5)
      .lineTo(POWER.x, POWER.y - 0.5)
      .stroke({ width: 1.6, color: 0xffffff, cap: "round" });
    this.L.devices.addChild(this.powerBtn, glyph);

    if (SHOW_GAS_PIPE)
      this.label("Gas", GAS_X, BOILER_BOTTOM + 42, {
        size: 11,
        color: MUTED,
        ax: 0.5,
      });
  }

  private buildThermostat(): void {
    const T = THERMOSTAT;
    const g = new Graphics()
      .roundRect(T.x, T.y, T.w, T.h, 8)
      .fill(0xfdfdfb)
      .stroke({ width: 1.5, color: 0xb9b2a6 });
    // Screen is tinted: pale green when on, grey when switched off.
    this.thermoScreen
      .roundRect(T.x + 8, T.y + 8, T.w - 16, 40, 4)
      .fill(0xffffff);
    this.led.circle(T.x + T.w - 14, T.y + T.h - 11, 4).fill(0xffffff);
    this.L.devices.addChild(g, this.thermoScreen, this.led);
    this.thermoTemp = this.label("", T.x + T.w / 2, THERMO_READ_Y, {
      size: 20,
      weight: "700",
      color: 0x1d2a24,
      ax: 0.5,
      ay: 0.5,
    });
    this.thermoSet = this.label("", T.x + T.w / 2, T.y + 39, {
      size: 12,
      weight: "600",
      color: 0x33403a,
      ax: 0.5,
      ay: 0.5,
    });
    this.thermoState = this.label("", T.x + 10, T.y + T.h - 11, {
      size: 9,
      weight: "600",
      color: MUTED,
      ay: 0.5,
    });
  }

  private buildEffects(): void {
    // snow
    const snowCtx = new GraphicsContext()
      .circle(0, 0, 2)
      .fill({ color: 0xffffff, alpha: 0.95 });
    for (let i = 0; i < 26; i++) {
      const g = new Graphics(snowCtx);
      this.snow.push({
        g,
        x: 0,
        y: Math.random() * FLOOR_Y,
        v: 18 + Math.random() * 22,
      });
      this.L.fx.addChild(g);
    }
    // heat-loss arrows
    const mk = (kind: HitKind, name: string): LossArrow => {
      const g = new Graphics();
      this.L.fx.addChild(g);
      return {
        kind,
        g,
        name: this.label(name, 0, 0, { size: 11, color: 0x8a3a0e }),
        value: this.label("", 0, 0, {
          size: 13,
          weight: "700",
          color: 0x8a3a0e,
        }),
        box: { x: 0, y: 0, w: 0, h: 0 },
        width: -1,
      };
    };
    this.arrows = [
      mk("loss-vent", "Draughts"),
      mk("loss-wall", "Walls"),
      mk("loss-roof", "Roof"),
    ];
    // Hidden until "Show heat loss" is ticked (drawArrows positions them).
    for (const a of this.arrows)
      a.g.visible = a.name.visible = a.value.visible = false;

    // hover highlight
    this.ring
      .circle(0, 0, 9)
      .stroke({ width: 3, color: 0x111111, alpha: 0.6 })
      .circle(0, 0, 9)
      .stroke({ width: 1.5, color: 0xffffff });
    this.layerBox
      .rect(-2, -1, RAD.w + 4, RAD.h / K.RAD_LAYERS + 2)
      .stroke({ width: 2, color: 0xffffff });
    this.ring.visible = this.layerBox.visible = false;
    this.L.overlay.addChild(this.ring, this.layerBox);
  }

  private buildLabels(): void {
    this.loftText = this.label("", 24, 30, {
      size: 11,
      weight: "600",
      color: 0x7a6420,
    });
    this.loftText.visible = false; // shown only while the loft is hovered
    // Outside reading sits level with the thermostat's temperature reading.
    this.outsideTitle = this.label("OUTSIDE", 0, THERMO_READ_Y - 13, {
      size: 11,
      weight: "600",
      color: 0x33475b,
      ax: 0.5,
      ay: 1,
      spacing: 1,
    });
    this.outsideTemp = this.label("", 0, THERMO_READ_Y, {
      size: 20,
      weight: "700",
      color: 0x1f3347,
      ax: 0.5,
      ay: 0.5,
    });
  }

  /** Arrow positions depend on how thick the wall is. */
  private layoutArrows(): void {
    for (const a of this.arrows) a.width = -1; // force redraw
  }

  private drawArrows(): void {
    const sim = this.sim;
    const c = lossCoefficients(sim.insulation);
    const dT = sim.Troom - sim.params.outdoor;
    const watts: Record<string, number> = {
      "loss-wall": c.wall * dT,
      "loss-vent": c.vent * dT,
      "loss-roof": c.roof * dT,
    };
    const x1 = WALL_X - 40;
    const x2 = Math.min(SCENE_W - 6, this.wallEnd + 66);
    for (const a of this.arrows) {
      const W = watts[a.kind];
      const show = this.showLosses && W > 5;
      a.g.visible = a.name.visible = a.value.visible = show;
      if (!show) continue;
      a.value.text = `${Math.round(W)} W`;
      const w = Math.round(clamp(2 + W / 22, 2, 24) * 2) / 2;
      if (w === a.width) continue;
      a.width = w;
      const head = 8 + w * 0.6;
      const hw = w / 2 + 4 + w * 0.25;
      const g = a.g.clear();
      if (a.kind === "loss-roof") {
        const x = ROOF_ARROW_X;
        const yb = 150;
        const yt = 6;
        g.poly([
          x - w / 2,
          yb,
          x - w / 2,
          yt + head,
          x - hw,
          yt + head,
          x,
          yt,
          x + hw,
          yt + head,
          x + w / 2,
          yt + head,
          x + w / 2,
          yb,
        ]).fill({
          color: LOSS_COLOR,
          alpha: 0.8,
        });
        a.name.position.set(x + hw + 6, 10);
        a.value.position.set(x + hw + 6, 24);
        a.box = { x: x - hw, y: yt, w: hw * 2 + 70, h: yb - yt };
      } else {
        // Draughts arrow sits above the outside reading so their labels never clash.
        const y = a.kind === "loss-vent" ? 150 : 445;
        g.poly([
          x1,
          y - w / 2,
          x2 - head,
          y - w / 2,
          x2 - head,
          y - hw,
          x2,
          y,
          x2 - head,
          y + hw,
          x2 - head,
          y + w / 2,
          x1,
          y + w / 2,
        ]).fill({
          color: LOSS_COLOR,
          alpha: 0.8,
        });
        a.name.position.set(this.wallEnd + 8, y + hw + 4);
        a.value.position.set(this.wallEnd + 8, y + hw + 18);
        a.box = { x: x1, y: y - hw, w: x2 - x1, h: hw * 2 + 34 };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  /** @param dt real seconds since last frame, @param speed sim-seconds per real second (0 when paused) */
  update(dt: number, speed: number): void {
    const sim = this.sim;
    const p = sim.params;
    this.clock += dt;
    if (p.insulation !== this.builtInsulation) this.rebuildFabric();

    // colours
    this.roomWall.tint = roomTint(sim.Troom);
    const sky = skyTint(p.outdoor);
    this.sky.tint = sky;
    for (let i = 0; i < sim.N; i++) {
      const g = this.cellG[i];
      if (!g) continue;
      const c = waterColor(sim.T[i]);
      if (c !== this.cellColor[i]) {
        this.cellColor[i] = c;
        g.tint = c;
      }
    }
    const hx = waterColor(sim.T[0]);
    this.hxG.tint = hx;
    this.intFlowG.tint = hx;
    this.intRetG.tint = waterColor(sim.T[sim.idx.ret.last]);
    this.led.tint = sim.demand ? 0xe34948 : 0xc9c4ba;
    this.thermoScreen.tint = p.thermostatOn ? 0xe9f0ec : 0xd0d3d1;

    // water movement
    // Pump speed sets the pace (capped so it stays watchable); each branch
    // moves in proportion to the share of the flow it carries.
    const pump = sim.flowLpm;
    const pumpPx = Math.min(
      (pump / 60 / K.PIPE_L_PER_M) * PX_PER_M * speed,
      160,
    );
    const main = this.dotGroups[0];
    for (const g of this.dotGroups) {
      const lpm = g.lpm();
      const flowing = lpm > 0.01;
      if (flowing && speed > 0 && pump > 0) {
        g.offset += pumpPx * (lpm / pump) * dt;
        // A branch carrying (almost) all the flow eases back into step with
        // the main loop so its dots run straight on through the junctions.
        if (g !== main && lpm > 0.98 * pump)
          g.offset += wrapPhase(main.offset - g.offset) * Math.min(1, dt * 3);
      }
      g.paths.forEach(({ path, u }, k) =>
        this.placeDots(path, g.dots[k], g.offset - u, flowing),
      );
    }

    // The plug in the real TRV body tracks the valve opening.
    this.trvLift += (sim.trvOpening - this.trvLift) * Math.min(1, dt * 6);
    this.trvPlug.y = PLUG_CLOSED_Y - PLUG_TRAVEL * this.trvLift;

    if (sim.pumpOn && speed > 0)
      this.impeller.rotation += dt * (3 + 12 * sim.trvOpening);

    const burning = sim.burnerW > 30;
    const intensity = 0.55 + 0.6 * Math.min(1, sim.burnerW / 2500);
    this.flames.forEach((f, i) => {
      f.visible = burning;
      if (burning)
        f.scale.set(
          1,
          intensity * (0.82 + 0.18 * Math.sin(this.clock * 17 + i * 1.9)),
        );
    });

    // snow when it's freezing
    const snowing = p.outdoor <= 0.5;
    for (const s of this.snow) {
      s.g.visible = snowing;
      if (!snowing) continue;
      s.y += s.v * dt;
      if (s.y > FLOOR_Y - 6) {
        s.y = 0;
        s.x = this.wallEnd + 4 + Math.random() * (SCENE_W - this.wallEnd - 8);
      }
      s.g.position.set(s.x + Math.sin(this.clock * 1.3 + s.v) * 3, s.y);
    }

    this.cutaway.update(sim, dt, speed);
    const onTrv =
      SHOW_TRV_CUTAWAY &&
      (this.hover?.kind === "trv" || this.hover?.kind === "trv-inset");
    this.cutHold = onTrv ? 0.8 : Math.max(0, this.cutHold - dt);
    const cutTarget = this.cutHold > 0 ? 1 : 0;
    const a =
      this.cutaway.alpha +
      (cutTarget - this.cutaway.alpha) * Math.min(1, dt * 10);
    this.cutaway.alpha = this.cutLead.alpha = a < 0.01 ? 0 : a;
    this.cutaway.visible = this.cutLead.visible = a >= 0.01;
    this.powerBtn.tint = p.boilerOn ? 0x16a34a : 0x9ca3af;
    const h = this.hover;
    this.loftText.visible = h?.kind === "loft";
    this.lsLabel.visible = h?.kind === "lockshield";
    this.lsPlug.y = PLUG_CLOSED_Y - PLUG_TRAVEL * sim.params.lockshield;
    this.trvLabel.visible = h?.kind === "trv" || h?.kind === "trv-inset";
    this.abvLabel.visible = h?.kind === "bypass-valve";

    if (this.clock - this.lastLabels > 0.2) {
      this.lastLabels = this.clock;
      this.updateLabels();
    }
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

  private updateLabels(): void {
    const sim = this.sim;
    const p = sim.params;
    const trv = TRV_SETTINGS[p.trvIndex];
    this.thermoTemp.text = `${sim.Troom.toFixed(1)}°`;
    this.thermoSet.text = p.thermostatOn
      ? `Set ${p.thermostatSet.toFixed(1)}°`
      : "Heating off";
    this.thermoState.text = !p.thermostatOn
      ? "OFF"
      : sim.demand
        ? "HEAT ON"
        : "IDLE";
    this.trvNumber.text = trv.label;
    this.displayTemp.text = p.boilerOn ? `${p.flowSet}°C` : "";
    this.displayStatus.text = STATUS_TEXT[sim.status];
    this.outsideTemp.text = `${p.outdoor.toFixed(0)} °C`;
    // Arrows are hidden by default: only redraw while shown (and once to hide).
    if (this.showLosses || this.lossesShown) this.drawArrows();
    this.lossesShown = this.showLosses;
  }
}
