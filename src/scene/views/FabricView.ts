/*
 * The building and the outdoors: loft, ceiling, boiler cupboard, internal
 * walls, floor void and ground; the external wall build-up, loft insulation,
 * sky and snow, which change with the insulation level and the weather; and,
 * with the day/night cycle on, a darker sky at night and a sun or moon.
 */
import { Graphics, GraphicsContext, type Text } from "pixi.js";
import type { WallType } from "../../sim/model";
import { daylight } from "../../sim/weather";
import { mixColor, skyTint } from "../colors";
import type { Frame, HitPass, SceneContext, View } from "../context";
import type { Pt } from "../geometry";
import type { Hit } from "../hit";

const snowCtx = new GraphicsContext()
  .circle(0, 0, 2)
  .fill({ color: 0xffffff, alpha: 0.95 });

/**
 * How fast precipitation moves at a simulation speed, relative to real
 * time. It speeds up with the simulation, but on a gentle curve (speed^0.3:
 * about 2.5x at 20x, 3.4x at 60x, 6.8x at 600x) so it stays watchable, and
 * it stops while paused.
 */
export const precipitationRate = (speed: number) =>
  speed > 0 ? Math.pow(speed, 0.3) : 0;

const NIGHT_SKY = 0x1d2b4c;
const NIGHT_GROUND = 0x4a5468; // tint that darkens the outside ground at night
const DAY_INK = { title: 0x33475b, temp: 0x1f3347 };
const NIGHT_INK = { title: 0xc9d6e6, temp: 0xffffff }; // readable on the night sky

// A small sun and moon by the outside reading (day/night cycle only).
const sunCtx = new GraphicsContext();
for (let k = 0; k < 8; k++) {
  const a = (k * Math.PI) / 4;
  sunCtx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
  sunCtx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
}
sunCtx
  .stroke({ width: 2, color: 0xf2b630, cap: "round" })
  .circle(0, 0, 6)
  .fill(0xf6c445);
const moonCtx = new GraphicsContext()
  .circle(0, 0, 7)
  .fill(0xf1eed6)
  .circle(-2, -2, 1.6)
  .circle(2.5, 1.5, 1.2)
  .fill(0xd8d3b3);

export class FabricView implements View {
  /** Outer face of the external wall (depends on the insulation build-up). */
  wallEnd: number;
  private readonly ctx: SceneContext;
  private readonly sky = new Graphics();
  private readonly outsideGround = new Graphics();
  private readonly wallG = new Graphics();
  private readonly loftG = new Graphics();
  private builtInsulation = "";
  private readonly snow: { g: Graphics; x: number; y: number; v: number }[] =
    [];
  /** Time as the snow sees it: runs at precipitationRate(speed). */
  private snowClock = 0;
  private readonly sun = new Graphics(sunCtx);
  private readonly moon = new Graphics(moonCtx);
  private night = false; // outside labels currently in their night colours
  private readonly outsideTitle: Text;
  private readonly outsideTemp: Text;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const { lay, layers } = ctx;
    this.wallEnd = lay.wallX + 72;

    const g = new Graphics();
    // loft void with rafters
    g.rect(0, 0, lay.wallX, lay.loftFloor).fill(0xe8e1d4);
    for (let x = -60; x < lay.wallX; x += 96)
      g.moveTo(x, lay.loftFloor).lineTo(x + 64, 0);
    g.stroke({ width: 3, color: 0xdad1c1 });
    g.rect(0, lay.loftFloor, lay.wallX, lay.ceilY - lay.loftFloor).fill(
      0xd5cec1,
    ); // ceiling
    const cb = lay.cupboard;
    g.rect(cb.x, cb.y, cb.w, cb.h).fill(0xe9e4da);
    // internal walls
    for (const w of lay.partitions) g.rect(w.x, w.y, w.w, w.h).fill(0xd3cbbe);
    for (const w of lay.partitions)
      g.moveTo(w.x, w.y)
        .lineTo(w.x, w.y + w.h)
        .moveTo(w.x + w.w, w.y)
        .lineTo(w.x + w.w, w.y + w.h);
    g.stroke({ width: 1, color: 0xbdb4a5 });
    // floorboards
    g.rect(0, lay.floorY, lay.wallX, 10).fill(0xa87d54);
    for (let x = 40; x < lay.wallX; x += 80)
      g.moveTo(x, lay.floorY).lineTo(x, lay.floorY + 10);
    g.stroke({ width: 1, color: 0x8a643f });
    // floor void with joists
    g.rect(
      0,
      lay.floorY + 10,
      lay.wallX,
      lay.voidBottom - lay.floorY - 10,
    ).fill(0x4a433c);
    for (let x = 30; x < lay.wallX; x += 110)
      g.rect(x, lay.floorY + 10, 14, 30).fill(0x6e5c49);
    // ground
    g.rect(0, lay.voidBottom, lay.W, lay.H - lay.voidBottom).fill(0x8b8378);
    for (let x = -80; x < lay.W; x += 22)
      g.moveTo(x, lay.H).lineTo(x + 68, lay.voidBottom);
    g.stroke({ width: 1, color: 0x7a7267 });
    layers.bg.addChild(g);

    layers.fabric.addChild(
      this.sky,
      this.outsideGround,
      this.wallG,
      this.loftG,
    );

