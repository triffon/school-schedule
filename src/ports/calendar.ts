/**
 * The slice of Google Calendar the pipeline uses, as one function per
 * operation rather than a generic request sender, so that a fake records a
 * readable request per call and each call site is typed on its own.
 */
export interface CalendarClient {
  listCalendars(): Promise<CalendarSummary[]>;
  createCalendar(request: CreateCalendarRequest): Promise<CalendarSummary>;
  listEvents(request: ListEventsRequest): Promise<CalendarEvent[]>;
  insertEvent(request: InsertEventRequest): Promise<CalendarEvent>;
  updateEvent(request: UpdateEventRequest): Promise<CalendarEvent>;
  deleteEvent(request: DeleteEventRequest): Promise<void>;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  /** True for the account's own calendar, which the pipeline refuses to touch. */
  primary?: boolean;
}

export interface CreateCalendarRequest {
  summary: string;
  timeZone: string;
}

export interface ListEventsRequest {
  calendarId: string;
  /**
   * Restricts the listing to events carrying this private extended property,
   * given as `key=value`. This is how the pipeline finds its own events without
   * mistaking one the operator created for one of its own.
   */
  privateExtendedProperty?: string;
}

export interface InsertEventRequest {
  calendarId: string;
  event: CalendarEventInput;
}

export interface UpdateEventRequest {
  calendarId: string;
  eventId: string;
  event: CalendarEventInput;
}

export interface DeleteEventRequest {
  calendarId: string;
  eventId: string;
}

/** A wall-clock time in an explicit IANA zone, so recurrences survive DST. */
export interface CalendarDateTime {
  dateTime: string;
  timeZone: string;
}

export interface CalendarEventInput {
  summary: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  /** RFC 5545 lines, such as an `RRULE` bounded by the Term and its `EXDATE`s. */
  recurrence?: string[];
  /** Set explicitly, so a lesson never inherits the account's default alerts. */
  reminders?: { useDefault: boolean };
  /** Whether the event blocks time on the calendar it's published to. */
  transparency?: "opaque" | "transparent";
  extendedProperties?: { private?: Record<string, string> };
}

export interface CalendarEvent extends CalendarEventInput {
  id: string;
}
