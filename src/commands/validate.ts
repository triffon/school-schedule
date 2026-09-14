import { EXIT_FAILURE } from "../exit-codes.js";
import { notImplemented } from "./not-implemented.js";
import type { CommandContext } from "./context.js";

/**
 * Checks the Intake structurally and semantically, without touching a calendar
 * or a spreadsheet.
 */
export async function validate(context: CommandContext): Promise<number> {
  notImplemented("validate", context);
  return EXIT_FAILURE;
}
