import { describe, expect, test } from "vitest";
import type { CalendarEvent } from "../src/ports/calendar.js";
import { CALENDAR_ID, configFile } from "./support/config.js";
import { dataRepository } from "./support/data-repository.js";
import { fakeCalendarClient, type FakeCalendarClient } from "./support/fake-calendar.js";
import { schoolSpreadsheet } from "./support/fake-sheets.js";
import {
  intakeFiles,
  nonSchoolDays,
  schoolDayWith,
  SCHOOL_DAY_FILE,
  NON_SCHOOL_DAYS_FILE,
  term,
  TERM_FILE,
  timetable,
  TIMETABLE_FILE,
} from "./support/intake.js";
import { runCli, type CliRun } from "./support/run-cli.js";

/**
 * What a second `apply` does: the calendar converges on the Intake rather than
 * gaining a second copy of the week. Correcting a mistyped subject is a one-line
 * edit to the Intake and a re-run (ADR-0006).
 */

/** One run against a calendar that keeps whatever earlier runs left on it. */
async function apply(
  calendar: FakeCalendarClient,
  files: Record<string, unknown> = {},
): Promise<CliRun> {
  const root = await dataRepository({ ...configFile(), ...intakeFiles(files) });
  return runCli(["apply", root, "--yes"], { sheets: schoolSpreadsheet(), calendar });
}

/** A run that stops to ask, which is how an operator sees the summary. */
async function summarise(
  calendar: FakeCalendarClient,
  files: Record<string, unknown> = {},
): Promise<CliRun> {
  const root = await dataRepository({ ...configFile(), ...intakeFiles(files) });
  return runCli(["apply", root], { sheets: schoolSpreadsheet(), calendar, confirm: true });
}

/** Every event on the calendar Config names, by subject and by the Slot it starts in. */
function publishedBlocks(calendar: FakeCalendarClient): string[] {
  return calendar
    .eventsOn(CALENDAR_ID)
    .map((event) => `${event.extendedProperties?.private?.block} ${event.summary}`);
}

/** The one Lesson the tests about Google's own shapes bend the Timetable to. */
const ONE_LESSON_MONDAY = { weekday: "monday", slot: 1, subject: "Математика" };

/** That Lesson as a whole Intake: one Block on the calendar, and no holidays. */
const ONE_LESSON = {
  [TIMETABLE_FILE]: { ...timetable, lessons: [ONE_LESSON_MONDAY] },
  [NON_SCHOOL_DAYS_FILE]: { ...nonSchoolDays, ranges: [] },
};

/**
 * That Block's event as Google hands it back to the run after: a wall-clock
 * time with the zone's offset appended to it, which is not the text the
 * pipeline sent and stands for the same moment.
 */
function asGoogleReturnsIt(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-of-the-last-run",
    summary: "Математика",
    start: { dateTime: "2025-09-15T08:00:00+03:00", timeZone: "Europe/Sofia" },
    end: { dateTime: "2025-09-15T08:40:00+03:00", timeZone: "Europe/Sofia" },
    recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20260126T060000Z"],
    reminders: { useDefault: false },
    transparency: "transparent",
    extendedProperties: {
      private: {
        publishedBy: "school-schedule",
        block: "monday-1",
        term: "2025-09-15/2026-01-30",
      },
    },
    ...overrides,
  };
}

/** One Block's event on the calendar, by the Block it was stamped with. */
function eventFor(calendar: FakeCalendarClient, block: string): CalendarEvent | undefined {
  return calendar
    .eventsOn(CALENDAR_ID)
    .find((event) => event.extendedProperties?.private?.block === block);
}

/** When that Block's event starts, and when it ends. */
function startsOf(calendar: FakeCalendarClient, block: string): string | undefined {
  return eventFor(calendar, block)?.start.dateTime;
}

function endsOf(calendar: FakeCalendarClient, block: string): string | undefined {
  return eventFor(calendar, block)?.end.dateTime;
}

/** The dates that Block's recurrence skips. */
function exclusionsOf(calendar: FakeCalendarClient, block: string): string[] {
  return (eventFor(calendar, block)?.recurrence ?? [])
    .filter((line) => line.startsWith("EXDATE"))
    .flatMap((line) => line.slice(line.indexOf(":") + 1).split(","));
}

