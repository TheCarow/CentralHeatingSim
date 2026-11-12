/*
 * One room: its wall tint, the radiator (water in layers), the TRV and
 * lockshield with their moving plugs, the TRV cut-away, and - in rooms
 * without the thermostat - a temperature reading on the wall.
 */
import { Graphics, GraphicsContext, type Text } from "pixi.js";
import { TRV_SETTINGS } from "../../sim/model";
import { roomTint, waterColor } from "../colors";
import {
  type Frame,
  type HitPass,
  type SceneContext,
  type View,
} from "../context";
import { inRect, type Pt } from "../geometry";
import { roomOf, type Hit } from "../hit";
import type { RoomLayout } from "../layout";
import { TrvCutaway } from "../TrvCutaway";

const SHOW_TRV_CUTAWAY = false; // magnified TRV diagram on hover, hidden for now
// Plug travel on the real valves: closed, the plug sits across the inlet just
// below the corner; fully open, it is lifted clear of the channel.
const PLUG_TRAVEL = 14;

// Plugs on pins (TRV) and a short spindle ending inside the cap (lockshield).
const trvPlugCtx = new GraphicsContext()
  .rect(-1.5, -32, 3, 32)
  .fill(0xa7afb7)
  .roundRect(-7, 0, 14, 6, 1.5)
  .fill(0x1f1f1f);
const lsPlugCtx = new GraphicsContext()
  .rect(-1.5, -16, 3, 16)
  .fill(0xa7afb7)
  .roundRect(-7, 0, 14, 6, 1.5)
  .fill(0x1f1f1f);

export class RoomView implements View {
  readonly index: number;
  private readonly ctx: SceneContext;
  private readonly rl: RoomLayout;
  private readonly firstLayer: number; // model cell of the radiator's top layer
  private readonly layers: Graphics[] = [];
  private readonly colors: Int32Array;
  private readonly wall = new Graphics();
  private readonly trvPlug: Graphics;
  private readonly lsPlug: Graphics;
  private trvLift = 1; // eased 0..1 plug lift shown on the real TRV
  private readonly cutaway: TrvCutaway;
  private readonly cutLead = new Graphics();
  private cutHold = 0; // seconds the cut-away stays up after the pointer leaves the TRV
  private readonly layerBox = new Graphics();
  private readonly trvNumber: Text;
  /** Room temperature, where the thermostat doesn't already show it. */
  private readonly reading: Text | null = null;

  constructor(ctx: SceneContext, index: number) {
    this.ctx = ctx;
    this.index = index;
    const { sim, lay, layers } = ctx;
    const rl = (this.rl = lay.rooms[index]);
    const rad = rl.rad;
    const edge = sim.circuit.radiators[index].rad;
    this.firstLayer = edge.first;
    const R = edge.cells;
    this.colors = new Int32Array(R).fill(-1);

    this.wall.rect(rl.rect.x, rl.rect.y, rl.rect.w, rl.rect.h).fill(0xffffff);
    layers.bg.addChild(this.wall);

    // Radiator: grille on top, water in layers, then the panel's ribs.
    const lh = rad.h / R;
    const grille = new Graphics()
      .roundRect(rad.x + 3, rad.y - 7, rad.w - 6, 8, 2)
      .fill(0xdedcd6)
      .stroke({ width: 1, color: 0x9a968f });
    for (let x = rad.x + 8; x < rad.x + rad.w - 6; x += 5)
      grille.moveTo(x, rad.y - 5).lineTo(x, rad.y - 1);
    grille.stroke({ width: 1, color: 0x9a968f, alpha: 0.7 });
    layers.devices.addChild(grille);

    for (let i = 0; i < R; i++) {
      const g = new Graphics()
        .rect(rad.x, rad.y + i * lh, rad.w, lh + 0.6)
        .fill(0xffffff);
      layers.devices.addChild(g);
      this.layers.push(g);
    }
    const over = new Graphics();
    for (let x = rad.x + 9; x < rad.x + rad.w - 4; x += 10)
      over.moveTo(x, rad.y + 3).lineTo(x, rad.y + rad.h - 3);
    over.stroke({ width: 2, color: 0x000000, alpha: 0.1 });
    for (let x = rad.x + 12; x < rad.x + rad.w - 4; x += 10)
      over.moveTo(x, rad.y + 3).lineTo(x, rad.y + rad.h - 3);
    over.stroke({ width: 1, color: 0xffffff, alpha: 0.18 });
    over
      .roundRect(rad.x, rad.y, rad.w, rad.h, 3)
      .stroke({ width: 2, color: 0x76726b });
    layers.devices.addChild(over);

    // TRV (flow side) and lockshield (return side). Plugs are drawn before
    // the heads so the pins slide up out of sight.
    this.trvPlug = new Graphics(trvPlugCtx);
    this.trvPlug.position.set(rl.trvX, rl.plugClosedY - PLUG_TRAVEL);
    this.lsPlug = new Graphics(lsPlugCtx);
    this.lsPlug.position.set(rl.lockX, rl.plugClosedY - PLUG_TRAVEL); // moved by the setting in update()
    layers.devices.addChild(this.trvPlug, this.lsPlug);

    // Union nuts where the pipes leave each body.
    const nuts = new Graphics()
      .rect(rl.trvX - 8, rl.trvBody.y + rl.trvBody.h - 3, 16, 4)
      .rect(rl.trvX + 10, rl.tailY - 8, 4, 16)
      .rect(rl.lockX - 14, rl.tailY - 8, 4, 16)
      .rect(rl.lockX - 8, rl.lsBody.y + rl.lsBody.h - 3, 16, 4)
      .fill(0xb9c0c7)
      .stroke({ width: 1, color: 0x7d858c });
    layers.devices.addChild(nuts);

    const head = rl.trvHead;
    const v = new Graphics()
      .roundRect(head.x, head.y, head.w, head.h, 6)
      .fill(0xfbfbf9)
      .stroke({ width: 1.5, color: 0xa9a399 });
    for (let y = head.y + 7; y < head.y + 28; y += 4)
      v.moveTo(head.x + 4, y).lineTo(head.x + head.w - 4, y);
    v.stroke({ width: 1, color: 0xcfc9be });
    v.roundRect(head.x + 4, head.y + 32, head.w - 8, 26, 3)
      .fill(0xf0eee8)
      .stroke({ width: 1, color: 0xbdb6aa });
    v.roundRect(rl.lockX - 7, rl.tailY - 36, 14, 17, 3)
      .fill(0xfbfbf9)
      .stroke({ width: 1, color: 0xa9a399 });
    // Magnifier: leader from the cut-away to the real valve body.
    const lead = this.cutLead
      .circle(rl.trvX, rl.tailY - 4, 22)
      .stroke({ width: 1.5, color: 0x8a857c })
      .moveTo(rl.cut.x + rl.cut.w, rl.cut.y + 107)
      .lineTo(rl.trvX - 21, rl.tailY - 8)
      .stroke({ width: 1.5, color: 0x8a857c });
    layers.devices.addChild(v, lead);

    this.cutaway = new TrvCutaway((s, x, y, o) => ctx.label(s, x, y, o));
    this.cutaway.radiator = index;
    this.cutaway.position.set(rl.cut.x, rl.cut.y);
    // Shown only while the TRV is hovered (see update()).
    this.cutaway.alpha = lead.alpha = 0;
    this.cutaway.visible = lead.visible = false;
    layers.devices.addChild(this.cutaway);

    this.trvNumber = ctx.label("4", rl.trvX, head.y + 45, {
      size: 16,
      weight: "700",
      ax: 0.5,
      ay: 0.5,
    });
    // Rooms without the thermostat show their temperature on the wall,
    // level with the thermostat's reading.
    if (index !== sim.thermostatRoom)
      this.reading = ctx.label("", rl.reading.x, rl.reading.y, {
        size: 20,
        weight: "700",
        ax: 0.5,
        ay: 0.5,
      });

    // Hover highlight for a radiator layer.
    this.layerBox
      .rect(-2, -1, rad.w + 4, lh + 2)
      .stroke({ width: 2, color: 0xffffff });
    this.layerBox.visible = false;
    layers.overlay.addChild(this.layerBox);
  }

