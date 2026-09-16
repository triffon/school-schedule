import type { SheetsRequest } from "../../src/ports/sheets.js";
import type { FakeSheetsClient } from "./fake-sheets.js";

/**
 * A spreadsheet as it stands after everything a run sent it: what a person
 * opening the tab would see, rather than the requests that got it there.
 *
 * The seam the pipeline is tested at records Sheets requests, and a grid
 * assembled out of dozens of them is unreadable in a failure message. This
 * applies them the way Sheets would — in order, so that a merge before its
 * unmerge or a value written outside the grid shows up as a wrong rendering
 * rather than passing unnoticed — and hands back the result.
 */
export interface RenderedTab {
  title: string;
  sheetId: number;
  /** True when the run created this tab rather than finding it there. */
  created: boolean;
  /** Cell values, row-major. A cell nothing wrote to reads as an empty string. */
  values: string[][];
  /** How each cell is drawn, row-major, where the run said. */
  formats: (Record<string, unknown> | undefined)[][];
  /** Merged rectangles in A1 notation — `D4:D5` — in the order they were made. */
  merges: string[];
  /** Column widths in pixels, by column, where the run set one. */
  columnWidths: (number | undefined)[];
  /**
   * Row heights by row: a number where the run pinned one, `"fit"` where it
   * handed the row to Sheets to size, and `undefined` where it said nothing.
   * How tall Sheets makes a `"fit"` row depends on font metrics this renderer
   * has no business guessing at, so it records the instruction rather than a
   * height it would have to invent.
   */
  rowHeights: (number | "fit" | undefined)[];
  /** True where the run wrote anything at all to the tab. */
  written: boolean;
}

/** Every tab of a spreadsheet, by title, as the run left it. */
export function renderedTabs(
  sheets: FakeSheetsClient,
  spreadsheetId: string,
): Map<string, RenderedTab> {
  const tabs = new Map<number, MutableTab>(
    sheets.tabsOf(spreadsheetId).map((tab) => [tab.sheetId, blankTab(tab.title, tab.sheetId, false)]),
  );

  for (const batch of sheets.batches) {
    if (batch.spreadsheetId !== spreadsheetId) continue;
    for (const request of batch.requests) apply(request, tabs);
  }

  return new Map([...tabs.values()].map((tab) => [tab.title, rendered(tab)]));
}

/** The one tab a run was meant to own, failing loudly when it is not there. */
export function renderedTab(
  sheets: FakeSheetsClient,
  spreadsheetId: string,
  title: string,
): RenderedTab {
  const tab = renderedTabs(sheets, spreadsheetId).get(title);
  if (tab === undefined) {
    const there = [...renderedTabs(sheets, spreadsheetId).keys()];
    throw new Error(`no tab named "${title}" in ${spreadsheetId}; there is: ${there.join(", ")}`);
  }
  return tab;
}

interface MutableTab {
  title: string;
  sheetId: number;
  created: boolean;
  written: boolean;
  rowCount: number;
  columnCount: number;
  cells: Map<string, string>;
  formats: Map<string, Record<string, unknown>>;
  merges: GridRange[];
  columnWidths: (number | undefined)[];
  rowHeights: (number | "fit" | undefined)[];
}

/** How one cell is drawn, named the way a person reads a spreadsheet: `A1`. */
export function formatAt(tab: RenderedTab, cell: string): Record<string, unknown> | undefined {
  const parsed = /^([A-Z]+)(\d+)$/.exec(cell);
  if (parsed?.[1] === undefined || parsed[2] === undefined) {
    throw new Error(`"${cell}" is not a cell in A1 notation`);
  }

  const column = [...parsed[1]].reduce((so, letter) => so * 26 + (letter.charCodeAt(0) - 64), 0) - 1;
  return tab.formats[Number(parsed[2]) - 1]?.[column];
}

interface GridRange {
  sheetId: number;
  startRowIndex?: number;
  endRowIndex?: number;
  startColumnIndex?: number;
  endColumnIndex?: number;
}

