import type {
  CalendarClient,
  CalendarEvent,
  CalendarSummary,
  CreateCalendarRequest,
  DeleteEventRequest,
  InsertEventRequest,
  ListEventsRequest,
  UpdateEventRequest,
} from "../../src/ports/calendar.js";

/**
 * What a test asserts on: one entry per call the command made, in a shape meant
 * to be read in a failure message rather than raw wire JSON.
 */
export type CalendarRequest =
  | { kind: "listCalendars" }
  | { kind: "createCalendar"; request: CreateCalendarRequest }
  | { kind: "listEvents"; request: ListEventsRequest }
  | { kind: "insertEvent"; request: InsertEventRequest }
  | { kind: "updateEvent"; request: UpdateEventRequest }
  | { kind: "deleteEvent"; request: DeleteEventRequest };

export interface FakeCalendarClient extends CalendarClient {
  /** Every call the command made, in order. */
  readonly requests: CalendarRequest[];
  /** Only the calls that change the account, in order. */
  readonly writes: CalendarRequest[];
  /** The events a calendar holds now, after everything the command did. */
  eventsOn(calendarId: string): CalendarEvent[];
}

export interface FakeCalendarState {
  /** Calendars the account already owns. */
  calendars?: CalendarSummary[];
  /** Events already on a calendar, so that reconciliation can be driven. */
  events?: Record<string, CalendarEvent[]>;
}

const WRITE_KINDS = new Set(["createCalendar", "insertEvent", "updateEvent", "deleteEvent"]);

/** Where an event sits on a calendar, refusing loudly when it isn't there. */
function locate(on: CalendarEvent[], target: { calendarId: string; eventId: string }): number {
  const at = on.findIndex((event) => event.id === target.eventId);
  if (at === -1) {
    throw new Error(`no event ${target.eventId} on calendar ${target.calendarId}`);
  }
  return at;
}

export function fakeCalendarClient(state: FakeCalendarState = {}): FakeCalendarClient {
  const requests: CalendarRequest[] = [];
  const calendars: CalendarSummary[] = [...(state.calendars ?? [])];
  const events = new Map<string, CalendarEvent[]>(
    Object.entries(state.events ?? {}).map(([calendarId, seeded]) => [calendarId, [...seeded]]),
  );

  let nextId = 1;
  const mintId = (prefix: string) => `${prefix}-${nextId++}`;

  const eventsFor = (calendarId: string): CalendarEvent[] => {
    const existing = events.get(calendarId);
    if (existing) return existing;
    const created: CalendarEvent[] = [];
    events.set(calendarId, created);
    return created;
  };

  const record = (request: CalendarRequest) => {
    requests.push(request);
  };

  return {
    requests,

    get writes() {
      return requests.filter((request) => WRITE_KINDS.has(request.kind));
    },

    eventsOn(calendarId) {
      return [...(events.get(calendarId) ?? [])];
    },

    async listCalendars() {
      record({ kind: "listCalendars" });
      return [...calendars];
    },

    async createCalendar(request) {
      record({ kind: "createCalendar", request });
      const created: CalendarSummary = { id: mintId("calendar"), summary: request.summary };
      calendars.push(created);
      return created;
    },

    async listEvents(request) {
      record({ kind: "listEvents", request });
      const all = eventsFor(request.calendarId);
      const filter = request.privateExtendedProperty;
      if (filter === undefined) return [...all];

      const separator = filter.indexOf("=");
      if (separator === -1) {
        throw new Error(`privateExtendedProperty must be "key=value", got: ${filter}`);
      }
      const key = filter.slice(0, separator);
      const value = filter.slice(separator + 1);
      return all.filter((event) => event.extendedProperties?.private?.[key] === value);
    },

    async insertEvent(request) {
      record({ kind: "insertEvent", request });
      const inserted: CalendarEvent = { ...request.event, id: mintId("event") };
      eventsFor(request.calendarId).push(inserted);
      return inserted;
    },

    async updateEvent(request) {
      record({ kind: "updateEvent", request });
      const on = eventsFor(request.calendarId);
      const updated: CalendarEvent = { ...request.event, id: request.eventId };
      on[locate(on, request)] = updated;
      return updated;
    },

    async deleteEvent(request) {
      record({ kind: "deleteEvent", request });
      const on = eventsFor(request.calendarId);
      on.splice(locate(on, request), 1);
    },
  };
}
