/*
 * Heat-loss arrows through the walls, roof and draughts, sized by the watts
 * escaping. Hidden unless "Show heat loss" is ticked.
 */
import { Graphics, type Text } from "pixi.js";
import { clamp } from "../../sim/model";
import type { Frame, HitPass, SceneContext, View } from "../context";
import { inRect, type Pt, type Rect } from "../geometry";
import type { Hit, HitKind } from "../hit";
import type { FabricView } from "./FabricView";

const LOSS_COLOR = 0xe8590c;

interface LossArrow {
  kind: HitKind;
  g: Graphics;
  name: Text;
  value: Text;
  box: Rect;
  width: number; // drawn shaft width; -1 forces a redraw
}

export class LossArrowsView implements View {
  private readonly ctx: SceneContext;
  private readonly fabric: FabricView;
  private readonly arrows: LossArrow[];
  private shown = false;
  private builtWallEnd = -1;

  constructor(ctx: SceneContext, fabric: FabricView) {
    this.ctx = ctx;
    this.fabric = fabric;
    const mk = (kind: HitKind, name: string): LossArrow => {
      const g = new Graphics();
      ctx.layers.fx.addChild(g);
      return {
        kind,
        g,
        name: ctx.label(name, 0, 0, { size: 11, color: 0x8a3a0e }),
        value: ctx.label("", 0, 0, {
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
    // Hidden until "Show heat loss" is ticked (draw() positions them).
    for (const a of this.arrows)
      a.g.visible = a.name.visible = a.value.visible = false;
  }

  update(f: Frame): void {
    if (!f.refreshText) return;
    // Hidden by default: only redraw while shown (and once to hide).
    if (f.showLosses || this.shown) this.draw(f.showLosses);
    this.shown = f.showLosses;
  }

  private draw(showLosses: boolean): void {
    const lay = this.ctx.lay;
    const wallEnd = this.fabric.wallEnd;
    // Arrow ends depend on how thick the wall is.
    if (wallEnd !== this.builtWallEnd) {
      this.builtWallEnd = wallEnd;
      for (const a of this.arrows) a.width = -1;
    }
    const lw = this.ctx.sim.lossWatts();
    const watts: Record<string, number> = {
      "loss-wall": lw.wall,
      "loss-vent": lw.vent,
      "loss-roof": lw.roof,
    };
    const la = lay.losses;
    const x1 = la.wallX1;
    const x2 = Math.min(lay.W - 6, wallEnd + 66);
    for (const a of this.arrows) {
      const W = watts[a.kind];
      const show = showLosses && W > 5;
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
        const x = la.roofX;
        const yb = la.roofBottom;
        const yt = la.roofTop;
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
        const y = a.kind === "loss-vent" ? la.ventY : la.wallY;
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
        a.name.position.set(wallEnd + 8, y + hw + 4);
        a.value.position.set(wallEnd + 8, y + hw + 18);
        a.box = { x: x1, y: y - hw, w: x2 - x1, h: hw * 2 + 34 };
      }
    }
  }

  hitTest(p: Pt, pass: HitPass): Hit | null {
    if (pass !== "body") return null;
    for (const a of this.arrows)
      if (a.g.visible && inRect(p, a.box, 4)) return { kind: a.kind };
    return null;
  }
}
