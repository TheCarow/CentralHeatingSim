/*
 * Outside temperature and daylight over the day.
 *
 * With the day/night cycle on, the outside temperature swings around the
 * chosen daily average: coldest around 3 am, warmest around 3 pm. With it
 * off, it stays at the average.
 */

export const DAY_S = 86400;

export const DAY_NIGHT = {
  swing: 4, // °C either side of the daily average
  warmestHour: 15, // and so coldest 12 hours earlier, at 3 am
} as const;

/** Time of day at sim time t as "hh:mm", or "hh:mm:ss" with seconds. */
export function formatTimeOfDay(t: number, withSeconds = false): string {
  const s = Math.floor(((t % DAY_S) + DAY_S) % DAY_S);
  const two = (n: number) => String(n).padStart(2, "0");
  const hhmm = `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}`;
  return withSeconds ? `${hhmm}:${two(s % 60)}` : hhmm;
}

/** Outside temperature at sim time t. */
export function outdoorAt(
  average: number,
  dayNight: boolean,
  t: number,
): number {
  if (!dayNight) return average;
  const phase = (2 * Math.PI * (t - DAY_NIGHT.warmestHour * 3600)) / DAY_S;
  return average + DAY_NIGHT.swing * Math.cos(phase);
}

/**
 * How light it is outside at sim time t: 1 by day, 0 at night, easing
 * across dawn (around 6 am) and dusk (around 6 pm) over about an hour.
 */
export function daylight(t: number): number {
  const sun = Math.sin((2 * Math.PI * (t - 6 * 3600)) / DAY_S); // 1 at noon
  return Math.min(1, Math.max(0, 0.5 + 3 * sun));
}
