import { describe, expect, test } from "vitest";
import type { Authorisation } from "../src/google/authorisation.js";
import { googleCalendarClient } from "../src/google/calendar.js";
import { CALENDAR_SCOPE, SHEETS_SCOPE } from "../src/google/scopes.js";
import { googleSheetsClient } from "../src/google/sheets.js";
import { fakeFetch, jsonReply, type HttpCall } from "./support/fake-fetch.js";

/** An authorisation that grants whatever is asked of it, and records what was. */
function granting(): Authorisation & { scopes: string[] } {
  const scopes: string[] = [];
  return {
    scopes,
    async accessToken(scope) {
      scopes.push(scope);
      return "access-that-works";
    },
  };
}

/** One that refuses everything, the way an ungranted scope does. */
const refusing: Authorisation = {
  async accessToken(scope) {
    throw new Error(`not granted: ${scope}`);
  },
};

const bodyOf = (call: HttpCall | undefined): unknown => JSON.parse(call?.body ?? "null");

describe("the Sheets client", () => {
  test("reads a spreadsheet's tabs, asking only for what the pipeline uses", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({
        spreadsheetId: "the-spreadsheet",
        sheets: [
          { properties: { sheetId: 0, title: "Sheet1" } },
          { properties: { sheetId: 42, title: "5В — I срок" } },
        ],
      }),
    );
    const client = googleSheetsClient(granting(), { fetch: fetching });

    const spreadsheet = await client.getSpreadsheet({ spreadsheetId: "the-spreadsheet" });

    expect(spreadsheet).toEqual({
      spreadsheetId: "the-spreadsheet",
      sheets: [
        { sheetId: 0, title: "Sheet1" },
        { sheetId: 42, title: "5В — I срок" },
      ],
    });
    expect(fetching.calls[0]?.url).toContain(
      "https://sheets.googleapis.com/v4/spreadsheets/the-spreadsheet",
    );
    expect(fetching.calls[0]?.url).toContain("fields=");
  });

  test("carries the access token, and asks for the Sheets scope to get it", async () => {
    const authorisation = granting();
    const fetching = fakeFetch(() => jsonReply({ spreadsheetId: "s", sheets: [] }));

    await googleSheetsClient(authorisation, { fetch: fetching }).getSpreadsheet({
      spreadsheetId: "s",
    });

    expect(authorisation.scopes).toEqual([SHEETS_SCOPE]);
    expect(fetching.calls[0]?.headers["authorization"]).toBe("Bearer access-that-works");
  });

  test("sends a whole batch as one request, which is how the quota counts it", async () => {
    const fetching = fakeFetch(() => jsonReply({ replies: [] }));
    const requests = [{ updateCells: {} }, { mergeCells: {} }];

    await googleSheetsClient(granting(), { fetch: fetching }).batchUpdate({
      spreadsheetId: "the-spreadsheet",
      requests,
    });

    expect(fetching.calls).toHaveLength(1);
    expect(fetching.calls[0]?.method).toBe("POST");
    expect(fetching.calls[0]?.url).toContain("/the-spreadsheet:batchUpdate");
    expect(bodyOf(fetching.calls[0])).toEqual({ requests });
  });

  test("a spreadsheet identifier with a slash in it is escaped into the path", async () => {
    const fetching = fakeFetch(() => jsonReply({ spreadsheetId: "a/b", sheets: [] }));

    await googleSheetsClient(granting(), { fetch: fetching }).getSpreadsheet({
      spreadsheetId: "a/b",
    });

    expect(fetching.calls[0]?.url).toContain("/v4/spreadsheets/a%2Fb");
  });

  test("a refusal from Google is reported in Google's own words", async () => {
    const fetching = fakeFetch(() =>
      jsonReply(
        { error: { code: 403, status: "PERMISSION_DENIED", message: "The caller does not have permission" } },
        403,
      ),
    );
    const client = googleSheetsClient(granting(), { fetch: fetching });

    await expect(client.getSpreadsheet({ spreadsheetId: "s" })).rejects.toThrow(
      /PERMISSION_DENIED[\s\S]*caller does not have permission/,
    );
  });

  test("an ungranted scope stops the request before it is sent", async () => {
    const fetching = fakeFetch();

    await expect(
      googleSheetsClient(refusing, { fetch: fetching }).getSpreadsheet({ spreadsheetId: "s" }),
    ).rejects.toThrow(SHEETS_SCOPE);
    expect(fetching.calls).toEqual([]);
  });
});

