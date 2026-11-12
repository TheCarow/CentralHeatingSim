# Combi Heating Simulator

An educational simulation of one to three rooms heated by a combi boiler,
drawn with [PixiJS 8](https://pixijs.com/) (Vite + TypeScript template).

**Try it:** <https://thecarow.com/CentralHeatingSim/>

## Run

```bash
npm install
npm run dev      # http://localhost:8080
npm run build    # lint + type-check + production build into dist/
npm test         # simulation tests (Vitest)
```

Every push to `main` runs the tests, builds the site and publishes it to
GitHub Pages (`.github/workflows/pages.yml`).

`npm test` includes a golden-value test that pins the one-room behaviour to
recorded values (`tests/golden/sim-baseline.json`). Re-record it with
`npm run test:golden` only when a change in behaviour is intended.

## What you can change

Hover something you can change and a bubble beside it shows its live
details; it stays put rather than following the pointer. Click (or tap)
it and the bubble stays open with the object's controls under the details.
Click the object again, click elsewhere or press Escape to close it.

| Object | Controls |
|---|---|
| Boiler | power on/off, flow temperature (30–80 °C) |
| Room thermostat | heating on/off, set temperature (5–30 °C) |
| A TRV | head setting (0, ❄, 1–5) for that radiator |
| A lockshield | how far open (10–100 %, 10 % steps) for that radiator |
| Outside | outside temperature (−15–25 °C) and the day/night cycle: the outside temperature swings ±4 °C around the chosen value, coldest around 3 am and warmest around 3 pm; the sky darkens at night and a clock shows the time of day |
| Walls or loft | insulation (Poor → Excellent) |

The boiler's and thermostat's bubbles always open below them. The green
power buttons on the boiler and the thermostat switch them straight away.
Scrolling over the boiler, thermostat, a TRV, a lockshield or the outside
turns it up or down a notch. Radiator water shows its details in a bubble
above the radiator; the pipes have a tooltip that follows the pointer.
Bubbles and tooltips fade quickly in and out. Water colour runs like a
thermal camera's, from deep blue (10 °C) through violet, magenta and red to
orange (80 °C), getting lighter as it warms so that small differences show.

The top bar has the number of rooms (1–3, in a row), the speed, **Reset**,
and two view options: **Heat loss** (arrows showing where heat escapes)
and **Details** (fuller tooltips).

**Reset** restarts from cold: the rooms, water and pipes all at the outside
temperature, as when the page opens. Changing the number
of rooms keeps the whole-house settings and the settings of radiators that are
still there, and cold-starts the new house.

With more than one room the thermostat hangs in room 1. The other rooms show
their temperature on the wall but are controlled only by their TRVs, so they
stop warming whenever room 1 is warm enough and the boiler switches off.

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
- **Outside:** a fixed temperature, or with the day/night cycle on, a
  daily swing of ±4 °C around the chosen average (coldest about 3 am,
  warmest about 3 pm). Heat losses, snow and the history follow the actual
  temperature; the "could reach" estimates use the daily average.
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
drawing about 1500 wide, so each room is narrower. Like a game screen, the
drawing fills the window under the top bar, scaled to fit and centred (at
the top on a portrait screen); the page itself doesn't scroll. Each
radiator's lockshield pipe drops through the flow pipe on its way to the
return; it is drawn passing in front, so the two pipes
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
src/ui/targets.ts         what each click opens, and what its card points at
src/ui/deviceCard.ts      the bubble beside an object: details, then controls
src/ui/placement.ts       where that bubble goes
src/ui/settings.ts        setting ranges; scrolling and power-button changes
src/ui/                   also: top bar, tooltip text
tests/                    Vitest: golden one-room values, multi-room invariants, layout
```