function blankTab(title: string, sheetId: number, created: boolean): MutableTab {
  return {
    title,
    sheetId,
    created,
    written: created,
    // What Sheets gives a new tab, so that a run which never sizes its grid is
    // rendered against the same default a real spreadsheet would use.
    rowCount: 1000,
    columnCount: 26,
    cells: new Map(),
    formats: new Map(),
    merges: [],
    columnWidths: [],
    rowHeights: [],
  };
}

function apply(request: SheetsRequest, tabs: Map<number, MutableTab>): void {
  const [kind, body] = single(request);

  switch (kind) {
    case "addSheet":
      return addSheet(body, tabs);
    case "updateSheetProperties":
      return updateSheetProperties(body, tabs);
    case "updateCells":
      return updateCells(body, tabs);
    case "mergeCells":
      return mergeCells(body, tabs);
    case "unmergeCells":
      return unmergeCells(body, tabs);
    case "updateDimensionProperties":
      return updateDimensionProperties(body, tabs);
    case "autoResizeDimensions":
      return autoResizeDimensions(body, tabs);
    default:
      throw new Error(
        `this test renderer does not understand the Sheets request "${kind}": ${JSON.stringify(request)}`,
      );
  }
}

function addSheet(body: Record<string, unknown>, tabs: Map<number, MutableTab>): void {
  const properties = object(body["properties"], "addSheet.properties");
  const sheetId = number(properties["sheetId"], "addSheet.properties.sheetId");
  const title = string(properties["title"], "addSheet.properties.title");

  if (tabs.has(sheetId)) throw new Error(`a tab with sheetId ${sheetId} is already there`);
  if ([...tabs.values()].some((tab) => tab.title === title)) {
    throw new Error(`a tab named "${title}" is already there`);
  }

  tabs.set(sheetId, blankTab(title, sheetId, true));
}

function updateSheetProperties(
  body: Record<string, unknown>,
  tabs: Map<number, MutableTab>,
): void {
  const properties = object(body["properties"], "updateSheetProperties.properties");
  const tab = target(number(properties["sheetId"], "updateSheetProperties.sheetId"), tabs);
  const grid = properties["gridProperties"];
  if (grid === undefined) return;

  const sizes = object(grid, "updateSheetProperties.gridProperties");
  if (sizes["rowCount"] !== undefined) {
    tab.rowCount = number(sizes["rowCount"], "gridProperties.rowCount");
  }
  if (sizes["columnCount"] !== undefined) {
    tab.columnCount = number(sizes["columnCount"], "gridProperties.columnCount");
  }
  tab.written = true;
}

function updateCells(body: Record<string, unknown>, tabs: Map<number, MutableTab>): void {
  const rows = body["rows"];

  if (rows === undefined) {
    // A clear: every cell the range covers loses what it held.
    const range = gridRange(body["range"], "updateCells.range");
    const tab = target(range.sheetId, tabs);
    for (const key of [...tab.cells.keys(), ...tab.formats.keys()]) {
      const [row, column] = key.split(",").map(Number) as [number, number];
      if (!covers(range, tab, row, column)) continue;
      tab.cells.delete(key);
      tab.formats.delete(key);
    }
    tab.written = true;
    return;
  }

  const start = object(body["start"], "updateCells.start");
  const tab = target(number(start["sheetId"], "updateCells.start.sheetId"), tabs);
  const firstRow = number(start["rowIndex"] ?? 0, "updateCells.start.rowIndex");
  const firstColumn = number(start["columnIndex"] ?? 0, "updateCells.start.columnIndex");

  list(rows, "updateCells.rows").forEach((row, rowOffset) => {
    const values = list(object(row, "updateCells.rows[]")["values"] ?? [], "row.values");
    values.forEach((cell, columnOffset) => {
      const at = { row: firstRow + rowOffset, column: firstColumn + columnOffset };
      if (at.row >= tab.rowCount || at.column >= tab.columnCount) {
        throw new Error(
          `${a1(at.row, at.column)} is outside the grid of "${tab.title}", which is ` +
            `${tab.rowCount} rows by ${tab.columnCount} columns`,
        );
      }
      tab.cells.set(`${at.row},${at.column}`, cellText(cell));
      const format = object(cell, "a cell")["userEnteredFormat"];
      if (format !== undefined) {
        tab.formats.set(`${at.row},${at.column}`, object(format, "userEnteredFormat"));
      }
    });
  });

  tab.written = true;
}