describe("the Calendar client", () => {
  test("lists the account's calendars, marking the primary one", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({
        items: [
          { id: "operator@example.com", summary: "Operator", primary: true },
          { id: "school@group.calendar.google.com", summary: "School" },
        ],
      }),
    );

    const calendars = await googleCalendarClient(granting(), { fetch: fetching }).listCalendars();

    expect(calendars).toEqual([
      { id: "operator@example.com", summary: "Operator", primary: true },
      { id: "school@group.calendar.google.com", summary: "School" },
    ]);
  });

  test("follows Google's paging, so a long list is not silently truncated", async () => {
    const fetching = fakeFetch((call) =>
      call.url.includes("pageToken=second")
        ? jsonReply({ items: [{ id: "b", summary: "B" }] })
        : jsonReply({ items: [{ id: "a", summary: "A" }], nextPageToken: "second" }),
    );

    const calendars = await googleCalendarClient(granting(), { fetch: fetching }).listCalendars();

    expect(calendars.map((calendar) => calendar.id)).toEqual(["a", "b"]);
    expect(fetching.calls).toHaveLength(2);
  });

  test("lists a calendar's events by the property the pipeline stamped on its own", async () => {
    const fetching = fakeFetch(() => jsonReply({ items: [] }));

    await googleCalendarClient(granting(), { fetch: fetching }).listEvents({
      calendarId: "school@group.calendar.google.com",
      privateExtendedProperty: "publishedBy=school-schedule",
    });

    const url = new URL(fetching.calls[0]!.url);
    expect(url.pathname).toBe(
      "/calendar/v3/calendars/school%40group.calendar.google.com/events",
    );
    expect(url.searchParams.get("privateExtendedProperty")).toBe("publishedBy=school-schedule");
    // Recurring events are published and reconciled whole, never as instances.
    expect(url.searchParams.get("singleEvents")).toBe("false");
  });

  test("inserts, updates and deletes an event where Google keeps it", async () => {
    const fetching = fakeFetch(() => jsonReply({ id: "minted" }));
    const client = googleCalendarClient(granting(), { fetch: fetching });
    const event = {
      summary: "Математика",
      start: { dateTime: "2026-02-02T09:30:00", timeZone: "Europe/Sofia" },
      end: { dateTime: "2026-02-02T10:10:00", timeZone: "Europe/Sofia" },
    };

    await client.insertEvent({ calendarId: "school@example.com", event });
    await client.updateEvent({ calendarId: "school@example.com", eventId: "e1", event });
    await client.deleteEvent({ calendarId: "school@example.com", eventId: "e1" });

    expect(fetching.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "POST /calendar/v3/calendars/school%40example.com/events",
      "PUT /calendar/v3/calendars/school%40example.com/events/e1",
      "DELETE /calendar/v3/calendars/school%40example.com/events/e1",
    ]);
    expect(bodyOf(fetching.calls[0])).toEqual(event);
  });

  test("creates a calendar in the timezone Config names", async () => {
    const fetching = fakeFetch(() => jsonReply({ id: "minted", summary: "School" }));

    const created = await googleCalendarClient(granting(), { fetch: fetching }).createCalendar({
      summary: "School",
      timeZone: "Europe/Sofia",
    });

    expect(created).toEqual({ id: "minted", summary: "School" });
    expect(bodyOf(fetching.calls[0])).toEqual({ summary: "School", timeZone: "Europe/Sofia" });
  });

  test("asks for the Calendar scope, not the Sheets one", async () => {
    const authorisation = granting();

    await googleCalendarClient(authorisation, { fetch: fakeFetch(() => jsonReply({ items: [] })) })
      .listCalendars();

    expect(authorisation.scopes).toEqual([CALENDAR_SCOPE]);
  });
});
