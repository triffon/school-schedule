/**
 * What the pipeline asks Google for, and what it is therefore allowed to reach.
 *
 * Both are requested at once, on the first and only consent screen `init` puts
 * in front of the operator: only Sheets is published to today, but adopting the
 * Calendar Destination later should cost no second authorisation.
 *
 * The Calendar scope is the events one, not the full `calendar` (ADR-0004): the
 * calendar to publish to is named in Config rather than created or picked here,
 * so nothing the pipeline does manages a calendar, and the grant carries no
 * power to create, delete or re-configure one.
 */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export const REQUESTED_SCOPES = [SHEETS_SCOPE, CALENDAR_SCOPE];

/** What a scope is called when it has to be explained to the operator. */
export function nameOfScope(scope: string): string {
  switch (scope) {
    case SHEETS_SCOPE:
      return "Google Sheets";
    case CALENDAR_SCOPE:
      return "Google Calendar";
    default:
      return scope;
  }
}
