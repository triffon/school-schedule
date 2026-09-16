import { describe, expect, test } from "vitest";
import { CALENDAR_ID, config, configFile, SPREADSHEET_ID } from "./support/config.js";
import { dataRepository } from "./support/data-repository.js";
import type { CalendarEvent } from "../src/ports/calendar.js";
import type { FakeCalendarClient } from "./support/fake-calendar.js";
import { schoolSpreadsheet } from "./support/fake-sheets.js";
import {
  intakeFiles,
  nonSchoolDays,
  NON_SCHOOL_DAYS_FILE,
  term,
  TERM_FILE,
  timetable,
  TIMETABLE_FILE,
} from "./support/intake.js";
import { runCli, type CliRun } from "./support/run-cli.js";

/**
 * What a student sees in their calendar: one recurring event per Block, running
 * for the Term and skipping the Non-school days (ADR-0003, ADR-0008).
 */

/** Publishes the fixture week, or a Timetable a test has bent, to both Destinations. */
async function publish(files: Record<string, unknown> = {}): Promise<CliRun> {
  const root = await dataRepository({ ...configFile(), ...intakeFiles(files) });
  return runCli(["apply", root, "--yes"], { sheets: schoolSpreadsheet() });
}

/** Every event the run left on the calendar Config names, in the order it wrote them. */
function published(run: CliRun) {
  return run.calendar.eventsOn(CALENDAR_ID);
}

/**
 * A Calendar client that will not have the run, as an unauthorised one does.
 * `listing` is what it answers a listing with, for a calendar that lets the run
 * work out what it would change and then refuses to be written to.
 */
function refusing(why: string, listing?: CalendarEvent[]): FakeCalendarClient {
  const refuse = async (): Promise<never> => {
    throw new Error(why);
  };
  return {
    requests: [],
    writes: [],
    eventsOn: () => [],
    listCalendars: refuse,
    createCalendar: refuse,
    listEvents: listing === undefined ? refuse : async () => listing,
    insertEvent: refuse,
    updateEvent: refuse,
    deleteEvent: refuse,
  };
}

/** One event's recurrence lines of a given kind, per event, in event order. */
function recurrence(run: CliRun, kind: "RRULE" | "EXDATE"): string[] {
  return published(run).map((event) =>
    (event.recurrence ?? []).filter((line) => line.startsWith(kind)).join(" "),
  );
}

describe("one recurring event per Block", () => {
  test("a Block rather than a Lesson is what reaches the calendar", async () => {
    const run = await publish();

    expect(run.exitCode).toBe(0);
    // Fourteen Lessons, eleven Blocks: Monday's double Математика and Tuesday's
    // double Български език each read as one lesson, as does Wednesday's
    // История spanning the short Break between its two Slots.
    expect(published(run).map((event) => event.summary)).toEqual([
      "Математика",
      "Български език",
      "Физическо възпитание",
      "Музика",
      "Български език",
      "Английски език",
      "Математика",
      "История",
      "Английски език",
      "Технологии",
      "Изобразително изкуство",
    ]);
  });
});

describe("when a Block runs", () => {
  test("it reads as one lesson from its first Slot's start to its last Slot's end", async () => {
    const run = await publish();

    // The Term begins on Monday 15 September, so each weekday's first
    // occurrence is that week's. A Block of several Slots is one stretch of
    // time, and it covers whatever lies between them: Wednesday's История runs
    // 09:50–11:10 over the short Break at 10:30.
    expect(published(run).map((event) => `${event.start.dateTime} – ${event.end.dateTime}`))
      .toEqual([
        "2025-09-15T08:00:00 – 2025-09-15T09:30:00",
        "2025-09-15T09:50:00 – 2025-09-15T10:30:00",
        "2025-09-15T10:40:00 – 2025-09-15T11:10:00",
        "2025-09-15T11:20:00 – 2025-09-15T11:50:00",
        "2025-09-16T08:00:00 – 2025-09-16T09:30:00",
        "2025-09-16T09:50:00 – 2025-09-16T10:30:00",
        "2025-09-17T08:00:00 – 2025-09-17T08:40:00",
        "2025-09-17T09:50:00 – 2025-09-17T11:10:00",
        "2025-09-18T08:00:00 – 2025-09-18T08:40:00",
        "2025-09-18T08:50:00 – 2025-09-18T09:30:00",
        "2025-09-19T08:50:00 – 2025-09-19T09:30:00",
      ]);
  });

  test("a Block spanning a labelled Break covers the Break's time", async () => {
    const run = await publish({
      [TIMETABLE_FILE]: {
        ...timetable,
        // Either side of голямо междучасие, 09:30–09:50.
        lessons: [
          { weekday: "monday", slot: 2, subject: "Химия" },
          { weekday: "monday", slot: 3, subject: "Химия" },
        ],
      },
    });

    // One event over the Break rather than two either side of it: an honest
    // rendering of continuous instruction in one subject (ADR-0008).
    expect(published(run)).toHaveLength(1);
    expect(published(run)[0]).toMatchObject({
      summary: "Химия",
      start: { dateTime: "2025-09-15T08:50:00" },
      end: { dateTime: "2025-09-15T10:30:00" },
    });
  });

  test("its times are wall-clock, in the zone Config names", async () => {
    const run = await publish();

    // No offset on the time and the zone said outright, so Google expands the
    // recurrence in that zone rather than at a fixed distance from UTC.
    for (const event of published(run)) {
      expect(event.start.timeZone).toBe("Europe/Sofia");
      expect(event.end.timeZone).toBe("Europe/Sofia");
    }
  });
});

