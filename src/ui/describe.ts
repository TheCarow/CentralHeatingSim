/*
 * What the hover tooltip says about each part of the scene, from live sim state.
 */
import type { Hit } from "../scene/HeatingScene";
import { K, TRV_SETTINGS, type Sim, type SimStatus } from "../sim/model";
import type { CellInfo } from "../sim/circuit";
import { toCss, waterColor } from "../scene/colors";

export interface TipRow {
  label: string;
  value: string;
  key?: string; // CSS colour for a line key (chart tooltip)
  dashed?: boolean;
}

export interface TipContent {
  title: string;
  value?: string;
  swatch?: string; // CSS colour chip shown beside the value
  rows: TipRow[];
  note?: string;
}

const t1 = (t: number) => `${t.toFixed(1)} °C`;
const watts = (w: number) =>
  Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
const metres = (m: number) => `${m.toFixed(1)} m`;

const STATUS_TEXT: Record<SimStatus, string> = {
  standby: "standby",
  overrun: "pump overrun",
  bypass: "radiator valves shut, water going round the bypass",
  heating: "heating",
  idle: "at temperature",
  off: "switched off",
};

/** Flow through the branch that cell i sits in, with the reason if it's still. */
function flowRow(sim: Sim, i: number): TipRow {
  const lpm = sim.cellFlowLpm(i);
  if (lpm > 0.01)
    return { label: "Water flow", value: `${lpm.toFixed(2)} L/min` };
  let why = "pump off";
  if (sim.pumpOn)
    why = sim.cellInfo(i).role === "bypass" ? "TRV fully open" : "TRV shut";
  return { label: "Water flow", value: `not moving (${why})` };
}

/** Distance along the flow main from the boiler to the centre of a cell. */
function fromBoilerM(sim: Sim, info: CellInfo): number {
  let d = info.alongM;
  for (let j = 0; j < info.edge.n; j++) d += sim.circuit.flowMain[j].lenM;
  return d;
}

