import { INTAKE_DOCUMENTS } from "../intake/documents.js";
import { countOf, describeProblems } from "../intake/problems.js";
import { SCHEMA_VERSION } from "../intake/schema.js";
import { validateIntake } from "../intake/validate.js";
import { EXIT_FAILURE, EXIT_OK } from "../exit-codes.js";
import type { CommandContext } from "./context.js";

/**
 * Checks the Intake without touching a calendar or a spreadsheet, so that an
 * operator who has just pasted in agent output can find out whether the
 * pipeline will accept it.
 *
 * Failure is total: nothing partial is ever published, and the exit status
 * says so.
 */
export async function validate(context: CommandContext): Promise<number> {
  const { io } = context.deps;
  const result = await validateIntake(context.dataRepository);

  if (!result.ok) {
    io.err(`school-schedule validate: the Intake in ${context.dataRepository} is not valid`);
    io.err("");
    for (const line of describeProblems(result.problems)) io.err(line);
    io.err("");
    io.err(
      `${countOf(result.problems.length, "problem")}. Nothing has been published; correct the Intake and run validate again.`,
    );
    return EXIT_FAILURE;
  }

  io.out(
    `The Intake in ${context.dataRepository} is valid: ` +
      `${countOf(INTAKE_DOCUMENTS.length, "document")} against schema version ${SCHEMA_VERSION}.`,
  );
  return EXIT_OK;
}
