import type { SheetsRequest } from "../ports/sheets.js";
import type { Cell, CellRole, Grid, Rectangle } from "./grid.js";

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
    ...grid.columnWidths.map((pixels, column) => ({
      updateDimensionProperties: {
        range: { sheetId: tab.sheetId, dimension: "COLUMNS", startIndex: column, endIndex: column + 1 },
        properties: { pixelSize: pixels },
        fields: "pixelSize",
      },
    })),
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

function cellData(cell: Cell): Record<string, unknown> {
  return {
    userEnteredValue: { stringValue: cell.text },
    userEnteredFormat: FORMATS[cell.role],
  };
}

/**
 * How each kind of cell is drawn. A printed copy has to identify itself and
 * read across a room, so the Class is the largest thing on the page and every
 * cell is centred in its own — subjects vertically too, since a merged cell is
 * as tall as the Block it covers.
 */
const CENTRED = { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } as const;

const FORMATS: Record<CellRole, Record<string, unknown>> = {
  class: { ...CENTRED, textFormat: { bold: true, fontSize: 14 } },
  term: { ...CENTRED, textFormat: { bold: false, fontSize: 11 } },
  header: { ...CENTRED, textFormat: { bold: true, fontSize: 11 } },
  time: { ...CENTRED, textFormat: { bold: false, fontSize: 10 } },
  // A subject is the one thing here that can outgrow its column.
  subject: { ...CENTRED, wrapStrategy: "WRAP", textFormat: { bold: false, fontSize: 10 } },
};