export function describe(hit: Hit, sim: Sim): TipContent {
  const p = sim.params;
  const ins = sim.insulation;
  const c = sim.losses; // W/K, whole house
  const lw = sim.lossWatts(); // W, whole house
  const dT = lw.total / c.total; // inside - outside, weighted over rooms
  const circuit = sim.circuit;
  // Devices belong to radiator 0 until the scene draws more than one room.
  const k = 0;
  const room = sim.rooms[k];
  const radiator = p.radiators[k];

  switch (hit.kind) {
    case "cell": {
      const i = hit.cell ?? circuit.hx;
      const T = sim.T[i];
      const info = sim.cellInfo(i);
      const r = info.radiator >= 0 ? info.radiator : k;
      const base = { value: t1(T), swatch: toCss(waterColor(T)) };
      switch (info.role) {
        case "hx":
          return {
            title: "Boiler heat exchanger",
            ...base,
            rows: [
              { label: "Flow set-point", value: `${p.flowSet} °C` },
              { label: "Burner output", value: watts(sim.burnerW) },
              flowRow(sim, i),
            ],
            note: "The burner heats the water here. The boiler turns its flame up or down (modulates) to hold the flow set-point.",
          };
        case "flow":
          return {
            title: "Flow pipe (from boiler)",
            ...base,
            rows: [
              {
                label: "Distance from boiler",
                value: metres(fromBoilerM(sim, info)),
              },
              flowRow(sim, i),
            ],
          };
        case "trvTail":
          return {
            title: "Through the TRV into the radiator",
            ...base,
            rows: [
              flowRow(sim, i),
              {
                label: "TRV",
                value: `${Math.round(sim.rooms[r].trvOpening * 100)}% open`,
              },
            ],
          };
        case "rad":
          return {
            title: "Radiator water",
            ...base,
            rows: [
              {
                label: "Layer",
                value: `${info.index + 1} of ${info.edge.cells} (1 = top)`,
              },
              { label: "Heat from this layer", value: watts(sim.q[i]) },
              { label: "Whole radiator", value: watts(sim.rooms[r].radW) },
              {
                label: "Top → bottom",
                value: `${sim.radInT(r).toFixed(1)} → ${sim.radOutT(r).toFixed(1)} °C`,
              },
              flowRow(sim, i),
            ],
            note: "Hot water enters at the top and cools as it sinks through the panel. Less flow (TRV closing) means a cooler bottom and less heat.",
          };
        case "lsTail":
          return {
            title: "Out of the radiator (lockshield side)",
            ...base,
            rows: [flowRow(sim, i)],
          };
        case "bypass":
          return {
            title: "Bypass pipe",
            ...base,
            rows: [
              flowRow(sim, i),
              {
                label: "Share of pump flow",
                value: `${Math.round((sim.bypassLpm / Math.max(sim.flowLpm, 1e-9)) * 100) || 0}%`,
              },
            ],
            note: "Water the TRV won't let through goes this way, straight back to the boiler, so the loop keeps circulating.",
          };
        case "ret":
          return {
            title:
              i === circuit.returnMain[0].last
                ? "Return into boiler"
                : "Return pipe (to boiler)",
            ...base,
            rows: [
              {
                label:
                  info.edge.n === 0
                    ? "Distance from radiator"
                    : `Distance from radiator ${info.edge.n + 1}`,
                value: metres(info.alongM),
              },
              flowRow(sim, i),
              {
                label: "Condensing?",
                value: sim.condensing
                  ? "yes (return below 54 °C)"
                  : "no (return too hot)",
              },
            ],
          };
      }
      break;
    }

    case "bypass-valve": {
      const share =
        sim.flowLpm > 0.01
          ? Math.round((sim.bypassLpm / sim.flowLpm) * 100)
          : 0;
      return {
        title: "Automatic bypass valve",
        value: !sim.pumpOn
          ? "Pump off"
          : share < 1
            ? "Closed"
            : `${share}% of flow`,
        rows: [
          {
            label:
              sim.rooms.length > 1 ? "Through radiators" : "Through radiator",
            value: `${sim.radiatorFlowLpm.toFixed(2)} L/min`,
          },
          {
            label: "Through bypass",
            value: `${sim.bypassLpm.toFixed(2)} L/min`,
          },
        ],
        note: "A spring-loaded valve that opens as the TRV closes, so the pump always has a loop to push water round. Hot water sent straight back raises the return temperature, which can stop the boiler condensing.",
      };
    }

    case "trv": {
      const trv = TRV_SETTINGS[radiator.trvIndex];
      return {
        title: "Thermostatic radiator valve",
        value: `Setting ${trv.label}`,
        rows: [
          {
            label: "Aims for",
            value: trv.target == null ? "shut (no heat)" : `≈ ${trv.target} °C`,
          },
          { label: "Its sensor reads", value: t1(room.Tsensor) },
          {
            label: "Valve",
            value:
              trv.target == null
                ? "shut"
                : `${Math.round(room.trvOpening * 100)}% open`,
          },
        ],
        note: "It closes gradually as the air around it nears its target, so it controls only this radiator. Click (Shift+click) or scroll to turn it.",
      };
    }

    case "trv-inset": {
      const trv = TRV_SETTINGS[radiator.trvIndex];
      return {
        title: "Inside the TRV",
        value:
          trv.target == null
            ? "Plug on seat (shut)"
            : `Plug lifted ${(room.trvOpening * 2).toFixed(1)} of 2 mm`,
        rows: [
          {
            label: "Head setting",
            value:
              trv.target == null
                ? "0 (shut)"
                : `${trv.label} ≈ ${trv.target} °C`,
          },
          { label: "Wax capsule temp", value: t1(room.Tsensor) },
          flowRow(sim, circuit.radiators[k].trvTail.first),
        ],
        note: "The wax capsule in the head expands as it warms. It pushes the pin down until the plug presses on the seat and stops the water. As the room cools the wax shrinks, and a spring lifts the plug again. A higher number sets the mechanism further back, so it takes more heat to close.",
      };
    }

    case "lockshield":
      return {
        title: "Lockshield valve",
        value: `${Math.round(radiator.lockshield * 100)}% open`,
        rows: [
          { label: "Purpose", value: "balancing" },
          flowRow(sim, circuit.radiators[k].lsTail.first),
        ],
        note: "Set by the installer to share flow fairly between radiators. Closing it caps the flow through this radiator; the rest goes round the bypass. Click (Shift+click) or scroll to change it.",
      };

    case "thermostat":
      return {
        title: "Room thermostat",
        value: t1(sim.thermostatT),
        rows: [
          { label: "Heating", value: p.thermostatOn ? "on" : "switched off" },
          { label: "Set to", value: t1(p.thermostatSet) },
          {
            label: "Status",
            value: !p.thermostatOn
              ? "not calling"
              : sim.demand
                ? "calling for heat"
                : "satisfied",
          },
          {
            label: "Switches on / off",
            value: `${(p.thermostatSet - K.THERMOSTAT_HYST).toFixed(2)} / ${(p.thermostatSet + K.THERMOSTAT_HYST).toFixed(2)} °C`,
          },
        ],
        note: "Turns the boiler and pump on and off for the whole system. Click to switch heating on or off; scroll to change the set temperature.",
      };

    case "display":
    case "boiler":
    case "burner":
    case "gas": {
      const gasW = sim.burnerW > 0 ? sim.burnerW / sim.efficiency : 0;
      return {
        title:
          hit.kind === "gas"
            ? "Gas supply"
            : hit.kind === "burner"
              ? "Burner"
              : "Combi boiler",
        value: hit.kind === "gas" ? watts(gasW) : `${p.flowSet} °C flow`,
        rows: [
          { label: "Status", value: STATUS_TEXT[sim.status] },
          { label: "Heat output", value: watts(sim.burnerW) },
          { label: "Gas input", value: watts(gasW) },
          {
            label: "Efficiency",
            value: `${(sim.efficiency * 100).toFixed(1)}%`,
          },
          { label: "Return temp", value: t1(sim.returnT) },
          {
            label: "Gas used so far",
            value: `${(sim.gasJ / 3.6e6).toFixed(2)} kWh`,
          },
        ],
        note:
          hit.kind === "gas"
            ? undefined
            : "A combi heats radiators and makes hot water on demand. Scroll or click (Shift+click) the boiler to change the flow temperature.",
      };
    }

    case "power":
      return {
        title: "Boiler power",
        value: p.boilerOn ? "On" : "Off",
        rows: [
          {
            label: "Thermostat",
            value: !p.thermostatOn
              ? "switched off"
              : sim.demand
                ? "calling for heat"
                : "satisfied",
          },
        ],
        note: "Click to switch the boiler on or off. When it's off, the thermostat can call for heat but nothing happens.",
      };

    case "pump":
      return {
        title: "Circulating pump",
        value: sim.pumpOn ? "Running" : "Off",
        rows: [
          flowRow(sim, circuit.hx),
          {
            label: "Overrun left",
            value:
              !sim.demand && sim.overrun > 0
                ? `${Math.ceil(sim.overrun)} s`
                : "–",
          },
        ],
        note: "Pushes water round the circuit while the thermostat calls for heat, then runs on briefly to cool the heat exchanger.",
      };

    case "wall": {
      let area = 0;
      for (const r of sim.plan.rooms) area += r.extWallM2;
      return {
        title: "External wall",
        value: ins.wall.name,
        rows: [
          { label: "U-value", value: `${ins.wall.U} W/m²K` },
          { label: "Area", value: `${area} m²` },
          { label: "Heat loss now", value: watts(lw.wall) },
        ],
        note: "U-value = watts lost per m² for each °C of difference inside to outside. Lower is better.",
      };
    }

    case "loft":
      return {
        title: "Loft insulation",
        value: `${ins.loft.mm} mm`,
        rows: [
          { label: "Ceiling U-value", value: `${ins.loft.U} W/m²K` },
          { label: "Heat loss now", value: watts(lw.roof) },
        ],
      };

    case "loss-wall":
    case "loss-roof":
    case "loss-vent": {
      const map = {
        "loss-wall": {
          name: "Through the external wall",
          H: c.wall,
          W: lw.wall,
        },
        "loss-roof": {
          name: "Through the ceiling / roof",
          H: c.roof,
          W: lw.roof,
        },
        "loss-vent": { name: "Draughts & ventilation", H: c.vent, W: lw.vent },
      } as const;
      const m = map[hit.kind];
      return {
        title: "Heat escaping",
        value: watts(m.W),
        rows: [
          { label: "Path", value: m.name },
          { label: "Rate", value: `${m.H.toFixed(1)} W per °C` },
          { label: "Inside − outside", value: `${dT.toFixed(1)} °C` },
        ],
      };
    }

    case "outside":
      return {
        title: "Outdoors",
        value: t1(p.outdoor),
        rows: [{ label: "Room is warmer by", value: `${dT.toFixed(1)} °C` }],
        note: "Heat loss is proportional to this difference. Click (Shift+click) or scroll here to change the outside temperature.",
      };

    case "void":
      return {
        title: "Floor void",
        rows: [{ label: "Pipe heat loss now", value: watts(sim.pipeW) }],
        note: "Flow and return pipes run under the floorboards. They're lagged, but still give off a little heat.",
      };

    case "cupboard":
      return {
        title: "Boiler cupboard",
        rows: [],
        note: "A combi boiler needs no hot-water cylinder or loft tanks. It heats tap water instantly when a tap opens.",
      };

    case "room": {
      const exp = sim.expectedRoomTemp(k);
      const rate = sim.roomRatePerHour(k);
      return {
        title: "Room air",
        value: t1(room.T),
        rows: [
          {
            label: "Heat in (radiator + pipes)",
            value: watts(room.radW + room.pipeW),
          },
          { label: "Heat out (fabric)", value: watts(room.lossW) },
          {
            label: "Trend",
            value: `${rate >= 0 ? "+" : ""}${rate.toFixed(2)} °C/h`,
          },
          { label: "Should settle near", value: t1(exp.t) },
        ],
      };
    }
  }
}
