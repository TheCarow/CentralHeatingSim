/*
 * The combi boiler: case, display, power button, heat exchanger, burner
 * flames and pump.
 */
import { Graphics, GraphicsContext, type Text } from "pixi.js";
import type { SimStatus } from "../../sim/model";
import { waterColor } from "../colors";
import {
  MUTED,
  poly,
  type Frame,
  type HitPass,
  type SceneContext,
  type View,
} from "../context";
import { distToPolyline, inRect, type Pt } from "../geometry";
import type { Hit } from "../hit";
import { onPowerButton, powerButton, powerTint } from "./powerButton";

const SHOW_FLUE = false; // exhaust flue on top of the boiler, hidden for now
const SHOW_GAS_PIPE = false; // gas supply stub under the boiler, hidden for now

const STATUS_TEXT: Record<SimStatus, string> = {
  standby: "STANDBY",
  overrun: "OVERRUN",
  bypass: "BYPASS",
  heating: "HEATING",
  idle: "AT TEMP",
  off: "OFF",
};

// Flames: one stable shape each, animated by scale.
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

/**
 * How fast the flames flicker at a simulation speed, relative to real time:
 * only slightly faster at high speeds (speed^0.15: about 1.6x at 20x, 2.6x
 * at 600x), and still while paused.
 */
const flickerRate = (speed: number) => (speed > 0 ? Math.pow(speed, 0.15) : 0);

export class BoilerView implements View {
  private readonly ctx: SceneContext;
  private readonly hxG = new Graphics();
  private readonly intFlowG = new Graphics();
  private readonly intRetG = new Graphics();
  private readonly flames: Graphics[] = [];
  /** Time as the flames see it: runs at flickerRate(speed). */
  private flameClock = 0;
  private readonly impeller = new Graphics();
  private readonly powerBtn: Graphics;
  private readonly displayTemp: Text;
  private readonly displayStatus: Text;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const bl = ctx.lay.boiler;
    const devices = ctx.layers.devices;

    const b = new Graphics();
    if (SHOW_FLUE) {
      const f = bl.flue;
      b.rect(f.x, f.y, f.w, f.h)
        .fill(0xbab5ac)
        .stroke({ width: 1, color: 0x9a948a })
        .circle(f.x + f.w / 2, f.y, 10)
        .fill(0xa9a49a);
    }
    b.roundRect(bl.body.x, bl.body.y, bl.body.w, bl.body.h, 10)
      .fill(0xf8f8f6)
      .stroke({ width: 2, color: 0xb3ada2 })
      .roundRect(bl.display.x, bl.display.y, bl.display.w, bl.display.h, 4)
      .fill(0x1f2b26)
      .roundRect(bl.cutaway.x, bl.cutaway.y, bl.cutaway.w, bl.cutaway.h, 6)
      .fill(0x2b2723);
    // gas pipe stub
    if (SHOW_GAS_PIPE) {
      poly(b, bl.gasPipe).stroke({ width: 9, color: 0x6b5a1e, cap: "round" });
      poly(b, bl.gasPipe).stroke({ width: 5, color: 0xe2b93b, cap: "round" });
    }
    // internal pipe casings
    poly(b, bl.intFlow).stroke({ width: 9, color: 0x161412 });
    poly(b, bl.intReturn).stroke({ width: 9, color: 0x161412 });
    devices.addChild(b);

    poly(this.intFlowG, bl.intFlow).stroke({ width: 5, color: 0xffffff });
    poly(this.intRetG, bl.intReturn).stroke({ width: 5, color: 0xffffff });
    const hx = bl.hx;
    this.hxG.roundRect(hx.x, hx.y, hx.w, hx.h, 4).fill(0xffffff);
    const fins = new Graphics();
    for (let x = hx.x + 5; x < hx.x + hx.w - 2; x += 6)
      fins.moveTo(x, hx.y + 2).lineTo(x, hx.y + hx.h - 2);
    fins.stroke({ width: 1.5, color: 0x000000, alpha: 0.22 });
    fins
      .roundRect(hx.x, hx.y, hx.w, hx.h, 4)
      .stroke({ width: 1.5, color: 0x0f0d0b });
    const burner = bl.burner;
    const burnerBar = new Graphics()
      .rect(burner.x, burner.y + burner.h - 4, burner.w, 4)
      .fill(0x8d8d8d);
    devices.addChild(this.intFlowG, this.intRetG, this.hxG, fins, burnerBar);

