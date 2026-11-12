/*
 * Where everything sits in the cut-away drawing, computed from the house plan.
 *
 * All coordinates are in "design space": the scene draws in these units and
 * scales the whole world to fit the canvas. Drawing, hit-testing and per-frame
 * updates all read positions from here, so there is one place to change when
 * rooms are added or resized.
 *
 * No PixiJS imports: this is plain geometry and can be unit-tested.
 */
import type { HousePlan } from "../house/plan";
import type { EdgeRole } from "../sim/circuit";
import { Polyline, type Pt, type Rect } from "./geometry";

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface BoilerLayout {
  body: Rect;
  display: Rect;
  power: Circle; // on/off button
  cutaway: Rect; // dark opening showing the heat exchanger and burner
  hx: Rect;
  burner: Rect;
  pump: Circle;
  flue: Rect;
  flowX: number; // where flow and return leave the bottom of the case
  returnX: number;
  gasX: number;
  bottom: number;
  intFlow: Pt[]; // inside the case: heat exchanger -> flow outlet
  intReturn: Pt[]; // return inlet -> heat exchanger
  gasPipe: Pt[];
}

export interface RoomLayout {
  index: number;
  /** The room's air space, ceiling to floor. */
  rect: Rect;
  rad: Rect;
  tailY: number; // height of the radiator tails
  trvX: number; // centre line of the TRV (flow side)
  lockX: number; // centre line of the lockshield (return side)
  trvHead: Rect;
  trvBody: Rect;
  lsBody: Rect;
  lockshield: Rect; // lockshield cap and body, for hover
  plugClosedY: number; // valve plugs sit here when shut
  /** Where the magnified TRV cut-away card goes. */
  cut: Rect;
  /** Where this radiator's TRV tail leaves the flow main... */
  teeFlow: Pt;
  /** ...and where its lockshield tail joins the return main. */
  teeReturn: Pt;
}

/** Where one pipe passes in front of another (they are not joined). */
export interface Crossing {
  at: Pt;
  front: { role: EdgeRole; n: number };
  back: { role: EdgeRole; n: number };
}

export interface LossArrowLayout {
  wallX1: number; // horizontal arrows start inside the room...
  ventY: number;
  wallY: number;
  roofX: number;
  roofTop: number;
  roofBottom: number;
}

export interface HouseLayout {
  W: number;
  H: number;
  loftFloor: number;
  ceilY: number;
  floorY: number;
  voidBottom: number;
  /** Inner face of the external (gable) wall at the end of the row. */
  wallX: number;
  cupboard: Rect;
  /** Internal walls: cupboard | room 1, room 1 | room 2, ... */
  partitions: Rect[];
  boiler: BoilerLayout;
  flowY: number; // flow main under the floor
  returnY: number; // return main under the floor
  junctionY: number; // bypass tees under the last radiator
  rooms: RoomLayout[];
  thermostat: Rect;
  /** Centre of the thermostat's big reading (the outside reading lines up). */
  thermoReadY: number;
  bypass: { valve: Pt; box: Rect };
  losses: LossArrowLayout;
  pipes: {
    flow: Polyline[];
    ret: Polyline[];
    trvTail: Polyline[];
    lsTail: Polyline[];
    bypass: Polyline;
  };
  /** Each lockshield drop (except the last) crosses the flow main in front. */
  crossings: Crossing[];
}

/** Size of the magnified TRV cut-away card. */
export const CUTAWAY_W = 172;
export const CUTAWAY_H = 200;

// ---- Fixed parts of the drawing ---------------------------------------------
const H = 700;
const LOFT_FLOOR = 76;
const CEIL_Y = 84;
const FLOOR_Y = 560;
const VOID_BOTTOM = 632;
const CUPBOARD_W = 300;
const PARTITION_W = 16;
const OUTSIDE_W = 200; // from the inner face of the gable wall to the edge
const FLOW_Y = 588;
const RETURN_Y = 612;
const JUNCTION_Y = 546;

// One room fills the original 1200-wide drawing. With more rooms they share
// a slightly wider drawing, so each room is narrower.
const ONE_ROOM_W = 684;
const ROOMS_BUDGET = 1000; // design units for rooms + their internal walls

/** Interior width of each room when there are n of them. */
export function roomWidth(n: number): number {
  return n === 1 ? ONE_ROOM_W : Math.floor(ROOMS_BUDGET / n) - PARTITION_W;
}

