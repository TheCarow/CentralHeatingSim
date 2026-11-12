# Combi Heating Simulator

An educational simulation of one room heated by a combi boiler, drawn with
[PixiJS 8](https://pixijs.com/) (Vite + TypeScript template).

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
| Boiler on/off | switch, or the green power button on the boiler |
| Boiler flow temperature (30–80 °C) | slider, or click/scroll the boiler |
| Room thermostat (5–30 °C) | slider, or scroll the thermostat; click it to switch heating on/off |
| Lockshield (10–100 %, 10 % steps) | slider, or click/scroll the lockshield |
| TRV head setting (0, ❄, 1–5) | buttons, or click/scroll the TRV or its cut-away |
| Insulation (Poor → Excellent) | buttons |
| Outside temperature (−15–25 °C) | slider, or click/scroll the outside area |

Shift+click turns a device down. Hover anything in the diagram for live
details. Pipe colour runs blue (10 °C) to red (80 °C).

**Cold start** restarts with the room, water and pipes all at the outside
temperature. **Reset** restarts with everything at 14 °C.

## The model (`src/sim/`)

- The water circuit is split into small cells. Water moves cell to cell
  (upwind finite volume), and each cell loses heat to the room.
- **House plan** (`src/house/plan.ts`): rooms in a row, each with one
  radiator. The pipework is a ladder: the flow main has a tee for each
  radiator (TRV → radiator → lockshield) and ends in one automatic bypass
  valve under the last radiator; the return main collects them on the way
  back. With one room this is a single loop.
- **Pump and valves:** the pump delivers every radiator's design flow
  (2 L/min each). The TRV and lockshield, in series, cut a radiator's share;
  the bypass takes whatever the radiators don't, so water keeps circulating
  even with every TRV shut.
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
draw-off, and one radiator per room. The diagram currently shows one room;
the simulation already supports up to three.

## Layout

```
src/house/plan.ts         rooms, radiators and pipe runs (pure data)
src/sim/circuit.ts        plan -> water cells, joins and conduction links
src/sim/hydraulics.ts     how the pump flow divides between radiators and bypass
src/sim/model.ts          physics, controls, steady-state estimates
src/scene/HeatingScene.ts PixiJS cut-away scene, hover hit-testing
src/scene/TrvCutaway.ts   magnified TRV valve (currently hidden)
src/chart/HistoryChart.ts PixiJS 6-hour history chart
src/ui/                   controls, tooltip text
tests/                    Vitest: golden one-room test, multi-room invariants
```