function mergeCells(body: Record<string, unknown>, tabs: Map<number, MutableTab>): void {
  const range = gridRange(body["range"], "mergeCells.range");
  const tab = target(range.sheetId, tabs);

  if (tab.merges.some((existing) => overlap(existing, tab, range))) {
    throw new Error(`${rangeName(range, tab)} overlaps a merge already made on "${tab.title}"`);
  }

  tab.merges.push(range);
  tab.written = true;
}

function unmergeCells(body: Record<string, unknown>, tabs: Map<number, MutableTab>): void {
  const range = gridRange(body["range"], "unmergeCells.range");
  const tab = target(range.sheetId, tabs);
  tab.merges = tab.merges.filter((existing) => !overlap(existing, tab, range));
  tab.written = true;
}

function updateDimensionProperties(
  body: Record<string, unknown>,
  tabs: Map<number, MutableTab>,
): void {
  const range = object(body["range"], "updateDimensionProperties.range");
  const tab = target(number(range["sheetId"], "updateDimensionProperties.sheetId"), tabs);
  const dimension = string(range["dimension"], "updateDimensionProperties.dimension");
  if (dimension !== "COLUMNS" && dimension !== "ROWS") return;

  const pixels = number(
    object(body["properties"], "updateDimensionProperties.properties")["pixelSize"],
    "properties.pixelSize",
  );
  const along = dimension === "COLUMNS" ? tab.columnWidths : tab.rowHeights;
  const from = number(range["startIndex"] ?? 0, "range.startIndex");
  const to = number(
    range["endIndex"] ?? (dimension === "COLUMNS" ? tab.columnCount : tab.rowCount),
    "range.endIndex",
  );
  for (let at = from; at < to; at++) along[at] = pixels;
  tab.written = true;
}

/**
 * A row handed to Sheets to size. Recorded as the instruction it is: a run that
 * pinned the row on a previous pass and auto-resizes it on this one has undone
 * that pinning, which is the whole reason the request is sent.
 */
function autoResizeDimensions(
  body: Record<string, unknown>,
  tabs: Map<number, MutableTab>,
): void {
  const range = object(body["dimensions"], "autoResizeDimensions.dimensions");
  const tab = target(number(range["sheetId"], "autoResizeDimensions.sheetId"), tabs);
  const dimension = string(range["dimension"], "autoResizeDimensions.dimension");
  if (dimension !== "ROWS") return;

  const from = number(range["startIndex"] ?? 0, "dimensions.startIndex");
  const to = number(range["endIndex"] ?? tab.rowCount, "dimensions.endIndex");
  for (let row = from; row < to; row++) tab.rowHeights[row] = "fit";
  tab.written = true;
}

function rendered(tab: MutableTab): RenderedTab {
  const values = Array.from({ length: tab.rowCount }, (_, row) =>
    Array.from({ length: tab.columnCount }, (_, column) => tab.cells.get(`${row},${column}`) ?? ""),
  );

  const formats = Array.from({ length: tab.rowCount }, (_, row) =>
    Array.from({ length: tab.columnCount }, (_, column) => tab.formats.get(`${row},${column}`)),
  );

  return {
    title: tab.title,
    sheetId: tab.sheetId,
    created: tab.created,
    written: tab.written,
    values,
    formats,
    merges: tab.merges.map((range) => rangeName(range, tab)),
    columnWidths: [...tab.columnWidths],
    rowHeights: [...tab.rowHeights],
  };
}