    for (let i = 0; i < 5; i++) {
      const f = new Graphics(flameCtx);
      f.position.set(burner.x + 8 + i * 11, burner.y + burner.h - 4);
      this.flames.push(f);
      devices.addChild(f);
    }

    const pump = new Graphics()
      .circle(bl.pump.x, bl.pump.y, bl.pump.r)
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
    this.impeller.position.set(bl.pump.x, bl.pump.y);
    devices.addChild(pump, this.impeller);

    const d = bl.display;
    this.displayTemp = ctx.label("", d.x + 9, d.y + d.h / 2, {
      size: 16,
      weight: "700",
      color: 0xb9f6ca,
      ay: 0.5,
    });
    this.displayStatus = ctx.label("", d.x + d.w - 8, d.y + d.h / 2, {
      size: 9,
      weight: "600",
      color: 0x8fd9a8,
      ax: 1,
      ay: 0.5,
      spacing: 0.5,
    });
    this.powerBtn = powerButton(devices, bl.power);

    if (SHOW_GAS_PIPE)
      ctx.label("Gas", bl.gasX, bl.bottom + 42, {
        size: 11,
        color: MUTED,
        ax: 0.5,
      });
  }

  update(f: Frame): void {
    const sim = this.ctx.sim;
    const p = sim.params;
    const c = sim.circuit;
    const hx = waterColor(sim.T[c.hx]);
    this.hxG.tint = hx;
    this.intFlowG.tint = hx;
    this.intRetG.tint = waterColor(sim.T[c.returnMain[0].last]);

    if (sim.pumpOn && f.speed > 0) {
      let opening = 0;
      for (const r of sim.rooms) opening += r.trvOpening;
      opening /= sim.rooms.length;
      this.impeller.rotation += f.dt * (3 + 12 * opening);
    }

    const burning = sim.burnerW > 30;
    const intensity = 0.55 + 0.6 * Math.min(1, sim.burnerW / 2500);
    this.flameClock += f.dt * flickerRate(f.speed);
    this.flames.forEach((fl, i) => {
      fl.visible = burning;
      if (burning)
        fl.scale.set(
          1,
          intensity * (0.82 + 0.18 * Math.sin(this.flameClock * 17 + i * 1.9)),
        );
    });
    this.powerBtn.tint = powerTint(p.boilerOn);

    if (f.refreshText) {
      this.displayTemp.text = p.boilerOn ? `${p.flowSet}°C` : "";
      this.displayStatus.text = STATUS_TEXT[sim.status];
    }
  }

  hitTest(p: Pt, pass: HitPass): Hit | null {
    const bl = this.ctx.lay.boiler;
    const c = this.ctx.sim.circuit;
    if (pass === "device") {
      if (onPowerButton(p, bl.power)) return { kind: "power" };
      if (inRect(p, bl.display)) return { kind: "display" };
      if (Math.hypot(p.x - bl.pump.x, p.y - bl.pump.y) <= bl.pump.r + 2)
        return { kind: "pump" };
      if (inRect(p, bl.hx)) return { kind: "cell", cell: c.hx };
      if (inRect(p, bl.burner)) return { kind: "burner" };
      if (distToPolyline(p, bl.intFlow) <= 6)
        return { kind: "cell", cell: c.hx };
      if (distToPolyline(p, bl.intReturn) <= 6)
        return { kind: "cell", cell: c.returnMain[0].last };
      if (SHOW_GAS_PIPE && distToPolyline(p, bl.gasPipe) <= 6)
        return { kind: "gas" };
    } else if (pass === "body") {
      if (inRect(p, bl.body)) return { kind: "boiler" };
    }
    return null;
  }
}
