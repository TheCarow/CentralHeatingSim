/*
 * The illustrated cut-away house, drawn with PixiJS.
 *
 * This is the host: it owns the Pixi application, scales the drawing to fit
 * the canvas, routes pointer input, and drives the views that draw each part
 * (views/). Positions come from layout.ts, computed from the house plan.
 *
 * Everything is drawn in "design space" inside `world`, which is scaled to
 * fit the canvas. Geometry is built once; per frame the views only change
 * tints (water colours), transforms (flow dots, flames, pump) and a few
 * throttled text labels.
 */
import {
  Application,
  Container,
  Graphics,
  type FederatedPointerEvent,
} from "pixi.js";
import type { Sim } from "../sim/model";
import {
  HIT_PASSES,
  SceneContext,
  destroyTree,
  makeLayers,
  type Frame,
  type View,
} from "./context";
import type { Pt, Rect } from "./geometry";
import { CLICKABLE, SCROLLABLE, type Hit } from "./hit";
import { computeLayout, type HouseLayout } from "./layout";
import { BoilerView } from "./views/BoilerView";
import { FabricView } from "./views/FabricView";
import { LossArrowsView } from "./views/LossArrowsView";
import { PipeNetworkView } from "./views/PipeNetworkView";
import { RoomView } from "./views/RoomView";
import { ThermostatView } from "./views/ThermostatView";

export { CLICKABLE, SCROLLABLE, type Hit, type HitKind } from "./hit";

const TEXT_REFRESH_S = 0.2; // labels update at most this often
const BACKGROUND = 0xf1ede5; // round the drawing when it doesn't fill the canvas

export class HeatingScene {
  readonly app = new Application();
  hover: Hit | null = null;
  /** Heat-loss arrows (walls, roof, draughts) are hidden unless switched on. */
  showLosses = false;
  /** The pointer moved: what it's over (null for nothing) and where. */
  onHover?: (hit: Hit | null, clientX: number, clientY: number) => void;
  /** A click or tap, and what it hit (null for nothing clickable). */
  onClick?: (hit: Hit | null) => void;
  /** Scrolled over an object that can be turned up (1) or down (-1). */
  onAdjust?: (hit: Hit, dir: 1 | -1) => void;

  private sim: Sim;
  /** Where everything sits, from the house plan. */
  private lay: HouseLayout;
  private readonly world = new Container();
  /** Plain bands round the drawing, over anything drawn past its edges. */
  private readonly letterbox = new Graphics();
  private ctx!: SceneContext;
  /** Views in drawing order; hit-testing asks them in this order too. */
  private views: View[] = [];
  private clock = 0;
  private lastText = -1;

  constructor(sim: Sim) {
    this.sim = sim;
    this.lay = computeLayout(sim.plan);
  }

  async init(el: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: el,
      background: BACKGROUND,
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
    this.app.stage.addChild(this.world, this.letterbox);
    this.build();

    new ResizeObserver(() => this.app.queueResize()).observe(el);
    this.app.renderer.on("resize", (w: number, h: number) => this.layout(w, h));
    this.layout(this.app.screen.width, this.app.screen.height);
    this.setupInput();
  }

  /**
   * Show a different house (e.g. another number of rooms): throw away every
   * view and build them again for the new sim and its layout.
   */
  setSim(sim: Sim): void {
    this.sim = sim;
    this.lay = computeLayout(sim.plan);
    for (const layer of this.world.removeChildren()) destroyTree(layer);
    this.build();
    this.layout(this.app.screen.width, this.app.screen.height);
    this.setHover(null, 0, 0);
  }

  /** Where everything sits in the drawing (design space). */
  get houseLayout(): HouseLayout {
    return this.lay;
  }

  /** The drawing as it sits in the canvas, in page (document) coordinates. */
  drawingOnPage(): Rect {
    return this.toPage({ x: 0, y: 0, w: this.lay.W, h: this.lay.H });
  }

  /** A design-space rectangle in page (document) coordinates. */
  toPage(r: Rect): Rect {
    const b = this.app.canvas.getBoundingClientRect();
    const c = { x: b.left + scrollX, y: b.top + scrollY };
    const s = this.world.scale.x;
    return {
      x: c.x + this.world.x + r.x * s,
      y: c.y + this.world.y + r.y * s,
      w: r.w * s,
      h: r.h * s,
    };
  }

