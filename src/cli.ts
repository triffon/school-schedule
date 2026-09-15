#!/usr/bin/env node
import { run } from "./command.js";
import { EXIT_FAILURE } from "./exit-codes.js";
import { unavailableCalendarClient, unavailableSheetsClient } from "./ports/unavailable.js";
import { systemClock } from "./ports/clock.js";
import { SHARED_SKILL_LIBRARY } from "./prompt/library.js";

const err = (line: string) => process.stderr.write(`${line}\n`);

try {
  process.exitCode = await run(process.argv.slice(2), {
    calendar: unavailableCalendarClient(),
    sheets: unavailableSheetsClient(),
    clock: systemClock,
    skillLibrary: SHARED_SKILL_LIBRARY,
    io: {
      out: (line) => process.stdout.write(`${line}\n`),
      err,
    },
  });
} catch (cause) {
  // Anything that escaped the command layer is still the operator's problem, so
  // give them the message rather than a stack trace.
  err(cause instanceof Error ? cause.message : `school-schedule: ${String(cause)}`);
  process.exitCode = EXIT_FAILURE;
}
