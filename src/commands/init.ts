import { EXIT_FAILURE } from "../exit-codes.js";
import { notImplemented } from "./not-implemented.js";
import type { CommandContext } from "./context.js";

/**
 * Authorises against Google, lets the operator pick or create a calendar, and
 * writes its identifier into Config.
 */
export async function init(context: CommandContext): Promise<number> {
  notImplemented("init", context);
  return EXIT_FAILURE;
}
