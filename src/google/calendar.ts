import type {
  CalendarClient,
  CalendarEvent,
  CalendarSummary,
  CreateCalendarRequest,
  DeleteEventRequest,
  InsertEventRequest,
  ListEventsRequest,
  UpdateEventRequest,
} from "../ports/calendar.js";
import { googleApi, type GoogleApi, type GoogleApiOptions } from "./api.js";
import type { Authorisation } from "./authorisation.js";
import { systemFetch } from "./http.js";
import { CALENDAR_SCOPE } from "./scopes.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3";

/** As many as Google will give at once; fewer pages is fewer requests. */
const PAGE_SIZE = "250";

/** One page of a listing, whatever it lists. */
interface Page<T> {
  items?: T[];
  nextPageToken?: string;
}

/** A calendar identifier is an address, so it never goes into a path raw. */
const calendarPath = (calendarId: string) =>
  `${CALENDAR}/calendars/${encodeURIComponent(calendarId)}`;

/** The real Google Calendar client, behind the port the pipeline publishes through. */
export function googleCalendarClient(
  authorisation: Authorisation,
  options: GoogleApiOptions = {},
): CalendarClient {
  const api = googleApi(
    "Google Calendar",
    CALENDAR_SCOPE,
    authorisation,
    options.fetch ?? systemFetch,
  );

  return {
    async listCalendars(): Promise<CalendarSummary[]> {
      const entries = await everyPage<{ id: string; summary?: string; primary?: boolean }>(
        api,
        `${CALENDAR}/users/me/calendarList?maxResults=${PAGE_SIZE}`,
      );

      return entries.map((entry) => ({
        id: entry.id,
        summary: entry.summary ?? entry.id,
        ...(entry.primary === true ? { primary: true } : {}),
      }));
    },

    async createCalendar(request: CreateCalendarRequest): Promise<CalendarSummary> {
      const created = await api.post<{ id: string; summary?: string }>(
        `${CALENDAR}/calendars`,
        { summary: request.summary, timeZone: request.timeZone },
      );
      return { id: created.id, summary: created.summary ?? request.summary };
    },

    async listEvents(request: ListEventsRequest): Promise<CalendarEvent[]> {
      const query = new URLSearchParams({
        // The pipeline publishes and reconciles recurring events whole
        // (ADR-0003), so it wants the events themselves, not their instances.
        singleEvents: "false",
        showDeleted: "false",
        maxResults: PAGE_SIZE,
      });
      if (request.privateExtendedProperty !== undefined) {
        query.set("privateExtendedProperty", request.privateExtendedProperty);
      }

      return everyPage<CalendarEvent>(api, `${calendarPath(request.calendarId)}/events?${query}`);
    },

    async insertEvent(request: InsertEventRequest): Promise<CalendarEvent> {
      return api.post<CalendarEvent>(`${calendarPath(request.calendarId)}/events`, request.event);
    },

    async updateEvent(request: UpdateEventRequest): Promise<CalendarEvent> {
      return api.put<CalendarEvent>(
        `${calendarPath(request.calendarId)}/events/${encodeURIComponent(request.eventId)}`,
        request.event,
      );
    },

    async deleteEvent(request: DeleteEventRequest): Promise<void> {
      await api.delete(
        `${calendarPath(request.calendarId)}/events/${encodeURIComponent(request.eventId)}`,
      );
    },
  };
}

/**
 * Every page of a listing, followed to the end. Google pages everything, and a
 * truncated listing would read as a calendar with fewer events on it than it
 * has — which reconciliation would then publish again.
 */
async function everyPage<T>(api: GoogleApi, url: string): Promise<T[]> {
  const collected: T[] = [];
  let next: string | undefined;

  do {
    const separator = url.includes("?") ? "&" : "?";
    const page: Page<T> = await api.get<Page<T>>(
      next === undefined ? url : `${url}${separator}pageToken=${encodeURIComponent(next)}`,
    );
    collected.push(...(page.items ?? []));
    next = page.nextPageToken;
  } while (next !== undefined);

  return collected;
}
