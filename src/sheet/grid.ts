import { blocksOn, type Block } from "../blocks.js";
import type { Config } from "../config.js";
import { slotsOf, type Intake, type Slot, type Weekday } from "../intake/documents.js";

/**
 * The weekly grid as a person reads it: times down the left, weekdays across
 * the top, one row per Slot. Nothing here knows about Sheets — this says what
 * the timetable looks like, and `requests.ts` says how Google is told.
 *
 * The whole layout is generated rather than filled into a tab a human keeps
 * formatted (ADR-0007), because the rows are a direct function of the School
 * day: a Term with a different number of Slots shifts every row beneath it.
 */
export interface Grid {
  /** Cells row-major; every row has one cell per column. */
  cells: Cell[][];
  /** Rectangles to merge, in the order they read. */
  merges: Rectangle[];
  /** How wide each column is rendered, in pixels. */
  columnWidths: number[];
}

export interface Cell {
  text: string;
  role: CellRole;
}

/** What a cell is, which is what decides how it is rendered. */
export type CellRole = "class" | "term" | "header" | "time" | "subject";

/** A rectangle of the grid, in row and column positions counting from 0. */
export interface Rectangle {
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}

/** What stands between a Slot's start and its end in the time columns. */
const TIME_SEPARATOR = "–";

/**
 * The time columns are as wide as the times they hold and no wider: the space
 * belongs to the subjects. Their widths are the pipeline's, not the school's —
 * unlike a weekday column, nothing a school does makes `08:00` wider.
 */
const TIME_COLUMN_WIDTH = 64;
const SEPARATOR_COLUMN_WIDTH = 24;

/** The three time columns, then one column per weekday Config lists. */
const TIME_COLUMNS = 3;

/** The Class, the Term, then the weekday headers, above the first Slot's row. */
const HEADING_ROWS = 3;

export function gridOf(config: Config, intake: Intake): Grid {
  const { weekdays } = config.display;
  const slots = slotsOf(intake.schoolDay);
  const columns = weekdays.map((column) => columnOf(intake, column.weekday, slots.length));
  const width = TIME_COLUMNS + weekdays.length;

  return {
    cells: [
      titleRow(config.display.class, "class", width),
      titleRow(config.display.term, "term", width),
      headerRow(weekdays.map((column) => column.header)),
      ...slots.map((slot, index) => slotRow(slot, columns.map((column) => column.text[index] ?? ""))),
    ],
    merges: [
      ...fullWidthRows(HEADING_ROWS - 1, width),
      ...columns.flatMap((column, index) => column.merges.map(rectangle(TIME_COLUMNS + index))),
    ],
    columnWidths: [
      TIME_COLUMN_WIDTH,
      SEPARATOR_COLUMN_WIDTH,
      TIME_COLUMN_WIDTH,
      ...weekdays.map(() => config.display.weekdayColumnWidth),
    ],
  };
}

/**
 * One weekday's column: what each Slot shows, and which stretches of it are one
 * cell. A Block of two or more Slots is one vertically merged cell, so that it
 * reads as one lesson at a glance, and the subject is written in the cell the
 * merge keeps, which is its first. The Slots no Block covers are empty, and a
 * run of them merges the same way (ADR-0008), so a day that stops early reads
 * as one gap rather than as a column of blank cells.
 */
interface WeekdayColumn {
  /** What each Slot shows, by position, blank under a merge and where nothing is taught. */
  text: string[];
  /** The stretches of two or more Slots that are one cell, by Slot position. */
  merges: { firstSlot: number; lastSlot: number }[];
}

function columnOf(intake: Intake, weekday: Weekday, slots: number): WeekdayColumn {
  const blocks = blocksOn(intake.timetable, weekday);
  const text = Array.from({ length: slots }, () => "");
  for (const block of blocks) text[block.firstSlot - 1] = block.subject;

  const merges = [...blocks, ...gapsBetween(blocks, slots)]
    .filter(spansSeveralSlots)
    .sort((one, other) => one.firstSlot - other.firstSlot);

  return { text, merges };
}

/** The stretches of Slots no Block covers, each of them one empty cell. */
function gapsBetween(blocks: Block[], slots: number): { firstSlot: number; lastSlot: number }[] {
  const gaps = [];
  let slot = 1;

  for (const block of blocks) {
    if (block.firstSlot > slot) gaps.push({ firstSlot: slot, lastSlot: block.firstSlot - 1 });
    slot = block.lastSlot + 1;
  }
  if (slot <= slots) gaps.push({ firstSlot: slot, lastSlot: slots });

  return gaps;
}

function spansSeveralSlots(span: { firstSlot: number; lastSlot: number }): boolean {
  return span.lastSlot > span.firstSlot;
}

/** Where a column's stretch of Slots sits in the grid. */
function rectangle(column: number) {
  return (span: { firstSlot: number; lastSlot: number }): Rectangle => ({
    firstRow: HEADING_ROWS + span.firstSlot - 1,
    lastRow: HEADING_ROWS + span.lastSlot - 1,
    firstColumn: column,
    lastColumn: column,
  });
}

/** A title row: the text in the first cell, the rest blank under the merge. */
function titleRow(text: string, role: CellRole, width: number): Cell[] {
  return Array.from({ length: width }, (_, column) => ({
    text: column === 0 ? text : "",
    role,
  }));
}

function headerRow(headers: string[]): Cell[] {
  return [
    ...blanks("header", TIME_COLUMNS),
    ...headers.map((text) => ({ text, role: "header" as const })),
  ];
}

/**
 * A Slot's row: when it starts, a separator, when it ends, and then what each
 * weekday shows in it. Every Slot gets a row even when no weekday has a Lesson
 * in it, so the sheet says how far the school day extends.
 */
function slotRow(slot: Slot, weekdays: string[]): Cell[] {
  return [
    { text: slot.start, role: "time" },
    { text: TIME_SEPARATOR, role: "time" },
    { text: slot.end, role: "time" },
    ...weekdays.map((text) => ({ text, role: "subject" as const })),
  ];
}

function blanks(role: CellRole, howMany: number): Cell[] {
  return Array.from({ length: howMany }, () => ({ text: "", role }));
}

function fullWidthRows(through: number, width: number): Rectangle[] {
  return Array.from({ length: through }, (_, row) => ({
    firstRow: row,
    lastRow: row,
    firstColumn: 0,
    lastColumn: width - 1,
  }));
}