// Inside a room. The radiator sits towards the right-hand wall; it keeps its
// full width while the room has space for it and the valves either side.
const RAD_Y = 392;
const RAD_MAX_W = 220;
const RAD_H = 118;
const RAD_SPACE = 160; // room width the radiator leaves for valves and margins
const TAIL_DY = 6; // tails run this far above the radiator's bottom edge
const VALVE_DX = 23; // valve centre lines, out from the radiator's ends
const BODY_UP = 20; // valve body extends this far above the tail line...
const BODY_DOWN = 13; // ...and this far below it
const THERMOSTAT_DX = 64;
const CUT_DX = 36;
const ROOF_ARROW_DX = 170;

function boiler(): BoilerLayout {
  const body = { x: 90, y: 110, w: 160, h: 250 };
  const hx = { x: 116, y: 168, w: 108, h: 38 };
  const bottom = body.y + body.h;
  const flowX = 215;
  const returnX = 130;
  const gasX = 172;
  return {
    body,
    display: { x: 104, y: 120, w: 108, h: 30 },
    power: { x: 228, y: 135, r: 9 },
    cutaway: { x: 102, y: 158, w: 136, h: 190 },
    hx,
    burner: { x: 140, y: 208, w: 60, h: 22 },
    pump: { x: 130, y: 300, r: 13 },
    flue: { x: 100, y: 90, w: 20, h: 22 },
    flowX,
    returnX,
    gasX,
    bottom,
    intFlow: [
      { x: flowX, y: hx.y + hx.h },
      { x: flowX, y: bottom },
    ],
    intReturn: [
      { x: returnX, y: bottom },
      { x: returnX, y: hx.y + hx.h },
    ],
    gasPipe: [
      { x: gasX, y: bottom },
      { x: gasX, y: bottom + 38 },
    ],
  };
}

function roomLayout(
  index: number,
  x: number,
  w: number,
  last: boolean,
): RoomLayout {
  const radW = Math.min(RAD_MAX_W, w - RAD_SPACE);
  const rightGap = Math.min(150, Math.max(40, Math.round(w * 0.22)));
  const rad = { x: x + w - rightGap - radW, y: RAD_Y, w: radW, h: RAD_H };
  const tailY = rad.y + rad.h - TAIL_DY;
  const trvX = rad.x - VALVE_DX;
  const lockX = rad.x + rad.w + VALVE_DX;
  const body = (cx: number): Rect => ({
    x: cx - 13,
    y: tailY - BODY_UP,
    w: 26,
    h: BODY_UP + BODY_DOWN,
  });
  return {
    index,
    rect: { x, y: CEIL_Y, w, h: FLOOR_Y - CEIL_Y },
    rad,
    tailY,
    trvX,
    lockX,
    trvHead: { x: trvX - 15, y: 420, w: 30, h: 64 },
    trvBody: body(trvX),
    lsBody: body(lockX),
    lockshield: { x: lockX - 13, y: tailY - 36, w: 26, h: 49 },
    plugClosedY: tailY + 1,
    cut: { x: x + CUT_DX, y: 338, w: CUTAWAY_W, h: CUTAWAY_H },
    // The last radiator's tees sit on the bypass, just under the radiator;
    // the others branch straight off the mains under the floor.
    teeFlow: { x: trvX, y: last ? JUNCTION_Y : FLOW_Y },
    teeReturn: { x: lockX, y: last ? JUNCTION_Y : RETURN_Y },
  };
}