describe("the recurrence", () => {
  test("repeats weekly and stops at the Term's last occurrence of that weekday", async () => {
    const run = await publish();

    // The Term ends on Friday 30 January 2026, so each weekday's last
    // occurrence is that week's. UNTIL is bound to be UTC, and Sofia stands two
    // hours ahead of it in January, so an 08:00 lesson bounds at 06:00 Z.
    expect(recurrence(run, "RRULE")).toEqual([
      "RRULE:FREQ=WEEKLY;UNTIL=20260126T060000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260126T075000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260126T084000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260126T092000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260127T060000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260127T075000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260128T060000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260128T075000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260129T060000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260129T065000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20260130T065000Z",
    ]);
  });

  test("a daylight-saving change inside the Term leaves the wall-clock time alone", async () => {
    const run = await publish({
      [TIMETABLE_FILE]: {
        ...timetable,
        lessons: [{ weekday: "monday", slot: 1, subject: "Математика" }],
      },
    });

    // Sofia puts its clocks back on 26 October, inside this Term. The lesson is
    // still at 08:00 either side of that, because the time is wall-clock in a
    // named zone rather than an instant. The bound is the one place a real
    // instant is required, and it is taken at the zone's winter offset of two
    // hours rather than the summer offset the recurrence started under.
    expect(published(run)[0]).toMatchObject({
      start: { dateTime: "2025-09-15T08:00:00", timeZone: "Europe/Sofia" },
    });
    expect(recurrence(run, "RRULE")).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20260126T060000Z"]);
  });
});

describe("the Non-school days", () => {
  test("every one falling on a Block's weekday is taken out of its recurrence", async () => {
    const run = await publish();

    // Есенна ваканция runs Friday 31 October to Monday 3 November and Коледна
    // ваканция from 24 December to 4 January, so each weekday loses a different
    // set of dates. An exclusion carries the lesson's own start time, because a
    // date alone would not match a timed occurrence.
    expect(recurrence(run, "EXDATE")).toEqual([
      "EXDATE;TZID=Europe/Sofia:20251103T080000,20251229T080000",
      "EXDATE;TZID=Europe/Sofia:20251103T095000,20251229T095000",
      "EXDATE;TZID=Europe/Sofia:20251103T104000,20251229T104000",
      "EXDATE;TZID=Europe/Sofia:20251103T112000,20251229T112000",
      "EXDATE;TZID=Europe/Sofia:20251230T080000",
      "EXDATE;TZID=Europe/Sofia:20251230T095000",
      "EXDATE;TZID=Europe/Sofia:20251224T080000,20251231T080000",
      "EXDATE;TZID=Europe/Sofia:20251224T095000,20251231T095000",
      "EXDATE;TZID=Europe/Sofia:20251225T080000,20260101T080000",
      "EXDATE;TZID=Europe/Sofia:20251225T085000,20260101T085000",
      "EXDATE;TZID=Europe/Sofia:20251031T085000,20251226T085000,20260102T085000",
    ]);
  });

  test("a labelled range covering a whole week empties every weekday of it", async () => {
    const run = await publish({
      [TIMETABLE_FILE]: {
        ...timetable,
        lessons: config.display.weekdays.map(({ weekday }) => ({
          weekday,
          slot: 1,
          subject: "Математика",
        })),
      },
      [NON_SCHOOL_DAYS_FILE]: {
        ...nonSchoolDays,
        // Monday 27 October to Sunday 2 November, the day after Sofia puts its
        // clocks back: the whole week goes, and at the lesson's wall-clock time.
        ranges: [{ label: "Есенна ваканция", start: "2025-10-27", end: "2025-11-02" }],
      },
    });

    expect(recurrence(run, "EXDATE")).toEqual([
      "EXDATE;TZID=Europe/Sofia:20251027T080000",
      "EXDATE;TZID=Europe/Sofia:20251028T080000",
      "EXDATE;TZID=Europe/Sofia:20251029T080000",
      "EXDATE;TZID=Europe/Sofia:20251030T080000",
      "EXDATE;TZID=Europe/Sofia:20251031T080000",
    ]);
  });
});

