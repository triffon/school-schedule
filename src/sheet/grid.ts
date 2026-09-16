import { blocksOn, type Block } from "../blocks.js";
import { fillIn, type Config } from "../config.js";
import type { Intake, SchoolDay, Slot, Weekday } from "../intake/documents.js";

/**
 * The weekly grid as a person reads it: times down the left, weekdays across
 * the top, one row per Slot and one per labelled Break. Nothing here knows
 * about Sheets — this says what the timetable looks like, down to which sides
 * of a cell are ruled, and `requests.ts` says how Google is told.
 *
 * The whole layout is generated rather than filled into a tab a human keeps
 * formatted (ADR-0007), because the rows are a direct function of the School
 * day: a Break that gains a label gains a row, and a Term with a different
 * number of Slots shifts every row beneath it.
 */
export interface Grid {
  /** Cells row-major; every row has one cell per column. */
  cells: Cell[][];
  /** Rectangles to merge, in the order they read. */
  merges: Rectangle[];
  /** How wide each column is rendered, in pixels. */
  columnWidths: number[];
  /** How tall each row is rendered. */
  rowHeights: RowHeight[];
}

/**
 * A row's height: a number of pixels, or `fit` for as tall as its own text
 * needs. The grid pins every row it has an opinion about, and leaves the
 * heading to `fit` — how tall a line of 14pt Arial stands is Google's business,
 * not something to hard-code a pixel count for and have drift.
 */
export type RowHeight = number | "fit";

export interface Cell {
  text: string;
  role: CellRole;
  /** Which of the cell's four sides are ruled. */
  edges: Edges;
}

/** What a cell is, which is what decides how it is rendered. */
export type CellRole = "class" | "term" | "spacer" | "header" | "time" | "subject" | "break";

/**
 * The sides of one cell that carry a line. Ruling is described per cell because
 * that is how a reader sees it — the three time columns are one box with no
 * lines inside it, and a Break row carries none of its own at all.
 */
export interface Edges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

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
const TIME_COLUMN_WIDTH = 43;
const SEPARATOR_COLUMN_WIDTH = 15;

/** The three time columns, then one column per weekday Config lists. */
const TIME_COLUMNS = 3;

/** The Class, the Term, a blank row, then the weekday headers. */
const HEADING_ROWS = 4;

/**
 * How tall each kind of row below the heading is rendered, in pixels. One line
 * of text is 21, so a Slot row is two lines tall: a subject long enough to wrap
 * fits without the row growing and shifting every row beneath it down the
 * printed page.
 */
const LINE_HEIGHT = 21;
const SLOT_ROW_HEIGHT = 2 * LINE_HEIGHT;

/** The heading is set off from the grid by a blank row rather than by padding. */
const SPACER_ROW_HEIGHT = 41;

export function gridOf(config: Config, intake: Intake): Grid {
  const { display } = config;
  const rows = bodyRows(intake.schoolDay);
  const columns = display.weekdays.map((column) => columnOf(intake, column.weekday, rows));
  const width = TIME_COLUMNS + display.weekdays.length;

  return {
    cells: [
      titleRow(fillIn(display.title, display), "class", width),
      titleRow(fillIn(display.subtitle, display), "term", width),
      blanks("spacer", width, unruled),
      headerRow(display.weekdays.map((column) => column.header)),
      ...rows.map((row, index) => bodyRow(row, index, rows.length, columns)),
    ],
    merges: [
      ...fullWidthRows(TITLE_ROWS, width),
      ...columns.flatMap((column, index) => column.merges.map(rectangle(TIME_COLUMNS + index))),
      ...rows.flatMap((row, index) => breakMerges(row, index, columns)),
    ],
    columnWidths: [
      TIME_COLUMN_WIDTH,
      SEPARATOR_COLUMN_WIDTH,
      TIME_COLUMN_WIDTH,
      ...display.weekdays.map(() => display.weekdayColumnWidth),
    ],
    rowHeights: [
      "fit",
      "fit",
      SPACER_ROW_HEIGHT,
      LINE_HEIGHT,
      ...rows.map((row) => (row.kind === "slot" ? SLOT_ROW_HEIGHT : LINE_HEIGHT)),
    ],
  };
}

/** The two rows the Class and the Term are written across. */
const TITLE_ROWS = 2;

/**
 * One row of the grid below the headings: a Slot, or a labelled Break.
 *
 * A Break earns a row only when it is labelled, because an unlabelled one has
 * nothing to say that the Slot times either side of it do not already say. A
 * labelled one reads as a band across the week — lunch, the long morning break
 * — and that band is what the row is for.
 */