/** The Terms the calendar's events belong to, each named once. */
function terms(calendar: FakeCalendarClient): string[] {
  return [
    ...new Set(
      calendar
        .eventsOn(CALENDAR_ID)
        .map((event) => event.extendedProperties?.private?.term ?? "none"),
    ),
  ];
}

/** What the latest run asked of Google, with what earlier runs asked set aside. */
function asked(calendar: FakeCalendarClient, alreadyAsked: number): string[] {
  return calendar.requests.slice(alreadyAsked).map((request) => request.kind);
}

describe("a second run of an unchanged Intake", () => {
  test("writes nothing at all, having read the calendar once to find that out", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);
    const week = calendar.eventsOn(CALENDAR_ID);
    const alreadyAsked = calendar.requests.length;

    const run = await apply(calendar);

    expect(run.exitCode).toBe(0);
    // One listing to see what is there, and not a single write: the calendar
    // already says what the Intake says.
    expect(asked(calendar, alreadyAsked)).toEqual(["listEvents"]);
    expect(calendar.eventsOn(CALENDAR_ID)).toEqual(week);
  });
});

describe("a correction to the Intake", () => {
  test("a mistyped subject is updated in place rather than published a second time", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);
    const alreadyAsked = calendar.requests.length;

    const run = await apply(calendar, {
      [TIMETABLE_FILE]: {
        ...timetable,
        lessons: timetable.lessons.map((lesson) =>
          lesson.weekday === "friday"
            ? { ...lesson, subject: "Изобразително изкуство и графика" }
            : lesson,
        ),
      },
    });

    expect(run.exitCode).toBe(0);
    expect(asked(calendar, alreadyAsked)).toEqual(["listEvents", "updateEvent"]);
    // Eleven Blocks before and eleven after, the corrected one among them.
    expect(publishedBlocks(calendar)).toContain("friday-2 Изобразително изкуство и графика");
    expect(publishedBlocks(calendar)).toHaveLength(11);
  });

  test("a School day re-timed re-times the events taught in the Slots that moved", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);
    const alreadyAsked = calendar.requests.length;

    // The school starts Slot 1 ten minutes later and runs Slot 2 ten minutes
    // longer, pushing the Break after it back to keep the day contiguous.
    const run = await apply(calendar, {
      [SCHOOL_DAY_FILE]: schoolDayWith({
        0: { kind: "slot", start: "08:10", end: "08:40" },
        2: { kind: "slot", start: "08:50", end: "09:40" },
        3: { kind: "break", start: "09:40", end: "09:50", label: "голямо междучасие" },
      }),
    });

    expect(run.exitCode).toBe(0);
    // Six Blocks are taught in one of those two Slots — four beginning in the
    // first, two ending in the second. The other five are left alone.
    expect(asked(calendar, alreadyAsked)).toEqual([
      "listEvents",
      ...Array<string>(6).fill("updateEvent"),
    ]);
    expect(startsOf(calendar, "monday-1")).toBe("2025-09-15T08:10:00");
    // Friday's Block begins where it always did and now ends ten minutes later,
    // which no recurrence line would give away: its rule is bound by its start.
    expect(startsOf(calendar, "friday-2")).toBe("2025-09-19T08:50:00");
    expect(endsOf(calendar, "friday-2")).toBe("2025-09-19T09:40:00");
  });

  test("a holiday added to the Non-school days is taken out of the events it falls on", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);
    const alreadyAsked = calendar.requests.length;

    const run = await apply(calendar, {
      [NON_SCHOOL_DAYS_FILE]: {
        ...nonSchoolDays,
        // A Wednesday the school had not declared before.
        ranges: [...nonSchoolDays.ranges, { label: "Патронен празник", start: "2025-11-19", end: "2025-11-19" }],
      },
    });

    expect(run.exitCode).toBe(0);
    // Only Wednesday's two Blocks lose a date, so only those two are rewritten.
    expect(asked(calendar, alreadyAsked)).toEqual(["listEvents", "updateEvent", "updateEvent"]);
    expect(exclusionsOf(calendar, "wednesday-1")).toContain("20251119T080000");
  });

  test("a Lesson taken out of the Timetable takes its event off the calendar", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);
    const alreadyAsked = calendar.requests.length;

    const run = await apply(calendar, {
      [TIMETABLE_FILE]: {
        ...timetable,
        lessons: timetable.lessons.filter((lesson) => lesson.weekday !== "friday"),
      },
    });

    expect(run.exitCode).toBe(0);
    expect(asked(calendar, alreadyAsked)).toEqual(["listEvents", "deleteEvent"]);
    expect(publishedBlocks(calendar)).toHaveLength(10);
    expect(publishedBlocks(calendar)).not.toContain("friday-2 Изобразително изкуство");
  });

  test("a Block that now begins in another Slot leaves no duplicate behind", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);
    const alreadyAsked = calendar.requests.length;

    // Monday's double Математика loses its first Slot, so the Block that ran
    // 08:00–09:30 from Slot 1 now runs 08:50–09:30 from Slot 2 — a different
    // Block, correlating on nothing the calendar already holds.
    const run = await apply(calendar, {
      [TIMETABLE_FILE]: {
        ...timetable,
        lessons: timetable.lessons.filter(
          (lesson) => !(lesson.weekday === "monday" && lesson.slot === 1),
        ),
      },
    });

    expect(run.exitCode).toBe(0);
    // The one that has gone is deleted before the one that replaces it is
    // written, so the week is never on the calendar twice over.
    expect(asked(calendar, alreadyAsked)).toEqual(["listEvents", "deleteEvent", "insertEvent"]);
    expect(publishedBlocks(calendar).filter((event) => event.endsWith("Математика"))).toEqual([
      "wednesday-1 Математика",
      "monday-2 Математика",
    ]);
  });
});

