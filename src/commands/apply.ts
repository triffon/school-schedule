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

  // The plan is worked out from a read of the spreadsheet, so the summary
  // describes this spreadsheet rather than what the pipeline hopes to find.
  let plan: SheetPlan;
  try {
    plan = await planSheet(context.deps.sheets, config.config, validation.intake);
  } catch (cause) {
    return stopped(context, cause);
  }

  for (const line of summarise(plan, config.config, validation.intake)) io.out(line);

  if (!context.args.some((argument) => SKIP_CONFIRMATION.includes(argument))) {
    if (!(await context.deps.confirm(`Publish to ${plan.tab}? [y/N]`))) {
      io.err("Nothing has been published.");
      io.err(`Run apply with ${SKIP_CONFIRMATION[0]} where there is nobody to answer.`);
      return EXIT_FAILURE;
    }
  }

  try {
    await publishSheet(context.deps.sheets, plan);
  } catch (cause) {
    return stopped(context, cause);
  }

  io.out(`Published ${plan.tab}.`);
  return EXIT_OK;
}

/**
 * Reports a Destination that would not have the run — unauthorised, refused, or
 * simply unreachable — in the same words a bad Config is reported in, because
 * it leaves the operator in the same place: nothing published, one thing to put
 * right, and a re-run.
 *
 * The layout goes out as a single batch, which Sheets applies whole or not at
 * all, so a failure here really does mean nothing was published.
 */
function stopped(context: CommandContext, cause: unknown): number {
  const { io } = context.deps;

  io.err(`school-schedule apply: ${(cause as Error).message}`);
  io.err("");
  io.err("Nothing has been published.");
  return EXIT_FAILURE;
}

/**
 * What the run is about to do, in enough detail for an operator to notice they
 * have pointed it at the wrong spreadsheet, the wrong Class or the wrong Term.
 */
function summarise(plan: SheetPlan, config: Config, intake: Intake): string[] {
  const slots = slotsOf(intake.schoolDay).length;
  const { weekdays } = config.display;

  return [
    `apply is about to publish ${config.display.class} — ${config.display.term} to Google Sheets:`,
    "",
    `  spreadsheet  ${plan.spreadsheetId}`,
    `  tab          ${plan.tab} (${plan.creating ? "not there yet, will be created" : "already there, will be rewritten whole"})`,
    `  grid         ${countOf(slots, "Slot")} × ${countOf(weekdays.length, "weekday")}, ` +
      `${countOf(intake.timetable.lessons.length, "Lesson")}`,
    "",
    "No other tab in the spreadsheet is touched.",
    "",
  ];
}
