import type { Config } from "../config.js";
import type { Intake } from "../intake/documents.js";
import type { CalendarClient, CalendarEventInput } from "../ports/calendar.js";
import { eventsOf } from "./events.js";

/**
 * Everything one run would do to the calendar, worked out before anything is
 * sent, so that the operator is shown what is about to change and can still say
 * no.
 */
export interface CalendarPlan {
  /** The one calendar Config names, which is the whole of choosing it (ADR-0004). */
  calendarId: string;
  /** One recurring event per Block, in the order they are written. */
  events: CalendarEventInput[];
}

export function planCalendar(config: Config, intake: Intake): CalendarPlan {
  return { calendarId: config.calendarId, events: eventsOf(config, intake) };
}

/**
 * Writes the plan to the calendar. Calendar has no batch that spares the quota
 * — a batch of *n* counts as *n* (ADR-0003) — so the events go one at a time.
 */
export async function publishCalendar(client: CalendarClient, plan: CalendarPlan): Promise<void> {
  for (const event of plan.events) {
    await client.insertEvent({ calendarId: plan.calendarId, event });
  }
}