type BodyRow =
  | { kind: "slot"; slot: Slot; /** Its position among the Slots, counting from 1. */ position: number }
  | { kind: "break"; label: string };

function bodyRows(schoolDay: SchoolDay): BodyRow[] {
  const rows: BodyRow[] = [];
  let position = 0;

  for (const entry of schoolDay.sequence) {
    if (entry.kind === "slot") {
      rows.push({ kind: "slot", slot: entry, position: ++position });
    } else if (entry.label !== undefined && entry.label !== "") {
      rows.push({ kind: "break", label: entry.label });
    }
  }

  return rows;
}

/**
 * One weekday's column: what each row shows, which stretches of it are one
 * cell, and which rows a Block covers.
 *
 * A Block of two or more Slots is one vertically merged cell, so that it reads
 * as one lesson at a glance, and the subject is written in the cell the merge
 * keeps, which is its first. A Block swallows any Break row it spans (ADR-0008).
 * The Slots no Block covers are empty, and a run of them merges the same way,
 * so a day that stops early reads as one gap rather than as a column of blank
 * cells.
 */
interface WeekdayColumn {
  /** What each row shows, blank under a merge and where nothing is taught. */
  text: string[];
  /** The stretches of two or more rows that are one cell, by row position. */
  merges: Span[];
  /** Which rows a Block covers; a Break row it does not shows its band. */
  spanned: boolean[];
}

/** A run of rows, counting from the first row below the headings. */
interface Span {
  first: number;
  last: number;
}

function columnOf(intake: Intake, weekday: Weekday, rows: BodyRow[]): WeekdayColumn {
  const rowOfSlot = slotRows(rows);
  const text = rows.map(() => "");
  const spanned = rows.map(() => false);
  const blocks: Span[] = [];

  for (const block of blocksOn(intake.timetable, weekday)) {
    const span = spanOf(block, rowOfSlot);
    text[span.first] = block.subject;
    for (let row = span.first; row <= span.last; row++) spanned[row] = true;
    blocks.push(span);
  }

  const merges = [...blocks, ...gaps(rows, spanned)]
    .filter(coversSeveralRows)
    .sort((one, other) => one.first - other.first);

  return { text, merges, spanned };
}

/** Which row each Slot is on, by its position counting from 1. */
function slotRows(rows: BodyRow[]): number[] {
  const at: number[] = [];
  rows.forEach((row, index) => {
    if (row.kind === "slot") at[row.position] = index;
  });
  return at;
}

function spanOf(block: Block, rowOfSlot: number[]): Span {
  return { first: rowOfSlot[block.firstSlot] ?? 0, last: rowOfSlot[block.lastSlot] ?? 0 };
}

/**
 * The stretches of Slot rows no Block covers, each of them one empty cell. A
 * Break row interrupts a stretch rather than joining it: nothing is taught
 * either side of the Break, so there is no lesson to swallow it, and the band
 * reads across every column that way.
 */
function gaps(rows: BodyRow[], spanned: boolean[]): Span[] {
  return runsOf(rows.length, (at) => rows[at]?.kind === "slot" && spanned[at] !== true);
}

/**
 * The maximal runs of consecutive positions that hold. The empty stretches down
 * a weekday column and the free stretches across a Break row are the same shape
 * — a run of cells that reads as one.
 */
function runsOf(length: number, holds: (at: number) => boolean): Span[] {
  const runs: Span[] = [];
  let running: Span | undefined;

  for (let at = 0; at < length; at++) {
    if (holds(at)) {
      running = running === undefined ? { first: at, last: at } : { ...running, last: at };
      continue;
    }
    if (running !== undefined) runs.push(running);
    running = undefined;
  }

  if (running !== undefined) runs.push(running);
  return runs;
}

function coversSeveralRows(span: Span): boolean {
  return span.last > span.first;
}

/** Where a column's stretch of rows sits in the grid. */
function rectangle(column: number) {
  return (span: Span): Rectangle => ({
    firstRow: HEADING_ROWS + span.first,
    lastRow: HEADING_ROWS + span.last,
    firstColumn: column,
    lastColumn: column,
  });
}

/**
 * The bands a labelled Break row reads as: one per run of weekday columns no
 * Block is spanning, each carrying the label in the cell a merge would keep,
 * which is its first.
 *
 * Where no weekday is spanned there is a single run, and it reaches leftwards
 * over the time columns as well: a Break the whole week shares is one band
 * across the sheet rather than one that starts under Monday. This is the only
 * thing ever written in a Break row's time columns, which otherwise stay empty
 * — the Slots above and below already say when the Break runs.
 */
