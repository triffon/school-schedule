import type { Dependencies } from "../dependencies.js";

/** Everything a subcommand is handed once the command layer has parsed argv. */
export interface CommandContext {
  /** The resolved path to the data repository holding Config and Intake. */
  dataRepository: string;
  /** Whatever followed the data repository on the command line. */
  args: string[];
  /**
   * The instant the run began, read once from the injected clock, so that every
   * part of one run agrees on what "now" is.
   */
  startedAt: Date;
  deps: Dependencies;
}

export type Command = (context: CommandContext) => Promise<number>;
