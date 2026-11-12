/*
 * Magnified cut-away of the TRV valve body.
 *
 * The head holds a wax capsule. As the air warms towards the head's setting
 * the wax expands, pushes the pin down, and the plug (the "stopper") closes
 * onto the seat. Water squeezes through the gap between plug and seat.
 */
import { Container, Graphics, GraphicsContext, type Text } from "pixi.js";
import { TRV_SETTINGS, type Sim } from "../sim/model";
import { waterColor } from "./colors";
import { Polyline } from "./geometry";

export const CUTAWAY_W = 172;
export const CUTAWAY_H = 200;

const CX = 72; // centre line of orifice, pin and plug
const SEAT_Y = 122; // top face of the seat
const PLUG_H = 7;
const MAX_LIFT = 16; // plug travel, in drawing pixels, when fully open
const PIN_LEN = 50;
const BELLOWS_TOP = 30;
const BELLOWS_REF = 20; // bellows geometry is drawn this tall, then scaled

const BRASS = 0xcfa94e;
const BRASS_EDGE = 0x96752b;

type LabelFn = (
  str: string,
  x: number,
  y: number,
  o: {
    size?: number;
    color?: number;
    weight?: "500" | "600" | "700";
    ax?: number;
    ay?: number;
    parent?: Container;
  },
) => Text;

export class TrvCutaway extends Container {
  private readonly water = new Graphics();
  private readonly stem = new Graphics();
  private readonly bellows = new Graphics();
  private readonly dots: Graphics[] = [];
  private readonly state: Text;
  private offset = 0;
  private lift = 0; // smoothed, px
  private path: Polyline | null = null; // water path past the plug
  private pathLift = -1; // lift the path was built for
  private readonly scratch = { x: 0, y: 0 };

  constructor(label: LabelFn) {
    super();
    const card = new Graphics()
      .roundRect(0, 0, CUTAWAY_W, CUTAWAY_H, 8)
      .fill(0xfdfcf9)
      .stroke({ width: 1.5, color: 0xb9b2a6 });

    // Head (plastic) with the wax capsule inside.
    const head = new Graphics()
      .roundRect(40, 24, 64, 50, 7)
      .fill(0xf3f1ec)
      .stroke({ width: 1.5, color: 0xa9a399 });
    for (let x = 46; x < 100; x += 6) head.moveTo(x, 26).lineTo(x, 29);
    head.stroke({ width: 1, color: 0xc9c2b6 });

    // Brass body, outlet to the radiator (right) and inlet from the boiler (below).
    const body = new Graphics()
      .roundRect(26, 84, 116, 98, 8)
      .fill(BRASS)
      .stroke({ width: 1.5, color: BRASS_EDGE })
      .rect(138, 92, CUTAWAY_W - 138, 28)
      .fill(BRASS)
      .rect(56, 180, 32, CUTAWAY_H - 180)
      .fill(BRASS);
    body
      .moveTo(140, 92)
      .lineTo(CUTAWAY_W, 92)
      .moveTo(140, 120)
      .lineTo(CUTAWAY_W, 120)
      .moveTo(56, 182)
      .lineTo(56, CUTAWAY_H)
      .moveTo(88, 182)
      .lineTo(88, CUTAWAY_H)
      .stroke({ width: 1.5, color: BRASS_EDGE });
    // gland / bonnet the pin slides through
    body
      .rect(58, 74, 28, 12)
      .fill(0xc7ccd1)
      .stroke({ width: 1, color: 0x8b939b });

    // Water passages (white, tinted with the water temperature each frame).
    this.water
      .rect(40, 94, 92, SEAT_Y - 94)
      .rect(130, 98, CUTAWAY_W - 130, 18)
      .rect(CX - 9, SEAT_Y, 18, CUTAWAY_H - SEAT_Y)
      .fill(0xffffff);

    // Seat faces either side of the orifice.
    const seat = new Graphics()
      .rect(40, SEAT_Y, CX - 9 - 40, 3)
      .rect(CX + 9, SEAT_Y, 132 - (CX + 9), 3)
      .fill(BRASS_EDGE);

    // Pin + plug, drawn with the plug's sealing face at local y = 0.
    this.stem
      .rect(-2.5, -PLUG_H - 3 - PIN_LEN, 5, PIN_LEN)
      .fill(0xb8bec4)
      .stroke({ width: 1, color: 0x7d858c })
      .rect(-9, -PLUG_H - 3, 18, 3)
      .fill(0x8b939b)
      .roundRect(-14, -PLUG_H, 28, PLUG_H, 2)
      .fill(0x2b2b2b);

    // Wax capsule bellows, drawn BELLOWS_REF tall and stretched to meet the pin.
    this.bellows.rect(-16, 0, 32, BELLOWS_REF).fill(0xe2c766);
    for (let y = 3; y < BELLOWS_REF; y += 4)
      this.bellows.rect(-16, y, 32, 1.2).fill(0xb8932f);
    this.bellows.position.set(CX, BELLOWS_TOP);

    this.addChild(card, head, body, this.water, seat, this.bellows, this.stem);

    const dotCtx = new GraphicsContext()
      .circle(0, 0, 1.4)
      .fill({ color: 0xffffff, alpha: 0.5 });
    for (let i = 0; i < 8; i++) {
      const d = new Graphics(dotCtx);
      this.dots.push(d);
      this.addChild(d);
    }

    const MUTED = 0x6f6a62;
    label("Inside the TRV", 10, 7, { size: 11, weight: "700", parent: this });
    this.state = label("", CUTAWAY_W - 10, 7, {
      size: 11,
      weight: "600",
      ax: 1,
      parent: this,
    });
    label("Wax", 108, 32, { size: 10, color: MUTED, parent: this });
    label("capsule", 108, 44, { size: 10, color: MUTED, parent: this });
    label("Pin", 38, 71, { size: 10, color: MUTED, parent: this });
    label("Plug", 4, 98, { size: 10, color: MUTED, parent: this });
    label("Seat", 4, 117, { size: 10, color: MUTED, parent: this });
    label("from boiler", 94, 186, { size: 10, color: MUTED, parent: this });
    label("→ radiator", 109, 68, { size: 10, color: MUTED, parent: this });
  }