  /** Create the drawing layers and every view, back to front. */
  private build(): void {
    const layers = makeLayers();
    for (const layer of Object.values(layers)) this.world.addChild(layer);
    const ctx = (this.ctx = new SceneContext(this.sim, this.lay, layers));
    const fabric = new FabricView(ctx);
    this.views = [
      fabric,
      new PipeNetworkView(ctx),
      ...this.lay.rooms.map((r) => new RoomView(ctx, r.index)),
      new BoilerView(ctx),
      new ThermostatView(ctx),
      new LossArrowsView(ctx, fabric),
    ];
    const n = this.lay.rooms.length;
    this.app.canvas.setAttribute(
      "aria-label",
      `Cut-away of ${n === 1 ? "a room" : `${n} rooms`} heated by a combi boiler: pipes, ${n === 1 ? "radiator" : "radiators"} with TRV and lockshield, room thermostat and external wall.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Layout & input
  // ---------------------------------------------------------------------------

  /**
   * Fit the drawing to the canvas (which fills the window under the top
   * bar), centred. On a portrait screen it sits at the top, leaving the room
   * below it for the bubbles.
   */
  private layout(w: number, h: number): void {
    const lay = this.lay;
    const s = Math.min(w / lay.W, h / lay.H);
    this.world.scale.set(s);
    const spareY = h - lay.H * s;
    const x0 = (w - lay.W * s) / 2;
    const y0 = h > w ? 0 : spareY / 2;
    this.world.position.set(x0, y0);
    const dw = lay.W * s;
    const dh = lay.H * s;
    this.letterbox
      .clear()
      .rect(0, 0, w, y0)
      .rect(0, y0 + dh, w, h - y0 - dh)
      .rect(0, y0, x0, dh)
      .rect(x0 + dw, y0, w - x0 - dw, dh)
      .fill(BACKGROUND);
    // Keep text crisp when the scene is scaled up.
    // Quantised so small size changes don't re-rasterise every label.
    this.ctx.setTextResolution(
      this.app.renderer.resolution * Math.max(1, Math.ceil(s * 2) / 2),
    );
  }

  private setupInput(): void {
    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = this.app.screen;
    // Hit-testing is done in hitTest(); stop Pixi walking every child per event.
    stage.interactiveChildren = false;

    stage.on("pointermove", (e: FederatedPointerEvent) => {
      // Pixi hears pointer moves over the whole page. Only those over the
      // canvas itself count: not over a pinned bubble lying on top of it.
      if (e.nativeEvent.target !== this.app.canvas) {
        if (this.hover) this.setHover(null, 0, 0);
        stage.cursor = "default";
        return;
      }
      const hit = this.hitTest(this.world.toLocal(e.global));
      stage.cursor = hit && CLICKABLE.has(hit.kind) ? "pointer" : "default";
      this.setHover(hit, e.client.x, e.client.y);
    });
    // Every tap is reported, on nothing too (that closes an open bubble).
    stage.on("pointertap", (e: FederatedPointerEvent) => {
      const hit = this.hitTest(this.world.toLocal(e.global));
      this.onClick?.(hit && CLICKABLE.has(hit.kind) ? hit : null);
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
        if (hit && SCROLLABLE.has(hit.kind)) {
          e.preventDefault();
          this.onAdjust?.(hit, e.deltaY < 0 ? 1 : -1);
        }
      },
      { passive: false },
    );
  }

  private setHover(hit: Hit | null, x: number, y: number): void {
    this.hover = hit;
    for (const v of this.views) v.setHover?.(hit);
    this.onHover?.(hit, x, y);
  }

  /** What is at design-space point p (small devices win over what's behind). */
  hitTest(p: Pt): Hit | null {
    const lay = this.lay;
    if (p.x < 0 || p.y < 0 || p.x > lay.W || p.y > lay.H) return null;
    for (const pass of HIT_PASSES)
      for (const v of this.views) {
        const hit = v.hitTest?.(p, pass);
        if (hit) return hit;
      }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  /** @param dt real seconds since last frame, @param speed sim-seconds per real second (0 when paused) */
  update(dt: number, speed: number): void {
    this.clock += dt;
    const refreshText = this.clock - this.lastText > TEXT_REFRESH_S;
    if (refreshText) this.lastText = this.clock;
    const f: Frame = {
      dt,
      speed,
      clock: this.clock,
      hover: this.hover,
      refreshText,
      showLosses: this.showLosses,
    };
    for (const v of this.views) v.update(f);
  }
}
