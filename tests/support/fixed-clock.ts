import type { Clock } from "../../src/ports/clock.js";

/** A clock frozen at an instant, so a run's output is reproducible. */
export function fixedClock(instant: string): Clock {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) {
    throw new Error(`fixedClock was given an unparseable instant: ${instant}`);
  }
  return { now: () => new Date(at) };
}
