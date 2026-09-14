import { EXIT_FAILURE } from "../exit-codes.js";
import { notImplemented } from "./not-implemented.js";
import type { CommandContext } from "./context.js";

/**
 * Validates the Intake, summarises what is about to change, and — once
 * confirmed — publishes the Timetable to both Destinations.
 */
export async function apply(context: CommandContext): Promise<number> {
  notImplemented("apply", context);
  return EXIT_FAILURE;
}