describe("a calendar the pipeline is not alone on", () => {
  test("an event the operator made themselves is neither read, updated nor deleted", async () => {
    const theirs: CalendarEvent = {
      id: "event-of-their-own",
      summary: "Родителска среща",
      start: { dateTime: "2025-09-24T18:00:00+03:00", timeZone: "Europe/Sofia" },
      end: { dateTime: "2025-09-24T19:00:00+03:00", timeZone: "Europe/Sofia" },
    };
    const calendar = fakeCalendarClient({ events: { [CALENDAR_ID]: [theirs] } });

    await apply(calendar);
    const alreadyAsked = calendar.requests.length;
    await apply(calendar);

    // Correlating on the pipeline's own stamp is what keeps their event theirs:
    // the listing never returns it, so nothing can be done to it (ADR-0006).
    expect(asked(calendar, alreadyAsked)).toEqual(["listEvents"]);
    expect(calendar.eventsOn(CALENDAR_ID)).toContainEqual(theirs);
  });

  test("an event that has lost which Block it is gets deleted and its Block published afresh", async () => {
    const stripped: CalendarEvent = {
      ...asGoogleReturnsIt(),
      extendedProperties: { private: { publishedBy: "school-schedule" } },
    };
    const calendar = fakeCalendarClient({ events: { [CALENDAR_ID]: [stripped] } });

    const run = await apply(calendar, ONE_LESSON);

    // An orphan cannot be correlated with anything, so it is rebuilt rather
    // than updated in place — the accepted cost of correlating this way.
    expect(run.exitCode).toBe(0);
    expect(asked(calendar, 0)).toEqual(["listEvents", "deleteEvent", "insertEvent"]);
    expect(publishedBlocks(calendar)).toEqual(["monday-1 Математика"]);
  });

  test("the copies a run from before reconciliation left behind collapse to one each", async () => {
    const before = fakeCalendarClient();
    await apply(before);
    const week = before.eventsOn(CALENDAR_ID);
    // The same week twice over, as publishing without reconciling would leave it.
    const again = week.map((event) => ({ ...event, id: `${event.id}-again` }));
    const calendar = fakeCalendarClient({ events: { [CALENDAR_ID]: [...week, ...again] } });

    const run = await apply(calendar);

    expect(run.exitCode).toBe(0);
    expect(asked(calendar, 0)).toEqual(["listEvents", ...Array<string>(11).fill("deleteEvent")]);
    expect(publishedBlocks(calendar)).toHaveLength(11);
  });
});

