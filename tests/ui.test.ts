/*
 * Clicking objects in the scene: which card each click opens, where the
 * card goes, and the small changes made by scrolling and power buttons.
 */
import { describe, expect, it } from "vitest";
import { MAX_ROOMS, makePlan } from "../src/house/plan";
import {
  CLICKABLE,
  SCROLLABLE,
  type Hit,
  type HitKind,
} from "../src/scene/hit";
import { computeLayout } from "../src/scene/layout";
import { Sim } from "../src/sim/model";
import { placeCard } from "../src/ui/placement";
import { RANGE, nudge, togglePower } from "../src/ui/settings";
import {
  anchorFor,
  bubbleFor,
  sameTarget,
  sidesFor,
  targetFor,
} from "../src/ui/targets";

const ALL_KINDS: HitKind[] = [
  "cell",
  "radiator",
  "trv",
  "trv-inset",
  "power",
  "lockshield",
  "thermostat",
  "thermostat-power",
  "display",
  "boiler",
  "pump",
  "burner",
  "gas",
  "wall",
  "loft",
  "outside",
  "loss-wall",
  "loss-roof",
  "loss-vent",
];
const POWER: HitKind[] = ["power", "thermostat-power"];

describe("what a click does", () => {
  it("opens a card for every clickable object except the power buttons", () => {
    for (const kind of ALL_KINDS) {
      const opens = targetFor({ kind }) !== null;
      expect(CLICKABLE.has(kind), kind).toBe(opens || POWER.includes(kind));
      if (POWER.includes(kind)) expect(opens, kind).toBe(false);
    }
  });

  it("shows a power button's details in its appliance's bubble", () => {
    expect(bubbleFor({ kind: "power" })).toEqual({ kind: "boiler" });
    expect(bubbleFor({ kind: "thermostat-power" })).toEqual({
      kind: "thermostat",
    });
    // Radiator water: a bubble with details only (no card to open).
    expect(bubbleFor({ kind: "radiator", cell: 40, room: 2 })).toEqual({
      kind: "radiator",
      room: 2,
    });
    expect(targetFor({ kind: "radiator", cell: 40, room: 2 })).toBeNull();
    // Everything else: its own card's bubble, or the pointer tooltip.
    for (const kind of ALL_KINDS)
      if (!POWER.includes(kind) && kind !== "radiator")
        expect(bubbleFor({ kind, room: 1 }), kind).toEqual(
          targetFor({ kind, room: 1 }),
        );
    expect(bubbleFor({ kind: "cell", cell: 3 })).toBeNull();
    expect(bubbleFor(null)).toBeNull();
  });

  it("can scroll only what can be clicked", () => {
    for (const kind of SCROLLABLE) expect(CLICKABLE.has(kind), kind).toBe(true);
  });

  it("opens the right radiator's TRV and lockshield cards", () => {
    expect(targetFor({ kind: "trv-inset", room: 2 })).toEqual({
      kind: "trv",
      room: 2,
    });
    expect(targetFor({ kind: "lockshield", room: 1 })).toEqual({
      kind: "lockshield",
      room: 1,
    });
    expect(
      sameTarget(
        targetFor({ kind: "trv", room: 1 }),
        targetFor({ kind: "trv-inset", room: 1 }),
      ),
    ).toBe(true);
    expect(
      sameTarget(
        targetFor({ kind: "trv", room: 0 }),
        targetFor({ kind: "trv", room: 1 }),
      ),
    ).toBe(false);
    expect(
      sameTarget(targetFor({ kind: "loft" }), targetFor({ kind: "wall" })),
    ).toBe(true);
  });

  it("points every bubble at a fixed spot inside the drawing", () => {
    for (let n = 1; n <= MAX_ROOMS; n++) {
      const lay = computeLayout(makePlan(n));
      const parts: Hit[] = [
        { kind: "boiler" },
        { kind: "power" },
        { kind: "thermostat" },
        { kind: "outside" },
        { kind: "wall" },
        { kind: "loft" },
        { kind: "loss-vent" },
        ...lay.rooms.flatMap((r): Hit[] => [
          { kind: "trv", room: r.index },
          { kind: "lockshield", room: r.index },
          { kind: "radiator", room: r.index },
        ]),
      ];
      for (const part of parts) {
        const r = anchorFor(bubbleFor(part)!, lay, part.kind);
        expect(r.x, part.kind).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(lay.W);
        expect(r.y + r.h).toBeLessThanOrEqual(lay.H);
      }
      // The outside bubble points at the OUTSIDE reading, past the wall.
      const out = anchorFor({ kind: "outside" }, lay);
      expect(out.x).toBeGreaterThan(lay.wallX);
      expect(out.y).toBeLessThan(lay.thermoReadY);
      expect(out.y + out.h).toBeGreaterThan(lay.thermoReadY);
      // Insulation points at the loft or the wall, whichever you came from.
      const ins = { kind: "insulation" } as const;
      expect(anchorFor(ins, lay, "loss-roof")).toEqual(
        anchorFor(ins, lay, "loft"),
      );
      expect(anchorFor(ins, lay, "loss-wall")).toEqual(
        anchorFor(ins, lay, "wall"),
      );
      expect(
        anchorFor(ins, lay, "loft").y + anchorFor(ins, lay, "loft").h,
      ).toBe(lay.ceilY);
      expect(anchorFor(ins, lay, "wall").x).toBe(lay.wallX);
    }
  });
});

