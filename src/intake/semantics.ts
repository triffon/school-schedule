import {
  INTAKE_DOCUMENTS,
  type Intake,
  type NonSchoolDays,
  type SchoolDay,
  type SchoolDayEntry,
  type Term,
  type Timetable,
} from "./documents.js";
import { show, type Problem } from "./problems.js";

/**
 * The second layer of validation: the invariants the rest of the pipeline
 * assumes, which an Intake can violate while satisfying the schema in every
 * particular. The ways an agent misreads an artifact mostly stay well-formed,
 * so this is where the misreadings worth catching are caught.
 *
 * Runs only once every document is structurally valid, so every value read here
 * is already known to be of the shape the contract describes.
 *
 * Problems come back in the order the documents are read, so that the report
 * groups by file the way a structural one does.
 */
export function semanticProblems(intake: Intake): Problem[] {
  const termFaults = termProblems(intake.term);

  return [
    ...sequenceProblems(intake.schoolDay),
    ...undeclaredSlots(intake.timetable, intake.schoolDay),
    // A Term that runs backwards puts every Non-school day outside it, and that
    // fallout would bury the one thing worth correcting.
    ...(termFaults.length > 0 ? [] : nonSchoolDayProblems(intake.nonSchoolDays, intake.term)),
    ...termFaults,
  ];
}

/**
 * The School day is one unbroken run of time: every entry ends exactly where
 * the next begins, and each ends after it begins. Time no entry accounts for,
 * and two entries claiming the same minutes, are both misreadings of the
 * artifact rather than days the pipeline could publish.
 */
function sequenceProblems(schoolDay: SchoolDay): Problem[] {
  const file = fileOf("schoolDay");
  const { sequence } = schoolDay;
  const problems: Problem[] = [];

  sequence.forEach((entry, index) => {
    // Times are HH:MM on a 24-hour clock by the time they get here, so comparing
    // them as strings compares them chronologically.
    if (entry.end <= entry.start) {
      problems.push({
        file,
        at: `sequence[${index}].end`,
        message:
          `expected ${nameOf(sequence, index)} to end after it begins at ${show(entry.start)}, ` +
          `found ${show(entry.end)}`,
      });
    }

    const previous = index === 0 ? undefined : sequence[index - 1];
    // An entry that ends before it begins has already been reported; measuring
    // the next entry against an end time like that would only report it twice.
    if (previous === undefined || previous.end <= previous.start) return;
    if (entry.start === previous.end) return;

    const overlapping = entry.start < previous.end;
    problems.push({
      file,
      at: `sequence[${index}].start`,
      message:
        `expected ${nameOf(sequence, index)} to begin at ${show(previous.end)}, where ` +
        `${nameOf(sequence, index - 1)} (sequence[${index - 1}]) ends, found ${show(entry.start)}, ` +
        `which ${overlapping ? "overlaps it" : "leaves the time between them unaccounted for"}. ` +
        `The School day's Slots and Breaks must be contiguous and must not overlap.`,
    });
  });

  return problems;
}

/**
 * A Lesson names its Slot by position, so the Timetable and the School day can
 * only be read together. A position past the last Slot means one of the two was
 * misread — a day with a sixth Slot the sequence never declares, or a sequence
 * that lost one — and either way the Lesson has no time to be published at.
 */
function undeclaredSlots(timetable: Timetable, schoolDay: SchoolDay): Problem[] {
  const file = fileOf("timetable");
  const declared = schoolDay.sequence.filter((entry) => entry.kind === "slot").length;

  return timetable.lessons.flatMap((lesson, index) =>
    lesson.slot <= declared
      ? []
      : [
          {
            file,
            at: `lessons[${index}]`,
            message:
              `expected a Slot the School day declares, found Slot ${lesson.slot} for ` +
              `${lesson.weekday}. The School day declares ${declared} ` +
              `${declared === 1 ? "Slot" : "Slots"}.`,
          },
        ],
  );
}

/**
 * A Non-school day is a date inside the Term on which no Lesson is taught, so a
 * range reaching outside the Term is either a misread date or a calendar for a
 * different Term altogether. Left alone it would exclude dates from a
 * recurrence that never reaches them.
 *
 * A range that ends before it begins covers no dates at all, which is the same
 * misreading seen from the other side.
 */
function nonSchoolDayProblems(nonSchoolDays: NonSchoolDays, term: Term): Problem[] {
  const file = fileOf("nonSchoolDays");

  // Dates are YYYY-MM-DD by the time they get here, so comparing them as
  // strings compares them chronologically.
  const outside = (date: string) => date < term.start || date > term.end;

  return nonSchoolDays.ranges.flatMap((range, index) => {
    const at = `ranges[${index}]`;

    if (range.end < range.start) {
      return [
        {
          file,
          at,
          message:
            `expected ${show(range.label)} to end on or after it begins on ${show(range.start)}, ` +
            `found ${show(range.end)}`,
        },
      ];
    }

    if (!outside(range.start) && !outside(range.end)) return [];

    return [
      {
        file,
        at,
        message:
          `expected ${show(range.label)} to fall inside the Term, ${show(term.start)} to ` +
          `${show(term.end)}, found ${show(range.start)} to ${show(range.end)}. Non-school days ` +
          `are dates inside the Term.`,
      },
    ];
  });
}

/**
 * The Term is the range the Timetable is in force over and the bound on every
 * recurrence the pipeline publishes. One that does not end after it begins is
 * in force over nothing at all.
 */
function termProblems(term: Term): Problem[] {
  if (term.start < term.end) return [];

  return [
    {
      file: fileOf("term"),
      at: "end",
      message: `expected the Term to end after it begins on ${show(term.start)}, found ${show(term.end)}`,
    },
  ];
}

/** Where a document lives, for a Problem that names it. */
function fileOf(key: keyof Intake): string {
  const document = INTAKE_DOCUMENTS.find((candidate) => candidate.key === key);
  if (document === undefined) throw new Error(`no Intake document named "${key}"`);
  return document.file;
}

/**
 * How an entry is named in a message: a Slot by its position among the Slots,
 * which is how the Timetable refers to it, and a Break by what it is, having no
 * identity of its own.
 */
function nameOf(sequence: SchoolDayEntry[], index: number): string {
  const entry = sequence[index];
  if (entry?.kind !== "slot") return "the Break";

  const position = sequence.slice(0, index + 1).filter((each) => each.kind === "slot").length;
  return `Slot ${position}`;
}
