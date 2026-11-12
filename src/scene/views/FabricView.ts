/*
 * The building and the outdoors: loft, ceiling, boiler cupboard, internal
 * walls, floor void and ground; the external wall build-up, loft insulation,
 * sky and snow, which change with the insulation level and the weather.
 */
import { Graphics, GraphicsContext, type Text } from "pixi.js";
import type { WallType } from "../../sim/model";
import { skyTint } from "../colors";
import type { Frame, HitPass, SceneContext, View } from "../context";
import { inRect, type Pt } from "../geometry";
import type { Hit } from "../hit";

const snowCtx = new GraphicsContext()
  .circle(0, 0, 2)
  .fill({ color: 0xffffff, alpha: 0.95 });

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
  private readonly loftText: Text;
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

    this.loftText = ctx.label("", 24, 30, {
      size: 11,
      weight: "600",
      color: 0x7a6420,
    });
    this.loftText.visible = false; // shown only while the loft is hovered
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
    this.loftText.text = `Loft insulation ${ins.loft.mm} mm`;
    this.loftText.y = Math.max(4, lay.loftFloor - th - 18);

    const cx = (x + lay.W) / 2;
    this.outsideTitle.x = cx;
    this.outsideTemp.x = cx;
    for (const s of this.snow) s.x = x + Math.random() * (lay.W - x);
  }

  update(f: Frame): void {
    const { sim, lay } = this.ctx;
    const p = sim.params;
    if (p.insulation !== this.builtInsulation) this.rebuild();
    this.sky.tint = skyTint(p.outdoor);

    // snow when it's freezing
    const snowing = p.outdoor <= 0.5;
    for (const s of this.snow) {
      s.g.visible = snowing;
      if (!snowing) continue;
      s.y += s.v * f.dt;
      if (s.y > lay.floorY - 6) {
        s.y = 0;
        s.x = this.wallEnd + 4 + Math.random() * (lay.W - this.wallEnd - 8);
      }
      s.g.position.set(s.x + Math.sin(f.clock * 1.3 + s.v) * 3, s.y);
    }

    this.loftText.visible = f.hover?.kind === "loft";
    if (f.refreshText) this.outsideTemp.text = `${p.outdoor.toFixed(0)} °C`;
  }

  hitTest(p: Pt, pass: HitPass): Hit | null {
    if (pass !== "space") return null;
    const lay = this.ctx.lay;
    if (p.x >= lay.wallX && p.x <= this.wallEnd && p.y <= lay.voidBottom)
      return { kind: "wall" };
    if (p.y < lay.ceilY && p.x < lay.wallX) return { kind: "loft" };
    if (p.x > this.wallEnd && p.y < lay.voidBottom) return { kind: "outside" };
    if (p.y >= lay.floorY && p.y < lay.voidBottom && p.x < lay.wallX)
      return { kind: "void" };
    if (inRect(p, lay.cupboard)) return { kind: "cupboard" };
    return null;
  }
}