describe("what Google hands back", () => {
  test("a time echoed with the zone's offset on it still reads as unchanged", async () => {
    const calendar = fakeCalendarClient({ events: { [CALENDAR_ID]: [asGoogleReturnsIt()] } });

    const run = await apply(calendar, ONE_LESSON);

    // Google returns `2025-09-15T08:00:00+03:00` for the `2025-09-15T08:00:00`
    // it was sent. Reading that as a changed time would rewrite the whole week
    // on every run.
    expect(run.exitCode).toBe(0);
    expect(asked(calendar, 0)).toEqual(["listEvents"]);
  });

  test("exclusions grouped into other lines still read as the same recurrence", async () => {
    const calendar = fakeCalendarClient({
      events: {
        [CALENDAR_ID]: [
          asGoogleReturnsIt({
            recurrence: [
              "EXDATE;TZID=Europe/Sofia:20251229T080000",
              "RRULE:FREQ=WEEKLY;UNTIL=20260126T060000Z",
              "EXDATE;TZID=Europe/Sofia:20251103T080000",
            ],
          }),
        ],
      },
    });

    // The same two Non-school days the pipeline sends as one line, split over
    // two and in another order: the same recurrence, and no reason to write.
    const run = await apply(calendar, {
      [TIMETABLE_FILE]: { ...timetable, lessons: [ONE_LESSON_MONDAY] },
    });

    expect(run.exitCode).toBe(0);
    expect(asked(calendar, 0)).toEqual(["listEvents"]);
  });
});

describe("a new Term published to the calendar the last one was", () => {
  test("the previous Term's events are swept rather than left stacked under it", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);
    const alreadyAsked = calendar.requests.length;

    const run = await apply(calendar, {
      [TERM_FILE]: { ...term, start: "2026-02-09", end: "2026-06-30" },
      [NON_SCHOOL_DAYS_FILE]: {
        ...nonSchoolDays,
        ranges: [{ label: "Великденска ваканция", start: "2026-04-10", end: "2026-04-13" }],
      },
    });

    expect(run.exitCode).toBe(0);
    // Every event of the first Term goes, and the second Term's week is
    // published in its place: eleven out, eleven in, on one reading.
    expect(asked(calendar, alreadyAsked)).toEqual([
      "listEvents",
      ...Array<string>(11).fill("deleteEvent"),
      ...Array<string>(11).fill("insertEvent"),
    ]);
    expect(publishedBlocks(calendar)).toHaveLength(11);
    expect(terms(calendar)).toEqual(["2026-02-09/2026-06-30"]);
  });
});

describe("what the operator is told before they answer", () => {
  test("a first run counts the whole week as events to add", async () => {
    const calendar = fakeCalendarClient();

    const run = await summarise(calendar);

    expect(run.stdout).toContain("11 to add, 0 to update, 0 to delete");
    // Counted before the question, and nothing written until it is answered.
    expect(run.questions).toHaveLength(1);
  });

  test("a re-run counts what has changed, and says so before anything is written", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);

    const run = await summarise(calendar, {
      [TIMETABLE_FILE]: {
        ...timetable,
        lessons: timetable.lessons.filter(
          (lesson) => !(lesson.weekday === "monday" && lesson.slot === 1),
        ),
      },
    });

    const counted = run.stdout.indexOf("1 to add, 0 to update, 1 to delete");
    const written = run.stdout.indexOf("Published to ");
    expect(counted).toBeGreaterThan(-1);
    // Counted, then asked, then written — in that order, in what the operator reads.
    expect(written).toBeGreaterThan(counted);
    expect(run.questions).toHaveLength(1);
  });

  test("a run with nothing to do says the calendar already says this", async () => {
    const calendar = fakeCalendarClient();
    await apply(calendar);

    const run = await summarise(calendar);

    expect(run.stdout).toContain("none; the calendar already says this");
    expect(run.stdout).toContain(`${CALENDAR_ID} was already up to date.`);
  });
});
