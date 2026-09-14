import { EXIT_FAILURE } from "../exit-codes.js";
import { notImplemented } from "./not-implemented.js";
import type { CommandContext } from "./context.js";

/**
 * Emits a self-contained prompt for turning one Source into part of an Intake,
 * embedding the Intake JSON Schema and the resolved Parsing Skill.
 */
export async function prompt(context: CommandContext): Promise<number> {
  notImplemented("prompt", context);
  return EXIT_FAILURE;
}