describe("what an event says and carries", () => {
  test("it says the subject and nothing else", async () => {
    const run = await publish();

    // A description or a location would repeat the title or invent a room the
    // Intake never recorded.
    for (const event of published(run)) {
      expect(event).not.toHaveProperty("description");
      expect(event).not.toHaveProperty("location");
    }
  });

  test("reminders are turned off outright, not left to the account default", async () => {
    const run = await publish();

    // A default alert would notify the student before every lesson, dozens of
    // times a week, so it is refused explicitly rather than left unsaid.
    for (const event of published(run)) {
      expect(event.reminders).toEqual({ useDefault: false });
    }
  });

  test("every event is free rather than busy", async () => {
    const run = await publish();

    // A lesson is not the student's own commitment, so it should not read as
    // one blocking their time on the calendar it's published to.
    for (const event of published(run)) {
      expect(event.transparency).toBe("transparent");
    }
  });

  test("each one names its Block, for a later run to correlate on", async () => {
    const run = await publish();

    // A Block is identified by its weekday and the Slot its run begins at
    // (ADR-0006), which is what a re-run matches its events on.
    expect(published(run).map((event) => event.extendedProperties?.private?.block)).toEqual([
      "monday-1",
      "monday-3",
      "monday-4",
      "monday-5",
      "tuesday-1",
      "tuesday-3",
      "wednesday-1",
      "wednesday-3",
      "thursday-1",
      "thursday-2",
      "friday-2",
    ]);
  });

  test("each one names the pipeline and the Term it belongs to", async () => {
    const run = await publish();

    // The pipeline's own mark is what a listing filters on, so that a run finds
    // its own events and never an operator's. The Term is identified by the
    // dates it is in force over rather than by Config's label for it: the label
    // is a display choice, and an event should not be swept and rebuilt because
    // the school reworded it.
    for (const event of published(run)) {
      expect(event.extendedProperties?.private).toMatchObject({
        publishedBy: "school-schedule",
        term: "2025-09-15/2026-01-30",
      });
    }
  });
});

describe("the run as an operator sees it", () => {
  test("the summary describes the calendar alongside the sheet, before anything is asked", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });

    const run = await runCli(["apply", root], { sheets: schoolSpreadsheet(), confirm: true });

    expect(run.stdout).toContain(CALENDAR_ID);
    expect(run.stdout).toContain("11 recurring events");
    // Sixteen dates over the fixture's two holiday ranges: four in the autumn
    // and twelve over Christmas.
    expect(run.stdout).toContain("2025-09-15 to 2026-01-30, skipping 16 Non-school days");
    // The sheet's half is still there, and one question gates both halves.
    expect(run.stdout).toContain(SPREADSHEET_ID);
    expect(run.questions).toHaveLength(1);
  });

  test("declining leaves both Destinations alone", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = schoolSpreadsheet();

    const run = await runCli(["apply", root], { sheets, confirm: false });

    expect(run.exitCode).not.toBe(0);
    expect(published(run)).toEqual([]);
    expect(sheets.batches).toEqual([]);
  });

  test("every request goes to the calendar Config names, and asks nothing else of Google", async () => {
    const run = await publish();

    // Naming a calendar in Config is the whole of choosing one (ADR-0004): the
    // pipeline never lists calendars and never creates one. It reads the events
    // on the one it was given, once, and writes what that read says it must.
    expect([...new Set(run.calendar.requests.map((request) => request.kind))]).toEqual([
      "listEvents",
      "insertEvent",
    ]);
    for (const request of run.calendar.requests) {
      expect(request).toMatchObject({ request: { calendarId: CALENDAR_ID } });
    }
  });

  test("a calendar that will not be read stops the run before the sheet is written", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = schoolSpreadsheet();

    const run = await runCli(["apply", root, "--yes"], {
      sheets,
      calendar: refusing(
        "school-schedule: Google Calendar refused the request — 403 PERMISSION_DENIED: no permission",
      ),
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("PERMISSION_DENIED");
    // Working out what to change is a read, and it happens before either
    // Destination is written to, so a calendar that refuses costs nothing.
    expect(sheets.batches).toEqual([]);
    expect(run.stderr).toMatch(/Nothing has been published/);
  });

  test("a calendar that fails partway is reported without claiming nothing was published", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = schoolSpreadsheet();

    const run = await runCli(["apply", root, "--yes"], {
      sheets,
      calendar: refusing(
        "school-schedule: Google Calendar refused the request — 503 UNAVAILABLE: backend error",
        [],
      ),
    });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("UNAVAILABLE");
    // The sheet went out as one batch before the calendar was written to, so
    // saying nothing had been published would be a lie.
    expect(sheets.batches).toHaveLength(1);
    expect(run.stderr).not.toMatch(/Nothing has been published/);
    expect(run.stderr).toContain("the calendar was not finished");
  });
});

describe("a Term too short to reach a weekday", () => {
  test("publishes nothing for the Blocks on it, rather than a lesson that never runs", async () => {
    const run = await publish({
      // Monday to Wednesday: Friday never comes round.
      [TERM_FILE]: { ...term, start: "2025-09-15", end: "2025-09-17" },
      [TIMETABLE_FILE]: {
        ...timetable,
        lessons: [
          { weekday: "monday", slot: 1, subject: "Математика" },
          { weekday: "friday", slot: 1, subject: "Химия" },
        ],
      },
      [NON_SCHOOL_DAYS_FILE]: { ...nonSchoolDays, ranges: [] },
    });

    expect(published(run).map((event) => event.summary)).toEqual(["Математика"]);
    expect(recurrence(run, "RRULE")).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20250915T050000Z"]);
  });
});