function target(sheetId: number, tabs: Map<number, MutableTab>): MutableTab {
  const tab = tabs.get(sheetId);
  if (tab === undefined) throw new Error(`no tab with sheetId ${sheetId} in this spreadsheet`);
  return tab;
}

/** A range's bounds, with the omitted ones meaning "the whole sheet". */
function bounds(range: GridRange, tab: MutableTab) {
  return {
    firstRow: range.startRowIndex ?? 0,
    lastRow: (range.endRowIndex ?? tab.rowCount) - 1,
    firstColumn: range.startColumnIndex ?? 0,
    lastColumn: (range.endColumnIndex ?? tab.columnCount) - 1,
  };
}

function covers(range: GridRange, tab: MutableTab, row: number, column: number): boolean {
  const at = bounds(range, tab);
  return row >= at.firstRow && row <= at.lastRow && column >= at.firstColumn && column <= at.lastColumn;
}

function overlap(one: GridRange, tab: MutableTab, other: GridRange): boolean {
  const here = bounds(one, tab);
  const there = bounds(other, tab);
  return (
    here.firstRow <= there.lastRow &&
    there.firstRow <= here.lastRow &&
    here.firstColumn <= there.lastColumn &&
    there.firstColumn <= here.lastColumn
  );
}

function rangeName(range: GridRange, tab: MutableTab): string {
  const at = bounds(range, tab);
  return `${a1(at.firstRow, at.firstColumn)}:${a1(at.lastRow, at.lastColumn)}`;
}

/** `D4` — the notation a person reads a spreadsheet in. */
function a1(row: number, column: number): string {
  let letters = "";
  for (let rest = column; rest >= 0; rest = Math.floor(rest / 26) - 1) {
    letters = String.fromCharCode(65 + (rest % 26)) + letters;
  }
  return `${letters}${row + 1}`;
}

/** What a cell shows, which for everything the pipeline writes is a string. */
function cellText(cell: unknown): string {
  const value = object(cell, "a cell")["userEnteredValue"];
  if (value === undefined) return "";
  const entered = object(value, "userEnteredValue");
  if (entered["stringValue"] === undefined) {
    throw new Error(`this test renderer only reads stringValue cells, got ${JSON.stringify(entered)}`);
  }
  return string(entered["stringValue"], "userEnteredValue.stringValue");
}

function single(request: SheetsRequest): [string, Record<string, unknown>] {
  const keys = Object.keys(request);
  if (keys.length !== 1 || keys[0] === undefined) {
    throw new Error(`a Sheets request carries exactly one kind, got: ${JSON.stringify(request)}`);
  }
  return [keys[0], object(request[keys[0]], keys[0])];
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${at} should be an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${at} should be a list, got ${JSON.stringify(value)}`);
  return value;
}

function string(value: unknown, at: string): string {
  if (typeof value !== "string") {
    throw new Error(`${at} should be a string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function number(value: unknown, at: string): number {
  if (typeof value !== "number") {
    throw new Error(`${at} should be a number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function gridRange(value: unknown, at: string): GridRange {
  const range = object(value, at);
  return {
    sheetId: number(range["sheetId"], `${at}.sheetId`),
    ...(range["startRowIndex"] === undefined
      ? {}
      : { startRowIndex: number(range["startRowIndex"], `${at}.startRowIndex`) }),
    ...(range["endRowIndex"] === undefined
      ? {}
      : { endRowIndex: number(range["endRowIndex"], `${at}.endRowIndex`) }),
    ...(range["startColumnIndex"] === undefined
      ? {}
      : { startColumnIndex: number(range["startColumnIndex"], `${at}.startColumnIndex`) }),
    ...(range["endColumnIndex"] === undefined
      ? {}
      : { endColumnIndex: number(range["endColumnIndex"], `${at}.endColumnIndex`) }),
  };
}
