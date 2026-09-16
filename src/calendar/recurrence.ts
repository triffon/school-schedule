import { instantOf, type IsoDate } from "./dates.js";

/**
 * The RFC 5545 lines Google is given alongside an event's start: the weekly
 * rule that carries a Block through the Term, and the exclusions that puncture
 * it for the Non-school days (ADR-0003).
 *
 * The event's own start supplies `DTSTART`, so it is never written here.
 */

/** A wall-clock time in the zone the event declares: `HH:MM`. */
export type WallClock = string;

/**
 * The weekly rule, bounded so the last occurrence is the one at the Term's end.
 *
 * The rule needs no `BYDAY`: a weekly recurrence falls on the weekday its start
 * falls on, and the start is already the Term's first occurrence of it. `UNTIL`
 * is inclusive and must be UTC even under a `TZID` start, which is the one
 * place the pipeline converts a wall-clock time into an instant.
 */
export function weeklyUntil(last: IsoDate, at: WallClock, timeZone: string): string {
  return `RRULE:FREQ=WEEKLY;UNTIL=${utcStamp(instantOf(last, at, timeZone))}`;
}

/**
 * The dates to drop from the recurrence, as one line. Each is the excluded
 * occurrence's own start — a date alone would not match a timed recurrence —
 * written as wall clock under the same zone, so that an exclusion either side
 * of a daylight-saving change lands on the lesson it means.
 */
export function excluding(dates: IsoDate[], at: WallClock, timeZone: string): string[] {
  if (dates.length === 0) return [];

  const stamps = dates.map((date) => `${compact(date)}T${at.replace(":", "")}00`);
  return [`EXDATE;TZID=${timeZone}:${stamps.join(",")}`];
}

/** `2026-01-26` as RFC 5545 writes a date: `20260126`. */
function compact(date: IsoDate): string {
  return date.replaceAll("-", "");
}

/** An instant as RFC 5545 writes one in UTC: `20260126T060000Z`. */
function utcStamp(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}