describe("where a card goes", () => {
  const bounds = { x: 0, y: 0, w: 1000, h: 600 };
  const page = { x: 0, y: 0, w: 1200, h: Infinity };

  it("sits above a small object, pointing at its middle", () => {
    const anchor = { x: 480, y: 400, w: 40, h: 40 };
    const p = placeCard(anchor, 280, 150, bounds, page);
    expect(p.side).toBe("above");
    expect(p.y + 150).toBeLessThanOrEqual(anchor.y);
    expect(p.x + p.arrow).toBeCloseTo(500, 6);
  });

  it("goes below when there's no room above", () => {
    const anchor = { x: 480, y: 40, w: 40, h: 40 };
    const p = placeCard(anchor, 280, 150, bounds, page);
    expect(p.side).toBe("below");
    expect(p.y).toBeGreaterThanOrEqual(anchor.y + anchor.h);
  });

  it("always puts the boiler's and thermostat's bubbles below them", () => {
    const anchor = { x: 480, y: 300, w: 40, h: 40 }; // room above and below
    expect(placeCard(anchor, 280, 150, bounds, page).side).toBe("above");
    for (const kind of ["boiler", "thermostat"] as const) {
      const p = placeCard(anchor, 280, 150, bounds, page, sidesFor({ kind }));
      expect(p.side, kind).toBe("below");
      expect(p.y).toBeGreaterThanOrEqual(anchor.y + anchor.h);
    }
    const rad = placeCard(
      { x: 480, y: 300, w: 200, h: 100 },
      280,
      150,
      bounds,
      page,
      sidesFor({ kind: "radiator", room: 0 }),
    );
    expect(rad.side).toBe("above"); // radiator water: always on top
    // Others go wherever fits.
    expect(sidesFor({ kind: "trv", room: 0 })).toBeUndefined();
    expect(sidesFor({ kind: "outside" })).toBeUndefined();
  });

  it("goes beside a tall object", () => {
    const anchor = { x: 100, y: 60, w: 120, h: 480 };
    const p = placeCard(anchor, 280, 150, bounds, page);
    expect(p.side).toBe("right");
    expect(p.x).toBeGreaterThanOrEqual(anchor.x + anchor.w);
    expect(p.y + p.arrow).toBeCloseTo(300, 6);
  });

  it("stays inside the drawing near its edge, the pointer still on the object", () => {
    const anchor = { x: 970, y: 400, w: 20, h: 40 };
    const p = placeCard(anchor, 280, 150, bounds, page);
    expect(p.x + 280).toBeLessThanOrEqual(bounds.w);
    expect(p.arrow).toBeLessThanOrEqual(280 - 18);
  });

  it("hangs under a drawing too small for it, on the page, pointing up", () => {
    const small = { x: 10, y: 100, w: 340, h: 200 };
    const anchor = { x: 300, y: 150, w: 20, h: 20 };
    const p = placeCard(anchor, 300, 160, small, {
      x: 0,
      y: 0,
      w: 360,
      h: Infinity,
    });
    expect(p.side).toBe("below");
    expect(p.y).toBeGreaterThanOrEqual(small.y + small.h);
    expect(p.x).toBeGreaterThanOrEqual(8);
    expect(p.x + 300).toBeLessThanOrEqual(360 - 8);
    expect(p.x + p.arrow).toBeCloseTo(310, 6); // under the object
  });

  it("hangs under a small drawing even where it would fit, so it hides little", () => {
    const small = { x: 0, y: 0, w: 360, h: 210 }; // a phone
    const anchor = { x: 330, y: 150, w: 2, h: 2 }; // e.g. a tap outside
    const p = placeCard(anchor, 150, 100, small, page);
    expect(p.side).toBe("above"); // a small card still goes beside it
    const q = placeCard(anchor, 280, 120, small, page);
    expect(q.side).toBe("below");
    expect(q.y).toBeGreaterThanOrEqual(small.h);
  });
});

describe("scrolling and power buttons", () => {
  it("turns objects a notch within their ranges", () => {
    const sim = new Sim(makePlan(2));
    const p = sim.params;
    const at = (kind: HitKind, room?: number): Hit => ({ kind, room });

    const flow = p.flowSet;
    nudge(p, at("boiler"), 1);
    expect(p.flowSet).toBe(flow + RANGE.flow.step);

    p.thermostatSet = RANGE.thermostat.max;
    nudge(p, at("thermostat"), 1);
    expect(p.thermostatSet).toBe(RANGE.thermostat.max);

    p.radiators[1].lockshield = 0.1;
    nudge(p, at("lockshield", 1), -1);
    expect(p.radiators[1].lockshield).toBeCloseTo(0.1, 9);
    nudge(p, at("lockshield", 1), 1);
    expect(p.radiators[1].lockshield).toBeCloseTo(0.2, 9);
    expect(p.radiators[0].lockshield).toBe(1);

    const trv = p.radiators[1].trvIndex;
    nudge(p, at("trv", 1), -1);
    expect(p.radiators[1].trvIndex).toBe(trv - 1);

    const out = p.outdoor;
    nudge(p, at("power"), 1); // not scrollable: no change anywhere
    expect(p.outdoor).toBe(out);
  });

  it("switches the boiler and the thermostat from their own buttons", () => {
    const p = new Sim().params;
    const boiler = p.boilerOn;
    const stat = p.thermostatOn;
    expect(togglePower(p, { kind: "power" })).toBe(true);
    expect(p.boilerOn).toBe(!boiler);
    expect(togglePower(p, { kind: "thermostat-power" })).toBe(true);
    expect(p.thermostatOn).toBe(!stat);
    expect(togglePower(p, { kind: "thermostat" })).toBe(false);
    expect(p.thermostatOn).toBe(!stat);
  });
});
