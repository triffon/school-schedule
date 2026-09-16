import type { Config } from "../config.js";
import type { Intake } from "../intake/documents.js";
import type { CalendarClient, CalendarEventInput } from "../ports/calendar.js";
import { PIPELINE_EVENTS } from "./correlation.js";
import { eventsOf } from "./events.js";
import { reconcile, type CalendarChanges } from "./reconcile.js";

/**
 * Everything one run would do to the calendar, worked out before anything is
 * sent, so that the operator is shown what is about to change and can still say
 * no.
 */
export interface CalendarPlan {
  /** The one calendar Config names, which is the whole of choosing it (ADR-0004). */
  calendarId: string;
  /** One recurring event per Block: the whole week, however much of it is already there. */
  events: CalendarEventInput[];
  /** What it takes to get there from what the calendar holds now. */
  changes: CalendarChanges;
}

/**
 * Reads the events the pipeline has already published and works out what this
 * run changes. That listing is all reconciliation costs beyond the writes it
 * turns out to need — and for an Intake that has not changed, there are none.
 */
export async function planCalendar(
  client: CalendarClient,
  config: Config,
  intake: Intake,
): Promise<CalendarPlan> {
  const events = eventsOf(config, intake);
  const alreadyThere = await client.listEvents({
    calendarId: config.calendarId,
    // Only the pipeline's own: an event the operator made is theirs, and is
    // never read, updated or deleted here (ADR-0006).
    privateExtendedProperty: PIPELINE_EVENTS,
  });

  return { calendarId: config.calendarId, events, changes: reconcile(events, alreadyThere) };
}

/**
 * Writes the plan to the calendar. Calendar has no batch that spares the quota
 * — a batch of *n* counts as *n* (ADR-0003) — so the changes go one at a time.
 *
 * What has gone is deleted before what is new is written, so that a Block whose
 * run now begins in another Slot is never on the calendar twice, not even for
 * the moment between the two requests.
 */
export async function publishCalendar(client: CalendarClient, plan: CalendarPlan): Promise<void> {
  const { calendarId, changes } = plan;

  for (const eventId of changes.deletes) {
    await client.deleteEvent({ calendarId, eventId });
  }
  for (const { eventId, event } of changes.updates) {
    await client.updateEvent({ calendarId, eventId, event });
  }
  for (const event of changes.inserts) {
    await client.insertEvent({ calendarId, event });
  }
}
