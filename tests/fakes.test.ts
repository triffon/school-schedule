import { describe, expect, test } from "vitest";
import { fakeCalendarClient } from "./support/fake-calendar.js";
import { fakeSheetsClient } from "./support/fake-sheets.js";
import type { CalendarEvent } from "../src/ports/calendar.js";

/**
 * The fakes are the seam's other half: every later ticket asserts through them,
 * so their own contract — what they record and what they can be seeded with —
 * is pinned here.
 */

const mathsOnMonday: CalendarEvent = {
  id: "existing-maths",
  summary: "Математика",
  start: { dateTime: "2026-02-02T09:30:00", timeZone: "Europe/Sofia" },
  end: { dateTime: "2026-02-02T10:10:00", timeZone: "Europe/Sofia" },
  extendedProperties: { private: { block: "MON-1", term: "2025/26-2" } },
};

const somethingTheOperatorMade: CalendarEvent = {
  id: "operators-own",
  summary: "Dentist",
  start: { dateTime: "2026-02-03T11:00:00", timeZone: "Europe/Sofia" },
  end: { dateTime: "2026-02-03T11:30:00", timeZone: "Europe/Sofia" },
};

describe("the fake Calendar client", () => {
  test("can be pre-seeded with the events a calendar already holds", async () => {
    const calendar = fakeCalendarClient({
      events: { "school@group.calendar.google.com": [mathsOnMonday, somethingTheOperatorMade] },
    });

    const listed = await calendar.listEvents({
      calendarId: "school@group.calendar.google.com",
    });

    expect(listed.map((event) => event.id)).toEqual(["existing-maths", "operators-own"]);
  });

  test("listing by private extended property returns only the matching events", async () => {
    const calendar = fakeCalendarClient({
      events: { "school@group.calendar.google.com": [mathsOnMonday, somethingTheOperatorMade] },
    });

    const listed = await calendar.listEvents({
      calendarId: "school@group.calendar.google.com",
      privateExtendedProperty: "term=2025/26-2",
    });

    expect(listed.map((event) => event.id)).toEqual(["existing-maths"]);
  });

  test("records each call in the order it was made", async () => {
    const calendar = fakeCalendarClient({
      events: { "school@group.calendar.google.com": [mathsOnMonday] },
    });

    await calendar.listEvents({ calendarId: "school@group.calendar.google.com" });
    await calendar.deleteEvent({
      calendarId: "school@group.calendar.google.com",
      eventId: "existing-maths",
    });

    expect(calendar.requests).toEqual([
      { kind: "listEvents", request: { calendarId: "school@group.calendar.google.com" } },
      {
        kind: "deleteEvent",
        request: { calendarId: "school@group.calendar.google.com", eventId: "existing-maths" },
      },
    ]);
  });

  test("a read leaves the writes empty, so a no-op run is provable", async () => {
    const calendar = fakeCalendarClient({
      events: { "school@group.calendar.google.com": [mathsOnMonday] },
    });

    await calendar.listEvents({ calendarId: "school@group.calendar.google.com" });

    expect(calendar.writes).toEqual([]);
  });

  test("inserts, updates and deletes are visible in the calendar's events afterwards", async () => {
    const calendar = fakeCalendarClient({
      events: { "school@group.calendar.google.com": [mathsOnMonday] },
    });

    const inserted = await calendar.insertEvent({
      calendarId: "school@group.calendar.google.com",
      event: { ...somethingTheOperatorMade, summary: "Физика" },
    });
    await calendar.updateEvent({
      calendarId: "school@group.calendar.google.com",
      eventId: "existing-maths",
      event: { ...mathsOnMonday, summary: "Математика и информатика" },
    });
    await calendar.deleteEvent({
      calendarId: "school@group.calendar.google.com",
      eventId: inserted.id,
    });

    const remaining = calendar.eventsOn("school@group.calendar.google.com");
    expect(remaining.map((event) => event.summary)).toEqual(["Математика и информатика"]);
  });

  test("deleting an event that is not there fails loudly", async () => {
    const calendar = fakeCalendarClient();

    await expect(
      calendar.deleteEvent({ calendarId: "school@group.calendar.google.com", eventId: "ghost" }),
    ).rejects.toThrow("ghost");
  });
});

describe("the fake Sheets client", () => {
  test("can be pre-seeded with the tabs a spreadsheet already has", async () => {
    const sheets = fakeSheetsClient({
      spreadsheets: {
        "sheet-id": [
          { sheetId: 0, title: "Term 1" },
          { sheetId: 7, title: "My notes" },
        ],
      },
    });

    const spreadsheet = await sheets.getSpreadsheet({ spreadsheetId: "sheet-id" });

    expect(spreadsheet.sheets.map((tab) => tab.title)).toEqual(["Term 1", "My notes"]);
  });

  test("records one entry per batch, as the Sheets quota counts them", async () => {
    const sheets = fakeSheetsClient({ spreadsheets: { "sheet-id": [] } });

    await sheets.batchUpdate({
      spreadsheetId: "sheet-id",
      requests: [{ addSheet: { properties: { title: "5B — Term 2" } } }, { mergeCells: {} }],
    });

    expect(sheets.batches).toHaveLength(1);
    expect(sheets.batches[0]?.requests).toHaveLength(2);
  });

  test("asking for a spreadsheet that is not there fails loudly", async () => {
    const sheets = fakeSheetsClient();

    await expect(sheets.getSpreadsheet({ spreadsheetId: "nope" })).rejects.toThrow("nope");
  });
});
