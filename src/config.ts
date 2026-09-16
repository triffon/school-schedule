import { WEEKDAYS, type Weekday } from "./intake/documents.js";
import { show, type Problem } from "./intake/problems.js";
import { readJsonFile, type JsonFile } from "./json-file.js";

/**
 * A school's settings, read from `config.json` in its data repository: which
 * calendar and spreadsheet to publish to, the timezone Slot times are
 * interpreted in, and the display choices publishing renders with.
 *
 * Config is the school's half of a run — everything the pipeline cannot derive
 * from the Intake — so a fault here is reported the same way an Intake fault is,
 * and for the same reason: the operator has to correct a file, not the code.
 *
 * It is read here rather than held to a JSON Schema the way the Intake is: the
 * Intake has a schema because the `prompt` command embeds it for an agent to
 * write against, and Config has no such second reader.
 */
export interface Config {
  timezone: string;
  calendarId: string;
  spreadsheetId: string;
  display: Display;
}

/** What publishing renders with, rather than what it publishes. */
export interface Display {
  /** The Class this Timetable belongs to, as it should read — `5В`. */
  class: string;
  /** The Term label, as it should read — `Учебна 2025/26 година, I срок`. */
  term: string;
  /**
   * The weekdays that get a column, in the order they are rendered, each with
   * the header it is rendered under. Listed rather than derived from a locale,
   * so that the capitalisation and the start of the week are the school's.
   */
  weekdays: WeekdayColumn[];
  /** The name of the tab the pipeline owns, over `{class}` and `{term}`. */
  tab: string;
  /**
   * The heading the sheet is printed under, and the line beneath it, over the
   * same `{class}` and `{term}`.
   *
   * They are templates rather than the Class and the Term themselves, because a
   * sheet meant to be handed to a child is titled the way a person would say it
   * — "Седмична програма на Анди" — while the Class stays the short name the
   * Calendar puts in every event title.
   */
  title: string;
  subtitle: string;
  /** How wide a weekday column is rendered, in pixels. */
  weekdayColumnWidth: number;
}

export interface WeekdayColumn {
  weekday: Weekday;
  header: string;
}

export const CONFIG_FILE = "config.json";

const CONFIG_DOCUMENT: JsonFile = {
  file: CONFIG_FILE,
  noun: "the Config",
  missing:
    "expected this school's Config, but the file is not there. It names the " +
    "spreadsheet and calendar to publish to and the strings to publish with.",
};

/**
 * Defaults for the settings a school has no opinion about. Each is a choice the
 * pipeline can make on the school's behalf without being wrong for it; anything
 * a school must say for itself — which spreadsheet, which Class — has none.
 */
const DEFAULT_TIMEZONE = "Europe/Sofia";
const DEFAULT_TAB = "{class} - {term}";
const DEFAULT_TITLE = "{class}";
const DEFAULT_SUBTITLE = "{term}";
const DEFAULT_WEEKDAY_COLUMN_WIDTH = 176;

export type ConfigReading = { ok: true; config: Config } | { ok: false; problems: Problem[] };

/**
 * Reads a data repository's Config. Every fault is collected rather than the
 * first thrown, so that an operator filling Config in for the first time sees
 * everything still missing from it in one pass.
 */
export async function readConfig(dataRepository: string): Promise<ConfigReading> {
  const read = await readJsonFile(dataRepository, CONFIG_DOCUMENT);
  if (!read.ok) return read;

  const problems: Problem[] = [];
  const root = objectAt(read.content, "", problems, "the Config as an object");
  const display = objectAt(
    root?.["display"],
    "display",
    problems,
    "the display choices as an object",
  );

  const config: Config = {
    timezone: stringOr(root?.["timezone"], "timezone", DEFAULT_TIMEZONE, problems),
    // `init` writes this one, and the rules about which calendars may be
    // published to are the Calendar Destination's, not this reader's.
    calendarId: stringOr(root?.["calendarId"], "calendarId", "", problems),
    spreadsheetId: required(root?.["spreadsheetId"], "spreadsheetId", problems),
    display: {
      class: required(display?.["class"], "display.class", problems),
      term: required(display?.["term"], "display.term", problems),
      weekdays: weekdayColumns(display?.["weekdays"], problems),
      tab: stringOr(display?.["tab"], "display.tab", DEFAULT_TAB, problems),
      title: stringOr(display?.["title"], "display.title", DEFAULT_TITLE, problems),
      subtitle: stringOr(display?.["subtitle"], "display.subtitle", DEFAULT_SUBTITLE, problems),
      weekdayColumnWidth: numberOr(
        display?.["weekdayColumnWidth"],
        "display.weekdayColumnWidth",
        DEFAULT_WEEKDAY_COLUMN_WIDTH,
        problems,
      ),
    },
  };

  unexpected(root, "", ["timezone", "calendarId", "spreadsheetId", "display"], problems);
  unexpected(
    display,
    "display",
    ["class", "term", "weekdays", "tab", "title", "subtitle", "weekdayColumnWidth"],
    problems,
  );

  return problems.length > 0 ? { ok: false, problems } : { ok: true, config };
}