export function computeLayout(plan: HousePlan): HouseLayout {
  const n = plan.rooms.length;
  const cupboard = { x: 0, y: CEIL_Y, w: CUPBOARD_W, h: FLOOR_Y - CEIL_Y };
  const partitions: Rect[] = [];
  const rooms: RoomLayout[] = [];
  const roomW = roomWidth(n);
  let x = CUPBOARD_W;
  for (let k = 0; k < n; k++) {
    partitions.push({ x, y: CEIL_Y, w: PARTITION_W, h: FLOOR_Y - CEIL_Y });
    x += PARTITION_W;
    rooms.push(roomLayout(k, x, roomW, k === n - 1));
    x += roomW;
  }
  const wallX = x;
  const b = boiler();
  const last = rooms[n - 1];

  // ---- pipe runs, matching the circuit's edges ----
  const flow: Polyline[] = [];
  const ret: Polyline[] = [];
  const trvTail: Polyline[] = [];
  const lsTail: Polyline[] = [];
  for (let k = 0; k < n; k++) {
    const r = rooms[k];
    const start: Pt[] =
      k === 0
        ? [
            { x: b.flowX, y: b.bottom },
            { x: b.flowX, y: FLOW_Y },
          ]
        : [{ x: rooms[k - 1].trvX, y: FLOW_Y }];
    const end: Pt[] = [{ x: r.trvX, y: FLOW_Y }];
    if (k === n - 1) end.push(r.teeFlow); // up to the bypass tee
    flow.push(new Polyline([...start, ...end]));

    trvTail.push(
      new Polyline([
        r.teeFlow,
        { x: r.trvX, y: r.tailY },
        { x: r.rad.x, y: r.tailY },
      ]),
    );
    lsTail.push(
      new Polyline([
        { x: r.rad.x + r.rad.w, y: r.tailY },
        { x: r.lockX, y: r.tailY },
        r.teeReturn,
      ]),
    );

    const from: Pt[] = [r.teeReturn];
    if (k === n - 1) from.push({ x: r.lockX, y: RETURN_Y }); // down from the bypass tee
    const to: Pt[] =
      k === 0
        ? [
            { x: b.returnX, y: RETURN_Y },
            { x: b.returnX, y: b.bottom },
          ]
        : [{ x: rooms[k - 1].lockX, y: RETURN_Y }];
    ret.push(new Polyline([...from, ...to]));
  }
  const bypass = new Polyline([
    { x: last.trvX, y: JUNCTION_Y },
    { x: last.lockX, y: JUNCTION_Y },
  ]);
  const valve = { x: (last.trvX + last.lockX) / 2, y: JUNCTION_Y };

  const statRoom = rooms[plan.thermostatRoom];
  const thermostat = {
    x: statRoom.rect.x + THERMOSTAT_DX,
    y: 236,
    w: 90,
    h: 70,
  };

  return {
    W: wallX + OUTSIDE_W,
    H,
    loftFloor: LOFT_FLOOR,
    ceilY: CEIL_Y,
    floorY: FLOOR_Y,
    voidBottom: VOID_BOTTOM,
    wallX,
    cupboard,
    partitions,
    boiler: b,
    flowY: FLOW_Y,
    returnY: RETURN_Y,
    junctionY: JUNCTION_Y,
    rooms,
    thermostat,
    thermoReadY: thermostat.y + 21,
    bypass: {
      valve,
      box: { x: valve.x - 14, y: JUNCTION_Y - 24, w: 28, h: 32 },
    },
    losses: {
      wallX1: wallX - 40,
      ventY: 150,
      wallY: 445,
      roofX: rooms[0].rect.x + ROOF_ARROW_DX,
      roofTop: 6,
      roofBottom: 150,
    },
    pipes: { flow, ret, trvTail, lsTail, bypass },
    crossings: findCrossings([
      ...flow.map((path, k) => ({ role: "flow" as const, n: k, path })),
      ...trvTail.map((path, k) => ({ role: "trvTail" as const, n: k, path })),
      ...lsTail.map((path, k) => ({ role: "lsTail" as const, n: k, path })),
      { role: "bypass" as const, n: 0, path: bypass },
      ...ret.map((path, k) => ({ role: "ret" as const, n: k, path })),
    ]),
  };
}

/**
 * Points where a vertical stretch of one pipe passes over a horizontal
 * stretch of another, away from either's ends (so not a tee). Every pipe
 * run is made of horizontal and vertical segments. The vertical pipe is
 * drawn in front.
 */
function findCrossings(
  runs: { role: EdgeRole; n: number; path: Polyline }[],
): Crossing[] {
  const out: Crossing[] = [];
  const segs = runs.flatMap((r) =>
    r.path.pts.slice(1).map((b, i) => ({ r, a: r.path.pts[i], b })),
  );
  const inside = (v: number, p: number, q: number) =>
    v > Math.min(p, q) + 0.5 && v < Math.max(p, q) - 0.5;
  for (const v of segs) {
    if (v.a.x !== v.b.x) continue; // vertical segments only
    for (const h of segs) {
      if (h.r === v.r || h.a.y !== h.b.y) continue; // horizontal, other pipe
      if (inside(v.a.x, h.a.x, h.b.x) && inside(h.a.y, v.a.y, v.b.y))
        out.push({
          at: { x: v.a.x, y: h.a.y },
          front: { role: v.r.role, n: v.r.n },
          back: { role: h.r.role, n: h.r.n },
        });
    }
  }
  return out;
}

/** The drawn path of a circuit edge (null for the boiler and radiators). */
export function pathFor(
  lay: HouseLayout,
  role: EdgeRole,
  n: number,
): Polyline | null {
  switch (role) {
    case "flow":
      return lay.pipes.flow[n];
    case "ret":
      return lay.pipes.ret[n];
    case "trvTail":
      return lay.pipes.trvTail[n];
    case "lsTail":
      return lay.pipes.lsTail[n];
    case "bypass":
      return lay.pipes.bypass;
    case "hx":
    case "rad":
      return null;
  }
}
