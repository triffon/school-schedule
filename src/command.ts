import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { apply } from "./commands/apply.js";
import type { Command, CommandContext } from "./commands/context.js";
import { init } from "./commands/init.js";
import { prompt } from "./commands/prompt.js";
import { validate } from "./commands/validate.js";
import type { Dependencies } from "./dependencies.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./exit-codes.js";

const COMMANDS = {
  init,
  prompt,
  validate,
  apply,
} satisfies Record<string, Command>;

export type CommandName = keyof typeof COMMANDS;

export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

function isCommandName(candidate: string): candidate is CommandName {
  return Object.hasOwn(COMMANDS, candidate);
}

const HELP_FLAGS = ["--help", "-h"];

function asksForHelp(argv: string[]): boolean {
  return argv.some((argument) => HELP_FLAGS.includes(argument));
}

export const USAGE = [
  "Usage: school-schedule <command> <data-repository> [options]",
  "",
  "Publishes a school's weekly Timetable to Google Calendar and Google Sheets.",
  "",
  "Commands:",
  "  init       Authorise against Google and choose the calendar to publish to",
  "  prompt     Emit a self-contained prompt for parsing a Source into an Intake",
  "  validate   Check the Intake without touching a calendar or a spreadsheet",
  "  apply      Publish the Timetable to the configured Destinations",
  "",
  "Arguments:",
  "  <data-repository>  Path to the repository holding this school's Config and Intake",
  "",
  "apply validates the Intake first, prints what it is about to change, and publishes only once",
  "you have agreed to it. Pass --yes where there is nobody to answer, such as an unattended run.",
  "",
  "prompt takes one more argument, the Parsing Skill for the artifact being parsed, named",
  "<publisher>/<artifact>. Anything after it reaches the agent as a note from the operator,",
  "which is how a Skill is told what only the operator knows — which of the school year's two",
  "Terms is being published, or which Class the Timetable is for.",
  "",
  "Options:",
  "  -y, --yes   Publish without stopping to confirm (apply only)",
  "  -h, --help  Show this help",
].join("\n");

/**
 * The command layer, and the pipeline's single testing seam. Everything the run
 * touches outside itself arrives in `deps`, so a test drives a subcommand the
 * way an operator does and asserts on what left the process: the exit status,
 * what was written out, and the requests the injected clients recorded.
 */
export async function run(argv: string[], deps: Dependencies): Promise<number> {
  const [name, ...rest] = argv;

  if (name !== undefined && HELP_FLAGS.includes(name)) {
    deps.io.out(USAGE);
    return EXIT_OK;
  }

  if (name === undefined) {
    deps.io.err(USAGE);
    return EXIT_USAGE;
  }

  if (!isCommandName(name)) {
    deps.io.err(`school-schedule: unknown command "${name}"`);
    deps.io.err(`Expected one of: ${COMMAND_NAMES.join(", ")}. Run --help for usage.`);
    return EXIT_USAGE;
  }

  // Help is asked for the way the usage advertises it — after the positional —
  // at least as often as before it.
  if (asksForHelp(rest)) {
    deps.io.out(USAGE);
    return EXIT_OK;
  }

  const [dataRepository, ...args] = rest;

  if (dataRepository === undefined) {
    deps.io.err(`school-schedule ${name}: no <data-repository> given`);
    deps.io.err(
      "Pass the path to the repository holding this school's Config and Intake. Run --help for usage.",
    );
    return EXIT_USAGE;
  }

  const root = resolve(dataRepository);
  const problem = await whyNotADataRepository(root);
  if (problem !== undefined) {
    deps.io.err(`school-schedule ${name}: ${problem}`);
    return EXIT_FAILURE;
  }

  const startedAt = deps.clock.now();
  deps.io.err(`school-schedule ${name} ${root} — run at ${startedAt.toISOString()}`);

  const context: CommandContext = { dataRepository: root, args, startedAt, deps };
  return COMMANDS[name](context);
}

/**
 * Says what is wrong with the path an operator pointed the pipeline at, or
 * `undefined` when it is a directory the pipeline can read.
 */
async function whyNotADataRepository(root: string): Promise<string | undefined> {
  try {
    const entry = await stat(root);
    if (!entry.isDirectory()) {
      return `${root} is not a directory; the data repository is a directory holding this school's Config and Intake`;
    }
    return undefined;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return `the data repository ${root} does not exist`;
    }
    return `the data repository ${root} could not be read: ${(cause as Error).message}`;
  }
}