  update(sim: Sim, dt: number, speed: number): void {
    const target = sim.trvOpening * MAX_LIFT;
    if (!this.visible) {
      this.lift = target; // nothing to draw; be ready when shown
      return;
    }
    // Ease towards the target so the plug visibly travels rather than jumps.
    this.lift += (target - this.lift) * Math.min(1, dt * 6);
    const lift = this.lift;

    this.stem.position.set(CX, SEAT_Y - lift);
    const pinTop = SEAT_Y - lift - PLUG_H - 3 - PIN_LEN;
    this.bellows.scale.y = Math.max(0.2, (pinTop - BELLOWS_TOP) / BELLOWS_REF);
    this.water.tint = waterColor(sim.radInT);

    const trv = TRV_SETTINGS[sim.params.trvIndex];
    this.state.text =
      trv.target == null ? "shut" : `${Math.round(sim.trvOpening * 100)}% open`;

    // Water squeezing past the plug.
    const flowing = sim.radFlowLpm > 0.01 && lift > 0.4;
    const gapMid = SEAT_Y - lift / 2;
    if (!this.path || Math.abs(lift - this.pathLift) > 0.05) {
      this.pathLift = lift;
      this.path = new Polyline([
        { x: CX, y: CUTAWAY_H },
        { x: CX, y: SEAT_Y + 3 },
        { x: CX + 18, y: gapMid },
        { x: 128, y: Math.min(gapMid, 110) },
        { x: CUTAWAY_W, y: 107 },
      ]);
    }
    const path = this.path;
    if (flowing && speed > 0) this.offset += (10 + 45 * sim.trvOpening) * dt;
    const gap = path.length / this.dots.length;
    this.dots.forEach((d, i) => {
      d.visible = flowing;
      if (!flowing) return;
      const p = path.atInto(
        (this.offset + i * gap) % path.length,
        this.scratch,
      );
      d.position.set(p.x, p.y);
    });
  }
}