    for (let i = 0; i < 26; i++) {
      const s = new Graphics(snowCtx);
      this.snow.push({
        g: s,
        x: 0,
        y: Math.random() * lay.floorY,
        v: 18 + Math.random() * 22,
      });
      layers.fx.addChild(s);
    }
    this.sun.visible = this.moon.visible = false;
    layers.fx.addChild(this.sun, this.moon);

    // Outside reading sits level with the thermostat's temperature reading.
    this.outsideTitle = ctx.label("OUTSIDE", 0, lay.thermoReadY - 13, {
      size: 11,
      weight: "600",
      color: 0x33475b,
      ax: 0.5,
      ay: 1,
      spacing: 1,
    });
    this.outsideTemp = ctx.label("", 0, lay.thermoReadY, {
      size: 20,
      weight: "700",
      color: 0x1f3347,
      ax: 0.5,
      ay: 0.5,
    });
    this.rebuild();
  }

  /** Wall build-up, loft insulation and outside area — depends on insulation level. */
  private rebuild(): void {
    const { sim, lay } = this.ctx;
    const ins = sim.insulation;
    this.builtInsulation = sim.params.insulation;

    const g = this.wallG.clear();
    const top = 0;
    const bottom = lay.voidBottom;
    const H = bottom - top;
    let x = lay.wallX;
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
    g.rect(lay.wallX, top, x - lay.wallX, H).stroke({
      width: 1,
      color: 0x8f877b,
      alignment: 1,
    });
    this.wallEnd = x;

    this.sky
      .clear()
      .rect(x, 0, lay.W - x, lay.floorY)
      .fill(0xffffff);
    this.outsideGround
      .clear()
      .rect(x, lay.floorY - 4, lay.W - x, 10)
      .fill(0x7da35c)
      .rect(x, lay.floorY + 6, lay.W - x, lay.voidBottom - lay.floorY - 6)
      .fill(0x8a7660);

    // loft insulation
    const th = Math.max(3, ins.loft.mm * 0.14);
    const lg = this.loftG
      .clear()
      .rect(0, lay.loftFloor - th, lay.wallX, th)
      .fill(0xf2c94c);
    if (th > 6) {
      lg.moveTo(0, lay.loftFloor - 2);
      for (let xx = 0, k = 0; xx <= lay.wallX; xx += 10, k++)
        lg.lineTo(xx, k % 2 ? lay.loftFloor - th + 2 : lay.loftFloor - 2);
      lg.stroke({ width: 1.2, color: 0xd29f24 });
    }

    const cx = (x + lay.W) / 2;
    this.outsideTitle.x = cx;
    this.outsideTemp.x = cx;
    // sun / moon just above the OUTSIDE title
    this.sun.position.set(cx, lay.thermoReadY - 42);
    this.moon.position.set(cx, lay.thermoReadY - 42);
    for (const s of this.snow) s.x = x + Math.random() * (lay.W - x);
  }

  update(f: Frame): void {
    const { sim, lay } = this.ctx;
    const p = sim.params;
    if (p.insulation !== this.builtInsulation) this.rebuild();
    const To = sim.outdoorT; // follows the day/night cycle if it's on

    // Sky colour follows the temperature; with the cycle on it darkens to a
    // night blue between dusk and dawn, and the ground darkens with it.
    const day = p.dayNight ? daylight(sim.time) : 1;
    const sky = skyTint(To);
    this.sky.tint = day < 1 ? mixColor(NIGHT_SKY, sky, day) : sky;
    this.outsideGround.tint =
      day < 1 ? mixColor(NIGHT_GROUND, 0xffffff, day) : 0xffffff;
    const night = day < 0.5;
    if (night !== this.night) {
      this.night = night;
      const ink = night ? NIGHT_INK : DAY_INK;
      this.outsideTitle.style.fill = ink.title;
      this.outsideTemp.style.fill = ink.temp;
    }
    this.sun.visible = p.dayNight && !night;
    this.moon.visible = p.dayNight && night;

    // Snow when it's freezing. It falls and sways faster at higher
    // simulation speeds and hangs still while paused.
    const snowing = To <= 0.5;
    const step = f.dt * precipitationRate(f.speed);
    this.snowClock += step;
    for (const s of this.snow) {
      s.g.visible = snowing;
      if (!snowing) continue;
      s.y += s.v * step;
      if (s.y > lay.floorY - 6) {
        s.y = 0;
        s.x = this.wallEnd + 4 + Math.random() * (lay.W - this.wallEnd - 8);
      }
      s.g.position.set(s.x + Math.sin(this.snowClock * 1.3 + s.v) * 3, s.y);
    }

    // (+ 0 turns -0 into 0, so a reading never shows "-0 °C")
    if (f.refreshText) this.outsideTemp.text = `${Math.round(To) + 0} °C`;
  }

  hitTest(p: Pt, pass: HitPass): Hit | null {
    if (pass !== "space") return null;
    const lay = this.ctx.lay;
    if (p.x >= lay.wallX && p.x <= this.wallEnd && p.y <= lay.voidBottom)
      return { kind: "wall" };
    if (p.y < lay.ceilY && p.x < lay.wallX) return { kind: "loft" };
    if (p.x > this.wallEnd && p.y < lay.voidBottom) return { kind: "outside" };
    return null;
  }
}
