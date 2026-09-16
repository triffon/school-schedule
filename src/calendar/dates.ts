import { WEEKDAYS, type NonSchoolDays, type Weekday } from "../intake/documents.js";

/**
 * Whole-day arithmetic on the dates the Intake writes, and the one conversion
 * out of wall-clock time that publishing needs.
 *
 * A date in the Intake is a day on a wall calendar rather than an instant, so
 * every date here is read as a UTC midnight: adding a day is adding 24 hours,
 * with no zone underneath to shift a date across a daylight-saving transition.
 */

/** A date as the Intake writes it: `YYYY-MM-DD`. */
export type IsoDate = string;

const DAY = 24 * 60 * 60 * 1000;

function midnight(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function dateOf(millis: number): IsoDate {
  return new Date(millis).toISOString().slice(0, 10);
}

/** Where a weekday sits in the Intake's week, which begins on Monday. */
function positionOf(weekday: Weekday): number {
  return WEEKDAYS.indexOf(weekday);
}

/** `Date`'s own week begins on Sunday; the Intake's begins on Monday. */
function positionAt(millis: number): number {
  return (new Date(millis).getUTCDay() + 6) % 7;
}

/** The first `weekday` on or after `from`. */
export function firstOn(weekday: Weekday, from: IsoDate): IsoDate {
  const start = midnight(from);
  return dateOf(start + ((positionOf(weekday) - positionAt(start) + 7) % 7) * DAY);
}

/** Those of `dates` that fall on `weekday`, in the order they were given. */
export function onWeekday(dates: IsoDate[], weekday: Weekday): IsoDate[] {
  const position = positionOf(weekday);
  return dates.filter((date) => positionAt(midnight(date)) === position);
}

/** The last `weekday` on or before `until`. */
export function lastOn(weekday: Weekday, until: IsoDate): IsoDate {
  const end = midnight(until);
  return dateOf(end - ((positionAt(end) - positionOf(weekday) + 7) % 7) * DAY);
}

/**
 * Zone-aware formatters are expensive to build and there are only ever a
 * handful of zones in a run — one, in practice — so each is built once.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone);
  if (existing !== undefined) return existing;

  const built = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, built);
  return built;
}

/** How far ahead of UTC `timeZone` stands at a given instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Map<string, string>(
    formatterFor(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const field = (name: string) => Number(parts.get(name));

  return (
    Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      field("hour"),
      field("minute"),
      field("second"),
    ) - instant
  );
}

/**
 * The instant a wall-clock time in `timeZone` falls at.
 *
 * Only one thing the pipeline publishes needs this: an `RRULE`'s `UNTIL`, which
 * RFC 5545 requires in UTC even where the recurrence itself is wall-clock in a
 * named zone. Everything else goes to Google as the wall-clock time it is.
 *
 * The zone's offset depends on the instant, and the instant is what is being
 * worked out, so the offset at the wall-clock time read as if it were UTC is
 * taken as a first guess and then the offset at that guess is taken. One pass
 * settles it: a guess is at most a day out, and no zone changes offset twice in
 * a day.
 */
export function instantOf(date: IsoDate, time: string, timeZone: string): Date {
  const asIfUtc = Date.parse(`${date}T${time}:00Z`);
  const guess = asIfUtc - offsetAt(asIfUtc, timeZone);
  return new Date(asIfUtc - offsetAt(guess, timeZone));
}

/**
 * Every date the Non-school days cover, in order and each of them once. They
 * are declared as labelled ranges rather than as individual dates, and a
 * recurrence is punctured a date at a time, so this is where the one becomes
 * the other. Ranges that overlap yield a date once, as a date is either taught
 * on or not.
 */
export function nonSchoolDates(nonSchoolDays: NonSchoolDays): IsoDate[] {
  const dates = new Set<IsoDate>();

  for (const range of nonSchoolDays.ranges) {
    for (let day = midnight(range.start); day <= midnight(range.end); day += DAY) {
      dates.add(dateOf(day));
    }
  }

  return [...dates].sort();
}
