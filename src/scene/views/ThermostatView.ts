/*
 * The room thermostat on the wall of the thermostat room: a screen with
 * the room temperature and set-point, a "calling" light with the status,
 * and a power button like the boiler's.
 */
import { Graphics, type Text } from "pixi.js";
import {
  MUTED,
  type Frame,
  type HitPass,
  type SceneContext,
  type View,
} from "../context";
import { inRect, type Pt } from "../geometry";
import type { Hit } from "../hit";
import { onPowerButton, powerButton, powerTint } from "./powerButton";

export class ThermostatView implements View {
  private readonly ctx: SceneContext;
  private readonly screen = new Graphics();
  private readonly led = new Graphics();
  private readonly powerBtn: Graphics;
  private readonly temp: Text;
  private readonly set: Text;
  private readonly state: Text;

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
    const T = ctx.lay.thermostat;
    const g = new Graphics()
      .roundRect(T.x, T.y, T.w, T.h, 8)
      .fill(0xfdfdfb)
      .stroke({ width: 1.5, color: 0xb9b2a6 });
    // Screen is tinted: pale green when on, grey when switched off.
    this.screen.roundRect(T.x + 8, T.y + 8, T.w - 16, 40, 4).fill(0xffffff);
    // Bottom strip: calling light and status on the left, power on the right.
    const stripY = ctx.lay.thermostatPower.y;
    this.led.circle(T.x + 13, stripY, 3.5).fill(0xffffff);
    ctx.layers.devices.addChild(g, this.screen, this.led);
    this.powerBtn = powerButton(ctx.layers.devices, ctx.lay.thermostatPower);
    this.temp = ctx.label("", T.x + T.w / 2, ctx.lay.thermoReadY, {
      size: 20,
      weight: "700",
      color: 0x1d2a24,
      ax: 0.5,
      ay: 0.5,
    });
    this.set = ctx.label("", T.x + T.w / 2, T.y + 39, {
      size: 12,
      weight: "600",
      color: 0x33403a,
      ax: 0.5,
      ay: 0.5,
    });
    this.state = ctx.label("", T.x + 21, stripY, {
      size: 9,
      weight: "600",
      color: MUTED,
      ay: 0.5,
    });
  }

  update(f: Frame): void {
    const sim = this.ctx.sim;
    const p = sim.params;
    this.led.tint = sim.demand ? 0xe34948 : 0xc9c4ba;
    this.screen.tint = p.thermostatOn ? 0xe9f0ec : 0xd0d3d1;
    this.powerBtn.tint = powerTint(p.thermostatOn);
    if (!f.refreshText) return;
    this.temp.text = `${sim.thermostatT.toFixed(1)}°`;
    this.set.text = p.thermostatOn
      ? `Set ${p.thermostatSet.toFixed(1)}°`
      : "Heating off";
    this.state.text = !p.thermostatOn ? "OFF" : sim.demand ? "HEAT ON" : "IDLE";
  }

  hitTest(p: Pt, pass: HitPass): Hit | null {
    if (pass !== "device") return null;
    const lay = this.ctx.lay;
    const room = this.ctx.sim.thermostatRoom;
    if (onPowerButton(p, lay.thermostatPower))
      return { kind: "thermostat-power", room };
    if (inRect(p, lay.thermostat, 2)) return { kind: "thermostat", room };
    return null;
  }
}
