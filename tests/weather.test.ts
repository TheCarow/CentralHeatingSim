/*
 * The optional day/night cycle: outside temperature over the day, daylight,
 * and how the simulation responds to it.
 */
import { describe, expect, it } from "vitest";
import { makePlan } from "../src/house/plan";
import { Sim } from "../src/sim/model";
import {
  DAY_NIGHT,
  DAY_S,
  daylight,
  formatTimeOfDay,
  outdoorAt,
} from "../src/sim/weather";

const at = (hour: number, day = 0) => day * DAY_S + hour * 3600;

describe("outside temperature over the day", () => {
  it("stays at the average with the cycle off", () => {
    for (let h = 0; h < 24; h++) expect(outdoorAt(5, false, at(h))).toBe(5);
  });

  it("is warmest at 3 pm and coldest at 3 am with the cycle on", () => {
    expect(outdoorAt(5, true, at(15))).toBeCloseTo(5 + DAY_NIGHT.swing, 9);
    expect(outdoorAt(5, true, at(3))).toBeCloseTo(5 - DAY_NIGHT.swing, 9);
    expect(outdoorAt(5, true, at(15, 2))).toBeCloseTo(5 + DAY_NIGHT.swing, 9);
    // averages out over a whole day
    let sum = 0;
    for (let m = 0; m < 1440; m++) sum += outdoorAt(5, true, m * 60);
    expect(sum / 1440).toBeCloseTo(5, 6);
  });

  it("is light by day and dark at night, half-light at dawn and dusk", () => {
    expect(daylight(at(12))).toBe(1);
    expect(daylight(at(0))).toBe(0);
    expect(daylight(at(6))).toBeCloseTo(0.5, 9);
    expect(daylight(at(18))).toBeCloseTo(0.5, 9);
  });
});

describe("the clock", () => {
  it("shows the time of day, with seconds when asked", () => {
    expect(formatTimeOfDay(at(6))).toBe("06:00");
    expect(formatTimeOfDay(at(2.2, 1))).toBe("02:12"); // next day: no day count
    expect(formatTimeOfDay(at(6) + 7, true)).toBe("06:00:07");
    expect(formatTimeOfDay(at(23) + 59 * 60 + 59.9, true)).toBe("23:59:59");
  });
});

describe("the simulation with the day/night cycle", () => {
  it("cold-starts at the outside temperature for 6 am", () => {
    const sim = new Sim(makePlan(2));
    sim.params.dayNight = true;
    sim.coldStart();
    const t6 = outdoorAt(sim.params.outdoor, true, at(6));
    expect(sim.outdoorT).toBeCloseTo(t6, 9);
    for (const r of sim.rooms) expect(r.T).toBeCloseTo(t6, 9);
  });

  it("records the swinging outside temperature and the room follows it", () => {
    const sim = new Sim(makePlan(1)); // heating off: the room drifts with outside
    sim.params.dayNight = true;
    sim.coldStart();
    sim.advance(3 * DAY_S);
    const lastDay = sim.history.filter((s) => s.t >= sim.time - DAY_S);
    const out = lastDay.map((s) => s.outdoor);
    const room = lastDay.map((s) => s.rooms[0].T);
    expect(Math.max(...out) - Math.min(...out)).toBeCloseTo(
      2 * DAY_NIGHT.swing,
      1,
    );
    // The room lags and damps the swing, but still rises and falls.
    const swing = Math.max(...room) - Math.min(...room);
    expect(swing).toBeGreaterThan(0.5);
    expect(swing).toBeLessThan(2 * DAY_NIGHT.swing);
  });

  it("loses more heat at night than in the afternoon", () => {
    const sim = new Sim(makePlan(1));
    sim.params.dayNight = true;
    sim.params.thermostatOn = true;
    sim.coldStart();
    sim.advance(DAY_S); // settle
    // Next 3 am (coldest), then 3 pm (warmest), with the room held near 20 °C
    sim.advance(at(3, 2) - sim.time);
    const night = sim.lossWatts().total;
    sim.advance(12 * 3600);
    const afternoon = sim.lossWatts().total;
    expect(night).toBeGreaterThan(afternoon * 1.2);
  });
});