  /** Is this hit on one of this room's things? */
  private mine(h: Hit | null): boolean {
    return h != null && roomOf(h) === this.index;
  }

  update(f: Frame): void {
    const { sim } = this.ctx;
    const k = this.index;
    const room = sim.rooms[k];
    const { dt, speed } = f;

    this.wall.tint = roomTint(room.T);
    for (let i = 0; i < this.layers.length; i++) {
      const col = waterColor(sim.T[this.firstLayer + i]);
      if (col !== this.colors[i]) {
        this.colors[i] = col;
        this.layers[i].tint = col;
      }
    }

    // The plug in the real TRV body tracks the valve opening.
    this.trvLift += (room.trvOpening - this.trvLift) * Math.min(1, dt * 6);
    this.trvPlug.y = this.rl.plugClosedY - PLUG_TRAVEL * this.trvLift;
    this.lsPlug.y =
      this.rl.plugClosedY - PLUG_TRAVEL * sim.params.radiators[k].lockshield;

    const h = f.hover;
    const onTrv =
      this.mine(h) && (h?.kind === "trv" || h?.kind === "trv-inset");
    this.cutaway.update(sim, dt, speed);
    this.cutHold =
      SHOW_TRV_CUTAWAY && onTrv ? 0.8 : Math.max(0, this.cutHold - dt);
    const cutTarget = this.cutHold > 0 ? 1 : 0;
    const a =
      this.cutaway.alpha +
      (cutTarget - this.cutaway.alpha) * Math.min(1, dt * 10);
    this.cutaway.alpha = this.cutLead.alpha = a < 0.01 ? 0 : a;
    this.cutaway.visible = this.cutLead.visible = a >= 0.01;

    if (f.refreshText) {
      this.trvNumber.text =
        TRV_SETTINGS[sim.params.radiators[k].trvIndex].label;
      if (this.reading) this.reading.text = `${room.T.toFixed(1)} °C`;
    }
  }

  hitTest(p: Pt, pass: HitPass): Hit | null {
    const rl = this.rl;
    const room = this.index;
    if (pass === "device") {
      if (inRect(p, rl.trvHead, 3)) return { kind: "trv", room };
      if (inRect(p, rl.trvBody, 2)) return { kind: "trv-inset", room };
      if (this.cutaway.alpha > 0.3 && inRect(p, rl.cut))
        return { kind: "trv-inset", room };
      if (inRect(p, rl.lockshield, 2)) return { kind: "lockshield", room };
    } else if (pass === "body") {
      if (inRect(p, rl.rad)) {
        const R = this.layers.length;
        const layer = Math.min(
          R - 1,
          Math.max(0, Math.floor(((p.y - rl.rad.y) / rl.rad.h) * R)),
        );
        return { kind: "radiator", cell: this.firstLayer + layer, room };
      }
    }
    return null;
  }

  setHover(hit: Hit | null): void {
    const i = hit?.kind === "radiator" ? (hit.cell ?? -1) : -1;
    const layer = i - this.firstLayer;
    const on = layer >= 0 && layer < this.layers.length;
    this.layerBox.visible = on;
    if (on)
      this.layerBox.position.set(
        this.rl.rad.x,
        this.rl.rad.y + (layer * this.rl.rad.h) / this.layers.length,
      );
  }
}
