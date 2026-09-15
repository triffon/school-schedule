#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { dataRepositoryIn, run } from "./command.js";
import { EXIT_FAILURE } from "./exit-codes.js";
import { storedAuthorisation } from "./google/authorisation.js";
import { googleCalendarClient } from "./google/calendar.js";
import { googleSheetsClient } from "./google/sheets.js";
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

const argv = process.argv.slice(2);

/**
 * The real Google clients are built here, at the edge, and injected like
 * everything else that leaves the process — so that nothing below the command
 * layer learns a token exists, and every test goes on driving subcommands with
 * fakes.
 *
 * They read that token from the data repository, which is the positional the
 * command layer is about to parse. Where there is none the run is a usage
 * mistake, reported before any client is reached, so the fallback here is never
 * read from.
 */
const authorisation = storedAuthorisation(resolve(dataRepositoryIn(argv) ?? "."), {
  clock: systemClock,
});

try {
  process.exitCode = await run(argv, {
    calendar: googleCalendarClient(authorisation),
    sheets: googleSheetsClient(authorisation),
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
