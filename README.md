# Combi Heating Simulator

An educational simulation of one to three rooms heated by a combi boiler,
drawn with [PixiJS 8](https://pixijs.com/) (Vite + TypeScript template).

## Run

```bash
npm install
npm run dev      # http://localhost:8080
npm run build    # lint + type-check + production build into dist/
npm test         # simulation tests (Vitest)
```

`npm test` includes a golden-value test that pins the one-room behaviour to
recorded values (`tests/golden/sim-baseline.json`). Re-record it with
`npm run test:golden` only when a change in behaviour is intended.

## What you can change

| Control | Where |
|---|---|
| Rooms (1–3, in a row) | buttons; changing it cold-starts the house |
| Boiler on/off | switch, or the green power button on the boiler |
| Boiler flow temperature (30–80 °C) | slider, or click/scroll the boiler |
| Room thermostat (5–30 °C) | slider, or scroll the thermostat; click it to switch heating on/off |
| Lockshield (10–100 %, 10 % steps), per radiator | slider in that radiator's row, or click/scroll the lockshield |
| TRV head setting (0, ❄, 1–5), per radiator | buttons in that radiator's row, or click/scroll the TRV |
| Insulation (Poor → Excellent) | buttons |
| Outside temperature (−15–25 °C) | slider, or click/scroll the outside area |

Shift+click turns a device down. Hover anything in the diagram for live
details. Pipe colour runs blue (10 °C) to red (80 °C).

**Cold start** restarts with the rooms, water and pipes all at the outside
temperature. **Reset** restarts with everything at 14 °C. Changing the number
of rooms keeps the whole-house settings and the settings of radiators that are
still there, and cold-starts the new house.

With more than one room the thermostat hangs in room 1. The other rooms show
their temperature on the wall but are controlled only by their TRVs, so they
stop warming whenever room 1 is warm enough and the boiler switches off.
Their tooltips say so.

The history chart and table are hidden for now (`hidden` on `#history` in
`index.html`).

## The model (`src/sim/`)

- The water circuit is split into small cells. Water moves cell to cell
  (upwind finite volume), and each cell loses heat to the room.
- **House plan** (`src/house/plan.ts`): rooms in a row, each with one
  radiator, on a two-pipe system under the floor. The flow pipe runs from
  the boiler past every radiator; a tee under each feeds its TRV, and the
  flow pipe carries on under the radiator to the next one. Each radiator's
  outlet (lockshield side) drops straight into the return pipe. Past the
  last radiator the flow pipe turns down into the return: an open bypass,
  with no valve.
- **Pump and valves:** the pump is sized for 2 L/min through each radiator
  and 2 L/min round the bypass. The flow divides between those parallel
  routes in proportion to how freely each lets water through; a radiator's
  route is scaled by its TRV opening and lockshield (in series). As a TRV
  closes, its share moves to the other radiators and the bypass, so water
  always circulates, even with every TRV shut. Because some water always
  goes round the bypass, the return to the boiler is hotter (less
  condensing).
- **Radiator:** 1600 W at ΔT50, output ∝ ΔT^1.3, modelled as 12 layers from
  top to bottom.
- **TRV:** a proportional valve driven by a slow wax sensor. It is fully open
  1 °C below its setting and shut 1 °C above it. Settings: ❄ 7, 1 12, 2 16,
  3 20, 4 24, 5 28 °C.
- **Thermostat:** on/off, with a ±0.25 °C switching band. The pump runs on
  for 2 minutes after the thermostat switches off.
- **Boiler:** modulates up to 24 kW to hold the flow set-point. Efficiency
  depends on return temperature; it condenses below about 54 °C.
- **Rooms:** one thermal mass each. Heat is lost through the roof/loft and
  draughts, and through the gable wall in the end room, using U-values for
  each insulation level. Neighbouring rooms trade heat through the internal
  wall between them. The thermostat hangs in the first room.

Simplifications: no minimum burner output (so no short-cycling), no hot-water
draw-off, and one radiator per room. A room's "could reach" estimate
assumes every room is at the same temperature, so it ignores heat traded
with its neighbours.

## Drawing

One room fills a 1200 × 700 drawing. With two or three rooms they share a
drawing about 1500 wide, so each room is narrower, and the canvas takes the
drawing's shape. Each radiator's lockshield pipe drops through the flow pipe
on its way to the return; it is drawn passing in front, so the two pipes
don't look joined.

## Layout

```
src/house/plan.ts         rooms, radiators and pipe runs (pure data)
src/sim/circuit.ts        plan -> water cells, joins and conduction links
src/sim/hydraulics.ts     how the pump flow divides between the radiators and the bypass
src/sim/model.ts          physics, controls, steady-state estimates
src/scene/layout.ts       plan -> where everything sits in the drawing
src/scene/HeatingScene.ts PixiJS host: scaling, pointer input, drives the views
src/scene/views/          one view per part: fabric & weather, pipe network,
                          each room (radiator, TRV, lockshield), boiler,
                          thermostat, heat-loss arrows
src/scene/hit.ts          what the pointer is over (with the room it belongs to)
src/scene/TrvCutaway.ts   magnified TRV valve (currently hidden)
src/chart/HistoryChart.ts PixiJS 6-hour history chart
src/ui/                   controls, tooltip text
tests/                    Vitest: golden one-room values, multi-room invariants, layout
```