/**
 * One of Config's display templates, with the Class and the Term filled into
 * it. The same two placeholders in every template, so that an operator who has
 * learned one has learned all of them.
 */
export function fillIn(template: string, display: Display): string {
  return template.replaceAll("{class}", display.class).replaceAll("{term}", display.term);
}

/** The tab the pipeline owns, with the Class and the Term filled into it. */
export function tabName(display: Display): string {
  return fillIn(display.tab, display);
}

function problem(at: string, message: string): Problem {
  return at === "" ? { file: CONFIG_FILE, message } : { file: CONFIG_FILE, at, message };
}

function objectAt(
  value: unknown,
  at: string,
  problems: Problem[],
  title: string,
): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  problems.push(problem(at, `expected ${title}, found ${show(value)}`));
  return undefined;
}

/** A setting the school must make itself: there is no sensible stand-in. */
function required(value: unknown, at: string, problems: Problem[]): string {
  if (typeof value === "string" && value !== "") return value;
  problems.push(problem(at, `expected a non-empty string, found ${show(value)}`));
  return "";
}

function stringOr(value: unknown, at: string, fallback: string, problems: Problem[]): string {
  if (value === undefined) return fallback;
  if (typeof value === "string") return value;
  problems.push(problem(at, `expected a string, found ${show(value)}`));
  return fallback;
}

function numberOr(value: unknown, at: string, fallback: number, problems: Problem[]): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  problems.push(problem(at, `expected a positive number of pixels, found ${show(value)}`));
  return fallback;
}

/** What one entry of `display.weekdays` is, said the way it is read back. */
const WEEKDAY_COLUMN =
  'a weekday column — {"weekday": the weekday as the Intake names it, ' +
  '"header": the string to render it under}';

/**
 * The weekday columns. A weekday the Intake could never name is a misspelling
 * rather than a day off, and a weekday named twice would render one column of
 * Lessons under two headers, so both are faults.
 */
function weekdayColumns(value: unknown, problems: Problem[]): WeekdayColumn[] {
  const at = "display.weekdays";

  if (!Array.isArray(value) || value.length === 0) {
    problems.push(
      problem(
        at,
        `expected at least one weekday to render a column for, found ${show(value)}. ` +
          `Each is ${WEEKDAY_COLUMN}, and they are listed in the order the columns read.`,
      ),
    );
    return [];
  }

  const columns: WeekdayColumn[] = [];
  const seen = new Set<Weekday>();

  value.forEach((entry, index) => {
    const each = objectAt(entry, `${at}[${index}]`, problems, WEEKDAY_COLUMN);
    if (each === undefined) return;

    const header = required(each["header"], `${at}[${index}].header`, problems);
    const weekday = each["weekday"];

    if (!isWeekday(weekday)) {
      problems.push(
        problem(
          `${at}[${index}].weekday`,
          `expected one of ${WEEKDAYS.map((day) => show(day)).join(", ")}, which is how the ` +
            `Intake names its weekdays, found ${show(weekday)}`,
        ),
      );
      return;
    }

    if (seen.has(weekday)) {
      problems.push(
        problem(`${at}[${index}].weekday`, `expected a weekday not already given a column, found ${show(weekday)}`),
      );
      return;
    }

    seen.add(weekday);
    columns.push({ weekday, header });
  });

  return columns;
}

function isWeekday(value: unknown): value is Weekday {
  return WEEKDAYS.includes(value as Weekday);
}

/**
 * A key the Config has no room for. Reported rather than ignored: a misspelled
 * setting is indistinguishable from an unset one otherwise, and it would take
 * the default silently.
 */
function unexpected(
  value: Record<string, unknown> | undefined,
  at: string,
  known: string[],
  problems: Problem[],
): void {
  if (value === undefined) return;
  for (const key of Object.keys(value)) {
    if (known.includes(key)) continue;
    problems.push(
      problem(
        at === "" ? key : `${at}.${key}`,
        `expected one of ${known.join(", ")}, found ${show(key)}. A setting the Config has no ` +
          `field for is a misspelling, and would otherwise be ignored in silence.`,
      ),
    );
  }
}
