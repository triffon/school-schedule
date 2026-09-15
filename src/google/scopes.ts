/**
 * What the pipeline asks Google for, and what it is therefore allowed to reach.
 *
 * Both are requested at once, on the first and only consent screen `init` puts
 * in front of the operator: only Sheets is published to today, but adopting the
 * Calendar Destination later should cost no second authorisation.
 *
 * The Calendar scope is the full one rather than `calendar.app.created`, which
 * cannot attach to a calendar the operator already owns (ADR-0004). What that
 * scope would have enforced is enforced in code instead: the pipeline refuses
 * to touch `primary`, or any calendar not named in Config.
 */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

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
