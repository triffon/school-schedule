import { nonSchoolDates } from "../calendar/dates.js";
import { planCalendar, publishCalendar, type CalendarPlan } from "../calendar/publish.js";
import { readConfig, type Config } from "../config.js";
import { slotsOf, type Intake } from "../intake/documents.js";
import { countOf, describeProblems } from "../intake/problems.js";
import { validateIntake } from "../intake/validate.js";
import { planSheet, publishSheet, type SheetPlan } from "../sheet/publish.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import type { CommandContext } from "./context.js";

/** How an operator who has come to trust the pipeline runs it unattended. */
const SKIP_CONFIRMATION = ["--yes", "-y"];

/**
 * Validates the Intake, summarises what is about to change, and — once
 * confirmed — publishes the Timetable to the Destinations.
 *
 * Validation is implicit rather than something to remember to run first, and it
 * is total: a run that cannot publish everything publishes nothing.
 */
export async function apply(context: CommandContext): Promise<number> {
  const { io } = context.deps;

  const unknown = context.args.filter((argument) => !SKIP_CONFIRMATION.includes(argument));
  if (unknown.length > 0) {
    io.err(`school-schedule apply: unexpected ${unknown.map((each) => `"${each}"`).join(", ")}`);
    io.err(`apply takes the data repository and, optionally, ${SKIP_CONFIRMATION.join(" or ")}.`);
    return EXIT_USAGE;
  }

  const config = await readConfig(context.dataRepository);
  const validation = await validateIntake(context.dataRepository);

  // Both halves of a run are reported together: an operator setting a school up
  // for the first time has both to fill in, and finding that out one run at a
  // time is two rounds of work for no reason.
  if (!config.ok || !validation.ok) {
    io.err(`school-schedule apply: ${context.dataRepository} is not ready to publish`);
    io.err("");
    const problems = [
      ...(config.ok ? [] : config.problems),
      ...(validation.ok ? [] : validation.problems),
    ];
    for (const line of describeProblems(problems)) io.err(line);
    io.err("");
    io.err("Nothing has been published; correct what is named above and run apply again.");
    return EXIT_FAILURE;
  }

  // The sheet's half of the plan is worked out from a read of the spreadsheet,
  // so the summary describes this spreadsheet rather than what the pipeline
  // hopes to find. The calendar's half is a function of the Intake alone.
  let sheet: SheetPlan;
  try {
    sheet = await planSheet(context.deps.sheets, config.config, validation.intake);
  } catch (cause) {
    return stopped(context, cause);
  }
  const calendar = planCalendar(config.config, validation.intake);

  for (const line of summarise(sheet, calendar, config.config, validation.intake)) io.out(line);

  // One question for both Destinations: a run publishes the week whole, and
  // agreeing to half of it is not something an operator can usefully do.
  if (!context.args.some((argument) => SKIP_CONFIRMATION.includes(argument))) {
    if (!(await context.deps.confirm(`Publish to ${sheet.tab} and ${calendar.calendarId}? [y/N]`))) {
      io.err("Nothing has been published.");
      io.err(`Run apply with ${SKIP_CONFIRMATION[0]} where there is nobody to answer.`);
      return EXIT_FAILURE;
    }
  }

  try {
    await publishSheet(context.deps.sheets, sheet);
  } catch (cause) {
    return stopped(context, cause);
  }
  io.out(`Published ${sheet.tab}.`);

  try {
    await publishCalendar(context.deps.calendar, calendar);
  } catch (cause) {
    return stopped(context, cause, [
      `${sheet.tab} was published; the calendar was not finished.`,
      "Run apply again once what is named above is put right.",
    ]);
  }
  io.out(`Published ${countOf(calendar.events.length, "event")} to ${calendar.calendarId}.`);

  return EXIT_OK;
}

/**
 * Reports a Destination that would not have the run — unauthorised, refused, or
 * simply unreachable — in the same words a bad Config is reported in, because
 * it leaves the operator in the same place: one thing to put right and a re-run.
 *
 * `standing` says what is true of the Destinations now. The sheet's layout goes
 * out as a single batch, which Sheets applies whole or not at all, so until it
 * has gone nothing has been published; the calendar is written an event at a
 * time and can be left part-written, which the caller says rather than let this
 * claim otherwise.
 */
function stopped(context: CommandContext, cause: unknown, standing?: string[]): number {
  const { io } = context.deps;

  io.err(`school-schedule apply: ${(cause as Error).message}`);
  io.err("");
  for (const line of standing ?? ["Nothing has been published."]) io.err(line);
  return EXIT_FAILURE;
}

/**
 * What the run is about to do, in enough detail for an operator to notice they
 * have pointed it at the wrong spreadsheet, the wrong Class or the wrong Term.
 */
function summarise(
  sheet: SheetPlan,
  calendar: CalendarPlan,
  config: Config,
  intake: Intake,
): string[] {
  const slots = slotsOf(intake.schoolDay).length;
  const { weekdays } = config.display;
  const { term } = intake;

  return [
    `apply is about to publish ${config.display.class} — ${config.display.term}:`,
    "",
    "  Google Sheets",
    `    spreadsheet  ${sheet.spreadsheetId}`,
    `    tab          ${sheet.tab} (${sheet.creating ? "not there yet, will be created" : "already there, will be rewritten whole"})`,
    `    grid         ${countOf(slots, "Slot")} × ${countOf(weekdays.length, "weekday")}, ` +
      `${countOf(intake.timetable.lessons.length, "Lesson")}`,
    "",
    "  Google Calendar",
    `    calendar     ${calendar.calendarId}`,
    `    events       ${countOf(calendar.events.length, "recurring event")}, one per Block`,
    `    term         ${term.start} to ${term.end}, skipping ` +
      `${countOf(nonSchoolDates(intake.nonSchoolDays).length, "Non-school day")}`,
    "",
    "No other tab in the spreadsheet is touched, and no other calendar is written to.",
    "",
  ];
}
