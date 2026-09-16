import { blocksOn, type Block } from "../blocks.js";
import type { Config } from "../config.js";
import { slotsOf, WEEKDAYS, type Intake, type Slot, type Term } from "../intake/documents.js";
import type { CalendarEventInput } from "../ports/calendar.js";
import { stampOf } from "./correlation.js";
import { firstOn, lastOn, nonSchoolDates, onWeekday, type IsoDate } from "./dates.js";
import { excluding, weeklyUntil } from "./recurrence.js";

/**
 * The Timetable as Google Calendar holds it: one recurring event per Block
 * (ADR-0003, ADR-0008), titled with the subject exactly as the school names it.
 *
 * Nothing here talks to Google — this says what the calendar should hold, and
 * `publish.ts` says how the calendar is told.
 */
export function eventsOf(config: Config, intake: Intake): CalendarEventInput[] {
  const slots = slotsOf(intake.schoolDay);
  const { term } = intake;

  // Every date no Lesson is taught on, worked out once for the whole week and
  // then read per weekday: a Block only ever loses the Non-school days that
  // fall on its own weekday.
  const free = nonSchoolDates(intake.nonSchoolDays);

  return WEEKDAYS.flatMap((weekday) => {
    const first = firstOn(weekday, term.start);
    // A Term of a few days may never reach a weekday at all, and a recurrence
    // whose first occurrence is past the Term's end is a lesson that never runs.
    if (first > term.end) return [];

    const weeks: Weeks = {
      first,
      last: lastOn(weekday, term.end),
      free: onWeekday(free, weekday),
    };

    return blocksOn(intake.timetable, weekday).map((block) =>
      eventOf(block, weeks, slots, config.timezone, term),
    );
  });
}

/** What every Block of one weekday shares: when it runs from and to, and the dates it skips. */
interface Weeks {
  first: IsoDate;
  last: IsoDate;
  free: IsoDate[];
}

function eventOf(
  block: Block,
  weeks: Weeks,
  slots: Slot[],
  timeZone: string,
  term: Term,
): CalendarEventInput {
  const starts = startOf(slots, block.firstSlot);

  return {
    // Exactly the subject, so that what the student reads matches what their
    // teachers and classmates call it. No description and no location: neither
    // would say anything the title does not.
    summary: block.subject,
    start: at(weeks.first, starts, timeZone),
    end: at(weeks.first, endOf(slots, block.lastSlot), timeZone),
    recurrence: [
      weeklyUntil(weeks.last, starts, timeZone),
      ...excluding(weeks.free, starts, timeZone),
    ],
    // Said rather than left unsaid: the account's default alert would notify
    // the student before every lesson, dozens of times a week.
    reminders: { useDefault: false },
    // A lesson is not the student's own commitment, so it should not read as
    // one blocking their time on the calendar it's published to.
    transparency: "transparent",
    // What a later run correlates this event with its Block by (ADR-0006).
    extendedProperties: { private: stampOf(block, term) },
  };
}

/**
 * A wall-clock time on a date, in the zone Config names. Google expands the
 * recurrence in that zone, which is what keeps a 09:30 lesson at 09:30 in
 * November.
 */
function at(date: string, time: string, timeZone: string) {
  return { dateTime: `${date}T${time}:00`, timeZone };
}

/** A Slot's times, by its position among the School day's Slots. */
function startOf(slots: Slot[], position: number): string {
  return slotAt(slots, position).start;
}

function endOf(slots: Slot[], position: number): string {
  return slotAt(slots, position).end;
}

function slotAt(slots: Slot[], position: number): Slot {
  const slot = slots[position - 1];
  // Validation has already refused a Lesson in a Slot the School day does not
  // declare, so reaching this is a fault in the pipeline rather than the Intake.
  if (slot === undefined) throw new Error(`no Slot ${position} in the School day`);
  return slot;
}
