import type { CalendarClient } from "./calendar.js";
import type { SheetsClient } from "./sheets.js";

/**
 * Stands in for the real Google clients until `init` wires up authorisation.
 * Nothing dispatched by the command layer reaches Google yet; if something
 * tries, it should say why rather than fail obscurely.
 */
function refuse(api: string): never {
  throw new Error(
    `school-schedule: the Google ${api} client is not wired up yet — run \`init\` once it is available`,
  );
}

export function unavailableCalendarClient(): CalendarClient {
  return {
    listCalendars: () => refuse("Calendar"),
    createCalendar: () => refuse("Calendar"),
    listEvents: () => refuse("Calendar"),
    insertEvent: () => refuse("Calendar"),
    updateEvent: () => refuse("Calendar"),
    deleteEvent: () => refuse("Calendar"),
  };
}

export function unavailableSheetsClient(): SheetsClient {
  return {
    getSpreadsheet: () => refuse("Sheets"),
    batchUpdate: () => refuse("Sheets"),
  };
}
