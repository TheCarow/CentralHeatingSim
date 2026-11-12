# Combi Heating Simulator

An educational simulation of one room heated by a combi boiler, drawn with
[PixiJS 8](https://pixijs.com/) (Vite + TypeScript template).

## Run

```bash
npm install
npm run dev      # http://localhost:8080
npm run build    # lint + type-check + production build into dist/
```

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
details; hovering the TRV also opens a cut-away of its valve. Pipe colour runs
blue (10 °C) to red (80 °C).

**Cold start** restarts with the room, water and pipes all at the outside
temperature. **Reset** restarts with everything at 14 °C.

## The model (`src/sim/model.ts`)

- The water circuit is split into small cells. Water moves cell to cell
  (upwind finite volume), and each cell loses heat to the room.
- **Circuit:** boiler → flow pipe → junction → (TRV → radiator → lockshield) **or**
  (automatic bypass valve) → junction → return pipe → boiler. The pump flow is
  fixed. The TRV decides how much goes through the radiator, and the bypass
  takes the rest, so water keeps circulating even with the TRV shut.
- **Radiator:** 1600 W at ΔT50, output ∝ ΔT^1.3, modelled as 12 layers from
  top to bottom.
- **TRV:** a proportional valve driven by a slow wax sensor. It is fully open
  1 °C below its setting and shut 1 °C above it. Settings: ❄ 7, 1 12, 2 16,
  3 20, 4 24, 5 28 °C.
- **Thermostat:** on/off, with a ±0.25 °C switching band. The pump runs on
  for 2 minutes after the thermostat switches off.
- **Boiler:** modulates up to 24 kW to hold the flow set-point. Efficiency
  depends on return temperature; it condenses below about 54 °C.
- **Room:** a single thermal mass. Heat is lost through the wall, the
  roof/loft and draughts, using U-values for each insulation level.

Simplifications: no minimum burner output (so no short-cycling), no hot-water
draw-off, and one radiator only.

## Layout

```
src/sim/model.ts          physics
src/scene/HeatingScene.ts PixiJS cut-away scene, hover hit-testing
src/scene/TrvCutaway.ts   magnified TRV valve (wax capsule, pin, plug, seat)
src/chart/HistoryChart.ts PixiJS 6-hour history chart
src/ui/                   controls, status line, tooltip text
```
