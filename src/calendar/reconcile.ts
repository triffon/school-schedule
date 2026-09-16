import type { CalendarDateTime, CalendarEvent, CalendarEventInput } from "../ports/calendar.js";
import { correlationOf } from "./correlation.js";

/**
 * What it would take to turn what the calendar holds now into what the Intake
 * says it should hold. Everything else on the calendar — every event the
 * pipeline did not publish — is no business of this and never reaches it.
 */
export interface CalendarChanges {
  /** Blocks with no event on the calendar yet. */
  inserts: CalendarEventInput[];
  /** Events whose Block is still taught but no longer says what the event says. */
  updates: EventUpdate[];
  /** Events whose Block has gone, whose Term has passed, or that lost their stamp. */
  deletes: string[];
}

export interface EventUpdate {
  eventId: string;
  event: CalendarEventInput;
}

/**
 * Matches the events already published against the Blocks this run wants, by
 * the stamp each carries (ADR-0006) rather than by anything an operator can
 * edit. An Intake that has not changed since the last run reconciles to no
 * changes at all, which is what makes a re-run free.
 */
export function reconcile(
  wanted: CalendarEventInput[],
  alreadyThere: CalendarEvent[],
): CalendarChanges {
  const byCorrelation = new Map<string, CalendarEvent>();
  for (const event of alreadyThere) {
    const correlation = correlationOf(event);
    // The first event of a correlation is the one kept: a second is a leftover
    // of a run from before the pipeline reconciled, and is swept below.
    if (correlation !== undefined && !byCorrelation.has(correlation)) {
      byCorrelation.set(correlation, event);
    }
  }

  const inserts: CalendarEventInput[] = [];
  const updates: EventUpdate[] = [];
  const matched = new Set<string>();

  for (const event of wanted) {
    const correlation = correlationOf(event);
    const already = correlation === undefined ? undefined : byCorrelation.get(correlation);

    if (already === undefined) {
      inserts.push(event);
      continue;
    }

    matched.add(already.id);
    if (!unchanged(already, event)) updates.push({ eventId: already.id, event });
  }

  // Whatever the Blocks of this run did not claim, in the order the calendar
  // listed it: the Terms that have passed, the Lessons that have gone, the
  // orphans, and every duplicate of an event that was claimed.
  const deletes = alreadyThere.filter((event) => !matched.has(event.id)).map((event) => event.id);

  return { inserts, updates, deletes };
}

/** Whether there is anything at all to write, which for a re-run there may not be. */
export function nothingToDo({ inserts, updates, deletes }: CalendarChanges): boolean {
  return inserts.length + updates.length + deletes.length === 0;
}

/**
 * Whether the event on the calendar already says what this run wants it to say.
 * Only what the pipeline itself writes is compared: Google returns fields of its
 * own alongside, and rewriting an event over one of those would be a write the
 * Intake never asked for.
 */
function unchanged(already: CalendarEvent, wanted: CalendarEventInput): boolean {
  return (
    already.summary === wanted.summary &&
    sameTime(already.start, wanted.start) &&
    sameTime(already.end, wanted.end) &&
    sameRecurrence(already.recurrence, wanted.recurrence) &&
    (already.transparency ?? "opaque") === (wanted.transparency ?? "opaque") &&
    (already.reminders?.useDefault ?? true) === (wanted.reminders?.useDefault ?? true)
  );
}

/**
 * Google echoes a wall-clock time back with the zone's offset appended —
 * `2025-09-15T08:00:00+03:00` for the `2025-09-15T08:00:00` it was sent — so
 * what is compared is the wall clock and the zone it is read in. An event
 * someone turned into an all-day one in the Google UI has neither, and reads as
 * changed: it is rewritten as the timed lesson it stands for.
 */
function sameTime(already: Partial<CalendarDateTime>, wanted: CalendarDateTime): boolean {
  return (
    already.timeZone === wanted.timeZone &&
    wallClock(already.dateTime) === wallClock(wanted.dateTime)
  );
}

/** `2025-09-15T08:00:00`, however much of an offset follows it. */
function wallClock(dateTime: string | undefined): string | undefined {
  return dateTime?.slice(0, 19);
}

/**
 * Whether two recurrences say the same thing. They are compared as a set of
 * parts, each `EXDATE`'s dates taken singly, because the same exclusions in
 * another order or grouped into lines differently are the same recurrence —
 * and rewriting every event because Google regrouped them would be a run's
 * worth of writes the Intake never asked for.
 */
function sameRecurrence(already: string[] | undefined, wanted: string[] | undefined): boolean {
  return partsOf(already).join("\n") === partsOf(wanted).join("\n");
}

function partsOf(lines: string[] = []): string[] {
  return lines.flatMap(singly).sort();
}

/** One part per date of an `EXDATE`, and the line itself for anything else. */
function singly(line: string): string[] {
  const at = line.indexOf(":");
  if (!line.startsWith("EXDATE") || at === -1) return [line];

  const [name, dates] = [line.slice(0, at), line.slice(at + 1)];
  return dates.split(",").map((date) => `${name}:${date}`);
}
