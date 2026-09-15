/**
 * The four Intake documents, and the shapes `src/intake/intake.schema.json`
 * describes. The schema is the contract an agent's output is held to; these
 * types are how the rest of the pipeline reads an Intake once it has passed.
 */

export interface Provenance {
  source: string;
  sourceHash: string;
  parsedAt: string;
  agent: string;
}

/**
 * The days a Lesson may fall on, in English and lower case whatever language
 * the school's own strings are in, and in the order the schema lists them.
 */
export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** A time window a Lesson may be taught in. Identified by its position. */
export interface Slot {
  kind: "slot";
  start: string;
  end: string;
}

/** A time window between two Slots. Rendered in the sheet only when labelled. */
export interface Break {
  kind: "break";
  start: string;
  end: string;
  label?: string;
}

export type SchoolDayEntry = Slot | Break;

export interface SchoolDay {
  schemaVersion: string;
  provenance: Provenance;
  sequence: SchoolDayEntry[];
}

/**
 * The School day's Slots, in order. A Lesson names its Slot by position among
 * exactly these, so this is also what turns a Lesson's number into a time.
 */
export function slotsOf(schoolDay: SchoolDay): Slot[] {
  return schoolDay.sequence.filter((entry) => entry.kind === "slot");
}

export interface Lesson {
  weekday: Weekday;
  /** The Slot's position among the School day's Slots, counting from 1. */
  slot: number;
  subject: string;
}

export interface Timetable {
  schemaVersion: string;
  provenance: Provenance;
  lessons: Lesson[];
}

export interface NonSchoolDayRange {
  label: string;
  start: string;
  end: string;
}

export interface NonSchoolDays {
  schemaVersion: string;
  provenance: Provenance;
  ranges: NonSchoolDayRange[];
}

export interface Term {
  schemaVersion: string;
  provenance: Provenance;
  start: string;
  end: string;
}

/** A whole Intake, once every document has been read and validated. */
export interface Intake {
  schoolDay: SchoolDay;
  timetable: Timetable;
  nonSchoolDays: NonSchoolDays;
  term: Term;
}

/**
 * One Intake document: where it lives in the data repository, which definition
 * in the schema governs it, and what to call it in a message. The four are kept
 * apart because they change on completely different cadences — re-parsing one
 * should not churn the others.
 */
export interface IntakeDocument {
  /** Its name here and its `$defs` entry in the schema, which are the same. */
  key: keyof Intake;
  /** Relative to the data repository, and always this path. */
  file: string;
  /** How an operator hears it named. */
  title: string;
}

export const INTAKE_DOCUMENTS: readonly IntakeDocument[] = [
  { key: "schoolDay", file: "intake/school-day.json", title: "the School day" },
  { key: "timetable", file: "intake/timetable.json", title: "the Timetable" },
  { key: "nonSchoolDays", file: "intake/non-school-days.json", title: "the Non-school days" },
  { key: "term", file: "intake/term.json", title: "the Term" },
];
