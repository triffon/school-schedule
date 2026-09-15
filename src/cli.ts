#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { run } from "./command.js";
import { EXIT_FAILURE } from "./exit-codes.js";
import { unavailableCalendarClient, unavailableSheetsClient } from "./ports/unavailable.js";
import { systemClock } from "./ports/clock.js";
import { SHARED_SKILL_LIBRARY } from "./prompt/library.js";

const err = (line: string) => process.stderr.write(`${line}\n`);

/**
 * Puts the question to whoever is at the terminal. The question and the answer
 * go over stderr with everything else said to the operator, so that a run can
 * still be redirected and the redirected file be nothing but its output.
 *
 * An unattended run has nobody to answer, and that is a no: the flag that skips
 * the question is how a pipeline says it has been trusted.
 */
async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    err(`${question} — but this is not a terminal, so there is nobody to ask.`);
    return false;
  }

  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await terminal.question(`${question} `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
}

try {
  process.exitCode = await run(process.argv.slice(2), {
    calendar: unavailableCalendarClient(),
    sheets: unavailableSheetsClient(),
    clock: systemClock,
    confirm: ask,
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
