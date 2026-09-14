import { run } from "../../src/command.js";
import type { Clock } from "../../src/ports/clock.js";
import { fixedClock } from "./fixed-clock.js";
import { fakeCalendarClient, type FakeCalendarClient } from "./fake-calendar.js";
import { fakeSheetsClient, type FakeSheetsClient } from "./fake-sheets.js";

export interface CliRun {
  /** The process exit status the invocation asked for. */
  exitCode: number;
  stdout: string;
  stderr: string;
  calendar: FakeCalendarClient;
  sheets: FakeSheetsClient;
}

export interface RunCliOptions {
  calendar?: FakeCalendarClient;
  sheets?: FakeSheetsClient;
  clock?: Clock;
}

/**
 * Invokes a subcommand in-process the way an operator would from a shell, with
 * fake Google clients and a fixed clock injected. This is the single seam the
 * spec commits to: assert on the exit status, on what was written out, and on
 * the requests the fakes recorded — never on which internal function ran.
 */
export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<CliRun> {
  const calendar = options.calendar ?? fakeCalendarClient();
  const sheets = options.sheets ?? fakeSheetsClient();
  const clock = options.clock ?? fixedClock("2026-01-15T08:00:00.000Z");

  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await run(argv, {
    calendar,
    sheets,
    clock,
    io: {
      out: (line) => stdout.push(line),
      err: (line) => stderr.push(line),
    },
  });

  return {
    exitCode,
    stdout: stdout.map((line) => `${line}\n`).join(""),
    stderr: stderr.map((line) => `${line}\n`).join(""),
    calendar,
    sheets,
  };
}
