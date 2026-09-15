/**
 * A complete, valid Intake for a school whose day has Slots of differing
 * duration and whose weekdays are ragged. Every validation test starts from
 * this and breaks exactly one thing, so a failure names the break rather than
 * the fixture.
 */

const provenance = (source: string) => ({
  source,
  sourceHash: "sha256:9f2c4a1b0e7d3856c1a4f0b92d6e8375a0c1d4e7f2b93856a0c1d4e7f2b93856",
  parsedAt: "2025-09-10T12:00:00Z",
  agent: "claude-opus-5",
});

/**
 * Five Slots — the last two half the length of the first three — separated by
 * Breaks, one of them labelled.
 */
export const schoolDay = {
  schemaVersion: "1",
  provenance: provenance("5b-timetable-2025.pdf"),
  sequence: [
    { kind: "slot", start: "08:00", end: "08:40" },
    { kind: "break", start: "08:40", end: "08:50" },
    { kind: "slot", start: "08:50", end: "09:30" },
    { kind: "break", start: "09:30", end: "09:50", label: "голямо междучасие" },
    { kind: "slot", start: "09:50", end: "10:30" },
    { kind: "break", start: "10:30", end: "10:40" },
    { kind: "slot", start: "10:40", end: "11:10" },
    { kind: "break", start: "11:10", end: "11:20" },
    { kind: "slot", start: "11:20", end: "11:50" },
  ],
};

/**
 * Ragged: Monday runs all five Slots, Tuesday stops after three, Wednesday
 * leaves its second Slot empty and Friday has a single Lesson.
 */
export const timetable = {
  schemaVersion: "1",
  provenance: provenance("5b-timetable-2025.pdf"),
  lessons: [
    { weekday: "monday", slot: 1, subject: "Математика" },
    { weekday: "monday", slot: 2, subject: "Математика" },
    { weekday: "monday", slot: 3, subject: "Български език" },
    { weekday: "monday", slot: 4, subject: "Физическо възпитание" },
    { weekday: "monday", slot: 5, subject: "Музика" },
    { weekday: "tuesday", slot: 1, subject: "Български език" },
    { weekday: "tuesday", slot: 2, subject: "Български език" },
    { weekday: "tuesday", slot: 3, subject: "Английски език" },
    { weekday: "wednesday", slot: 1, subject: "Математика" },
    { weekday: "wednesday", slot: 3, subject: "История" },
    { weekday: "wednesday", slot: 4, subject: "История" },
    { weekday: "thursday", slot: 1, subject: "Английски език" },
    { weekday: "thursday", slot: 2, subject: "Технологии" },
    { weekday: "friday", slot: 2, subject: "Изобразително изкуство" },
  ],
};

export const nonSchoolDays = {
  schemaVersion: "1",
  provenance: provenance("mon-school-calendar-2025.html"),
  ranges: [
    { label: "Есенна ваканция", start: "2025-10-31", end: "2025-11-03" },
    { label: "Коледна ваканция", start: "2025-12-24", end: "2026-01-04" },
  ],
};

export const term = {
  schemaVersion: "1",
  provenance: provenance("mon-school-calendar-2025.html"),
  start: "2025-09-15",
  end: "2026-01-30",
};

/**
 * The fixture's School day with entries of its sequence replaced by position,
 * so that a test breaks exactly one time of day and the rest of the day around
 * it stays valid.
 */
export function schoolDayWith(replacements: Record<number, object>): object {
  return {
    ...schoolDay,
    sequence: schoolDay.sequence.map((entry, index) => replacements[index] ?? entry),
  };
}

export const SCHOOL_DAY_FILE = "intake/school-day.json";
export const TIMETABLE_FILE = "intake/timetable.json";
export const NON_SCHOOL_DAYS_FILE = "intake/non-school-days.json";
export const TERM_FILE = "intake/term.json";

/**
 * The fixture as a data repository's files, ready for `dataRepository`.
 * `overrides` replaces whole documents; a `null` leaves the document out
 * altogether, which is how a test drops one.
 */
export function intakeFiles(
  overrides: Record<string, unknown | null> = {},
): Record<string, string | object> {
  const files: Record<string, unknown> = {
    [SCHOOL_DAY_FILE]: schoolDay,
    [TIMETABLE_FILE]: timetable,
    [NON_SCHOOL_DAYS_FILE]: nonSchoolDays,
    [TERM_FILE]: term,
    ...overrides,
  };

  return Object.fromEntries(
    Object.entries(files).filter(([, contents]) => contents !== null),
  ) as Record<string, string | object>;
}
