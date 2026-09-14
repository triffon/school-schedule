import type { CalendarClient } from "./ports/calendar.js";
import type { Clock } from "./ports/clock.js";
import type { SheetsClient } from "./ports/sheets.js";

/**
 * Everything a subcommand reaches the outside world through. Injected at the
 * command layer — the single seam the spec commits to — so a test can drive a
 * subcommand the way an operator does and assert on what left the process.
 */
export interface Dependencies {
  calendar: CalendarClient;
  sheets: SheetsClient;
  clock: Clock;
  io: Io;
}

/** Where a run's output goes. One call per line; the line has no newline. */
export interface Io {
  out(line: string): void;
  err(line: string): void;
}
