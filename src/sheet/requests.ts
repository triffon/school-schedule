import type { SheetsRequest } from "../ports/sheets.js";
import type { Cell, CellRole, Edges, Grid, Rectangle, RowHeight } from "./grid.js";

/**
 * How Google is told to draw the grid: one batch of requests that regenerates
 * the tab whole — its size, its values, its formatting, its column widths and
 * its merges — so that republishing after the School day changed leaves nothing
 * of the old layout behind (ADR-0007).
 *
 * The order matters and is the reason this is one list rather than a set: the
 * merges of the previous run are dropped before the grid is resized under them,
 * and the grid is resized before anything is written into it.
 */
export function layoutRequests(grid: Grid, tab: TargetTab): SheetsRequest[] {
  const rows = grid.cells.length;
  const columns = grid.cells[0]?.length ?? 0;

  return [
    ...(tab.creating
      ? [{ addSheet: { properties: { sheetId: tab.sheetId, title: tab.title } } }]
      : []),
    { unmergeCells: { range: { sheetId: tab.sheetId } } },
    {
      updateSheetProperties: {
        properties: { sheetId: tab.sheetId, gridProperties: { rowCount: rows, columnCount: columns } },
        fields: "gridProperties.rowCount,gridProperties.columnCount",
      },
    },
    {
      updateCells: {
        start: { sheetId: tab.sheetId, rowIndex: 0, columnIndex: 0 },
        rows: grid.cells.map((row) => ({ values: row.map(cellData) })),
        fields: "userEnteredValue,userEnteredFormat",
      },
    },
    ...grid.columnWidths.map(pinned(tab.sheetId, "COLUMNS")),
    ...rowHeightRequests(grid.rowHeights, tab.sheetId),
    ...grid.merges.map((rectangle) => ({
      mergeCells: { range: range(tab.sheetId, rectangle), mergeType: "MERGE_ALL" },
    })),
  ];
}

/** The one tab a run writes to, as the batch needs to know it. */
export interface TargetTab {
  sheetId: number;
  title: string;
  /** True when the tab is not there yet, so the batch has to add it first. */
  creating: boolean;
}

/** A sheetId no tab in the spreadsheet is using. */
export function freeSheetId(taken: number[]): number {
  return Math.max(-1, ...taken) + 1;
}

function range(sheetId: number, rectangle: Rectangle): Record<string, number> {
  return {
    sheetId,
    startRowIndex: rectangle.firstRow,
    endRowIndex: rectangle.lastRow + 1,
    startColumnIndex: rectangle.firstColumn,
    endColumnIndex: rectangle.lastColumn + 1,
  };
}

/** One column's width or one row's height, pinned to a number of pixels. */
function pinned(sheetId: number, dimension: "COLUMNS" | "ROWS") {
  return (pixels: number, index: number): SheetsRequest => ({
    updateDimensionProperties: {
      range: { sheetId, dimension, startIndex: index, endIndex: index + 1 },
      properties: { pixelSize: pixels },
      fields: "pixelSize",
    },
  });
}

/**
 * The row heights. A pinned row is given its pixel count; a `fit` row is handed
 * to Sheets to size, which is both how it ends up as tall as its own text and
 * how a height pinned by a previous run is undone — setting a pixel size makes
 * a row manually sized, and only an auto-resize takes that back (ADR-0007).
 */
function rowHeightRequests(heights: RowHeight[], sheetId: number): SheetsRequest[] {
  return heights.map((height, index) =>
    height === "fit"
      ? {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 },
          },
        }
      : pinned(sheetId, "ROWS")(height, index),
  );
}

function cellData(cell: Cell): Record<string, unknown> {
  return {
    userEnteredValue: { stringValue: cell.text },
    userEnteredFormat: { ...FORMATS[cell.role], ...ruling(cell.edges) },
  };
}

/**
 * How each kind of cell is drawn. A printed copy has to identify itself and
 * read across a room, so the Class is the largest thing on the page and every
 * cell is centred horizontally.
 *
 * Vertically they differ, and deliberately: a Slot row is two lines tall, so a
 * subject sits in the middle of the cell the Block merged, its time sits in
 * the middle of the row it belongs to, and a heading sits on the line the
 * grid starts at.
 */
const CENTRED = { horizontalAlignment: "CENTER" } as const;
const HEADING = { ...CENTRED, verticalAlignment: "BOTTOM" } as const;
const FROM_THE_TOP = { ...CENTRED, verticalAlignment: "TOP" } as const;

/** Grey for the weekday headers, a lighter one for a Break's band. */
const HEADER_GREY = { red: 217 / 255, green: 217 / 255, blue: 217 / 255 };
const BREAK_GREY = { red: 239 / 255, green: 239 / 255, blue: 239 / 255 };

const FORMATS: Record<CellRole, Record<string, unknown>> = {
  class: { ...HEADING, textFormat: { bold: true, fontSize: 14 } },
  term: { ...HEADING, textFormat: { bold: true, italic: true, fontSize: 11 } },
  // The blank row between the heading and the grid: nothing to align, only a
  // height, so it is told no more than what it is.
  spacer: { verticalAlignment: "BOTTOM", textFormat: { bold: true, fontSize: 11 } },
  header: { ...HEADING, backgroundColor: HEADER_GREY, textFormat: { bold: true, fontSize: 11 } },
  time: { ...CENTRED, verticalAlignment: "MIDDLE", textFormat: { bold: true, fontSize: 11 } },
  // A subject is the one thing here that can outgrow its column.
  subject: {
    ...CENTRED,
    verticalAlignment: "MIDDLE",
    wrapStrategy: "WRAP",
    textFormat: { bold: false, fontSize: 11 },
  },
  break: {
    ...FROM_THE_TOP,
    backgroundColor: BREAK_GREY,
    textFormat: { bold: false, italic: true, fontSize: 11 },
  },
};

/** A ruled side, which is the only kind of line the grid draws. */
const RULE = { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } } as const;

/**
 * A cell's lines. Left out altogether when it has none, so that a heading row
 * is told it has no borders rather than told it has four empty ones.
 */
function ruling(edges: Edges): Record<string, unknown> {
  const ruled = Object.entries(edges).filter(([, drawn]) => drawn);
  return ruled.length === 0
    ? {}
    : { borders: Object.fromEntries(ruled.map(([side]) => [side, RULE])) };
}
