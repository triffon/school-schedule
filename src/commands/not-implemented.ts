import type { CommandName } from "../command.js";
import type { CommandContext } from "./context.js";

/**
 * The skeleton's placeholder: the subcommand is recognised and dispatched, and
 * says plainly that it does nothing yet. Each subcommand loses this call as its
 * own ticket lands, and this module goes with the last of them.
 */
export function notImplemented(name: CommandName, context: CommandContext): void {
  context.deps.io.err(`school-schedule: ${name} is not implemented yet`);
}