function breakBands(index: number, columns: WeekdayColumn[]): Rectangle[] {
  const acrossTheWeek = columns.every((column) => column.spanned[index] !== true);

  return freeRuns(index, columns).map((run) => ({
    firstRow: HEADING_ROWS + index,
    lastRow: HEADING_ROWS + index,
    firstColumn: acrossTheWeek ? 0 : TIME_COLUMNS + run.first,
    lastColumn: TIME_COLUMNS + run.last,
  }));
}

/**
 * A Break row's own merges: every band of more than one column becomes one
 * cell, so that it reads unbroken rather than as a row of separate boxes. A
 * band of a single weekday is left alone — there is nothing to merge it with,
 * and merging it with its neighbour would join it to a column a Block spans.
 */
function breakMerges(row: BodyRow, index: number, columns: WeekdayColumn[]): Rectangle[] {
  if (row.kind !== "break") return [];

  return breakBands(index, columns).filter((band) => band.lastColumn > band.firstColumn);
}

/**
 * The runs of weekday columns a Break row is free in, left to right. A column a
 * Block spans is not free: the merged lesson covers the Break row there, which
 * is what "a Block swallows the Break" means on the page.
 */
function freeRuns(index: number, columns: WeekdayColumn[]): Span[] {
  return runsOf(columns.length, (at) => columns[at]?.spanned[index] !== true);
}

/** A title row: the text in the first cell, the rest blank under the merge. */
function titleRow(text: string, role: CellRole, width: number): Cell[] {
  return Array.from({ length: width }, (_, column) => ({
    text: column === 0 ? text : "",
    role,
    edges: unruled(),
  }));
}

function headerRow(headers: string[]): Cell[] {
  return [
    ...timeCells("header", ["", "", ""]),
    ...headers.map((text) => ({ text, role: "header" as const, edges: boxed() })),
  ];
}

/**
 * One row below the headings, whichever kind it is. A Slot's row says when it
 * starts, a separator, when it ends, and then what each weekday shows in it;
 * every Slot gets a row even when no weekday has a Lesson in it, so the sheet
 * says how far the school day extends.
 */
function bodyRow(row: BodyRow, index: number, rows: number, columns: WeekdayColumn[]): Cell[] {
  return row.kind === "slot"
    ? slotRow(row.slot, columns.map((column) => column.text[index] ?? ""))
    : breakRow(row, index, rows, columns);
}

function slotRow(slot: Slot, weekdays: string[]): Cell[] {
  return [
    ...timeCells("time", [slot.start, TIME_SEPARATOR, slot.end]),
    ...weekdays.map((text) => ({ text, role: "subject" as const, edges: boxed() })),
  ];
}

/**
 * A labelled Break's row: its bands, each with the label in it, and no times,
 * because the Slots above and below it already say when it runs. Where every
 * weekday is spanned by a Block there is no band, so the label has nowhere to
 * go and is not rendered at all, which follows from rendering it per column
 * (ADR-0008).
 */
function breakRow(
  row: { label: string },
  index: number,
  rows: number,
  columns: WeekdayColumn[],
): Cell[] {
  const width = TIME_COLUMNS + columns.length;
  const labelled = new Set(breakBands(index, columns).map((band) => band.firstColumn));

  // The band carries no lines of its own — only whatever part of the table's
  // own frame it happens to sit on, which is its left and right edge, and its
  // bottom when no Slot row follows to draw one.
  return Array.from({ length: width }, (_, at) => ({
    text: labelled.has(at) ? row.label : "",
    role: "break" as const,
    edges: {
      ...unruled(),
      left: at === 0,
      right: at === width - 1,
      bottom: index === rows - 1,
    },
  }));
}

/**
 * The three time columns of one row. They are ruled as a single box with no
 * lines between them, so that `08:00 – 08:40` reads as one time rather than as
 * three cells that happen to be adjacent.
 */
function timeCells(role: CellRole, texts: [string, string, string]): Cell[] {
  const [start, separator, end] = texts;
  return [
    { text: start, role, edges: { ...boxed(), right: false } },
    { text: separator, role, edges: { top: true, right: false, bottom: true, left: false } },
    { text: end, role, edges: { ...boxed(), left: false } },
  ];
}

function blanks(role: CellRole, howMany: number, edges: () => Edges): Cell[] {
  return Array.from({ length: howMany }, () => ({ text: "", role, edges: edges() }));
}

function boxed(): Edges {
  return { top: true, right: true, bottom: true, left: true };
}

function unruled(): Edges {
  return { top: false, right: false, bottom: false, left: false };
}

function fullWidthRows(through: number, width: number): Rectangle[] {
  return Array.from({ length: through }, (_, row) => ({
    firstRow: row,
    lastRow: row,
    firstColumn: 0,
    lastColumn: width - 1,
  }));
}
